// reading-position —— 每本书的阅读位置（乙，user 2026-09-19 拍板）：synced collection，key = 路径，逐 item uat-LWW 由库承担；
// **没有全局 lastActive funnel**（v1 的跨设备跳书已删）。写盘节律 = valuable-save（10s 防抖 / 30s 封顶 / trivial-skip），防 OneDrive 版本史塞爆。
// created 2026-09-19 by Claude Fable 5.1 · 2026-10-21 条目带拍 + 未知键直通（家族格式版本纪律；src/format/migrate/；Claude Fable 5.1）：
//   每条 `{ version, minor, patch, anchor, readAt, …extra }`；major 比本版新的那条**不读也不写回**（告诉用户一次）；minor 更新 = 照常用、未知键原样带回、告诉用户一次。
import { readingPos } from "./app-store.ts";
import { createValuableSave } from "./valuable-save.ts";
import { isTrivialMove, clampFrac, type Anchor } from "./chapters/index.ts";
import { migrate, splitExtra, compose, FormatTooNewError } from "./format/migrate/index.ts";
import { POSITION_DEBOUNCE_MS, POSITION_HEARTBEAT_MS, TRIVIAL_FRAC_DELTA } from "./config.ts";
import { reportError } from "./error-badge.ts";
import { t } from "./i18n/index.ts";

export interface StoredPosition { anchor: Anchor; readAt: number }

const vs = createValuableSave({
  commit: async () => { const r = await readingPos.reconcileWithRemote(); if (r.status === "error") throw (r.error instanceof Error ? r.error : new Error(String(r.error ?? r.status))); },
  keepalive: () => { void readingPos.flushLocal(); },
  debounceMs: POSITION_DEBOUNCE_MS, ceilingMs: POSITION_HEARTBEAT_MS,
});

function normalize(v: Record<string, unknown>): StoredPosition | null {
  const a = v.anchor as { chapter?: unknown; title?: unknown; frac?: unknown } | undefined;
  if (!a || typeof a !== "object") return null;
  return { anchor: { chapter: Math.max(0, Math.floor(Number(a.chapter) || 0)), title: typeof a.title === "string" ? a.title : "", frac: clampFrac(Number(a.frac)) }, readAt: Number(v.readAt) || 0 };
}
// 一条条目读出来的三种结果：ok（含要原样带回的 extra 袋）/ too-new（更新版本写的，不读不写回）/ none（没有或损坏）。
type Inspected = { kind: "ok"; pos: StoredPosition; extra: Record<string, unknown> } | { kind: "too-new" } | { kind: "none" };
let toldNewerMinor = false, toldTooNew = false;   // 每次打开 app 各提醒一次（家族格式纪律 §2：minor 更新告诉一次；major 更新拒认、报一次）
function inspect(raw: unknown): Inspected {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { kind: "none" };
  let m: ReturnType<typeof migrate>;
  try { m = migrate("readingPosition", raw as Record<string, unknown>); }
  catch (e) {
    if (e instanceof FormatTooNewError) { if (!toldTooNew) { toldTooNew = true; reportError(e, "log"); reportError(t("fmt.tooNew"), "warning"); } return { kind: "too-new" }; }
    reportError(e, "log"); return { kind: "none" };
  }
  if (m.verdict === "newer-minor" && !toldNewerMinor) { toldNewerMinor = true; reportError(t("fmt.newerMinor"), "info"); }
  const { known, extra } = splitExtra("readingPosition", m.json);
  const pos = normalize(known);
  return pos ? { kind: "ok", pos, extra } : { kind: "none" };
}
/** 写一条：更新版本写的那条不碰；其余 = extra 原样带回 + 已知键 + 本版的拍。返回 false = 没写（too-new）。 */
function write(name: string, pos: StoredPosition): boolean {
  const cur = inspect(readingPos.getItem(name));
  if (cur.kind === "too-new") return false;
  readingPos.setItem(name, compose("readingPosition", cur.kind === "ok" ? cur.extra : {}, { anchor: pos.anchor, readAt: pos.readAt }));
  return true;
}
export function getPosition(name: string): StoredPosition | null { const r = inspect(readingPos.getItem(name)); return r.kind === "ok" ? r.pos : null; }
/** 阅读器报位置：trivial（同章微动）只标脏不调度；非 trivial 走防抖/封顶。 */
export function notePosition(name: string, anchor: Anchor): void {
  const cur = getPosition(name);
  if (!write(name, { anchor, readAt: Date.now() })) return;
  if (isTrivialMove(cur?.anchor ?? null, anchor, TRIVIAL_FRAC_DELTA)) vs.markTrivial(); else vs.mark();
}
/** 打开一本书（哪怕没滚）：刷 readAt（最近阅读排序）；没有位置条目就建一条。 */
export function markOpened(name: string): void {
  const cur = getPosition(name);
  if (write(name, { anchor: cur?.anchor ?? { chapter: 0, title: "", frac: 0 }, readAt: Date.now() })) vs.mark();
}
export function isUnread(name: string): boolean { return readingPos.getEntry(name) == null; }
/** 最近阅读（跨夹）：按 readAt 降序前 n 本。更新版本写的条目不参与（不猜它的字段）。 */
export function recentBooks(n: number): { name: string; readAt: number }[] {
  return readingPos.entries().map((e) => { const r = inspect(e.value); return { name: e.id, readAt: r.kind === "ok" ? r.pos.readAt : 0 }; }).filter((x) => x.readAt > 0).sort((a, b) => b.readAt - a.readAt).slice(0, n);
}
export function flushPosition(): Promise<void> { return vs.flush().catch((e) => { reportError(e, "log"); }); }
export function keepalivePosition(): void { vs.flushKeepalive(); }
export function positionIsDirty(): boolean { return vs.isDirty(); }
