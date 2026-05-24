// SW: cache-first + 后台 revalidate + ETag/length diff → 通知页面 "有新版本"。
// 用户点刷新才 skipWaiting + reload(永不自动 reload —— 可能正在读书)。
//
// 改了 precache 文件后必须 bump CACHE_VERSION。
//
// 全部依赖都同源 (src/vendor/),不走 CDN —— 没有跨域 fetch,
// 也就没有 Edge "Tracking Prevention" 拦截问题。
// 唯一跨源 = Graph + MSAL login,passthrough 不缓存。

const CACHE_VERSION = "v10-2026-05-24";
const CACHE_NAME = `jrb-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon.svg",
  "./src/styles.css",
  "./src/app.js",
  "./src/auth.js",
  "./src/graph.js",
  "./src/session.js",
  "./src/cache.js",
  "./src/encoding.js",
  "./src/chapter-split.js",
  "./src/viewer-pdf.js",
  "./src/viewer-txt.js",
  "./src/config.js",
  "./src/vendor/pdfjs/pdf.mjs",
  "./src/vendor/pdfjs/pdf.worker.mjs",
  "./src/vendor/pdfjs/web/pdf_viewer.mjs",
  "./src/vendor/pdfjs/web/pdf_viewer.css",
  "./src/vendor/msal/msal-browser.min.js",
];
// cmaps / standard_fonts / web/images 不预缓 —— 按需 fetch (SW 仍会命中本站缓存层),
// 体积大装 PWA 时不阻塞。

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // 同源整体 precache。单个 fail 不要让整个 install 挂(可能某次重命名遗漏)
    for (const url of PRECACHE_URLS) {
      try { await cache.add(url); }
      catch (e) { console.warn("precache miss:", url, e?.message); }
    }
    await self.skipWaiting();
  })());
});

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

let updateAnnouncedThisLoad = false;
async function notifyUpdate(url) {
  if (updateAnnouncedThisLoad) return;
  updateAnnouncedThisLoad = true;
  const clientsList = await self.clients.matchAll({ includeUncontrolled: true });
  for (const client of clientsList) client.postMessage({ type: "asset-updated", url });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 跨源 (Graph / MSAL login) → passthrough
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    const networkFetch = fetch(req).then((response) => {
      if (response && response.ok) {
        if (cached) {
          const cE = cached.headers.get("etag");
          const fE = response.headers.get("etag");
          const cL = cached.headers.get("content-length");
          const fL = response.headers.get("content-length");
          const changed = (cE && fE && cE !== fE) || (!cE && cL && fL && cL !== fL);
          if (changed) notifyUpdate(req.url).catch(() => {});
        }
        cache.put(req, response.clone()).catch(() => {});
      }
      return response;
    }).catch(() => null);

    if (cached) {
      networkFetch.catch(() => {});
      return cached;
    }
    const response = await networkFetch;
    if (response) return response;
    if (req.mode === "navigate") {
      const fallback = await cache.match("./index.html");
      if (fallback) return fallback;
    }
    return new Response("offline & not cached", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "skip-waiting") self.skipWaiting();
});
