# JustReadBooks 现代化改装计划（0.1 纪元：接 @internal/store + @internal/gallery，按 WeebPaint 范式）

> created 20260919 · by Claude Fable 5.1（claude-fable-5-1）· as-of **v23**（2026-09-01）/ 2026-09-19
> 状态：**计划，未开工**。user 过目 §9 拍板后开工。本文 = 提案（活文档，实现中形状变了要回写）。
> 读者：user；下一个 JRB agent。前置读物：`20260917-myllamareborn-ai-dropbox-handoff.md`（滥用模式）、家族根 `ai-docs/20260901-modernization-round-handoff.md`（换代轮）、`../../20260516 WebXiaoHeiWu/ai-docs/20260903-v2-architecture.md`（同形骨架）。
> user 2026-09-19 原话（本 session）：「i want a more reliable reading experience」「rethink about the reading progress sync functionality. perhaps discard it because it causes more trouble than funneling effect i expect」「串章是小事情，不用太担心。虽然我也想过用当前行的hash之类的，但是不确定是否靠谱」「全面现代化改装，比如把云图标移动到gallery里面，而不是settings里面。然后接gallery」「azure上面 dev已加」「关键是接gallery，而不是手搓。也许gallery需要支持第二种UI，然后考虑gallery变成全屏的，这样长书名也能显示」「嗯 pdf viewer可以抽一个公共库」。

## 0. 一句话

JRB 不再是「自研 IDB 缓存 + 自研 session.json 合并 + 裸 Graph」的 2026-05 遗物，而是家族第三个四包消费者（store 0.13.0 / gallery 0.2.2 / workbench-elements 0.1.0 / encryption 0.1.0 表态零 codec），本轮顺带让两个包长东西：gallery 长出第二种 UI（列表视图 + 全屏），pdf viewer 抽成新包。赢的条件只有一个：**可靠地读**——远端把同名 txt 覆盖十次，读者不被抢走、位置不丢、离线能开、启动不等网。

## 1. 现状与问题陈述：为什么现有 schema 在「远端持续覆盖同名 txt」下别扭

现状（核过源码）：`src/app.js` 2696 行 orchestrator；`cache.js` 自研 IDB（LRU + pin + `local:` 合成 id）；`session.js` 自研 `session.json`（itemId → `{pageIndex, yFraction}`，按 `positionAt` 时间戳合并）+ `library.json`（itemId → 切章规则/编码，LWW）；`graph.js`/`auth.js` 裸 Graph/MSAL；单 main 直发 GH Pages 根（无 dev/prod）；无测试、无 TS、无 api/。

滥用模式（handoff §2）：MyLlamaReborn 脚本经 OneDrive 桌面客户端往 `ai-dropbox/` 写 txt，**同名覆盖一晚 3–10 次**；user 在手机上同时读；单本最大 90 MB；写入非原子。

别扭在六处：

| # | 现状 | 在「远端持续覆盖」下的后果 |
|---|---|---|
| 1 | **身份 = OneDrive itemId**（session/library/cache 全按 id 键） | 家族 2026-06-07 已否决的身份模型（MASTER §A：身份 = path/name）。桌面客户端 `mv` 可能换 id → 5 条进度成 ghost（handoff §3.5 已发生）。 |
| 2 | **位置 = 章节序号 + 章内比例** | 序号是对可变列表的下标：章节增删/重排即串章；占位「（未出）」变 1k 字，比例也漂。 |
| 3 | **eTag 变 → 静默 pull → 按当前位置重载 viewer**（constraint #6） | 读者读到一半被整章重画、滚动重置；一晚十次。这是「不可靠阅读」的头号来源，串章只是它的副作用。 |
| 4 | **session.json 单文件、边读边写**（10s 防抖 / 30s 封顶 / keepalive PUT / 412 合并重试） | 一份文件同时承担「每本书位置」和「全局 lastActive 跨设备跳书」；两台设备各写各的，出过两轮「旧设备盖新进度」根因修。手搓的正是库 collection 已提供的逐 item uat-LWW。 |
| 5 | **freshness = app 自己在每次 focus 遍历全部缓存项打 Graph** | N 次 `getItemMeta`；与库的 watchFolder（一夹一帧、`newer-on-cloud` 徽章现成）重复造轮子。 |
| 6 | **app 不认识「活书」**：第一行状态头、`*.part` 半成品、90 MB 单本 | 半成品入书架；截断 txt 仍是合法文本（validateAdopt 拦不住，只能靠写入方 rename 约定）；大件手机上开不开得动未验。 |

结论：**store 现代化不是换库，是把 #1–#5 整段扔掉**——身份、缓存、freshness、合并全归库；app 只剩阅读器 + 位置模型 + 活书 diff。

## 2. 目标（win condition，按优先级）

1. **读到一半不被抢**：远端覆盖 → 当前章 DOM 不动，只出一枚 chip「已更新 · +N 章 / 本章有更新」；翻章或点 chip 才用新字节。后台/下次打开时静默采纳。
2. **位置经得起覆盖**：锚 = `{章节序号, 章节标题文本, 章内比例}`；恢复时标题命中优先、序号 clamp 兜底。**不做行 hash**（user 2026-09-19：串章小事；行 hash 靠不靠谱不确定——行本身在覆盖中会变，标题才是写入方承诺稳定的东西，handoff §5）。
3. **启动不等网**（feedback 2026-09-19 启动速度优先）：首帧 = 本机（device-kv 上次那本 + 库本地缓存 + dir-index-cache 目录快照）；删掉 v1 的 10s 阻塞同步屏与 idle 蒙层。
4. **离线能开**：`autoCacheOpenedFile:true`，开即留本地；云端不可达时诚实说「本地没有」而不是转圈。
5. **错误不吞**：库 `reportError` → 顶部错误徽章（WXHW `error-badge.ts` 同款）；UI 不许谎报同步成功。
6. 以上全部先 mock 测（`@internal/store/testing`）再真机，一批交付一张总单。

## 3. 依据

- 换代轮拍板（2026-09-01 user）：「JRB 在 JRP TS 底座重做；云端 session.json/library.json 只读遗留」；优先级 store 现代化 > 壳 > UI。**本文对「JRP 底座」的落实**：TS/esbuild/dev-prod/四路 SW 的骨架取自 WXHW 2.0（2026-09-10，同一套四包的最新消费者；JRP 工具链 memory 已标「过时不当参考」）；JRP 贡献的是器官——pdf.js viewer（Vue island）+ `viewer-geometry` + `valuable-save` 调度器。意图（TS 底座、不从 vanilla 重来）不变，具体基座换成更新的兄弟——这是我的判断，写在这里供 user 否决。
- 2026-08-18：「JRP 半 sunset，PDF 并进 JRB 的时机 = JRB 接 store」→ 本轮就是那个时机（§9 Q6）。
- 2026-09-09：「抽库可以找个良辰吉日叫上 jrp jrb realhome, catsup 一起」→ user 2026-09-19 点名 JRB 接 gallery = 良辰吉日到了，JRB 是 gallery 第三消费者。
- 家规 #6/#7（AppFolder、`/consumers`，v23 已是）、§A 红线、四包只准走 `createStore()`/`createGallery()` 单接缝。

## 4. 架构

### 4.1 包与工具链（stamp 自 WXHW 2.0，逐文件对照拷、不发明）

| 件 | 来源 | 备注 |
|---|---|---|
| `@internal/store` 0.13.0 / `@internal/gallery` 0.2.2 / `@internal/workbench-elements` 0.1.0 / `@internal/encryption` 0.1.0 | `scripts/pull-package.sh` 收货进 `vendor-pkgs/` | encryption 传零 codec 实例（0.7.0 必填表态，无 dormant 替身）；JRB 本轮不做加密 UI。 |
| **`@internal/pdf-viewer`（新包，本轮出生）** | 从 JRP `src/ui/viewer.ts` + `src/domain/viewer-geometry.ts` 抽（user 2026-09-19「pdf viewer 可以抽一个公共库」）；仓形抄 internal-store | Vue 与 pdf.js 都由宿主注入（包不 bundle pdf.js）；JRB 第一消费者，JRP 若续命是第二。名字待 user（§9 Q11）。 |
| Vue 3.5.x prod ESM、pdf.js、MSAL | vendor（JRP/WXHW 已有同版本，拷） | gallery / pdf-viewer 两包都要 `deps.vue` 注入；txt 阅读器本身不进 reactive 图。 |
| `scripts/build.sh`（tsc 门 · 接缝 lint · sprite 对账 · 裸中文扫描）、`scripts/gen-api.sh`、`tools/esbuild`、`tools/inline-sprites.py`、`tools/ui-audit.mjs`、`test/run.mjs`、`test/redline-guard.test.mjs`、`test/boot-smoke.mjs` | WXHW | `@internal/pwa-shell` 包与 stamp 向导（W0-c/W0-d）尚未出生，照 WXHW 拷 `src/pwa-shell.ts`。 |
| `.github/workflows/deploy.yml`（prod → `/`，main → `/dev/`） | WXHW | 首次 setup：`prod` 分支 = v23 快照；Pages source 切 Actions。**`/` 上的 v23 = 逃生口，直到真机总单过、user 说 push prod**（BR 教训 §5）。 |
| `src/version.ts` + `bump.sh`、`src/device-kv.ts`、`src/error-badge.ts`、`src/i18n/`（zh 默认 + en 备）、共享 sprite | WXHW / 图标库 | JRB 未毕业，logging 语言不限；用户文案仍走 i18n SSoT（gallery 包 `t()` 闭集要它）。 |
| `api/`（.d.ts 户口） | gen-api | 现状 .h：无（vanilla JS）；提案 .h = §4.10。 |

### 4.2 数据类 → store 映射

| 数据类 | 归宿 | 备注 |
|---|---|---|
| 书（txt/pdf） | `store.file("<夹/>name.txt", {isZip:false, mode:"existing"})` | 身份 = 路径；同名覆盖 = 同一身份新版本；`open()` 开即留本地；`pullIfClean()` 快进。app **永不** `save` 到既有书（守卫测试：`save(` 只准出现在 upload 模块）。 |
| 上传（拖入/选文件） | `file(name, {mode:"new"}).save(bytes, {tryPush: signedIn})` | 非 UTF-8 先转码（v1 行为）；未登录时 `tryPush:false` → local-only，卡片「上传」动词补推；`offlineUploadReplay:"ask"`（≈ v1 constraint #4 语义）。 |
| 每本书阅读位置 | collection `reading-position`（key = 路径；value = §4.10 `Anchor` + `readAt`） | **synced 还是本机 = §9 Q1**；推送节律走 JRP `valuable-save`（`manual:true` + 10s/30s/trivial-skip 驱动 `reconcileWithRemote`），防 OneDrive 版本史塞爆。 |
| 每本书切章规则 / 编码 | collection `book-prefs`（key = 路径） | 替代 `library.json`。 |
| 设备本地：字号/行高/行宽两档/主题/PDF zoom/本机上次打开/图库当前夹 | `device-kv`（localStorage 唯一器官） | **不用 `{local:true}` collection——store 0.7.0 已删**（换代轮 handoff §2）。主题要首帧同步读 → 只能 kv。 |
| 全局「当前在读」跨设备 funnel（v1 `lastActive`） | **删除** | §4.7。 |
| 回收站 | 库 `.trash`（两端聚合） | v1 的 `.trash/` 直接可见。 |
| 遗留 `session.json` / `library.json` | 只读遗留，书架隐藏（保留名） | §7。 |

### 4.3 createStore 表态（`src/app-store.ts`，唯一值级 import）

`appId:"jrb"` · `persistence:"app-managed"`（登录手势 / 首次留离线手势时 `requestStoragePersistence()`）· `reconcilePolicy:"app-driven"`（focus/visibility/online + 前台 60s 只对**当前夹 + 当前书**复查）· `autoCacheOpenedFile:true` · `readOnlyFiles:false`（有上传）· `offlineUploadReplay:"ask"` · `validateAdopt` = pdf 看 `%PDF` 魔数 / txt 走编码链且非 HTML（WXHW `looksLikeTextDoc`）· `activeFileName` = 当前打开的书 · `signedIn` = `auth.isSignedIn`。

### 4.4 图库（`@internal/gallery`）——**接包，不手搓**（user 2026-09-19）

- 入口：顶栏 ☰ = 图库一屏（WXHW 2.0.1 同款）；**云登录 chip 进图库顶栏**（包的 `renderCloudAuthChip / wireCloudAuthRefresh`，宿主给三个元素）；设置面板只剩阅读偏好，登录行删掉。
- `policy`：`docExtensions [".txt", ".pdf"]`；`imageExtensions` 空；`tilePlaceholderHtml` = 书图标 / pdf 图标；`thumb` 本轮不给（PDF 首页缩略图 = 派生缓存，逐案申请，§10）；`encryption` 不给；`libraries` 只 OneDrive（folder provider 无地骑士 = §10）。
- `DocHost`：`open(name)` → 阅读器；`newDoc` → 返 null（读者无新建）；其余按包契约。
- 排序：包默认 natural 降序——`ai-dropbox/` 文件名带 `YYYY-MM-DD` 前缀，天然新在上（愿望 §6.1 免费得到）。徽章：包 9 态直接用，`newer-on-cloud` = 「有更新」零代码。
- **JRB 缺的东西全部长在包里，app 零手搓**（家规：缺接口 → 改库，绝不在 app 绕）。本轮 gallery 包提案（§4.10 第二段；走 API ritual：提案 .h user 过目后才动包；**WeebPaint 行为是 spec、默认 cards 不变、WeebPaint 零改动**）：
  1. **第二种 UI = 列表视图**（`policy.view: "cards" | "list"`，或宿主给默认 + 用户可切）：一行一本，**名字整行显示不截断**（长书名 = 蒸馏卡的 `2026-09-17 装订 《X》 作者 …`）、右侧徽章、副标题一行（大小 · 状态头）。txt 书没有封面，2/3 竖版卡片对它是浪费；列表才是书架。
  2. **全屏**：图库独占整屏（WeebPaint `.gallery-full` 已有雏形，包 CSS 里把它变成正式模式），长名字有地方放。
  3. **宿主 hook 三个**：`policy.tile.subtitle?(item) → string`（JRB 填状态头）；`policy.tile.marker?(item) → "unread" | null`（JRB 按 `reading-position` 无条目判未读）；`policy.sections?` 或 `policy.sortKey?(item)`（「最近阅读」条：按 `readAt` 置顶几本——形状归 user 过目，二选一）。
  4. **卡片/行菜单动词补「留离线 / 移除离线」**（verbs 已有 `offload`；`keepOffline` 待核，缺则加）。
  5. **上传入口**（拖放到图库 + 文件选择器 → `DocHost.upload?(files, dir)`）：读者类 app 的「新建」就是上传。
  6. **隐藏「新建」**（`DocHost.newDoc` 缺省即隐藏钮）。
- 实现时先核对包 `api/gallery.d.ts` 现值：已有的不重提，缺的进提案 .h。

### 4.5 阅读器（两个 imperative island，共用 `Reader` 端口）

- **txt**：v1 `viewer-txt.js` 重写为 TS——一次一章、上下翻章钮、reading-line 25%、行宽两档、键盘 + 手柄 D-pad 4 行量化（Quest）、目录树折叠。`chapter-split.ts` / `encoding.ts` 从 v1 移植（纯函数，补 node 测试）。
- **pdf**：**`@internal/pdf-viewer` 新包**——从 JRP `src/ui/viewer.ts`（Vue imperative island）+ `src/domain/viewer-geometry.ts`（纯几何，有测试：reading-line 位置复位 / cozy fit-width / spread 双页分行）抽出；`Reader` 端口 + `emit position/page/outline`；pdf.js 与 Vue 由宿主注入（`loadPdfjs` 回调），包不含 1 MB 的 pdf.js。v1 `viewer-pdf.js` 与 JRP 的 `viewer.ts` 都当 spec 读、不拷。仓形抄 internal-store（tgz + `pull-package.sh`），开发期 0.0.0，提案 .h user 过目后才搬。
- 大件：`Item.size` 超阈值 → 开书前一张 sheet 诚实提示「这本 N MB，手机可能开不动，仍要打开？」，不硬拦；阈值先定 20 MB，**在 SE2 实测后改**，并把数字回写 handoff §4.6 给写入方当分卷上限。

### 4.6 位置与「活书」

- 锚（§4.10 `Anchor`）：txt `{chapter, title, frac}`，pdf `{page, frac}`。`resolveTxtAnchor`：`chapters[chapter].title === title` → 用序号；否则找第一个同标题章；否则 clamp 序号。就这两行，不再深挖。
- 覆盖采纳（`live-book.ts`）：`pullIfClean` 状态 `fast-forwarded` → 新文本重切章 → `diffChapters(old, new, current)` → chip 文案（`+N 章` / `本章有更新`）；**当前章 DOM 不重画**；翻章或点 chip → 从新文本渲染并按锚复位。app 在后台（`visibilityState:"hidden"`）或书未打开时采纳即生效，无 chip。
- 状态头（handoff §1 文件第一行）：`statusHeader(text)` 取第一行；卡片副标题与阅读器顶栏显示；app 不解析它的语义（那是写入方的格式）。
- `*.part` / `~` 开头 / `.tmp` 不入书架（`watchBooks` 过滤）；写入方改「写临时名再 rename」（handoff §4.7 双方契约）。

### 4.7 阅读进度同步：重新思考

v1 承诺（README）：「一台设备看到 100 页，另一台打开自动跳到 100 页」。这句承诺由两件事组成：(a) **每本书的位置跨设备可见**；(b) **全局 lastActive 让任何设备一打开就跳到别台正在读的那本**。麻烦几乎全来自 (b) 与「读一半被远端拉走」的耦合：跳书 jumpscare、旧设备盖新进度的两轮根因、session.json 边读边写的 412 舞。(a) 在库里是现成的逐 item uat-LWW，app 侧代码接近零。

三个选项（推荐乙）：

- **甲 · 全丢**：位置只存本机 device-kv。最简单；换设备从头找。
- **乙 · 留 (a) 删 (b)**：`reading-position` 走 synced collection；每本书打开时按自己的锚恢复（提示性，不跨设备切书）；**永远没有** lastActive funnel、永远不在阅读中被远端改位置；覆盖只走 chip。甲 ↔ 乙 = 换一个存储面（collection ↔ kv），架构不变。
- 丙 · 保持 v1（否）。

推荐乙的理由：删掉的正是「trouble」，留下的正是「换设备接着读」这一点点 funnel 价值，而且成本由库承担。若 user 仍觉得 (a) 也多余 → 选甲，一个文件的改动。

### 4.8 壳

四路 SW 更新检测（`pwa-shell.ts`）；content-hash bundle；`prod` 分支 `/` + main `/dev/`；`src/version.ts` = `0.1.0-<日期>`（v23 ≡ 0.0.23；0.1.0 = 新纪元，minor 由 AI 提议、user 批——§9 Q7）。README 里那句跨设备跳页的承诺随乙/甲改写；是否算吃书归 user 判（AI 不建议 major）。

### 4.9 启动路径

`index.html` 烤 `data-theme`（kv 同步读）→ 模块顶层注册 SW → `createStore` → `initCollections()`（本地 hydrate，不碰网）→ 读 kv「本机上次那本」→ 库本地有副本则**立刻**渲染阅读器（首帧）→ 之后才：图库 data-face 订阅当前夹（dir-index-cache 首帧）、当前书 `pullIfClean`（采纳走 chip）、collections `reconcileWithRemote`。没有上次那本 / 本地无副本 → 首帧 = 图库。**没有任何阻塞蒙层，没有 10s 超时**。

### 4.10 提案 .h（pin 住的目标契约；现状 .h = 无）

```ts
// src/app-store.ts —— @internal/store 唯一值级 import（build.sh 接缝 lint 守）
export const auth: OneDriveAuth;
export function requireStore(): Store;
export const readingPos: Collection;      // "reading-position"（§9 Q1 选甲则此面消失、改 device-kv）
export const bookPrefs: Collection;       // "book-prefs"
export function initCollections(): Promise<void>;
export function reconcileCollections(): Promise<void>;
export function flushCollections(): Promise<void>;
export function setActiveBook(name: string | null): void;

// src/books.ts —— 书的动词层（对齐 WXHW docs.ts；红线全在库内）
export type BookKind = "txt" | "pdf";
export interface BookListItem { name: string; dir: string; stem: string; kind: BookKind; syncState: SyncState; cached: boolean; size?: number; lastModified?: number; unread: boolean }
export interface BookListFrame { folder: string; items: BookListItem[]; folders: string[]; complete: boolean; stale: boolean }
export function watchBooks(folder: string, cb: (f: BookListFrame) => void, opts?: { onError?: (e: unknown, phase: WatchFolderErrorPhase) => void }): () => void;   // 过滤 *.part / ~* / .tmp / 保留名
export type OpenBookResult = { kind: "ok"; blob: Blob } | { kind: "unavailable" } | { kind: "too-big"; size: number };
export function openBook(name: string, opts?: { allowBig?: boolean }): Promise<OpenBookResult>;
export function pullBookIfClean(name: string): Promise<FreshResult>;
export function keepBookOffline(name: string, onProgress?: (done: number, total: number) => void): Promise<void>;
export function offloadBook(name: string): Promise<void>;
export function uploadBook(file: File, dir: string): Promise<string>;   // mode:"new"；非 UTF-8 转码；返回身份
// 改名 / 移动 / 回收站 = gallery verbs，不在此重写

// src/reading-position.ts —— 纯模型（node 测）
export interface TxtAnchor { kind: "txt"; chapter: number; title: string; frac: number }
export interface PdfAnchor { kind: "pdf"; page: number; frac: number }
export type Anchor = TxtAnchor | PdfAnchor;
export interface Chapter { title: string; level: number; start: number; bodyStart: number; end: number }
export function resolveTxtAnchor(a: TxtAnchor, chapters: Chapter[]): number;   // 标题命中 > 序号 clamp
export function isTrivialMove(a: Anchor, b: Anchor, kind: BookKind): boolean;   // valuable-save 的 trivial 判定

// src/live-book.ts —— 覆盖后的活书 diff（node 测）
export interface LiveUpdate { addedChapters: number; currentChanged: boolean }
export function diffChapters(oldCh: Chapter[], newCh: Chapter[], current: number, oldText: string, newText: string): LiveUpdate;
export function statusHeader(text: string): string | null;   // 第一行

// src/chapter-split.ts / src/encoding.ts —— v1 移植，纯函数
export function splitByPreference(text: string, pref: BookPref | null): { chapters: Chapter[]; chosen: string | null };
export function decodeBytes(buf: ArrayBuffer): { text: string; encoding: string };

// src/reader/port.ts —— 两个 island 共用
export interface Reader {
  load(blob: Blob, anchor: Anchor | null): Promise<void>;
  current(): Anchor | null;
  restore(anchor: Anchor): boolean;
  adopt?(blob: Blob): Promise<LiveUpdate>;   // txt：换底稿不重画当前章
  teardown(): void;
  onPosition(cb: (a: Anchor) => void): () => void;
}

// src/gallery-host.ts —— DocHost 实现（图库 → 阅读器）；阅读器只发事件不 import 图库
```

**gallery 包侧提案 .h（追加，默认值 = 现行为，WeebPaint 零改动）：**

```ts
export interface GalleryPolicy {
  // …现有字段不动…
  view?: "cards" | "list";                       // 默认 "cards"；"list" = 一行一本、名字整行、副标题一行
  fullscreen?: boolean;                          // 默认 false；true = 图库独占整屏（.gallery-full 转正）
  tile?: { aspect?: "1/1" | "2/3"; subtitle?: (item: GItem) => string | null; marker?: (item: GItem) => "unread" | null };
  pinned?: (items: GItem[]) => GItem[];          // 「最近阅读」条：宿主返回要置顶的几本（形状待 user 过目，或改 sortKey）
}
export interface DocHost {
  // …现有…
  upload?(files: File[], dir: string): Promise<string[]>;   // 读者类 app 的「新建」；不实现 = 无上传入口
}
// verbs：keepOffline(item) / offload(item) 进行菜单（offload 已有）
```

**`@internal/pdf-viewer` 提案 .h（新包，名字待 user）：**

```ts
export interface PdfViewerDeps { vue: VueRuntime; loadPdfjs: () => Promise<PdfjsLib>; t?: (key: PdfViewerTextKey) => string; anchorFraction?: number }
export interface PdfPosition { pageIndex: number; yFraction: number }
export interface PdfViewerHandle {
  load(blob: Blob, position: PdfPosition | null): Promise<void>;
  current(): PdfPosition | null;
  restore(p: PdfPosition): boolean;
  zoomIn(): void; zoomOut(): void; fitWidth(): void; toggleSpread(): void;
  outline(): Promise<OutlineNode[]>;
  on(ev: "position" | "page" | "spread", cb: (v: unknown) => void): () => void;
  teardown(): void;
}
export function mountPdfViewer(el: HTMLElement, deps: PdfViewerDeps): PdfViewerHandle;
// 纯几何随包导出（node 测）：scrollTopForPosition / positionForScroll / cozyScale / pagesPerRow
```

## 5. 从 Background Radio 现代化吸取的教训

诚实前提：**BR v2 具体哪里不完美，我这边没有记录**——09-01 之后 BR 无 commit、无 ai-docs，只有 user 2026-09-19 这句「still not perfect although it might be background radio being backgrounded during driving to blame」。所以下面是结构性教训，不是对 BR 症状的诊断：

1. **换库 ≠ 可靠**。BR v2 接了 store（2026-08-20），但真正折磨人的是平台事实（iOS 后台挂起、SW 僵死、online 事件不来），这些库管不了。JRB 的对应物是：**手机 PWA 挂起数小时 → 回前台 → 文件已被覆盖 N 次 / IDB 可能被端 / 登录 token 过期**。计划里每条都要在这个场景下过一遍（§4.6 采纳只走 chip、§4.9 首帧不等网、库 0.12.1 的 bfcache 闸门与 token 单飞）。
2. **钉旧版 = 慢性病**。BR 钉 store 0.2.0，落后 11 个 minor；JRB 第一天钉 0.13.0，且把 `pull-package.sh` 升级路径写进 README。
3. **`/dev/` 长期不 cutover 就是「两个都不完美」**。BR v2 在 `/dev/` 一个月未上 `/`。JRB：真机总单一批过 → 问 user push prod，不留双轨。
4. **build 断了 12 天没人知道**（BR `build.sh` 因改名断路）。JRB：`npm test` + `build.sh` + `boot-smoke` 三件在每次 bump 前必跑；不设 CI 但脚本必须一条命令。
5. **不留过渡兜底**（换代轮 #6 对 BR 的拍板同样适用 JRB）：不做 v1 数据双读、不做 itemId → path 桥、不保留 `session.json` 写路径。
6. **别催真机**：BR 六轮战报都是 user 开车/通勤顺手测出来的；JRB 的真机总单只交一张，等 user 有空。

## 6. ai-dropbox 愿望清单逐条（handoff §4；每条都要 user 批，「没意思就无视」）

| # | 愿望 | 建议 | 落点 |
|---|---|---|---|
| 1 | inbox：按修改时间倒序、未读标记、看完一键丢 .trash | **采纳**（几乎免费：文件名日期前缀 + natural 降序；未读 = 无位置条目；.trash = gallery 动词） | 期 2 |
| 2 | 覆盖友好的进度：标题 + 章内比例 | **采纳**，就是 §4.6，只到标题命中，不做 hash | 期 2 |
| 3 | 活书提示：状态头上卡片；更新时提示不静默 | **采纳**（§4.6 chip + 状态头） | 期 2 |
| 4 | 反馈回流 `feedback.jsonl` | **报批**。若做，形状改成**一笔一文件** `ai-dropbox/.feedback/<ts>.json`（`mode:"new"`，永不冲突、不进 Work 机器）而不是追加写一个 jsonl；agent 侧 glob 读 | 期 4 |
| 5 | 盲读揭榜 `<书名>.key.json` | **报批**，小活 | 期 4 |
| 6 | 大件上限 | **采纳**：阈值 20 MB 起，SE2 实测后定数回写 handoff | 期 2 |
| 7 | `*.part` / `~` / `.tmp` 不入书架 | **采纳** | 期 2 |
| 8 | 显示层简繁开关 | **不做**（要 vendor 转换表；写入方继续预转） | — |
| 9 | 日期前缀分组/隐藏 | **不做**（natural 排序已够；`NameBoundary.display` 可藏前缀，等 user 真觉得碍眼） | — |

## 7. 遗留数据

- `session.json` / `library.json`：**不迁移，不删**（换代轮拍板「只读遗留」；身份从 itemId 换路径，迁移要逐 id 查 Graph，不值）。书架保留名隐藏。代价：正在读的几本书位置丢一次，user 重新翻到。
- 旧 IDB `justreadbooks-cache`（≤500 MB）：v2 用新命名空间 `jrb.defaultStore`，旧库**不读不删**（WXHW 先例）。要清 → 设置里一个显式「清理旧版缓存」按钮，删库这一句是否算「app 直碰 IDB」需 escalate（§9 Q5）。
- 云端 `.trash/` 里的旧投递 3 个：库两端聚合的回收站直接看得见，user 自己清。

## 8. 分期与交付（每期 = 一个可跑点 + 测试；dev 自动 push，prod 等 user）

- **期 0 · 仓形（半天）**：`prod` 分支 = v23 快照；deploy.yml；Pages 切 Actions；`docs/` → `ai-docs/`（带日期戳，改引用）；收进本文与 09-17 handoff。**验证**：`/` 仍是 v23 可用；`/dev/` 出现。
- **期 1a · 两个包（API ritual，user 在场过目 .h）**：① gallery 包提案（§4.4 六条：列表视图 / 全屏 / subtitle·marker·pinned hook / 留离线动词 / 上传入口 / 隐藏新建）→ 过目 → 实现 → 测试 → release 0.3.0（WeebPaint / WXHW 零改动可验）；② `@internal/pdf-viewer` 出生（提案 .h → 过目 → 从 JRP 抽 + 几何测试随行 → 0.1.0 release）。
- **期 1b · 地基**：五包收货（store / gallery / workbench-elements / encryption / pdf-viewer）；TS/esbuild；`app-store.ts` 接缝 + 红线守卫测试；`books.ts`；device-kv / pwa-shell / i18n / sprite / error-badge；gallery 一屏（列表视图、全屏、云 chip 在图库）；txt 阅读器（chapter-split/encoding 移植 + 测试）；pdf 阅读器 = 包消费；位置本机可用；`api/` 首刷。**win**：`/dev/` 登录 → 图库列表列出 `ai-dropbox/`、长书名整行可见 → 开 txt/pdf → 关掉重开回到原位 → 离线能开已缓存的书。
- **期 2 · 可靠阅读**：锚 + 活书 chip + `pullIfClean` 接线 + 大件提示 + `.part` 过滤 + 最近阅读条 + 未读点 + 留离线/移除离线 + 上传 + `valuable-save` 节律。**win（mock 测，`@internal/store/testing`）**：① 同名覆盖 3 次、当前章 DOM 未重画、chip 出现、翻章后按标题回到同一章；② 前插章节 → 标题命中；③ 标题消失 → clamp；④ `.part` 不入书架；⑤ 离线开已缓存书成功、开纯云端书诚实失败。**真机总单（一批）**：`/dev/` 登录 → 图库 → 开活书 → 电脑上跑一次装订覆盖 → 手机上 chip 出现且没被抢 → 翻章 → 关 app 半天再开回原位 → 飞行模式开已缓存书 → 登出。
- **期 3 · 收尾**：README 重写（承诺随 §4.7 改）；`api/` 重打；`0.1.0` 翻牌（先问 push prod）；真机总单结果 → user 说 push prod → `prod` 分支前进。
- **期 4 · 报批项**：愿望 4/5；PDF 首页缩略图（派生缓存逐案申请）；folder provider 无地骑士（PC 读本地文件夹）；JRP 合并（§9 Q6）。

## 9. 需要 user 拍板

1. **进度同步选甲还是乙**（§4.7；推荐乙）。
2. **云图标进图库、设置只留阅读偏好**——已按 2026-09-19 原话写入，确认即可。
3. **基座 = WXHW 2.0 骨架 + JRP 器官**（§3 第一条，与 09-01「JRP 底座」措辞不同）。
4. **`prod` 分支 = v23 快照、`/dev/` 开工**（Azure `/dev/` redirect 已加，user 2026-09-19）。
5. 旧 IDB `justreadbooks-cache`：留孤儿 / 设置里显式清理按钮（后者是否算直碰 IDB 归 user 判）。
6. **JRP 去留**：JRB v2 带 JRP 的 pdf viewer 后，论文是否搬进 JRB（Apps/JustReadPapers → Apps/JustReadBooks/papers 由 user 在 OneDrive 网页手动挪，appfolder 不能跨 app 读）；JRP 是否正式 sunset。
7. **版本 0.1.0 纪元**；README 承诺改写是否算吃书归 user。
8. 愿望清单 §6 的 4/5 做不做。
9. 大件阈值起点 20 MB（实测后改）。
10. **gallery 第二种 UI 的形状**（§4.4 / §4.10：`view:"list"` + `fullscreen` + 三个 hook + 上传入口）——提案 .h 过目；「最近阅读」用 `pinned` 还是 `sortKey`。
11. **pdf-viewer 包的名字与范围**（`@internal/pdf-viewer`？只 viewer + 几何，outline 归包，缩略图不归）。

## 10. 不做 / park

- 行 hash / 段落 hash 锚（user：不确定靠谱；标题命中够用）。
- 按章懒加载大件（需索引 + range 读，写入方分卷更便宜）。
- 加密书、简繁转换、日期分组、`beforeunload` keepalive PUT（库无此面；靠 valuable-save 节律 + 切后台 flush）。
- folder provider / 多库 registry（gallery 包已有器官，等 user 点名）。
- PDF 缩略图派生缓存（逐案申请）。
