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
- **朗读（0.2.1 进行中，2026-10-01；界面与接线已落、真引擎和语音包还没接 → 这一版顶栏不露朗读钮）**：本体 = 家族共享库 `@internal/read-aloud`（开发期 0.0.0，`vendor-pkgs/` 里是 dev-install 装的开发包；库仓 `../20261001 internal-read-aloud/`，规则见它的 CLAUDE.md）。**唯一接缝 `src/read-aloud-host.ts`**（值级 import 只准这里，build.sh + redline-guard 守）。分工：库管分句 / 合成 / 播放 / 「读到哪一句」；`src/reader/txt.ts` 加了五个按字符偏移说话的动作（`bodyText / offsetAt / firstVisibleOffset / markReading / revealSpan`）——**正文仍是一整个文本节点**，正在读的句子用 CSS Custom Highlight 画（`::highlight(jrb-reading)`），不为朗读改 DOM。交互：顶栏喇叭钮进朗读态 → 底部控制条（上一句 / 播放·暂停 / 下一句 / 退出）；朗读态下轻点一句 = 只读那一句；▶ = 从标着的句子连读，章末自动翻章（只有标题的空章直接跳过），屏幕常亮（Wake Lock）；自己翻章 / 换书 / 进书架 = 停；切后台 = 暂停（**锁屏 / 后台连读不在这一版的承诺里**）。语音包：清单内嵌在 `src/read-aloud-packs.generated.ts`（`node tools/gen-read-aloud-packs.mjs` 从模型仓生成，测试守漂移），现在是空的；设置 →「朗读」栏 = 下载 / 从本机文件导入 / 删除、音色（多音色才露）、语速、语音包来源（可改镜像）。worker 是第二个构建入口（`dist/read-aloud-worker-<hash>.js`，`<meta name="read-aloud-worker">`），**不预缓存、不随主 bundle 加载**；没进过朗读 = 引擎和语音包零字节。user 2026-10-01 定：**先用つくよみちゃん 兜底所有语言，别的音色以后慢慢加**；她的后端（piper-plus）还在和电脑参考实现对齐（现场 `~/jupyter/third-party/piper-plus/`）。验证：`npm run smoke` 现在跑两份——启动冒烟 + `test/read-aloud-smoke.mjs`（假引擎走完界面流程，28 项）；真引擎整链在库仓 `npm run e2e`。真机零。edited by Claude Fable 5.1 2026-10-01

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
| localStorage（device-kv）`read-aloud` | { pack, voice, speed, source } | 朗读偏好（设备属性，不跟云；0.2.1） |
| Cache Storage `pwa-models`（家族共享名；经 `@internal/read-aloud` 的 worker） | 语音包分片 + verified 标记 | 可再生派生缓存（user 2026-10-01 批，同上一句话）。**家族共享**：同源的 WXHW 下过的包这里直接能用（user「最好jrb和wxhw如果都用朗读的话可以共享同一个缓存」）。「清缓存重启」不许动它（`src/pwa-shell.ts` 只清 `jrb-` 前缀，冒烟守着）；删语音包只在设置 →「朗读」里逐包删 |
| Cache Storage `jrb-<hash>`（service worker 运行时缓存） | 公共字体 `vendor/fonts/sans.ttf.gz`、朗读 worker、朗读引擎文件 | 用过才进缓存；换版本重取 |
