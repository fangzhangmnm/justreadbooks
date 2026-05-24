# PWA 热更新 toast

> 抄自 [JustReadPapers docs/06-pwa-hot-update.md](../../20260518%20JustReadPapers/docs/06-pwa-hot-update.md),只保留本 repo 实际用到的部分,并补本 repo 特有的坑。

## 问题

GitHub Pages 部署 + service worker 缓存 = 用户什么时候能看到新版?简单答案"刷新就行"在 **iOS PWA** 上不成立 —— 从主屏冷启动,fetch 全走 cache,**永远看不到新版**直到 SW 源 byte 变。

## 三条检测路径,都要开

每条覆盖不同场景。少一条某些场景就漏报。

```js
// A. SW fetch handler 后台 revalidate 发现 eTag / content-length 变了 → postMessage
//    适合:tab 一直开着,没刷过
self.addEventListener("fetch", ...);  // 在 SW 里

// B. registration.updatefound + newWorker.statechange === "installed"
//    适合:本次访问期间 SW 源 byte 变了(主路径)
reg.addEventListener("updatefound", () => {
  const nw = reg.installing;
  nw.addEventListener("statechange", () => {
    if (nw.state === "installed" && navigator.serviceWorker.controller) {
      showUpdateToast();
    }
  });
});

// C. 启动时 registration.waiting 已经在 + 当前 controller 在
//    适合:上次访问已装好新 SW 但用户没点刷新,这次冷启动直接报
if (reg.waiting && navigator.serviceWorker.controller) {
  showUpdateToast();
}
```

**iOS PWA 关键**:从主屏冷启动,fetch 多半全走 cache → A 不 fire,靠 B/C 兜底。

## bump CACHE_VERSION 是部署仪式

```js
const CACHE_VERSION = "v2-2026-05-24";
```

SW 源 byte 变 = 浏览器触发 `updatefound`。如果只改 app.js 没改 SW,SW 内容相同 → 浏览器不认 SW 变 → B 不 fire → iOS PWA 永远收不到。

**每次 push bump 一次**,手动,没自动 build pipeline。`v3-2026-05-25`、`v4-...` 这样。

也可以只在 `PRECACHE_URLS` 变了时 bump —— 但本 repo `index.html` 里有版本提示更显眼,推荐每次都 bump。

## activate 清旧 cache

不清旧 cache 的话,IndexedDB / CacheStorage 涨爆 (尤其 vendor/pdfjs 占 4MB,几个版本累起来很可观)。

```js
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith("jrb-") && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});
```

`startsWith("jrb-")` 是本 app 的 cache 名前缀,避免误删跨 origin 邻居 (webxiaoheiwu / justreadpapers 也部署在 fangzhangmnm.github.io 同 origin 下)。

## 不在 localhost 注册 SW

本地开发 (`python -m http.server`) reload 时 cache 会捣乱,改 CSS 不立即生效。注册前 skip:

```js
const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""]);
if ("serviceWorker" in navigator && !LOCAL_DEV_HOSTS.has(location.hostname)) {
  navigator.serviceWorker.register("./service-worker.js");
}
```

## fetch 策略:cache-first + 后台 revalidate

```js
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 跨源 (Graph / MSAL login) → passthrough,不 cache
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    const networkFetch = fetch(req).then((resp) => {
      if (resp?.ok) {
        if (cached) {
          const changed =
            cached.headers.get("etag") !== resp.headers.get("etag")
            || cached.headers.get("content-length") !== resp.headers.get("content-length");
          if (changed) notifyUpdate(req.url).catch(() => {});
        }
        cache.put(req, resp.clone()).catch(() => {});
      }
      return resp;
    }).catch(() => null);

    if (cached) { networkFetch.catch(() => {}); return cached; }  // 先返 cache,不 await
    const resp = await networkFetch;
    if (resp) return resp;
    if (req.mode === "navigate") {
      const fb = await cache.match("./index.html");
      if (fb) return fb;
    }
    return new Response("offline & not cached", { status: 503 });
  })());
});
```

本 repo 现在所有依赖都 vendor 进同源 (`src/vendor/pdfjs/`、`src/vendor/msal/`),不再有跨源 CDN fetch。Edge "Tracking Prevention" 拦截那批 warning 也消失了。

## dedup 通知:一次 per SW lifetime

避免反复弹 toast(用户看到一次就够了别再骚扰):

```js
let updateAnnouncedThisLoad = false;
async function notifyUpdate(url) {
  if (updateAnnouncedThisLoad) return;
  updateAnnouncedThisLoad = true;
  const clientsList = await self.clients.matchAll({ includeUncontrolled: true });
  for (const client of clientsList) client.postMessage({ type: "asset-updated", url });
}
```

## toast UX:不自动 reload

用户可能正读到一半,自动 reload 跳到顶部 = 找不到位置。让 *用户* 决定:

```js
function showUpdateToast() { toast.classList.remove("hidden"); }

reloadButton.addEventListener("click", () => {
  flushKeepalive();  // 把没 flush 的位置先 PUT 上去
  navigator.serviceWorker.controller?.postMessage({ type: "skip-waiting" });
  location.reload();
});
```

SW 端响应:

```js
self.addEventListener("message", (event) => {
  if (event.data?.type === "skip-waiting") self.skipWaiting();
});
```

## 本 repo 特有的坑

### 1. updateMode = "site" | "session" 分流

toast 文案只有一种,但触发源有两种:

- **site**: SW 检测到本站文件变 → reload 整页
- **session**: OneDrive `session.json` 远端 eTag 变(另一台设备改了)→ reload session 状态,不 reload 页

混在一起会双触发或语义乱。reload 按钮根据 `updateMode` 分流:

```js
if (updateMode === "site") { location.reload(); }
else if (updateMode === "session") { await applyRemoteUpdate(); }
```

本地模式 (没配 Azure) 永远只有 "site" 触发,但代码路径还是分开写,以后接 OneDrive 自动兼容。

### 2. 升级 vendor 时改了 PRECACHE_URLS 必须 bump

`src/vendor/` 体积大 (~4MB),改了路径或版本忘 bump,SW install 的 `cache.add()` 拿到的还是旧路径 → 用户 cache 里出现 404 引用 → 页面 loading 错乱。

每次动 vendor:
1. 改 `service-worker.js` 里的 `PRECACHE_URLS` 列表
2. bump `CACHE_VERSION`

### 3. install 时单条 precache fail 不要让整体挂

旧版用 `cache.addAll(URLS)` —— 任意一条 404 整个 install fail → SW 永远装不上 → A/B/C 三条路径全失效。

改成逐条 try:

```js
for (const url of PRECACHE_URLS) {
  try { await cache.add(url); }
  catch (e) { console.warn("precache miss:", url, e?.message); }
}
```

至少漏掉某个 vendor 子文件不会让整个 SW 挂。

### 4. 已装 v1 的浏览器升 v2 流程

本地开发(不注册 SW)无所谓。但生产环境 / 已经"添加到主屏"的 iOS PWA:

- bump CACHE_VERSION + 推 push
- 用户下次启动 / focus → B 路径 fire → toast
- 用户点刷新 → skip-waiting + reload → v2 接管 + activate 清掉 v1 cache

如果调试 / 想强制清旧:DevTools → Application → Service Workers → Unregister + Application → Storage → Clear site data。

### 5. 跨 origin sibling app 不要互相清 cache

`fangzhangmnm.github.io` 同 origin 下有 webxiaoheiwu / justreadpapers / justreadbooks 等多个 app,每个 SW 的 `caches.keys()` 看到的是同一组 (origin 级别共享)。**activate 清旧 cache 时务必只清自己的前缀**:

```js
keys.filter((k) => k.startsWith("jrb-") && k !== CACHE_NAME).map((k) => caches.delete(k));
```

不带前缀 filter 就把邻居清光,邻居的离线缓存全没。
