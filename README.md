# 读书 · JustReadBooks

> 一打开就是上次没看完的那一页 —— TXT 网文阅读器，书放 OneDrive，飞机上也能看。

**👉 正式版 [https://fangzhangmnm.github.io/justreadbooks/](https://fangzhangmnm.github.io/justreadbooks/)（v1，v23）· 新版 [/dev/](https://fangzhangmnm.github.io/justreadbooks/dev/)（0.1，真机验证中）**

不用下载，不用安装，浏览器打开就用。手机加个主屏图标，跟原生 app 一样。

![icon](./icon.svg)

---

## 它解决的事

- **打开就回到上次那一页**。没有「选一本书」的选择困难，没有「上次看到哪了」的翻找。
- **手机一章一章看**。网文 TXT 自动按章节切开，顶上下「上一章 / 下一章」两个按钮，按起点 / 番茄那种节奏。
- **书在更新也不打断你**。书被电脑上的脚本重新生成了，正在读的那一章不会被抢走：只出一枚「已更新」提示，翻章或点它才换成新内容。回到书架时它自己就是新的。
- **飞机上也能看**。打开过的书自动留一份在本机；想囤的先在书架点「留一份离线」，断网就用本机的。
- **真的不用登录**。直接拖一个 TXT 到窗口就开看。位置自动记。云端是可选的，不是必需的。

## 它没有的事

- 没有广告，没有推荐算法，不会给你推「猜你喜欢」。
- 不联网卖你的阅读数据。整个 app 是一坨纯静态网页 + 你的 OneDrive（如果你愿意连）。
- 不需要会员。

## 怎么用

### 第一次

打开链接 → 拖一个 TXT 进窗口 → 开看。就这样。

### 连 OneDrive（可选）

用**个人**微软账号（Outlook / Hotmail；公司/学校账号不支持）。进书架 → 右上角云图标 →「连接 OneDrive」。连上之后：

- 书放在 OneDrive 的 `Apps/JustReadBooks/` 里（可以建子文件夹分类），这边书架跟着变。
- **每本书读到哪了会跨设备同步**：手机读到 137 章，iPad 打开那本书就在 137 章。它不会替你换书——你在哪台设备读什么，由你自己点。
- 没登录时拖进来的书留在本机；联网登录后会问你一次要不要推到云端。

不想连？永远不连也完全没问题，本机的书永远不会被推到任何地方。

### 加到手机主屏

iPhone：Safari 打开链接 → 分享 → 添加到主屏幕。Android：Chrome 打开链接 → 菜单 → 添加到主屏幕。

## 阅读设置

字号、行高、黑体 / 宋体、行宽两档（窄 = 轻小说式约 22 字/行；宽 = 纸书约 30 字/行）、主题（象牙白金日 / 黑金夜 / 跟随系统）。这些跟设备走，不跨设备同步。

键盘：← → 翻章，Space / PageDown 翻屏，B 书架，O 目录，S 设置。手柄（Quest）：十字键上下 4 行一步、左右翻章，Select 目录，Start 书架。

## 网文章节自动切分

TXT 里有 `第N章` / `Chapter N` / Markdown `#` 标题这些，会自动认出来切成章节。不行的话进设置给这本书选个规则，或者自己填正则。老网文常见的 GB2312 / GBK / Big5 编码会自动认出来，不会「锟斤拷」。

---

## 给开发者

0.1 纪元（2026-09-19 起）：TypeScript + 家族四个内部包（`@internal/store` 云同步 / `@internal/gallery` 书架 / `@internal/workbench-elements` UI 原子 / `@internal/encryption` 表态）；全 vendor、无 CDN、无运行时 npm。v1（vanilla JS，≤ v23）在 `ARCHIVE/v1/` 只当参考。设计与拍板见 [ai-docs/20260919-modernization-plan.md](ai-docs/20260919-modernization-plan.md)。

```bash
npm install                 # 开发期依赖（typescript）；四个包是 vendor-pkgs/*.tgz，断网可装
npm test                    # node 直跑（切章 / 编码 / 节律 / 红线守卫 / i18n 对账）
bash scripts/build.sh       # tsc 门 + 接缝 lint + sprite 对账 + 裸中文扫描 + esbuild → dist/jrb-<hash>.mjs
npm run smoke               # 无头 chromium：上传 → 阅读 → 模拟远端覆盖 → 刷新回原位
python3 -m http.server 8000 # 本地跑（http://localhost:8000/，无 SW）
```

部署：`main` → `/dev/`，`prod` 分支 → `/`（`.github/workflows/deploy.yml`）。

### 部署你自己的版本

1. fork 这个 repo
2. [Entra](https://entra.microsoft.com) → App registrations → New registration：Supported account types = **Personal Microsoft accounts only**；Redirect URI = Single-page application，值 = 你的 GH Pages 地址；API permissions = `Files.ReadWrite.AppFolder` + `offline_access`
3. 拿到 Application (client) ID，填到 [src/config.ts](src/config.ts) 的 `CLIENT_ID`
4. GitHub repo Settings → Pages → Source = GitHub Actions；建 `prod` 分支；Settings → Environments → `github-pages` → Deployment branches 加上 `prod`（默认只放行 `main`，不加则 prod 的部署被 environment protection rules 拒掉）

### 架构

```
index.html / styles.css / service-worker.js / manifest.webmanifest   壳（象牙白金 / 黑金）
src/app.ts             组合根：接线与事件编排
src/app-store.ts       @internal/store 唯一接缝（createStore 表态 + 两个 collection）
src/books.ts           书的动词：列表订阅 / 本地优先打开 / 后台追新 / 留离线 / 上传
src/reading-position.ts 每本书阅读位置（synced collection + 写盘节律）
src/chapters/          切章深模块：split / tree / anchor / diff / statusHeader（零 DOM 零 store）
src/reader/txt.ts      TXT 阅读器（一章一屏；换底稿不重画当前章）
src/gallery-host.ts    书架屏（@internal/gallery 消费面：列表视图、云图标、状态头副标题、未读点）
src/i18n/              文案 SSoT（zh / en）
test/                  node 测试 + boot smoke；api/ = tsc 签名树
```

### License

MIT
