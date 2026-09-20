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
  // 模拟远端覆盖（真实采纳路径 simulateFreshText = refreshCurrentBook 快进后的同一函数）：用户翻过章（touched）→ 不重画、出 chip；点 chip「刷新」→ 换新章节表回同一章
  const upd = await page.evaluate(async () => {
    const t = "2026-09-19 装订 《冒烟》 · 状态头（更新）\n" + Array.from({ length: 7 }, (_, i) => `第${i + 1}章 标题${i + 1}\n正文${i + 1} 更新版\n\n`).join("");
    const before = document.querySelector("#reader .txt-body")?.textContent?.trim();
    window.__jrb.simulateFreshText(t);
    await new Promise((r) => setTimeout(r, 150));
    const notice = [...document.querySelectorAll(".notice-stack *")].map((e) => e.textContent).join(" ");
    const prog = document.querySelector("#reader .chapter-nav-progress")?.textContent;
    const afterAdopt = document.querySelector("#reader .txt-body")?.textContent?.trim();
    return { before, afterAdopt, prog, noticeShown: notice.includes("有更新"), hadButton: [...document.querySelectorAll(".notice-stack button")].some((b) => b.textContent.trim() === "刷新") };
  });
  await page.screenshot({ path: process.env.JRB_SHOT_DIR ? `${process.env.JRB_SHOT_DIR}/chip.png` : "tmp/chip.png" }).catch(() => {});
  Object.assign(upd, await page.evaluate(async () => {
    const btn = [...document.querySelectorAll(".notice-stack button")].find((b) => b.textContent.trim() === "刷新");
    btn?.click();
    await new Promise((r) => setTimeout(r, 150));
    return { noticeGone: !document.querySelector(".notice-stack button"), afterApply: document.querySelector("#reader .txt-body")?.textContent?.trim(), title: document.querySelector("#reader .txt-chapter-title")?.textContent, idx: window.__jrb.reader.currentIndex(), header: window.__jrb.book().header };
  }));
  check("覆盖后（已动过）：当前章 DOM 未重画、进度显示新总数、chip「有更新」出现", upd.before === upd.afterAdopt && upd.afterAdopt === "正文2" && upd.prog === "2 / 7" && upd.noticeShown && upd.hadButton, JSON.stringify(upd));
  check("点 chip「刷新」→ 按标题回到同一章（第2章）换新正文、chip 收起、状态头随新版", upd.title === "第2章 标题2" && upd.afterApply === "正文2 更新版" && upd.idx === 1 && upd.noticeGone && upd.header.includes("更新"), JSON.stringify({ title: upd.title, afterApply: upd.afterApply, idx: upd.idx, noticeGone: upd.noticeGone, header: upd.header }));
  // 没动过的情况：重开书（touched=false）→ 新字节静默换底、无 chip
  await page.evaluate(() => window.__jrb.closeBook());
  await page.evaluate(() => window.__jrb.openBook("冒烟测试.txt", { quiet: true }));
  await page.waitForFunction(() => !!window.__jrb.book(), null, { timeout: 8000 }); await page.waitForTimeout(300);
  const silent = await page.evaluate(async () => {
    const t = "头\n" + Array.from({ length: 9 }, (_, i) => `第${i + 1}章 标题${i + 1}\n正文${i + 1} 静默版\n\n`).join("");
    window.__jrb.simulateFreshText(t); await new Promise((r) => setTimeout(r, 150));
    return { body: document.querySelector("#reader .txt-body")?.textContent?.trim(), prog: document.querySelector("#reader .chapter-nav-progress")?.textContent, notice: !!document.querySelector(".notice-stack button"), title: document.querySelector("#reader .txt-chapter-title")?.textContent };
  });
  check("覆盖后（没动过）：静默换底到同一章、无 chip", silent.body === "正文2 静默版" && silent.prog === "2 / 9" && !silent.notice && silent.title === "第2章 标题2", JSON.stringify(silent));
  await page.evaluate(() => window.__jrb.reader.next()); await page.waitForTimeout(150);   // 后面「刷新页面回到第 2 章」的前提：先回到第 2 章的位置（静默换底后仍在第 2 章，翻到第 3 再翻回）
  await page.evaluate(() => window.__jrb.reader.prev()); await page.waitForTimeout(150);
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
