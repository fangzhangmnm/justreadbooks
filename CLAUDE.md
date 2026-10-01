# JustReadBooks（家族总规则见上级 CLAUDE.md）

TXT 网文/轻小说阅读器（0.1 纪元：2026-09-19 在 @internal/store + @internal/gallery 上重做；v1 vanilla JS 在 `ARCHIVE/v1/` 只当 spec 读）。UI 中文（i18n SSoT `src/i18n/strings.ts`，zh 默认 / en 备）。计划 + 拍板 = `ai-docs/20260919-modernization-plan.md`；滥用模式（MyLlamaReborn 把 `ai-dropbox/` 当电脑→手机投递箱，同名 txt 一晚覆盖 3–10 次）= `ai-docs/20260917-myllamareborn-ai-dropbox-handoff.md`。edited by Claude Fable 5.1 2026-09-19

- **核心设计前提（user 2026-09-19）：远端一直在更新，新版不用清缓存就能看到，但永不为此转圈**——有本地副本秒开（不等 token / 网），后台 `pullIfClean`；用户没动就静默换底，动过就出「已更新」chip（翻章或点 chip 才换字节）。无副本才带字节进度条下载。
- **数据**：书 = `store.file("<夹/>书名.txt")`（身份 = 路径；读者永不 `save` 既有书，lint 守 `save(` 只在 `src/books.ts` 的上传/补推）；每本书阅读位置 = synced collection `reading-position`（乙：**没有全局 lastActive funnel**，v1 的跨设备跳书已删）；切章规则 = collection `book-prefs`；设备偏好（字号/行高/字体/行宽两档/主题/语言/本机上次那本）= device-kv。v1 遗留 `session.json` / `library.json` 只读遗留不迁不删（书架隐藏）；旧 IDB `justreadbooks-cache` 留孤儿。
- **切章 = 独立深模块 `src/chapters/`**（split / tree / anchor / diff / statusHeader；零 DOM 零 store，node 全测）。位置锚 = 序号 + 标题文本 + 章内比例，**只做标题命中 + 序号兜底，不做行 hash**（user：串章是小事）。单行状态头不成章。
- **接缝**：`src/app-store.ts` 是 `@internal/store` 唯一值级 import；`src/encryption.ts` 零 codec 表态；`src/device-kv.ts` 是 localStorage 唯一器官；`test/redline-guard.test.mjs` + `scripts/build.sh` 机械执法。
- **书架 = `@internal/gallery` 0.4.0**（`src/gallery-host.ts`；列表视图、云图标在书架顶栏、副标题·未读 hook、留离线动词；提案 `../20260909 internal-gallery/ai-docs/20260919-proposal-list-view.md`）。**切分铁律（user 2026-09-19「gallery 是前端」）**：夹里有什么 = store（`createStore({ hiddenName })`）；改名事件 = `store.files.onRenamed`（阅读位置 / 切章规则 / 上次那本指针跟着搬，app.ts 订阅一次）；图库只画、只发起。
- **PDF 本轮 sunset**（user 2026-09-19）：下一轮出 `@internal/pdf-viewer` 极简无框控件（单页/双页/连续多页，按钮归 app）；JRP 是独立产品不动。
- **Quest**：手柄 D-pad 4 行量化滚动、Select 目录、Start 书架（`src/reader/keys.ts`）。
- **0.2 纪元（朗读纪元，2026-10-01 开工；user「jrb决定要加之前记得bump minor」「设置分栏 公共字体 逐句朗读 亮屏连续 做」）**。评估与提案 = 家族根 `ai-docs/20261001-read-aloud-shared-lib-assessment.md`。**0.2.0 = 设置分栏 + 公共字体**：① 设置页 = 原生 `<details class="settings-section">` 四栏（阅读 / 界面 / 这本书 / 应用），零 JS，只有第一栏默认开（照 WXHW；user「设置能不能做成和wxhw一样分栏目展开的」）；「界面」栏（书架布局 / 主题 / 语言）是从原「阅读」里拆出来的，AI 拆的、待 user 过目。② 阅读正文黑体档 = 家族公共字体（思源黑体全量，`vendor/fonts/sans.ttf.gz` 6.3 MB，与 WXHW 同一个文件，sha256 见该目录 README）：唯一入口 `src/fonts.ts loadSansFace()`，family = `JRB Sans`（名字 AI 起的、待 user 过目），`--font-reading-sans` 第一位；**不挡启动**（首帧后的空闲片里才取、只有黑体档取、SW 不预缓存）；装进文档时 `app.ts ensureReadingFont()` 先记章内比例、装完对回去。宋体档照旧系统宋体。逐句朗读 / 亮屏连读见下一条。edited by Claude Fable 5.1 2026-10-01
- **朗读（0.2.1，2026-10-01 落地；user「语音包推。库发0.1.0 … merge吧」）**：本体 = 家族共享库 `@internal/read-aloud` **0.1.1**（库仓 `../20261001 internal-read-aloud/`，规则见它的 CLAUDE.md；收货 `pull-package.sh`）。随附音色 = つくよみちゃん（模型仓 `voices/tsukuyomi-chan.json`，五个小包 66.2 MB）。**唯一接缝 `src/read-aloud-host.ts`**（值级 import 只准这里，build.sh + redline-guard 守）。
  - 分工：库管分句 / 合成 / 播放 / 「读到哪一句」；`src/reader/txt.ts` 加了五个按字符偏移说话的动作（`bodyText / offsetAt / firstVisibleOffset / markReading / revealSpan`）——**正文仍是一整个文本节点**，正在读的句子用 CSS Custom Highlight 画（`::highlight(jrb-reading)`），不为朗读改 DOM。
  - **朗读是可选的，平时不打扰阅读**（user 2026-10-01「jrb如果每行都有speaking按钮会很干扰。而且大部分时候我们也不需要语言」「我的想法是你设置里面开启朗读模式，有全文朗读和每行点读」）：正文里永远没有朗读按钮；顶栏的喇叭钮**只有「装了音色 + 设置里朗读模式开着」才露**（偏好 `have` / `off`；启动时不为问这一句起 worker；`have` 记错了——缓存被清、兄弟 app 删了共用包——点一下就带去设置把账记对）。开关在设置 →「朗读」第一行：没装音色是灰的，第一次装上自动开，关掉不删音色。
  - 交互：顶栏喇叭钮进朗读态 → 底部控制条（上一句 / 播放·暂停 / 下一句 / 退出）。**点读**：没在念全文时轻点一句 = 只读那一句（粒度是句不是行；点在哪个字 → 那个字所在的句子）。**全文朗读**：▶ = 从标着的句子（没有就从屏幕上第一句）一路往下念，章末自动翻章（只有标题的空章直接跳过），屏幕常亮（Wake Lock）；**念全文的过程中（含暂停）轻点别的句子 = 跳到那一句接着念**（user「全文一定要有跳转到某一行的功能」）；自己翻章 / 换书 / 进书架 = 停；切后台 = 暂停（**锁屏 / 后台连读不在这一版的承诺里**）。
  - **音色 = 几个小包**（库的 `VoiceDef`：权重 / 运行时 / 每种语言的词典；包名规矩见家族 CLAUDE.md「共享模型库」）。内嵌目录 `src/read-aloud-packs.generated.ts`（`READ_ALOUD_VOICES` + `READ_ALOUD_PACKS`）由 `node tools/gen-read-aloud-packs.mjs` 从模型仓的 `voices/*.json` 生成，测试守漂移；**只内嵌模型仓里已经有的**（界面上不许出现下不到的下载钮）；生成物里有音色名和上游要求原样显示的日文署名，`tools/hunt-raw-cjk.mjs` 给它开了数据豁免。界面只说「音色」；**只把这一章的语言装进引擎**（日语前端固定占 160 MB 内存；日语正文里夹的拉丁字母走英语前端，所以日语章装日 + 英）；翻到别的语言的章自动换装。
  - 设置 →「朗读」栏：每个音色一行（下载 / 从本机文件导入 / 删除）、**音源的署名和使用条款原文**（`.ra-credit`，正文字号，不翻译——上游条款要求显眼、字号够）、说话人（多说话人才露）、语速、语音包来源（可改镜像）。导入按内容哈希认文件，文件名不作数。
  - worker 是第二个构建入口（piper-plus 引擎 = **module worker**，`dist/read-aloud-worker-piper-plus-<hash>.js` 约 156 KB，`<meta name="read-aloud-worker-piper-plus">`），**不预缓存、不随主 bundle 加载**；引擎的 wasm 和词典不在 app 仓里，随语音包来。没进过朗读 = 引擎和语音包零字节。
  - user 2026-10-01 定：**先用つくよみちゃん 兜底所有语言（日 / 英 / 中），别的音色以后慢慢加**。加音色 = 模型仓加包和 `voices/<id>.json` → 重跑 `tools/gen-read-aloud-packs.mjs` → build → 设置 →「朗读」里多一行；每个音色给用户的那句实话（哪种语言是本行）写在 i18n `ra.voiceNote.<id>`。
  - 验证：`npm run smoke` = 启动冒烟 + `test/read-aloud-smoke.mjs`（假引擎走完界面流程，41 项）；`npm run smoke:voice` = `test/read-aloud-voice.mjs`（**真引擎**：在 app 里真下载、点一句念一句、连读跨日 / 英 / 中三章、删除，18 项；默认读检疫桶里那份打包目录，目录不在就跳过；`READ_ALOUD_VOICE_DIR="../20260903 PWA Models"` 指向模型仓，再加 `READ_ALOUD_EMBEDDED=1` 就用 app 自己内嵌的目录跑）；库自己的整链在库仓 `npm run e2e`。真机零（iOS 内存、手机速度都没数据）。edited by Claude Fable 5.1 2026-10-01

## 命令
`npm test`（node 直跑）· `bash scripts/build.sh`（tsc 门 + 接缝 lint + sprite 对账 + 裸中文扫描 + esbuild → `dist/jrb-<hash>.mjs`）· `npm run smoke`（借 WeebPaint playwright：上传→阅读→覆盖 adopt→刷新回原位）· `bash scripts/gen-api.sh`（api/ 户口）· `./bump.sh vX.Y.Z-YYYY-MM-DD`。
部署：main → `/dev/`，prod 分支 → `/`（`.github/workflows/deploy.yml`）；**push prod 必问 user**（硬规则 #5）。

## 黄线区（外接服务白名单）
**模型源**（user 2026-10-01「JRB 可以从家族模型仓下载语音包、并存在浏览器缓存里吗？ 可以！」；0.2.1 朗读用）= 家族级白名单 ②（默认 `https://fangzhangmnm.github.io/pwa-models`，设置里可改镜像）——只读 GET 语音包分片，逐片 sha256 对内嵌清单；发请求的是 `@internal/read-aloud` 的 worker（不在 `src/` 里），`src/` 里仍然零非相对 URL 的 fetch，`speechSynthesis` / `SpeechRecognition` 一律禁（守卫测试）。
除此之外：JRB 不接任何第三方网络服务；云端全经 `@internal/store`（OneDrive appfolder，硬规则 #6/#7）。`test/redline-guard.test.mjs` 黄线测试守 `src/` 零非相对 URL fetch。

## 持久层白名单
| 层 | 键 / 库 | 内容 |
|---|---|---|
| localStorage（device-kv，前缀 `justreadbooks-2f8a41c7b9d3e650:`） | theme / reader-prefs / shelf-layout / lang / last-open / gallery-folder / last-scene / diag-log | 设备属性 + 本机指针 + 黑匣子 |
| IndexedDB `jrb.defaultStore`（库） | files / trash / backup / collections / staging / dir-index-cache | 书的本地副本 + 两个 collection |
| 云端 appfolder | `<夹/>书.txt`、`.jrb/reading-position.json`（{anchor, readAt}）、`.jrb/book-prefs.json`（{regexId, regexCustom, encoding, header}）、`.trash/` | 书 + 位置 + 规则 + 状态头 |
| localStorage 库前缀 `jrb.defaultStore.*` | etag / dirty / pending 账 | 库内部 |
| localStorage（device-kv）`read-aloud` | { voice（音色 id）, speaker, speed, source, have（这台设备上有没有能用的音色）, off（用户关了朗读模式） } | 朗读偏好（设备属性，不跟云；0.2.1） |
| Cache Storage `pwa-models`（家族共享名；经 `@internal/read-aloud` 的 worker） | 语音包分片 + verified 标记 | 可再生派生缓存（user 2026-10-01 批，同上一句话）。**家族共享**：同源的 WXHW 下过的包这里直接能用（user「最好jrb和wxhw如果都用朗读的话可以共享同一个缓存」）。「清缓存重启」不许动它（`src/pwa-shell.ts` 只清 `jrb-` 前缀，冒烟守着）；删只在设置 →「朗读」里按音色删（别的装着的音色还在用的包留着） |
| Cache Storage `jrb-<hash>`（service worker 运行时缓存） | 公共字体 `vendor/fonts/sans.ttf.gz`、朗读 worker | 用过才进缓存；换版本重取 |
