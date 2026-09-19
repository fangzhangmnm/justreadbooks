// headless 启动冒烟：静态起服 → chromium 无头开页 → 断言 boot 链 / DOM 接线 / 书架屏 / 设置 / sheet / 零页面错误。created 2026-09-19 by Claude Fable 5.1（抄 WXHW）
// playwright 借 WeebPaint devDep（家规：能自己验的先自己验完，不转嫁真机）。用法：npm run smoke（需先 build）。
import { createRequire } from "node:module";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const wpRequire = createRequire(new URL("../../20260524 WeebPaint/package.json", import.meta.url));
const { chromium } = wpRequire("playwright");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".webmanifest": "application/manifest+json", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".map": "application/json" };

const srv = http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  try { const b = await readFile(join(ROOT, p)); res.writeHead(200, { "Content-Type": MIME[extname(p)] ?? "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const port = srv.address().port;

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : "  " + detail}`); };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 667 } });   // iPhone SE2 基准
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") pageErrors.push("console.error: " + m.text()); });
try {
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__jrb, null, { timeout: 15000 });
  check("boot：window.__jrb 出现", true, `${Date.now() - t0}ms`);
  const version = await page.evaluate(() => window.__jrb.version);
  check("版本水印", /^v\d+\.\d+\.\d+-\d{4}-\d{2}-\d{2}$/.test(version), version);
  await page.waitForTimeout(800);
  check("首帧无书 → 书架屏打开（无阻塞蒙层）", await page.evaluate(() => !document.getElementById("galleryFull").classList.contains("hidden") && document.getElementById("busyOverlay").classList.contains("hidden")));
  const emptyText = await page.evaluate(() => document.querySelector("#galleryMount .gallery-empty")?.textContent?.trim() ?? "");
  check("书架空态文案（书架口吻，非包默认「作品」）", !!emptyText && !emptyText.includes("作品"), emptyText);
  const missingUse = await page.evaluate(() => { const ids = new Set([...document.querySelectorAll("symbol")].map((s) => s.id)); return [...document.querySelectorAll("use")].map((u) => (u.getAttribute("href") || "").slice(1)).filter((id) => !ids.has(id)); });
  check("所有 <use> 都有 symbol", missingUse.length === 0, missingUse.join(","));
  check("云 chip 在书架顶栏（未登录态）", await page.evaluate(() => document.getElementById("galleryCloudBtn")?.dataset.cloudState === "out"));
  await page.click("#galleryCloudBtn"); await page.waitForTimeout(200);
  check("云 chip → 弹出菜单（连接 OneDrive）", await page.evaluate(() => !!document.querySelector(".popup-menu, .menu-panel")));
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  await page.click("#gallerySettingsBtn"); await page.waitForTimeout(200);
  check("书架设置钮 → 设置面板", await page.evaluate(() => !document.getElementById("settingsView").hidden));
  check("版本显示在设置页", (await page.textContent("#settingsBuild")).includes(version));
  const before = await page.textContent("#fontSizeValue");
  await page.click("#fontSizeUp"); await page.waitForTimeout(100);
  const after = await page.textContent("#fontSizeValue");
  check("字号 + 生效（device-kv）", Number(after) === Number(before) + 1, `${before}→${after}`);
  await page.click("#settingsClose"); await page.waitForTimeout(150);
  check("设置关闭", await page.evaluate(() => document.getElementById("settingsView").hidden));
  const picked = await page.evaluate(async () => { const p = window.__jrb.choice("t", "m", [{ label: "A", value: 1 }, { label: "B", value: 2 }]); await new Promise((r) => setTimeout(r, 50)); document.querySelector("#sheetChoices button").click(); return await p; });
  check("choice sheet 可用", picked === 1, String(picked));
  const confirmShape = await page.evaluate(async () => { const p = window.__jrb.confirm("t", "m"); await new Promise((r) => setTimeout(r, 50)); const disp = (id) => getComputedStyle(document.getElementById(id)).display; const shape = { input: disp("sheetInput"), message: disp("sheetMessage"), choices: disp("sheetChoices") }; document.getElementById("sheetCancel").click(); return { ...shape, result: await p }; });
  check("confirm sheet 形状：输入框隐藏、文案可见、取消→false", confirmShape.input === "none" && confirmShape.message !== "none" && confirmShape.choices === "none" && confirmShape.result === false, JSON.stringify(confirmShape));
  // 网格：SE2 宽度下卡片至少两列（gallery 0.1.3 保证）——空态无卡片，只验容器存在
  check("书架挂载点存在且可滚", await page.evaluate(() => { const m = document.getElementById("galleryMount"); return !!m && getComputedStyle(m).overflowY !== "visible"; }));
  await page.click("#galleryBack"); await page.waitForTimeout(150);
  check("无书时「回到阅读」→ 空态页可见", await page.evaluate(() => document.getElementById("galleryFull").classList.contains("hidden") && !document.getElementById("landing").classList.contains("hidden")));
  // ── 阅读闭环（无云：上传 = local-only）：上传 5 章 txt → 阅读器 → 翻章 → 模拟远端覆盖（adopt）→ 刷新页面回到原位 ──
  const mk = (n, extraLine = "") => "2026-09-19 装订 《冒烟》 · 状态头\n" + Array.from({ length: n }, (_, i) => `第${i + 1}章 标题${i + 1}\n正文${i + 1}${extraLine}\n\n`).join("");
  await page.click("#libraryButton"); await page.waitForTimeout(200);
  await page.setInputFiles("#uploadInput", { name: "冒烟测试.txt", mimeType: "text/plain", buffer: Buffer.from(mk(5), "utf8") });
  await page.waitForFunction(() => !!window.__jrb.book(), null, { timeout: 8000 });
  await page.waitForTimeout(600);
  const b1 = await page.evaluate(() => ({ name: window.__jrb.book().name, n: window.__jrb.book().chapters.length, header: window.__jrb.book().header, galleryHidden: document.getElementById("galleryFull").classList.contains("hidden"), title: document.querySelector("#reader .txt-chapter-title")?.textContent, body: document.querySelector("#reader .txt-body")?.textContent?.trim() }));
  check("上传 txt → 阅读器打开（书架关、第 1 章）", b1.name === "冒烟测试.txt" && b1.n === 5 && b1.galleryHidden && b1.title === "第1章 标题1" && b1.body === "正文1", JSON.stringify(b1));
  check("状态头 = 第一行", b1.header === "2026-09-19 装订 《冒烟》 · 状态头", String(b1.header));
  await page.evaluate(() => window.__jrb.reader.next()); await page.waitForTimeout(150);
  check("翻到第 2 章", await page.evaluate(() => document.querySelector("#reader .txt-chapter-title")?.textContent === "第2章 标题2"));
  // 模拟远端覆盖：+2 章，且当前章正文变了 → adopt 不重画、进度显示新总数；applyPending 才换
  const upd = await page.evaluate(async () => {
    const t = "2026-09-19 装订 《冒烟》 · 状态头（更新）\n" + Array.from({ length: 7 }, (_, i) => `第${i + 1}章 标题${i + 1}\n正文${i + 1} 更新版\n\n`).join("");
    const mkCh = (text) => { const re = /^第\d+章 .+$/gm; const hits = []; let m; while ((m = re.exec(text))) hits.push({ start: m.index, title: m[0] }); return hits.map((h, i) => ({ title: h.title, start: h.start, bodyStart: text.indexOf("\n", h.start) + 1, end: i + 1 < hits.length ? hits[i + 1].start : text.length })); };
    const chapters = mkCh(t);
    const before = document.querySelector("#reader .txt-body")?.textContent?.trim();
    const u = window.__jrb.reader.adopt(t, chapters);
    const prog = document.querySelector("#reader .chapter-nav-progress")?.textContent;
    const afterAdopt = document.querySelector("#reader .txt-body")?.textContent?.trim();
    window.__jrb.reader.applyPending();
    await new Promise((r) => setTimeout(r, 100));
    return { u, before, afterAdopt, prog, afterApply: document.querySelector("#reader .txt-body")?.textContent?.trim(), title: document.querySelector("#reader .txt-chapter-title")?.textContent, idx: window.__jrb.reader.currentIndex() };
  });
  check("覆盖 adopt：当前章 DOM 未重画、进度显示新总数、diff 报 +2 章且本章有更新", upd.before === upd.afterAdopt && upd.afterAdopt === "正文2" && upd.prog === "2 / 7" && upd.u.addedChapters === 2 && upd.u.currentChanged === true, JSON.stringify(upd));
  check("applyPending：按标题回到同一章（第2章）并换成新正文", upd.title === "第2章 标题2" && upd.afterApply === "正文2 更新版" && upd.idx === 1, JSON.stringify({ title: upd.title, afterApply: upd.afterApply, idx: upd.idx }));
  await page.screenshot({ path: process.env.JRB_SHOT_DIR ? `${process.env.JRB_SHOT_DIR}/reader.png` : "tmp/reader.png" }).catch(() => {});
  // 刷新页面：last-open + 位置（collection 本地）→ 回到第 2 章
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(700);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => !!window.__jrb && !!window.__jrb.book(), null, { timeout: 10000 });
  await page.waitForTimeout(500);
  const re = await page.evaluate(() => ({ name: window.__jrb.book().name, title: document.querySelector("#reader .txt-chapter-title")?.textContent, galleryHidden: document.getElementById("galleryFull").classList.contains("hidden") }));
  check("刷新页面 → 秒开上次那本、回到第 2 章（首帧本机，无蒙层）", re.name === "冒烟测试.txt" && re.title === "第2章 标题2" && re.galleryHidden, JSON.stringify(re));
  await page.click("#libraryButton"); await page.waitForTimeout(800);
  const tiles = await page.evaluate(() => ({ n: document.querySelectorAll("#galleryMount .gallery-tile:not(.folder)").length, recent: document.getElementById("galleryRecent").hidden, names: [...document.querySelectorAll("#galleryMount .gallery-tile-name")].map((e) => e.textContent) }));
  check("书架有这本书（显示名去 .txt）", tiles.n === 1 && tiles.names[0] === "冒烟测试", JSON.stringify(tiles));
  await page.screenshot({ path: process.env.JRB_SHOT_DIR ? `${process.env.JRB_SHOT_DIR}/shelf.png` : "tmp/shelf.png" }).catch(() => {});
  const benign = /Not signed in|CloudNetworkError|Failed to fetch|net::ERR|msal/i;
  const realErrors = pageErrors.filter((e) => !benign.test(e));
  check("零页面错误（未登录/断网的库日志除外）", realErrors.length === 0, realErrors.join(" | ").slice(0, 400));
} catch (e) {
  check("smoke 跑完", false, String(e));
} finally {
  await browser.close(); srv.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n  boot smoke: ${results.length - failed}/${results.length} passed\n`);
process.exit(failed ? 1 : 0);
