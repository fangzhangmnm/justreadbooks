# 防御性写法 + 静默失败陷阱

> 抄自 [WebPaint sync-and-ui-shareback.md §7-8](../../20260524%20WebPaint/WebPaint/docs/sync-and-ui-shareback.md)。
> 记几个 sibling apps 都踩过的坑,以及怎么防。

## 1. IDB 可能被静默禁(隐私窗口 / Safari 老版本)

iOS Safari 隐私窗口:
- 老版本 (Safari < 14): `indexedDB.open` 直接抛 `SecurityError`
- 新版本: 允许 open,但配额极小(几 MB),关 tab 即清,写大 blob 时静默失败或抛 `QuotaExceededError`

后果: `cache.listMeta` / `cache.getBlob` 抛错 → `renderDocList` 静默死 → user 看到空白书架以为"app 坏了"。

### 我们的修法 — 健康探针 + 显著 banner

boot 时 [probeIdbHealth](../src/app.js) 调一次 `cache.listMeta()`:
- 成功 → 继续
- 失败 → 显示顶部红色 banner "本地存储不可用 — 可能是隐私窗口或浏览器配额耗尽。阅读进度无法保存。"

不挂 boot —— IDB 失败时还能用 OneDrive (在线模式)。仅显著提示告诉 user 进度无法本地保存。

### WebPaint 的教训

WebPaint v57 排查这个时,工程师(AI)第一反应是诊断"离线降级"路径,糊了一堆 try/catch 写防御代码。**真因**是 user 用的是隐私窗口。两小时后 user 自己想到的。

教训:
- **不要照"用户描述的现象"想象 root cause** — "离线"在用户语义里 ≠ `navigator.onLine === false`
- **少糊 try/catch** — 绝大多数是 cargo cult。**只有让用户行为可见后果的错才需要 surface**
- **静默失败 = 最大的坑** — 每条用户路径出错都要落到 UI 上
- **隐私模式 ≠ 离线 ≠ 未登录** — 三个状态都让"云功能不可用",但根因和提示语该不同
- **debug 路径**:让 user 自己提一个可能性比工程师猜 5 个先。AI 容易在猜测上 spiral

## 2. `navigator.onLine === true` 不可信

iOS Safari 上 `navigator.onLine`:
- `false` 几乎确定离线 (high confidence)
- `true` 不一定真在线 (DNS 走通但 server 不可达也 `true`)

**只用 `=== false` 作 fast-path**。判"在线"时不能信它,真正发请求才知道。

我们这边:
- 没专门检查 `navigator.onLine === true` 来做决策
- `online` 事件 listener 触发后,才发 Graph 请求 verify
- Graph 请求失败 → 错误自然处理,不依赖 onLine

## 3. MSAL `activeAccount` 在 boot 时离线会永久 null

WebPaint §7.1.1:

> MSAL 的 `activeAccount` 只在 boot 时 `acquireTokenSilent` 成功才设上。如果 boot 时
> 离线 (飞机模式 / 火车隧道 / iOS 后台休眠 wifi 没接上),silent 抛错 → activeAccount
> 永远是 null → 后面 wifi 回来 `isSignedIn()` 还是 false → 用户点同步 / 拉书架都
> "未登录"。

### 修法 — 暴露 `retrySilentSignIn` + 两个触发点

[auth.js:retrySilentSignIn](../src/auth.js):
- 检查 cached account 还在不
- 重新 `acquireTokenSilent`
- 成功 → set activeAccount,return true
- 失败 → return false (不抛)

触发点:
- `online` 事件:网回来了第一时间救活 ([app.js online listener](../src/app.js))
- syncStatus 点击 (manual sync):user 想同步 → 先 retry 一次再 fail-soft 弹设置面板

## 4. PWA SW 注册必须模块顶层

详见 [01-pwa-hot-update.md](01-pwa-hot-update.md)。坑要点:

- `window.load` listener 挂晚了不触发 — dynamic `import()` 异步,load 经常已 fire
- 模块顶层直接 `navigator.serviceWorker.register(...)` — 不 await 不卡 boot
- `_swRegistration` 存模块变量 — iPad save-to-home 模式下 `getRegistration()` 偶尔返 undefined

## 5. SW 刷新按钮推 `reg.waiting`,不是 `controller`

详见 [01-pwa-hot-update.md](01-pwa-hot-update.md)。错的话 toast 死循环:推给旧 SW (= controller) 它自己已 active → `skipWaiting()` 无意义 → 新 SW 永卡 waiting → reload 仍用旧 cache → 又弹 toast。

## 6. 不要用系统对话框 (alert / confirm / prompt)

WebPaint §7.4:全屏 PWA 上系统对话框观感很糟,被 iOS 包了一层蓝色 modal,跟 app 主题不搭。

**我们现在仍有几处 `confirm()` 和 `alert()`**:
- trashBook / restoreBook / purgeBook / emptyAllTrash / uncacheItem / deleteLocalBook / deleteGhost
- clearUnpinned / clearAllCache
- uploadFiles 几处 `alert()`
- createNewFolder 用 `prompt()`

TODO: 用 in-app sheet 替换。目前 web 用还 OK,iPad PWA 装到主屏后观感会变差。**还没做**。

## 7. emoji 当 UI 图标不可靠

WebPaint §7.5:不同 iOS 版本字体配置渲染不一致,zoom 也奇怪。

我们这边 95% 用 SVG (`viewBox="0 0 24 24"` `fill="none" stroke="currentColor" stroke-width="1.8"`)。只有 outline twisty (`▸`/`▾`) 是 Unicode 字符 — 那两个在所有平台稳定可用。OK。

## 8. visualViewport / iOS Safari URL bar

iOS Safari URL bar 推送 → 不一定触发 `window resize` event。canvas 内部 pixel buffer 旧尺寸 + CSS 拉伸 → 渲染像素和 clientX/Y 错位。

我们这边只用 PDF (pdf.js 自己处理) + TXT (纯 DOM,自适应),**不直接画 canvas**。不需要这个修。但 pdf.js 偶尔会因为同样原因显示尺寸错乱,刷新一下就好。

## 9. ghost pointer (iOS 偶尔丢 pointerup)

也是绘画 app 特有,我们这边没主动用 pointer events 做画布交互,**不需要**。

## 总结 — 我们这边的 defensive checklist

| 项 | 做了 | TODO |
|---|---|---|
| IDB 健康探针 + banner | ✅ probeIdbHealth | — |
| `navigator.onLine === false` 才信 | ✅ | — |
| retrySilentSignIn + online 触发 | ✅ | — |
| SW 模块顶层注册 | ✅ v20 起 | — |
| 刷新按钮推 reg.waiting | ✅ v20 起 | — |
| in-app sheet 替换 alert/confirm/prompt | — | 装 PWA 后该做 |
| 替换 emoji 图标 | n/a 没用 emoji | — |
| visualViewport / pointer 修 | n/a 不用 canvas | — |
