# 工单 E 报告：读书收新同步库 + 常驻条 + 命名空间表 + 六问

> created 20261103 by Claude Opus 5.5 · as-of v0.2.30 / 2026-11-03。读者 = Fable 和 user。工单 = 家族根 `ai-docs/20261103-work-orders.md` 工单 E + §0.3；Fable 11-03 裁定「读书不闸，只挂常驻条」。

## 0. 一屏结论

- **做完了**：收 store 2.2.4 / gallery 0.8.10 / model-packs 0.1.1，接好「旧的怎么办」；开机 / 醒来悄悄核，核不上只挂常驻条，回线自动收；正式版 / 开发版壳缓存分开（F-145）；命名空间表；六问。测试全绿。
- **没有卡门**。有一个问题要 Fable 看：**从设计稿到这里，「离线」不是人选的，是自动判的**（§3 第 1 条）。
- **没有真机**：条在阅读页上会不会碍事，要 user 用 dev 自然撞上，不催。

## 1. 做了什么（commit 一行一个）

| commit | 内容 |
|---|---|
| `c0f51b6` | v0.2.30：全部内容，读书没有分步提交的必要 |

验证：`npm test` 全过；`npm run smoke` 全过（boot 48、朗读 85、模型包）；`npm run e2e:sync` 全过（**这个仓第一次有同步测试台**，`test/e2e-sync/`，照小黑屋改的）。

## 2. 规则书 §4 检查表逐项

这一轮读书不上 itch，部署形态那几项不适用。

| # | 项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 自家前缀 token | ✓ | `justreadbooks-2f8a41c7b9d3e650`（`src/device-kv.ts:9`、`src/config.ts:7`） |
| 2 | 存储名带前缀 | ✓ | 下面命名空间表；只有 MSAL 是第三方 |
| 3–6、9–12 | 部署形态 / itch | 不适用 | 这轮不上 itch。第 6 项：读书没有加密、没有记住口令 |
| 7 | 崩溃影子 at-rest | 不适用 | 读书没有影子，也没有加密件 |
| 8 | 资源读出重核哈希 | ✓ | 收 `@internal/model-packs` 0.1.1（读缓存逐片重核）；`test/model-packs.mjs` |
| 13 | 一次做全 ★ | ✓ | 状态机每个依赖都有真消费者（`src/app.ts:523`）；有家的判据 = 真账号；**没有抄闸门那些用不上的**（罩、逃生钮、锁屏位代号都没带过来） |

### 命名空间表

| 名字 | 种类 | 文件:行 | 前缀 |
|---|---|---|---|
| `jrb.defaultStore`（+ `.staging`）+ localStorage `jrb.defaultStore.*` | store 自己的库 | `src/config.ts:5` APP_ID → `src/app-store.ts:36` | ✓（工单认 `${appId}.…`） |
| `justreadbooks-2f8a41c7b9d3e650.gallery-registry` | IDB 图库注册表 | `src/config.ts:7` → `src/gallery-host.ts:56` | ✓ |
| `justreadbooks-2f8a41c7b9d3e650:*` | localStorage（device-kv，唯一器官） | `src/device-kv.ts:9` | ✓ |
| `jrb-<hash>`（正式版）/ `jrb-dev-<hash>`（开发版）/ `jrb-boot` | Cache 壳 | `service-worker.js:24`；`src/pwa-shell.ts:13` | ✓（**这轮修的**，F-145；正式版那边要等推 prod） |
| `pwa-models` | Cache 家族共享 | 经 `@internal/model-packs`，接缝 `src/read-aloud-host.ts` | ✓（家规共享名） |
| `msal.*` 等 | localStorage（MSAL） | `node_modules/@internal/store/dist/base/providers/auth.js:272` | **✗ 第三方**，靠一 app 一子域名隔开 |
| `navigator.locks` 名 / `BroadcastChannel` 名 | — | 本仓 `src/` grep 零处；`@internal/*` 的 dist 也零处 | ✓（没有） |
| SW scope | `./service-worker.js` = 所在目录 | `src/pwa-shell.ts:96` | ✓ |

单测：`test/sw-cache-scope.test.mjs`。

### 六问（`20261103-library-needs-a-home.md` §2）

**先说「家」对读书是什么**（核对单 §3 要求单独说清）：书架里的书是**三等资源**，字节的正本在别处（用户自己的 txt、写入方推到 OneDrive 的活书）；阅读位置是**四等游标**，允许合并。读书不产生一等作品。所以读书的「家」只决定书和进度能不能跨设备，不决定有没有丢作品的风险。

| # | 问题 | 答 | 证据 |
|---|---|---|---|
| Q1 | 没有 provider 能建库存东西吗 | **能**：开页就建库，没登录也能把 txt 传进书架（只在 IDB） | `src/app-store.ts:36`；`src/books.ts:64`（`tryPush: signedIn && online`） |
| Q2 | 有本地文件夹这个家吗 | **没有** | `showDirectoryPicker` 全仓零处 |
| Q3 | 没有家时能做什么 | 传 txt 进书架、读、记进度。**没有「不进库，只开一个文件」的路**，选文件 = 进库 | `src/app.ts:381` |
| Q4 | 库入口没有家时长什么样 | 照常能进，不灰、没说明 | `src/app.ts:279`、`:280` |
| Q5 | 设备上有只在浏览器里的东西吗 | **有**：没登录传的书、没登录时的进度。但书是资源、原文件在用户手里；登录后「去处理」能传上去 | `src/app.ts:616` |
| Q6 | 崩溃影子 / 自动快照存哪 | 读者永不改写书，没有影子。进度走 collection 本地层（防抖落盘） | `src/reading-position.ts:15`、`:46` |

**我的看法（只报不改，归 Fable / user）**：Q1 / Q4 按规则书字面不合格，但规则书 §1 第 13 条的理由是「IDB 里永远不放任何东西的正本」，读书放的不是正本。设计稿刚写的「只有一等作品住库里的 app 才闸」这个口径也许同样适用于第 13 条。要不要给读书开这个例外，你们定。

## 3. 常驻条验收（Fable 裁定：读书不闸）

`npm run e2e:sync`，真 app + 真库 + 假云：

| # | 验收 | 结果 | 实测 |
|---|---|---|---|
| ① | 没有家：什么都没有 | ✓ | 没条、没续签 |
| ② | 登录好 + 云端没动 | ✓ | 没条；确实问了云端 |
| ③ | 续签失败 | ✓ | 不弹面、书摆着；条写「离线 · 登录过期了 · 重新登录」；之后零新请求；回线续签成 → 条收 |
| ③b | 「离线」不进存储 | ✓ | 重开不带上次的状态 |
| ③c | 点条重新登录 | ✓ | 取消不动；去登录 → 条收 |
| ③d | 没网时传的书 | ✓ | 条写「还有 1 份没传上去」；点 = 书架「要处理的」 |
| ④ | 没网 | ✓ | 86 ms 挂条，不续签；网回来自己收 |
| ⑤ | 云端慢 | ✓ | **书 3 ms 摆好，不等云端**；7.9 s 挂条（8 s 硬超时，黑匣子核）；云端回了自己收 |
| ⑥ | 中途过期 / 断网 / 醒来 | ✓ | 条马上挂、不弹面；醒来续签成了条收 |
| ⑧ | 黑匣子有原因码 | ✓ | 成败两条都核了；`[cloud] silent renew (boot): failed elapsed=…ms name=… code=…` |
| 改名 | 「旧的怎么办」三选一 | ✓ | 取消 / 留着 / 搬走，各自核云端和回执 |

结构守卫 `test/cloud-watch.test.mjs`：条和状态机不许碰任何面；boot 不等云端；每趟和硬超时赛跑；「离线」不落盘；云端判断不许散在 `navigator.onLine`；库改了日志行格式会红。

**§1 排查结论 = (b)**，同小黑屋：配置都对（`/consumers` `src/config.ts`；`localStorage` 缓存、回跳 `auth.js:268`、`:272`），刷新令牌固定 24 小时的证据来自 WeebPaint 黑匣子，**读书自己的要等真机黑匣子**（§6）。

**请 Fable 看的取舍：**

1. **「离线」是自动判的，不是人选的**。核不上就让库停网（`isOnline` 假），条挂着。好处：连不上时不反复撞网。代价：**假阳性时（8 秒内慢了一下）打不开云端的书**，要等迟到的回答、等隔一分钟的再问（只有「网盘没回应」这种才重试）、或点条。登录过期不自动重试（隐藏 iframe 不该一分钟开一次），等人点条或醒来。
2. **条上写「登录过期了 · 重新登录」**，比裁定的「离线」多几个字。理由：阅读页没有云钮，不写的话掉登录的人没有回去的路（user 的原话就是「每次开都得手动解决一下登录状态」）。点了走现有的两步登录。
3. **离开不足 2 分钟回来不核**（条挂着例外）。没有闲置锁屏，数字照小黑屋。
4. **状态机没和小黑屋共用**。这边是 129 行的另一个东西（没有罩、闸、逃生钮），只有 `parseAuthFailure` 那几行一样。CatsUp / KudsRocket 接闸门时可以看看要不要把「原因码解析」进库，不急。

## 4. 卡门的

没有。

## 5. Fable 要看的 diff

| 文件 | 看哪 |
|---|---|
| `src/cloud-watch.ts` | 全文：`run()`、`recover()`、`authChanged` |
| `src/offline-bar.ts` | 点条的三种去向 |
| `src/app.ts:519-540`、`:554`、`:580` | 接线：回前台分路、一分钟重试 |
| `src/store-ui.ts` | `resolveRenameOld`；`reportError` 捡原因码 |
| `service-worker.js:24-25`、`activate` | 壳缓存分范围 |

## 6. 真机项（攒批，不催）

- 用 dev 过一天以上再开：条应该写「登录过期了 · 重新登录」，书照读。黑匣子 `[cloud] silent renew` 那几行就是 §1 要的证据。
- 条在阅读页上的位置碍不碍事（贴底居中，无头没看过真屏）。
- iPad Edge 隐藏 iframe 卡住时：书照读，8 秒后才挂条。

## 7. 新图标需求

无。用现有的 `cloud-unavailable`。

## 8. 没做

- 本地文件夹的家（Q2）、库入口（Q4）：工单说只报不改。
- 朗读纪元功能没碰。
- prod 没推；等 user 一句话。
