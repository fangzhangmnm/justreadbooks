// StoreUI adapter —— 给 @internal/store 的 ui bundle（busy / resolveConflict / reportError / offlineEscape / text / confirmReplay）。
// created 2026-09-19 by Claude Fable 5.1（WXHW / WeebPaint store-ui.ts 同形）· 2026-10-21 收 store 2.1.2（Claude Fable 5.1）：冲突面主按钮 = 云端覆盖本地、措辞按 cloudState 分。
//   读者 app 的要点：**后台拉取 / 新鲜度检查绝不上全屏遮罩**（user 2026-09-19「我不想开书时转很久」）——
//   sync.pushing / file.pulling / cloud.checking / file.renaming 走安静状态行；只有用户动作（回收站 / 建删夹 / 重传）才遮罩。
//   冲突必 surface（ADR-0009）：读者从不改写书，理论上不会撞 412；上传撞名 / 书架「处理…」（store file.resolve()）/ 本地副本分叉时仍给真 sheet，绝不静默 cancel。
//   词汇表只有三个词（user 2026-10-16「禁止越狱」）：云端覆盖本地 / 本地覆盖云端 / 取消——答案只来自人在这张面上的点击，app 不预设。
import type { StoreUI, StoreTextKey, StoreTextParams, ResolveChoice } from "@internal/store";
import { withBusy, lockSyncGate, settleSyncGate, openConfirmSheet } from "./sheets.ts";
import { identifiers } from "./identifiers.ts";
import { t, type Key } from "./i18n/index.ts";
import { reportError } from "./error-badge.ts";
import { note as diagNote } from "./diag-log.ts";

// 库 16 个 busy 文案 key → 本仓 i18n。穷举 Record：库加 key 本表漏映 = 编译错。
const STORE_TEXT_KEYS: Record<StoreTextKey, Key> = {
  "sync.pushing": "st.syncPushing",
  "file.renaming": "st.fileRenaming",
  "file.uploading": "st.fileUploading",   // store 0.17.0 files.uploadStream（本 app 不用流式上传，映射只为穷举表完整）
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
/** 面上只写主干（书名，不带 .txt）；不是书的名字原样。 */
const stemOf = (identifier: string): string => identifiers.parse(identifier)?.stem ?? identifier;

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

  resolveConflict: async ({ name, occasion, cloudState }): Promise<ResolveChoice> => {
    const n = stemOf(name);
    let choice: ResolveChoice | null;
    if (occasion === "open") {
      choice = await lockSyncGate<"cancel" | "takeCloud">({
        title: t("cf.title"), message: t("cf.bodyOpen", { name: n }), note: t("cf.noteKeptSafe"),
        actions: [{ label: t("cf.openLocal"), value: "cancel", primary: true }, { label: t("cf.cloudWins"), value: "takeCloud" }],
      });
    } else {
      // 措辞按云端那一侧的状态（store 0.18.2 cloudState；gallery 0.8.1 的「处理…」走到这里）：absent = 云端那份没了、never = 从没传过、unchanged = 云端没变只是本机有没推的、
      //   changed（或老库不带）= 两边各一版。三个按钮不变、主按钮 = 云端覆盖本地（user 2026-10-16「一切对齐」「默认云端才是 authority」；gallery 0.7.1 / WXHW v2.3.35 同口径）。
      //   absent / never 时选「云端覆盖本地」= 本机这份进**回收站**（不是备份箱），所以「被替换的那份会进备份箱」那句只在 changed / unchanged 时说，正文里把两个按钮各做什么写清。
      const gone = cloudState === "absent" || cloudState === "never";
      const message = cloudState === "absent" ? t("cf.bodyAbsent", { name: n }) : cloudState === "never" ? t("cf.bodyNever", { name: n }) : cloudState === "unchanged" ? t("cf.bodyUnchanged", { name: n }) : t("cf.bodyPush", { name: n });
      choice = await lockSyncGate<ResolveChoice>({
        title: gone ? t("cf.cloudGoneTitle") : t("cf.title"), message, ...(gone ? {} : { note: t("cf.noteKeptSafe") }),
        actions: [{ label: t("cf.cloudWins"), value: "takeCloud", primary: true }, { label: t("cf.localWins"), value: "keepMine" }, { label: t("common.cancel"), value: "cancel" }],
      });
    }
    diagNote("sync", `conflict sheet "${name}" occasion=${occasion} cloud=${cloudState ?? "?"} → ${choice ?? "cancel"}`);   // 黑匣子：真机上「又弹面了」能对出是哪一次
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

  // ADR-0018：推到一半断网的上传回线补推（offlineUploadReplay:"ask"）——进度/撞名走状态行/横幅；问一次要不要推。
  onReplayStatus: ({ phase, name, done, total }): void => {
    const n = name ? stemOf(name) : "";
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
