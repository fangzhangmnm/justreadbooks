// 常量 SSoT（凡是「人类拍过板的数字」都在这里，别散在各处）。created 2026-09-19 by Claude Fable 5.1
//
// OneDrive：scope 永久 AppFolder（家规硬规则 #6）；authority /consumers = personal-account-only（硬规则 #7）。
// clientId 沿用 v1 注册（Entra 已翻 Personal only；/dev/ redirect 已加，user 2026-09-19）。
export const APP_ID = "jrb";   // 本 origin 内唯一命名空间：IDB `jrb.defaultStore` + localStorage 前缀；与 WXHW/JRP/BR 等兄弟隔离。v1 的 `justreadbooks-cache` 库留孤儿不读不删（user 2026-09-19）。
export const CLIENT_ID = "691bf41b-349a-46e1-8296-f0a644005421";
export const AUTHORITY = "https://login.microsoftonline.com/consumers";
export const SCOPES = ["Files.ReadWrite.AppFolder", "offline_access"];
export const MSAL_URL = "./vendor/msal/msal-browser.min.js";

/** 书的扩展名（0.1 只做 txt；pdf 下一轮出 @internal/pdf-viewer 控件时加入）。身份 = `[夹/]<文件名>.txt`（路径即身份，MASTER §A）。 */
export const BOOK_EXTS = [".txt"] as const;
/** 书架里不当书、也不当杂物显示的名字：v1 遗留的两个 json（只读遗留，不迁不删）与写入方的半成品（handoff §4.7 约定）。 */
export const HIDDEN_NAME_RE = /(^|\/)(session\.json|library\.json|[^/]*\.part|~[^/]*|[^/]*\.tmp)$/i;

// ── 位置写盘节律（v1 config 同值，从 JustReadPapers 抄的三层 throttle）──
/** 非 trivial 滚动重置的防抖。 */
export const POSITION_DEBOUNCE_MS = 10_000;
/** 首次变脏起最多等这么久必推（一直滚也封顶）。 */
export const POSITION_HEARTBEAT_MS = 30_000;
/** 同章内比例微动 ≤ 此值 = trivial（只更新内存，不调度推云）。 */
export const TRIVIAL_FRAC_DELTA = 0.05;
/** reading-line 在 viewport 内的固定锚位置 [0,1]：位置 = 这条线穿过的内容（25% 落在眼睛上，顶部已读过）。 */
export const READING_LINE_ANCHOR = 0.25;
/** 冷首帧后，前台轮询云端新鲜度的周期（reconcilePolicy:"app-driven"）；只复查当前书 + 当前夹。 */
export const FOREGROUND_POLL_MS = 60_000;
/** 大件诚实提示阈值（计划 §4.5：先 20 MB，SE2 实测后改，并回写 handoff §4.6 给写入方当分卷上限）。 */
export const BIG_BOOK_BYTES = 20 * 1024 * 1024;
/** 状态头（活书文件第一行）最多取这么多字符显示。 */
export const STATUS_HEADER_MAX_CHARS = 120;

/** collection 名（云端 `.jrb/<name>.json`；库自动追加 .json）。 */
export const COLLECTIONS = {
  readingPos: "reading-position",   // 每本书阅读位置（key = 路径；value = Anchor + readAt）——乙：synced，无全局 lastActive funnel
  bookPrefs: "book-prefs",          // 每本书切章规则 / 编码（key = 路径）——替代 v1 library.json
} as const;

/** 阅读偏好默认值（device-kv；设备属性不跟云）。行宽两档 = 轻小说式窄行（CLAUDE.md：16–22 字/行的节奏）与 paperback 宽行。 */
export const READER_DEFAULTS = { fontSize: 19, lineHeight: 1.9, fontFamily: "sans" as "sans" | "serif", widthTier: "novel" as "novel" | "classic" };
export const READER_WIDTH_PX = { novel: 440, classic: 660 } as const;
export const FONT_SIZE_RANGE = { min: 14, max: 28 } as const;

/** Quest 浏览器（手柄 D-pad 4 行量化滚动是这个场景）。 */
export const IS_QUEST_BROWSER = /OculusBrowser|Quest|Wolvic/i.test(globalThis.navigator?.userAgent ?? "");
