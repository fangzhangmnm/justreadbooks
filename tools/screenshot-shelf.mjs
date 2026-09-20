// 无头截图：上传三本长书名 txt → 阅读器 / 书架列表 / 行菜单 三张图到 tmp/（SE2 视口）。用法：bash scripts/build.sh && node tools/screenshot-shelf.mjs。created 2026-09-19 by Claude Fable 5.1
import { createRequire } from "node:module";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
const wpRequire = createRequire(new URL("../../20260524 WeebPaint/package.json", import.meta.url));
const { chromium } = wpRequire("playwright");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".map": "application/json" };
const srv = http.createServer(async (req, res) => { let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html"; try { const b = await readFile(join(ROOT, p)); res.writeHead(200, { "Content-Type": MIME[extname(p)] ?? "application/octet-stream" }); res.end(b); } catch { res.writeHead(404); res.end(); } });
await new Promise((r) => srv.listen(0, "127.0.0.1", r)); const port = srv.address().port;
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 375, height: 667 } });
const mk = (title, n) => `2026-09-17 装订 《${title}》 作者 · ${n} 篇 / 15k 词 · E1v3 12/${n} 已出 · Gv7 ${n}/${n} 已出（gemma4）\n` + Array.from({ length: n }, (_, i) => `# ${i + 1} 篇名${i + 1}\n## E1v3\n卡片正文${i + 1}\n## 原文\n原文${i + 1}\n\n`).join("");
await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__jrb, null, { timeout: 15000 }); await page.waitForTimeout(500);
const names = ["2026-09-17 装订 《小公主与三只猫的漫长冬天》 安徒生·改写 vol.3.txt", "2026-09-16 口味实测 r7 甲乙丙盲读 十二篇.txt", "2026-09-15 树v4 公版童话分类树草稿.txt"];
for (let i = names.length - 1; i >= 0; i--) { await page.setInputFiles("#uploadInput", { name: names[i], mimeType: "text/plain", buffer: Buffer.from(mk(names[i].slice(11, 20), 5), "utf8") }); await page.waitForTimeout(900); }
await page.evaluate(() => window.__jrb.reader.next()); await page.waitForTimeout(300);
await page.screenshot({ path: "tmp/list-reader.png" });
await page.click("#libraryButton"); await page.waitForTimeout(1200);
await page.screenshot({ path: "tmp/list-shelf.png" });
await page.click("#galleryMount .gallery-tile-menu-btn"); await page.waitForTimeout(300);
await page.screenshot({ path: "tmp/list-menu.png" });
const info = await page.evaluate(() => ({ layout: document.querySelector(".gallery-grid")?.className, names: [...document.querySelectorAll(".gallery-tile-name")].map((e) => e.textContent.trim()), subs: [...document.querySelectorAll(".gallery-tile-sub")].map((e) => e.textContent), markers: document.querySelectorAll(".gallery-marker.unread").length }));
console.log(JSON.stringify(info, null, 1));
await browser.close(); srv.close();
