// 单一版本号 SSoT。Classic script(不是 ES module)。
//
// 三处加载:
//   - service-worker.js: importScripts("./src/version.js"),用 self.JRB_VERSION 当 CACHE_VERSION
//   - index.html: <script src="./src/version.js"></script> 早于 app.js 加载,挂到 window.JRB_VERSION
//   - app.js: 启动时把 window.JRB_VERSION 打到 HUD 和 设置面板,user 一眼看出 update 装上没
//
// 每次发应该 bump 这里(约定 vN-YYYY-MM-DD)。SW 通过 importScripts 检测到字节变化触发
// install → 旧 cache 在 activate 时清。
self.JRB_VERSION = "v21-2026-05-25";
