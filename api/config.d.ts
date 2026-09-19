export declare const APP_ID = "jrb";
export declare const CLIENT_ID = "691bf41b-349a-46e1-8296-f0a644005421";
export declare const AUTHORITY = "https://login.microsoftonline.com/consumers";
export declare const SCOPES: string[];
export declare const MSAL_URL = "./vendor/msal/msal-browser.min.js";
/** 书的扩展名（0.1 只做 txt；pdf 下一轮出 @internal/pdf-viewer 控件时加入）。身份 = `[夹/]<文件名>.txt`（路径即身份，MASTER §A）。 */
export declare const BOOK_EXTS: readonly [".txt"];
/** 书架里不当书、也不当杂物显示的名字：v1 遗留的两个 json（只读遗留，不迁不删）与写入方的半成品（handoff §4.7 约定）。 */
export declare const HIDDEN_NAME_RE: RegExp;
/** 非 trivial 滚动重置的防抖。 */
export declare const POSITION_DEBOUNCE_MS = 10000;
/** 首次变脏起最多等这么久必推（一直滚也封顶）。 */
export declare const POSITION_HEARTBEAT_MS = 30000;
/** 同章内比例微动 ≤ 此值 = trivial（只更新内存，不调度推云）。 */
export declare const TRIVIAL_FRAC_DELTA = 0.05;
/** reading-line 在 viewport 内的固定锚位置 [0,1]：位置 = 这条线穿过的内容（25% 落在眼睛上，顶部已读过）。 */
export declare const READING_LINE_ANCHOR = 0.25;
/** 冷首帧后，前台轮询云端新鲜度的周期（reconcilePolicy:"app-driven"）；只复查当前书 + 当前夹。 */
export declare const FOREGROUND_POLL_MS = 60000;
/** 大件诚实提示阈值（计划 §4.5：先 20 MB，SE2 实测后改，并回写 handoff §4.6 给写入方当分卷上限）。 */
export declare const BIG_BOOK_BYTES: number;
/** 状态头（活书文件第一行）最多取这么多字符显示。 */
export declare const STATUS_HEADER_MAX_CHARS = 120;
/** collection 名（云端 `.jrb/<name>.json`；库自动追加 .json）。 */
export declare const COLLECTIONS: {
    readonly readingPos: "reading-position";
    readonly bookPrefs: "book-prefs";
};
/** 阅读偏好默认值（device-kv；设备属性不跟云）。行宽两档 = 轻小说式窄行（CLAUDE.md：16–22 字/行的节奏）与 paperback 宽行。 */
export declare const READER_DEFAULTS: {
    fontSize: number;
    lineHeight: number;
    fontFamily: "sans" | "serif";
    widthTier: "novel" | "classic";
};
export declare const READER_WIDTH_PX: {
    readonly novel: 440;
    readonly classic: 660;
};
export declare const FONT_SIZE_RANGE: {
    readonly min: 14;
    readonly max: 28;
};
/** Quest 浏览器（手柄 D-pad 4 行量化滚动是这个场景）。 */
export declare const IS_QUEST_BROWSER: boolean;
