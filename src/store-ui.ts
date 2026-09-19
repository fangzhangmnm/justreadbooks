// StoreUI adapter —— 给 @internal/store 的 ui bundle（busy / resolveConflict / reportError / offlineEscape / text / confirmReplay）。
// created 2026-09-19 by Claude Fable 5.1（WXHW / WeebPaint store-ui.ts 同形）。
//   读者 app 的要点：**后台拉取 / 新鲜度检查绝不上全屏遮罩**（user 2026-09-19「我不想开书时转很久」）——
//   sync.pushing / file.pulling / cloud.checking / file.renaming 走安静状态行；只有用户动作（回收站 / 建删夹 / 重传）才遮罩。
//   冲突必 surface（ADR-0009）：读者从不改写书，理论上不会撞 412；上传撞名 / 本地副本分叉时仍给真 sheet，绝不静默 cancel。
import type { StoreUI, StoreTextKey, StoreTextParams } from "@internal/store";
import { withBusy, lockSyncGate, settleSyncGate, openConfirmSheet } from "./sheets.ts";
import { t, type Key } from "./i18n/index.ts";
import { reportError } from "./error-badge.ts";

// 库 15 个 busy 文案 key → 本仓 i18n。穷举 Record：库加 key 本表漏映 = 编译错。
const STORE_TEXT_KEYS: Record<StoreTextKey, Key> = {
  "sync.pushing": "st.syncPushing",
  "file.renaming": "st.fileRenaming",
  "file.pulling": "st.filePulling",
  "cloud.checking": "st.cloudChecking",
  "file.deleting": "st.fileDeleting",
  "trash.restoring": "st.trashRestoring",
  "trash.purging": "st.trashPurging",
  "trash.emptyTrash": "st.trashEmptyTrash",
  "trash.emptyBackups": "st.trashEmptyBackups",
  "file.encrypting": "st.fileEncrypting",
  "file.decrypting": "st.fileDecrypting",
  "file.rekeying": "st.fileRekeying",
  "file.reuploading": "st.fileReuploading",
  "folder.creating": "st.folderCreating",
  "folder.deleting": "st.folderDeleting",
};
const stripExt = (n: string) => n.replace(/\.txt$/i, "");

const QUIET_KEYS = new Set<StoreTextKey>(["sync.pushing", "file.renaming", "file.pulling", "cloud.checking"]);
let _quietStatus: ((text: string) => void) | null = null;
/** 安静路径的状态行 sink（app 注入；不给 = 零 UI）。 */
export function setStoreQuietStatus(fn: (text: string) => void): void { _quietStatus = fn; }

export const storeUI: StoreUI = {
  busy: (label, fn, key) => (key && QUIET_KEYS.has(key) ? (_quietStatus?.(label), Promise.resolve().then(fn)) : withBusy(label, fn)),

  text: (key: StoreTextKey, params?: StoreTextParams): string | undefined => {
    const k = STORE_TEXT_KEYS[key];
    return k ? t(k, params) : undefined;
  },

  resolveConflict: async ({ name, occasion }): Promise<"keepMine" | "takeCloud" | "cancel"> => {
    const n = stripExt(name);
    const choice = occasion === "open"
      ? await lockSyncGate<"cancel" | "takeCloud">({
          title: t("cf.title"), message: t("cf.bodyOpen", { name: n }), note: t("cf.noteKeptSafe"),
          actions: [{ label: t("cf.openLocal"), value: "cancel", primary: true }, { label: t("cf.cloudWins"), value: "takeCloud" }],
        })
      : await lockSyncGate<"keepMine" | "takeCloud" | "cancel">({
          title: t("cf.title"), message: t("cf.bodyPush", { name: n }), note: t("cf.noteKeptSafe"),
          actions: [{ label: t("cf.localWins"), value: "keepMine", primary: true }, { label: t("cf.cloudWins"), value: "takeCloud" }, { label: t("common.cancel"), value: "cancel" }],
        });
    return choice ?? "cancel";
  },

  reportError: (err: unknown, level): void => {
    // 未登录时库的后台云动作会撞 auth 的 "Not signed in"——正常态不是故障，不上横幅
    if ((err as { message?: string } | null)?.message === "Not signed in") { reportError(err, "log"); return; }
    if ((err as { name?: string } | null)?.name === "CloudNetworkError") {
      reportError(err, "log");
      reportError(new Error(t("err.cloudNetwork")), level ?? "error");
      return;
    }
    reportError(err, level ?? "error");
  },

  // ADR-0018：离线上传的书回线补推（offlineUploadReplay:"ask"）——进度/撞名走状态行/横幅；问一次要不要推。
  onReplayStatus: ({ phase, name, done, total }): void => {
    const n = name ? stripExt(name) : "";
    if (phase === "collision") reportError(new Error(t("replay.collision", { name: n })), "warning");
    else if (phase === "done") reportError(t("replay.done", { done, total }), "info");
    else reportError(t("replay.progress", { done, total }), "info");
  },
  confirmReplay: (count: number): Promise<boolean> => openConfirmSheet(t("replay.askTitle"), t("replay.askMsg", { n: count })),

  // 「跳过到离线」逃生闸：开纯云端书时 fetchMeta 挂着 → 用户点跳过 → 读本地（本地没有则诚实报 unavailable）。
  offlineEscape: (): { probe: Promise<unknown>; settle: () => void } => {
    let onSkip!: () => void;
    const probe = new Promise<unknown>((res) => { onSkip = () => res(undefined); });
    void lockSyncGate<"skip" | null>({ title: t("cf.checkingCloud"), message: "", showSpinner: true, actions: [{ label: t("cf.skipToOffline"), value: "skip" }] })
      .then((v) => { if (v === "skip") onSkip(); });
    return { probe, settle: () => settleSyncGate(null) };
  },
};
