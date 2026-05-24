// Azure AD 应用注册的 client id。每个 GH-Pages 部署一个独立 client id。
// 部署前在 https://entra.microsoft.com → App registrations → 新建,把 redirect URI 设为
// https://fangzhangmnm.github.io/justreadbooks/ 以及 http://localhost:* (本地测试)。
// TODO: 部署时替换成真实 client id
export const CLIENT_ID = "691bf41b-349a-46e1-8296-f0a644005421";

// common = 个人 + 组织账号都能登
export const AUTHORITY = "https://login.microsoftonline.com/common";

// AppFolder = approot 沙盒;offline_access = 拿 refresh token,纯 silent
export const SCOPES = ["Files.ReadWrite.AppFolder", "offline_access"];

// 内部布局 (相对 approot)。**书直接放在 approot 根**(不是 approot/books/),
// 因为用户在 OneDrive 网页看到的就是 `Apps/JustReadBooks/<他的书>`,
// 多包一层 `books/` 会让人莫名其妙地"找不到自己的书"。
// 用户可以在根下任意建子文件夹分类。
//   approot/<可任意层级子文件夹>/<book.txt | book.pdf>
//   approot/session.json
//   approot/library.json   (章节切分 / encoding / 用户元数据)
//   approot/.trash/        (软删除,. 前缀压低显示存在感)
export const BOOKS_FOLDER = "";        // approot 根
export const TRASH_FOLDER = ".trash";  // 移到 trash 时用
export const SESSION_FILE = "session.json";
export const LIBRARY_FILE = "library.json";
// 列书架时跳过的内部文件/文件夹名(用户在 OneDrive 网页看到这些,但不该在书架里点开)
export const RESERVED_NAMES = new Set([SESSION_FILE, LIBRARY_FILE, TRASH_FOLDER]);

// 位置写盘节流(从 JustReadPapers 抄):
//   non-trivial 滚动重置 debounce;一直滚也封顶 heartbeat。
export const POSITION_DEBOUNCE_MS = 10_000;
export const POSITION_HEARTBEAT_MS = 30_000;

// PDF: 同页 + yFrac 微动 ≤ 0.5 = trivial,不调度 PUT
// TXT: 同章 + yFrac 微动 ≤ 0.05 = trivial (TXT 一章可能很长,0.5 太大)
export const TRIVIAL_POSITION_Y_DELTA = 0.5;
export const TRIVIAL_POSITION_Y_DELTA_TXT = 0.05;

// IndexedDB 缓存默认上限(用户可在菜单调整)。
// TXT 小说几百 KB,PDF 几 MB,500MB 默认能装很多。
// **重要**:跟 BackgroundRadio / RealHome 一样,缓存是"明确用户授权"的:
//  - 第一次打开 = 流式读到内存 (Blob URL),不入 IDB
//  - 用户点了下载按钮才入 IDB,**默认 pinned**(意图明确)
//  - 缓存满 → 优先淘汰非 pinned;全 pinned 装不下就 toast 提示
//  - 用户可在菜单里删 / unpin
export const DEFAULT_CACHE_CAP_BYTES = 500 * 1024 * 1024;
export const MIN_CACHE_CAP_MB = 50;

// reading-line 在 viewport 内的固定锚位置 [0,1]
export const READING_LINE_ANCHOR = 0.25;

// TXT 章节自动切分内建正则。
// 用户可以加自己的(library.json 里 per-book 存)。空 → 不切章,整本一章。
// 顺序很重要:先 markdown,再网文常见模式。第一个有 ≥3 个 match 的胜出。
export const BUILTIN_CHAPTER_REGEXES = [
  { id: "md1", label: "Markdown #",     re: "^# (.+)$"             },
  { id: "md2", label: "Markdown ##",    re: "^## (.+)$"            },
  { id: "md3", label: "Markdown ###",   re: "^### (.+)$"           },
  { id: "md4", label: "Markdown ####",  re: "^#### (.+)$"          },
  // 网络小说:第N章/回/节/卷/篇,后面可有可无 "标题"
  // \s 在多行 mode 也匹配中文空格么? 用 [ \t 　] 显式
  { id: "zh-chap",  label: "第N章",  re: "^[ \\t\\u00A0\\u3000]*第[零一二三四五六七八九十百千万0-9]+章.*$" },
  { id: "zh-hui",   label: "第N回",  re: "^[ \\t\\u00A0\\u3000]*第[零一二三四五六七八九十百千万0-9]+回.*$" },
  { id: "zh-jie",   label: "第N节",  re: "^[ \\t\\u00A0\\u3000]*第[零一二三四五六七八九十百千万0-9]+节.*$" },
  { id: "zh-juan",  label: "第N卷",  re: "^[ \\t\\u00A0\\u3000]*第[零一二三四五六七八九十百千万0-9]+卷.*$" },
  { id: "zh-pian",  label: "第N篇",  re: "^[ \\t\\u00A0\\u3000]*第[零一二三四五六七八九十百千万0-9]+篇.*$" },
  // 楔子 / 序章 / 番外 / 后记 这类"前后"特殊章
  { id: "zh-spec",  label: "楔子/序章/番外/后记",
    re: "^[ \\t\\u00A0\\u3000]*(楔子|序章|序言|引子|前言|尾声|后记|番外|外传|终章)([\\s :：·-].*)?$" },
  // 英文 Chapter N
  { id: "en-chap", label: "Chapter N", re: "^[ \\t]*Chapter\\s+[0-9IVXLC]+.*$" },
];

// TXT 自动切分:候选正则里"匹配数 ≥ MIN_AUTO_CHAPTER_HITS"的第一条胜出,否则不切
export const MIN_AUTO_CHAPTER_HITS = 3;

// idle 弹蒙层(让用户决定是否拉新)。30min
export const IDLE_MS = 30 * 60 * 1000;
