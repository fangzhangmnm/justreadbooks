# JustReadBooks（家族总规则见上级 CLAUDE.md）

TXT 网文/轻小说阅读器（0.1 纪元：2026-09-19 在 @internal/store + @internal/gallery 上重做；v1 vanilla JS 在 `ARCHIVE/v1/` 只当 spec 读）。UI 中文（i18n SSoT `src/i18n/strings.ts`，zh 默认 / en 备）。计划 + 拍板 = `ai-docs/20260919-modernization-plan.md`；滥用模式（MyLlamaReborn 把 `ai-dropbox/` 当电脑→手机投递箱，同名 txt 一晚覆盖 3–10 次）= `ai-docs/20260917-myllamareborn-ai-dropbox-handoff.md`。edited by Claude Fable 5.1 2026-09-19

- **核心设计前提（user 2026-09-19）：远端一直在更新，新版不用清缓存就能看到，但永不为此转圈**——有本地副本秒开（不等 token / 网），后台 `pullIfClean`；用户没动就静默换底，动过就出「已更新」chip（翻章或点 chip 才换字节）。无副本才带字节进度条下载。
- **数据**：书 = `store.file("<夹/>书名.txt")`（身份 = 路径；读者永不 `save` 既有书，lint 守 `save(` 只在 `src/books.ts` 的上传/补推）；每本书阅读位置 = synced collection `reading-position`（乙：**没有全局 lastActive funnel**，v1 的跨设备跳书已删）；切章规则 = collection `book-prefs`；设备偏好（字号/行高/字体/行宽两档/主题/语言/本机上次那本）= device-kv。v1 遗留 `session.json` / `library.json` 只读遗留不迁不删（书架隐藏）；旧 IDB `justreadbooks-cache` 留孤儿。
- **切章 = 独立深模块 `src/chapters/`**（split / tree / anchor / diff / statusHeader；零 DOM 零 store，node 全测）。位置锚 = 序号 + 标题文本 + 章内比例，**只做标题命中 + 序号兜底，不做行 hash**（user：串章是小事）。单行状态头不成章。
- **接缝**：`src/app-store.ts` 是 `@internal/store` 唯一值级 import；`src/encryption.ts` 零 codec 表态；`src/device-kv.ts` 是 localStorage 唯一器官；`test/redline-guard.test.mjs` + `scripts/build.sh` 机械执法。
- **书架 = `@internal/gallery` 0.4.0**（`src/gallery-host.ts`；列表视图、云图标在书架顶栏、副标题·未读 hook、留离线动词；提案 `../20260909 internal-gallery/ai-docs/20260919-proposal-list-view.md`）。**切分铁律（user 2026-09-19「gallery 是前端」）**：夹里有什么 = store（`createStore({ hiddenName })`）；改名事件 = `store.files.onRenamed`（阅读位置 / 切章规则 / 上次那本指针跟着搬，app.ts 订阅一次）；图库只画、只发起。
- **PDF 本轮 sunset**（user 2026-09-19）：下一轮出 `@internal/pdf-viewer` 极简无框控件（单页/双页/连续多页，按钮归 app）；JRP 是独立产品不动。
- **Quest**：手柄 D-pad 4 行量化滚动、Select 目录、Start 书架（`src/reader/keys.ts`）。

## 命令
`npm test`（node 直跑）· `bash scripts/build.sh`（tsc 门 + 接缝 lint + sprite 对账 + 裸中文扫描 + esbuild → `dist/jrb-<hash>.mjs`）· `npm run smoke`（借 WeebPaint playwright：上传→阅读→覆盖 adopt→刷新回原位）· `bash scripts/gen-api.sh`（api/ 户口）· `./bump.sh vX.Y.Z-YYYY-MM-DD`。
部署：main → `/dev/`，prod 分支 → `/`（`.github/workflows/deploy.yml`）；**push prod 必问 user**（硬规则 #5）。

## 黄线区（外接服务白名单）
无。JRB 不接任何第三方网络服务；云端全经 `@internal/store`（OneDrive appfolder，硬规则 #6/#7）。`test/redline-guard.test.mjs` 黄线测试守 `src/` 零非相对 URL fetch。

## 持久层白名单
| 层 | 键 / 库 | 内容 |
|---|---|---|
| localStorage（device-kv，前缀 `justreadbooks-2f8a41c7b9d3e650:`） | theme / reader-prefs / shelf-layout / lang / last-open / gallery-folder / last-scene / diag-log | 设备属性 + 本机指针 + 黑匣子 |
| IndexedDB `jrb.defaultStore`（库） | files / trash / backup / collections / staging / dir-index-cache | 书的本地副本 + 两个 collection |
| 云端 appfolder | `<夹/>书.txt`、`.jrb/reading-position.json`（{anchor, readAt}）、`.jrb/book-prefs.json`（{regexId, regexCustom, encoding, header}）、`.trash/` | 书 + 位置 + 规则 + 状态头 |
| localStorage 库前缀 `jrb.defaultStore.*` | etag / dirty / pending 账 | 库内部 |
