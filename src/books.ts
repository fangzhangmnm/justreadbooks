// books —— 书的动词层：store 之上「一本书」的动词（列表订阅 / 打开 / 后台追新 / 留离线 / 移除离线 / 上传 / 补推）。
// created 2026-09-19 by Claude Fable 5.1（对齐 WXHW docs.ts；红线全在库内 enforce：If-Match / .trash / 冲突 sheet / dirty 永不驱逐）。
// 本层只做：路径/扩展名约定、隐藏名过滤、把库的结果式返回翻成 UI 能画的东西。**永不改写既有书**（save 只出现在上传/补推）。
import type { SyncState, FolderSnapshot, FreshResult, RawFile, WatchFolderErrorPhase } from "@internal/store";
import { requireStore, auth, isCached, isDirty } from "./app-store.ts";
import { BOOK_EXTS, HIDDEN_NAME_RE, BIG_BOOK_BYTES } from "./config.ts";
import { decodeBytes, encodeUtf8 } from "./encoding.ts";

export interface BookListItem {
  /** 身份（全路径，含 .txt）。 */
  name: string;
  dir: string;
  /** 显示名（不含夹、不含扩展名）。 */
  stem: string;
  syncState: SyncState;
  cached: boolean;
  dirty: boolean;
  size?: number;
  lastModified?: number;
}
export interface BookListFrame { folder: string; items: BookListItem[]; folders: string[]; complete: boolean; stale: boolean }

export function isBookName(path: string): boolean { return BOOK_EXTS.some((e) => path.toLowerCase().endsWith(e)) && !HIDDEN_NAME_RE.test(path); }
export function isHiddenName(path: string): boolean { return HIDDEN_NAME_RE.test(path); }
export function splitPath(path: string): { dir: string; base: string } { const i = path.lastIndexOf("/"); return i < 0 ? { dir: "", base: path } : { dir: path.slice(0, i), base: path.slice(i + 1) }; }
export function joinPath(dir: string, base: string): string { return dir ? `${dir}/${base}` : base; }
export function stemOf(path: string): string { return splitPath(path).base.replace(/\.txt$/i, ""); }

const file = (name: string, mode: "new" | "existing" = "existing"): RawFile => requireStore().file(name, { isZip: false, mode });
const online = () => typeof navigator === "undefined" || navigator.onLine !== false;

// ── 列表（唯一列举面 = watchFolder 当前夹；只认 *.txt 直属项 + immediate 子夹）──
export function watchBooks(folder: string, cb: (frame: BookListFrame) => void, opts?: { onError?: (err: unknown, phase: WatchFolderErrorPhase) => void }): () => void {
  const prefix = folder ? `${folder}/` : "";
  const emit = (snap: FolderSnapshot) => {
    const folders = snap.folders.map((f) => (f.startsWith(prefix) ? f.slice(prefix.length) : f)).filter((f) => f && !f.includes("/"));
    const items: BookListItem[] = snap.items.filter((it) => isBookName(it.path)).map((it) => ({
      name: it.path, dir: splitPath(it.path).dir, stem: stemOf(it.path),
      syncState: it.syncState, cached: isCached(it.syncState), dirty: isDirty(it.syncState),
      ...(it.size != null ? { size: it.size } : {}), ...(it.lastModified != null ? { lastModified: it.lastModified } : {}),
    }));
    cb({ folder, items, folders, complete: snap.complete, stale: !!snap.stale });
  };
  return requireStore().files.watchFolder(folder, emit, opts);
}

// ── 打开（计划 §2 前提 0：本地优先，永不为网络转圈）──
export type OpenBookResult =
  | { kind: "ok"; blob: Blob; /** 首帧来自本地副本（秒开）；false = 刚下载的。 */ fromLocal: boolean }
  | { kind: "too-big"; size: number }
  | { kind: "unavailable" };   // 本地无且云端不可达
/** 有本地副本 → 立刻返回（不等 token、不等网）；没有 → 带进度下载（keepOffline 分片会话）再 open。size 已知且超阈值又没 allowBig → too-big（调用方弹诚实提示）。 */
export async function openBook(name: string, opts: { size?: number; allowBig?: boolean; onProgress?: (done: number, total: number) => void } = {}): Promise<OpenBookResult> {
  const f = file(name);
  const kept = await f.isKeptOffline().catch(() => false);
  if (!kept && opts.size != null && opts.size > BIG_BOOK_BYTES && !opts.allowBig) return { kind: "too-big", size: opts.size };
  if (!kept && opts.onProgress && auth.isSignedIn() && online()) {
    try { await f.keepOffline({ onProgress: opts.onProgress }); } catch { /* 下面 open 再试一次，拿不到就 unavailable */ }
  }
  const blob = await f.open();
  if (!blob) return { kind: "unavailable" };
  return { kind: "ok", blob, fromLocal: kept };
}
/** 后台追新（前提 0 ①③）：本地 clean ∧ 云端有新版 → 拉新版覆盖本地缓存；返回库的 FreshResult（status "fast-forwarded" = 换了字节，调用方决定静默换底还是出 chip）。 */
export function refreshBookInBackground(name: string, opts?: { onReplaceStart?: () => void }): Promise<FreshResult> {
  return file(name).pullIfClean({ isOnline: online, ...(opts?.onReplaceStart ? { onReplaceStart: opts.onReplaceStart } : {}) });
}
export function isBookKeptOffline(name: string): Promise<boolean> { return file(name).isKeptOffline(); }
export function keepBookOffline(name: string, onProgress?: (done: number, total: number) => void): Promise<void> { return file(name).keepOffline(onProgress ? { onProgress } : undefined); }
/** 移除本机副本（只对可重取的 shadow 合法；本机唯一副本会抛 OffloadIllegalError——库 banner）。 */
export function offloadBook(name: string): Promise<void> { return file(name).offload(); }

// ── 上传（读者唯一的写路径；mode:"new" 撞名不覆盖）──
export interface UploadResult { name: string; pushed: boolean; encoding: string }
/** 拖进来的 txt：探测编码，非 UTF-8 先转码（别的设备拿到不乱码）；撞名自动追加 " 1"…；未登录/离线只落本机（local-only，回线 ask 补推）。 */
export async function uploadBook(src: File, dir: string): Promise<UploadResult> {
  const base0 = src.name.replace(/[\\/:*?"<>|]/g, "_").trim() || "book.txt";
  const base = /\.txt$/i.test(base0) ? base0 : `${base0}.txt`;
  const raw = new Uint8Array(await src.arrayBuffer());
  const { text, encoding } = decodeBytes(raw);
  const bytes = encoding === "utf-8" ? raw : encodeUtf8(text);
  const files = requireStore().files;
  let name = joinPath(dir, base);
  for (let n = 1; n < 200 && (await files.nameOccupied(name)); n++) name = joinPath(dir, base.replace(/\.txt$/i, ` ${n}.txt`));
  const r = await file(name, "new").save(bytes, { tryPush: auth.isSignedIn() && online() });
  return { name, pushed: r.pushed, encoding };
}
/** 本机唯一副本的书补推云端（卡片「推送到云端」）：字节不变，只是把 local-only 变 synced。 */
export async function pushBook(name: string): Promise<boolean> {
  const f = file(name);
  const blob = await f.open();
  if (!blob) return false;
  const r = await f.save(blob, { tryPush: true });
  return r.pushed;
}

// ── 改名（身份变 = tryMove；结果式不抛，撞名报 where）──
export type RenameResult = { ok: true; name: string } | { ok: false; where: "local" | "cloud" } | { ok: false; error: string };
export async function renameBook(name: string, newStem: string): Promise<RenameResult> {
  const stem = newStem.replace(/[\\/:*?"<>|]/g, "_").trim();
  if (!stem) return { ok: false, error: "empty" };
  const target = joinPath(splitPath(name).dir, `${stem}.txt`);
  if (target === name) return { ok: true, name };
  try {
    const r = await file(name).tryMove(target);
    if (r.ok) return { ok: true, name: target };
    return { ok: false, where: (r as { where: "local" | "cloud" }).where };
  } catch (e) { return { ok: false, error: String((e as { message?: unknown })?.message ?? e) }; }
}
