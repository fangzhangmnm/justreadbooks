# 读书 · JustReadBooks

> 一打开就是上次没看完的那一页 —— TXT 网文 + PDF 图书,飞机上也能看。

**👉 [https://fangzhangmnm.github.io/justreadbooks/](https://fangzhangmnm.github.io/justreadbooks/)**

不用下载,不用安装,浏览器打开就用。手机加个主屏图标,跟原生 app 一样。

![icon](./icon.svg)

---

## 它解决的事

- **打开就回到上次那一页**。没有"选一本书"的选择困难症,没有"上次看到哪了"的翻找。
- **手机一章一章看**。网文 TXT 自动按章节切开,顶上下"上一章 / 下一章"两个按钮,按起点 / 番茄那种节奏。
- **飞机上也能看**。提前点缓存按钮把要看的书拉到本地,断网就用本地的。再也不用临行前往手机塞文件。
- **真的不用登录**。直接拖一个 TXT / PDF 到窗口就开看。位置自动记。云端是可选的,不是必需的。

## 它没有的事

- 没有广告。
- 没有推荐算法,不会给你推"猜你喜欢"。
- 不联网卖你的阅读数据。整个 app 是一坨纯静态网页 + 你的 OneDrive(如果你愿意连)。
- 不需要会员。

## 怎么用

### 第一次

打开 [链接](https://fangzhangmnm.github.io/justreadbooks/) → 拖一个 TXT 或 PDF 进窗口 → 开看。

就这样。

### 连 OneDrive (可选)

如果你有微软账号(Outlook / Hotmail / Microsoft 365 / 公司账号都行),进设置面板 →「登录」。登录之后:

- 登录状态下拖进来的书自动同步到云端,所有设备都能看到
- 一台设备看到 100 页,另一台打开自动跳到 100 页
- 在 OneDrive 网页里手动整理书架(建文件夹、改文件名),这边也跟着变

**关于"没登录时拖进来的书":**
- 第一次登录时会问你 "把它们也同步到云端吗" (实际上是自动同步,只在第一次登录这一次)
- 已经登录过、又登出、又拖了东西、又登录回来 —— 这些"中间拖的"文件**默认留在本地**,要让它们上云需要在书架里点 [上传到云端]。设计原则:不替你做你没明确同意的事

不想连?永远不连也完全没问题,本地文件永远不会被推到任何地方。

### 加到手机主屏

iPhone:Safari 打开链接 → 分享 → 添加到主屏幕
Android:Chrome 打开链接 → 菜单 → 添加到主屏幕

加完以后跟原生 app 一样,小图标点开就用。

## 主题

象牙白金(日)/ 黑金(夜)/ 跟随系统。点左下角月亮图标切换。

## 网文章节自动切分

TXT 里有 `第N章` / `Chapter N` / Markdown `### 标题` 这些,会自动认出来切成章节。

不行的话进设置选个匹配规则,或者自己填正则。

## 编码

老网文 .txt 经常是 GB2312 / GBK / Big5,这玩意儿直接用 UTF-8 解码会乱码("锟斤拷")。本 app 会自动认出编码再解,不用你管。

本地上传的非 UTF-8 文件,自动转 UTF-8 后再传 OneDrive(让其他设备拿到不再乱码)。已经在 OneDrive 上的文件不动它,只下载时按编码解。

---

## 给开发者

本 app 是无构建静态网页,所有依赖(pdf.js / MSAL)都 vendor 在 `src/vendor/` 里,纯同源加载,不连 CDN。

### 本地跑

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000/
```

### 部署你自己的版本

如果你想 fork 一份用自己的微软账号:

1. fork 这个 repo
2. 在 [Azure Portal](https://entra.microsoft.com) → App registrations → New registration
   - Supported account types:**Personal Microsoft accounts only**
   - Redirect URI:Single-page application,值 = 你的 GH Pages 地址(`https://你的用户名.github.io/justreadbooks/`)
   - API permissions:加 `Files.ReadWrite.AppFolder` + `offline_access`
3. 拿到 Application (client) ID,填到 [src/config.js](src/config.js) 的 `CLIENT_ID`
4. GitHub repo Settings → Pages → Deploy from `main` / root

### 架构

```
index.html               主表面
manifest.webmanifest     PWA
service-worker.js        cache-first + 新版本 toast
icon.svg                 书脊 + 书页 图标
src/
  config.js              CLIENT_ID + 章节内建正则
  auth.js                MSAL silent probe
  graph.js               OneDrive AppFolder wrapper
  encoding.js            UTF-8 / GB18030 / Big5 自动探测
  cache.js               IndexedDB 缓存 (本地文件 SSOT) + LRU + 用户钉住
  session.js             session.json 跨设备同步阅读位置
  chapter-split.js       TXT 章节切分
  viewer-pdf.js          pdf.js 阅读器
  viewer-txt.js          TXT 分章阅读器 (一次一章 + ←/→ 翻章)
  app.js                 orchestrator
  styles.css             象牙白金 / 黑金 主题
  vendor/                pdf.js + MSAL (整包 vendor)
docs/                    工程笔记 (PWA 热更新、sync 约束等)
```

### 工程笔记 docs/

按话题分:

- [00-sync-constraints.md](docs/00-sync-constraints.md) — cross-project 设计准则 (4 级数据保护 / consent scope / 8 条 priority)
- [01-pwa-hot-update.md](docs/01-pwa-hot-update.md) — SW 热更新 toast,3 条检测路径,bump CACHE_VERSION 仪式
- [02-cloud-conflict-policy.md](docs/02-cloud-conflict-policy.md) — etag freshness + ghost + accountId 隔离 + accountless 审计
- [03-cross-device-sync.md](docs/03-cross-device-sync.md) — session.json 跨设备同步,debounce+ceiling,412 merge,jumpscare 启动,focus 静默 pull
- [04-txt-chapter-splitting.md](docs/04-txt-chapter-splitting.md) — TXT 章节切分,内建正则,2-group level 约定,GB18030 编码,目录树折叠
- [05-cache-strategy.md](docs/05-cache-strategy.md) — IDB 缓存,4 级保护落地,LRU + pin,auto-cache,freshness 触发点
- [06-local-upload-flow.md](docs/06-local-upload-flow.md) — constraint #4 落地,pendingUpload/uploadDeferred 状态机,drain,collision
- [07-ui-patterns.md](docs/07-ui-patterns.md) — zen 顶栏,drawer 互斥,行级 busy 锁,键盘 + 手柄,主题
- [08-viewer-architecture.md](docs/08-viewer-architecture.md) — PDF 懒加载 + 重试,TXT 一章一屏渲染,position 协议
- [09-defensive-patterns.md](docs/09-defensive-patterns.md) — IDB 隐私窗口探针,retrySilentSignIn,navigator.onLine 不可信,系统对话框替换 TODO

### License

MIT
