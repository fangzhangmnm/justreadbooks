# PWA 热更新检测 + 版本号水印 + 手动检测

> 蓝本是 [WebPaint docs/pwa-update-detection.md](../../20260524%20WebPaint/WebPaint/docs/pwa-update-detection.md)。
> 本 repo 在 v20 重写时全套照搬,并加 sync-related 的踩坑。

## TL;DR(少一件都会有 user 抱怨)

1. **SW 在模块顶层 register**(不能塞 `window.load`,dynamic import 异步,load 经常已 fire)
2. **4 条 update 检测路径全挂**(waiting / updatefound / postMessage / poll)
3. **菜单加"检测更新"按钮**,返回"已是最新(vNN)"或"有新版本"
4. **屏幕上常驻版本号水印** —— user 点了刷新之后视觉确认新代码生效
5. **刷新按钮 postMessage 推 `reg.waiting`,不是 controller**(否则永卡 waiting,toast 死循环)
6. **版本号 SSoT** 在 [`src/version.js`](../src/version.js),SW + page 共享

## 问题

GitHub Pages 部署 + service worker 缓存 = 用户什么时候看到新版?简单答案"刷新就行"在 **iOS PWA** 上不成立 —— 从主屏冷启动,fetch 全走 cache,**永远看不到新版**直到 SW 源 byte 变。**而 iPad PWA 标准模式默认不主动 check SW**,可能几小时甚至几天才 check 一次。

## 0. SW 注册必须在模块顶层

```js
// ❌ 错(本 repo v19 之前的写法)
window.addEventListener("load", async () => {
  const reg = await navigator.serviceWorker.register("./service-worker.js");
});
```

**为什么炸**:`<script type="module" src="./src/app.js">` 是异步加载(网络 + 编译 + 依赖图)。等 `app.js` 跑起来时 `load` event 常常已 fire 过 → `addEventListener` 永远不触发 → SW 根本没注册。iPad PWA 加到主屏 → 飞行模式 → 找不到服务器;"检测更新"会说 "SW 未注册"。

```js
// ✅ 对的:模块顶层直接 register
let _swRegistration = null;
if ("serviceWorker" in navigator && !LOCAL_DEV_HOSTS.has(location.hostname)) {
  navigator.serviceWorker.register("./service-worker.js").then((reg) => {
    _swRegistration = reg;
    // 四条 update 路径在 .then 里挂
    ...
  }).catch((err) => console.warn("SW register failed", err));
}
```

要点:
- 模块顶层 → 同步触发 register
- 不 await → promise 后台跑,不卡其他启动逻辑
- 存到模块级 `_swRegistration` 给"检测更新"按钮 / refresh 按钮用

## 四条检测路径

```
                 +-----------------------+
   bump version.js → byte 变 ────────→ │ 浏览器 fetch 新 SW   │
                 +-----------┬---------+
                             |
              registration.update() (路径 4 主动 poll)
                             |
              install → precache → skipWaiting
                             |
              state: installed (路径 2) ──→ showUpdate()
                             |
              activate → clients.claim
                             |
              asset-updated postMessage (路径 3) ──→ showUpdate()

  开机时:   registration.waiting (路径 1) ──→ showUpdate()
```

### 路径 1: `registration.waiting`(开机检查)

上次 session 装好但没 activate 的,开机立刻 toast。

### 路径 2: `updatefound` + `statechange === "installed"`

本次 session 浏览器 check 到 + 装完了的瞬间。**必须**判断 `navigator.serviceWorker.controller` 存在(controller=null 说明首次安装,不该弹 update toast)。

### 路径 3: SW postMessage `{ type: "asset-updated" }`

SW 的 fetch handler:cache-first + background revalidate + ETag 比对。ETag 变了就 `clients.postMessage`。`updateAnnouncedThisLoad` 防同一 SW 生命周期重复广播。这条**比版本检测更敏感** —— 忘 bump version 但某 asset 字节级变了也能抓到。

### 路径 4: `visibilitychange` / `focus` / 10min interval → `reg.update()`

让浏览器**主动**去 check SW 更新。**iPad PWA standalone 模式下浏览器默认不勤快 check SW** —— 没有这条,前面三条都得等浏览器自己想起来。**这条是 iOS PWA "不主动"的解药**。

```js
const pokeUpdate = () => { reg.update().catch(() => {}); };
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") pokeUpdate();
});
window.addEventListener("focus", pokeUpdate);
setInterval(pokeUpdate, 10 * 60 * 1000);
```

## 刷新按钮的常见 bug:推错对象

```js
// ❌ 错(原代码)
navigator.serviceWorker.controller?.postMessage({ type: "skip-waiting" });
location.reload();
```

**炸的现象**:toast 弹"有新版本" → user 点刷新 → 仍是旧版本 → toast 又弹。死循环。

**为什么**:`navigator.serviceWorker.controller` 是**当前 active 的 SW = 旧版本**。推给它 `skipWaiting` 无意义(它自己已 active)。新 SW 永卡 `waiting`。reload 又用旧 SW 服务旧 cache → 老代码再跑 → 又弹 toast。永动机。

```js
// ✅ 对的
const reg = _swRegistration || await navigator.serviceWorker?.getRegistration();
if (!reg || !reg.waiting) { location.reload(); return; }
let reloaded = false;
const doReload = () => { if (reloaded) return; reloaded = true; location.reload(); };
navigator.serviceWorker.addEventListener("controllerchange", doReload, { once: true });
reg.waiting.postMessage({ type: "skip-waiting" });  // 推等待的新 SW
setTimeout(doReload, 5000);  // iOS 偶发不 fire controllerchange 的兜底
```

要点:
- postMessage 推 `reg.waiting`,不是 `controller`
- 听 `controllerchange` 等新 SW 接管,**再** reload
- 兜底 timeout 防 iOS 不 fire `controllerchange`

## 版本号 SSoT (`src/version.js`)

```js
// src/version.js (classic script,不是 ES module)
self.JRB_VERSION = "v20-2026-05-25";
```

```html
<!-- index.html,早于 app.js -->
<script src="./src/version.js"></script>
<script type="module" src="./src/app.js"></script>
```

```js
// service-worker.js 顶部
importScripts("./src/version.js");
const CACHE_VERSION = self.JRB_VERSION;
```

```js
// app.js 启动时
document.getElementById("versionLabel").textContent = window.JRB_VERSION;
```

Bump 一处,SW + page 两边同步,永远不漂移。Bump 即 byte 变 → 浏览器 install 新 SW → activate 时清旧 cache。

**改了客户端代码但忘 bump**:路径 3 的 ETag 检测能救你弹 toast,但 cache 名没换,下次 reload 还是旧 cache。**bump 是真解**。

## 屏幕上必须显示版本号(hard requirement)

**为什么**:user 点了"刷新"之后,**他没办法判断新代码是否真的跑起来了**。没有版本号水印:

- bug fix 推上去 → user 收到 toast → 点刷新 → 看上去一样 → "你这版本根本没生效"报告
- 实际可能是网络抖动 + SW activate 失败、precache 某个 asset 404、cache 没换……

本 repo 把版本号打到**顶栏 status 区域**(`第N页 · 已同步 5 分钟前 · v20-...`),低 opacity 但常驻;设置面板的"应用更新"section 也有。user 一眼看到 = 视觉确认闭环。

## 手动"检测更新"按钮

设置面板的"应用更新"section 加一个 `[检测更新]` 按钮。调 `_swRegistration.update()`,等 1.5 秒看 `reg.waiting`:

```js
const reg = _swRegistration || await navigator.serviceWorker?.getRegistration();
if (!reg) { status.textContent = "Service Worker 未注册"; return; }
await reg.update();
setTimeout(() => {
  if (reg.waiting) status.textContent = "有新版本,刷新页面应用";
  else status.textContent = `已是最新 (${window.JRB_VERSION})`;
}, 1500);
```

返回消息**带版本号** —— "已是最新(v20-2026-05-25)"比"已是最新"信息量大十倍。user 跟屏幕水印一对照 = 闭环。

为什么 4 条自动路径都挂上还要这条:**user 主动想确认时需要有出口**。bug 报告时 user 自己点一下 = "是的我装的是 vNN" / "提示有新版本"。

## bump 时机 / activate 清旧 cache

每次推应该 bump `version.js` 一次(约定 `vN-YYYY-MM-DD`):

- byte 变 → SW install 新 SW(`importScripts` 引入的 version.js byte 变也算 SW 变)
- install 把所有 PRECACHE_URLS 入新 cache
- activate 时清旧 jrb-vN-* cache:`keys.filter(k => k.startsWith("jrb-") && k !== CACHE_NAME)`

**前缀 filter 很重要**:同 origin (fangzhangmnm.github.io) 下还有 sibling app (justreadpapers / webxiaoheiwu),caches.keys() 看得到所有。`startsWith("jrb-")` 隔离掉只清自己的。

## dedup 通知

```js
let updateAnnouncedThisLoad = false;
async function notifyUpdate(url) {
  if (updateAnnouncedThisLoad) return;
  updateAnnouncedThisLoad = true;
  ...
}
```

page 端额外:`updateDismissed` —— user 关过 toast 同 session 不再弹。

## 跟 sync 的耦合 / 踩坑

### updateMode = "site" vs "session" vs "content"

toast 文案虽然只有"有新版本",但底层 reason 不同:
- **site**:SW 检测到本站 asset 变 → reload 整页(本 doc)
- **session**:OneDrive session.json 远端 eTag 变 → 现在自动静默 pull,不弹 toast (see [02-cloud-conflict-policy.md](02-cloud-conflict-policy.md))
- **content**:某本书云端版本变 → silentRefresh,viewer 在原位置 re-load,不弹 toast

reload 按钮根据 updateMode 分流。混在一起会双触发或语义乱。

### 升级 vendor 时改了 PRECACHE_URLS 必须 bump

`src/vendor/` 体积大(~4MB),改了路径 / 版本忘 bump,SW install 的 `cache.add()` 拿到的还是旧路径 → 用户 cache 里出现 404 引用 → 页面 loading 错乱。

每次动 vendor:
1. 改 `service-worker.js` 里的 PRECACHE_URLS 列表
2. bump `src/version.js`(等价 bump CACHE_VERSION)

### install 时单条 precache fail 不要让整体挂

```js
for (const url of PRECACHE_URLS) {
  try { await cache.add(url); }
  catch (e) { console.warn("precache miss:", url, e?.message); }
}
```

`cache.addAll(URLS)` 任意一条 404 整个 install 失败 → SW 永远装不上 → 4 条路径全失效。

### controllerchange 是 SW lifecycle 一部分,不要重连冲突

刷新按钮的 `addEventListener("controllerchange", ..., { once: true })`:`once` 保证一次。多次按刷新 / 反复触发不会累积 handler。

## 别犯的 anti-pattern

- ❌ SW register 放 `window.load`(v19 修)
- ❌ "刷新"按钮 postMessage 给 `controller`(v20 修)
- ❌ 只挂路径 3 — iPad 上 90% 不会 fire,因为 SW 没 check
- ❌ 没有手动"检测更新"出口
- ❌ 不显示版本号
- ❌ "检测更新"返回不带版本号
- ❌ 用 `navigator.serviceWorker.getRegistration()` 拿 reg — iPad save-to-home 模式下偶发返 undefined;启动时存的 `_swRegistration` 更稳
- ❌ 自动 reload — user 可能正在读。绝不自动,toast + 用户点
- ❌ 同 session 反复弹 toast — `updateAnnouncedThisLoad`(SW)+ `updateDismissed`(page)各守一边
- ❌ 在 localhost 注册 SW — F5 就拉不到最新代码了。`LOCAL_DEV_HOSTS` 白名单排除
- ❌ `clients.claim()` 不调 — 老 tab 还是旧 SW 控,下次 reload 才换
- ❌ 忘 bump version.js 又改文件 — 路径 3 ETag 检测能救一次,但 cache 名没换

## 兄弟项目实现对照

| 项目 | SW 文件 | 版本号 SSoT | 4 条路径 |
| - | - | - | - |
| WebXiaoHeiWu | `service-worker.js` | 在 SW 内 | ✅ 最早范式 |
| RealHome | `service-worker.js` | 在 SW 内 | ✅ |
| JustReadPapers | `service-worker.js` | 在 SW 内 | ✅(3 路径,v3 加 4) |
| WebPaint | `service-worker.js` + `src/version.js` | ✅ SSoT | ✅ 文档蓝本 |
| **JustReadBooks** | `service-worker.js` + `src/version.js` | ✅ SSoT | ✅ v20 起 |
