// 本机导入音色（小雅，sherpa-onnx 引擎）真引擎冒烟：设置里没有下载钮 → 从本机文件导入 chunk-000（逐片校验）→ 点一句中文念出来 → 连读三句到书末。
// created 2026-10-06 by Claude Fable 5.1。包在检疫桶（许可证不许再分发，永不进模型仓）；不在 → 跳过（退出码 0，明说跳过了）。
// 用法：npm run smoke:import（先 build）。这台机子的显卡可能在跑别的：浏览器 --disable-gpu。
import { createRequire } from "node:module";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const VOICE = "piper-xiao-ya";
const SLUG = "voice-piper-zh-xiao-ya-medium-int8-20261006";
const PACK_DIR = process.env.READ_ALOUD_IMPORT_PACK ?? join(process.env.HOME, "jupyter/third-party/sherpa-onnx-wasm/tts-probe/packs-local", SLUG);
if (!existsSync(join(PACK_DIR, "chunk-000"))) { console.log(`  read-aloud import-voice smoke: SKIPPED (no chunk-000 under ${PACK_DIR})`); process.exit(0); }

const { chromium } = createRequire(new URL("../../20260524 WeebPaint/package.json", import.meta.url))("playwright");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".webmanifest": "application/manifest+json", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };
let engineFetches = 0;
const srv = http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  if (p.startsWith("/vendor/sherpa-onnx-wasm/")) engineFetches++;
  try { const b = await readFile(join(ROOT, p)); res.writeHead(200, { "Content-Type": MIME[extname(p)] ?? "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${srv.address().port}`;

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : "  " + detail}`); };
const browser = await chromium.launch({ args: ["--disable-gpu", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") pageErrors.push("console.error: " + m.text()); });
await page.addInitScript(() => {
  window.__played = [];
  const orig = AudioBuffer.prototype.copyToChannel;
  AudioBuffer.prototype.copyToChannel = function (src, ch) { let s = 0; for (let i = 0; i < src.length; i++) s += src[i] * src[i]; window.__played.push({ sec: src.length / this.sampleRate, rms: Math.sqrt(s / Math.max(1, src.length)) }); return orig.call(this, src, ch); };
});
const wait = (fn, arg, ms = 60000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
const showChrome = async () => { if (!(await page.evaluate(() => document.body.dataset.chrome === "shown"))) { await page.mouse.click(195, 400); await page.waitForTimeout(250); } };
try {
  await page.goto(`${ORIGIN}/index.html`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__jrb, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  const BOOK = ["第1章 中文", "今天天气很好，我们去公园散步吧。她推开窗户，看见远处的山上还留着一点雪。两个人也不是很会野外生存。"].join("\n");
  await page.setInputFiles("#uploadInput", { name: "小雅导入.txt", mimeType: "text/plain", buffer: Buffer.from(BOOK, "utf8") });
  await page.waitForFunction(() => !!window.__jrb.book(), null, { timeout: 8000 });
  await page.waitForTimeout(400);
  await showChrome();
  await page.click("#settingsButton"); await page.waitForTimeout(250);
  await page.click("#secReadAloud > summary");
  const row = `#raPacks [data-voice="${VOICE}"]`;
  check("设置 →「朗读」栏里有小雅，状态「未下载」", await wait((sel) => document.querySelector(sel + " .ra-pack-state")?.textContent === "未下载", row, 15000));
  const btns = await page.evaluate((sel) => [...document.querySelectorAll(sel + " .ra-pack-actions button")].map((b) => b.textContent), row);
  check("只准本机导入：没有「下载」钮，只有「从本机文件导入…」", !btns.includes("下载") && btns.includes("从本机文件导入…"), JSON.stringify(btns));
  check("行下的说明写明只能本机导入 + 数据集许可证", await page.evaluate((sel) => (document.querySelector(sel + " .setting-note")?.textContent ?? "").includes("只能从本机文件导入"), row));
  // 选中它当当前音色
  await page.selectOption("#raVoiceSelect", VOICE); await page.dispatchEvent("#raVoiceSelect", "change"); await page.waitForTimeout(200);
  check("音色下拉里选中了小雅", await page.evaluate(() => document.getElementById("raVoiceSelect").value) === VOICE);
  // 导入：点钮 → 文件选择器 → 给 chunk-000（+ manifest.json / LICENSE.txt 一起给，不算错）
  const t0 = Date.now();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.evaluate((sel) => [...document.querySelectorAll(sel + " .ra-pack-actions button")].find((b) => b.textContent === "从本机文件导入…").click(), row)]);
  await chooser.setFiles([join(PACK_DIR, "chunk-000"), join(PACK_DIR, "manifest.json"), join(PACK_DIR, "LICENSE.txt")]);
  check("导入 → 逐片校验 → 「已下载」", await wait((sel) => document.querySelector(sel + " .ra-pack-state")?.textContent === "已下载", row, 120000), await page.evaluate((sel) => document.querySelector(sel + " .ra-pack-state")?.textContent, row));
  console.log(`  （导入 + 校验 ${((Date.now() - t0) / 1000).toFixed(1)} s）`);
  const cached = await page.evaluate(async () => (await (await caches.open("pwa-models")).keys()).map((r) => new URL(r.url).pathname));
  check("分片进了家族共享缓存 pwa-models", cached.some((p) => p.includes(`/__pwa-models__/${"voice-piper-zh-xiao-ya-medium-int8-20261006"}/`)), JSON.stringify(cached));
  await page.click("#settingsClose"); await page.waitForTimeout(200);

  // 点一句
  await showChrome();
  check("装了音色 → 顶栏露出朗读钮", await page.evaluate(() => document.getElementById("readAloudButton").hidden === false));
  await page.click("#readAloudButton");
  check("进朗读态", await wait(() => window.__jrb.readAloud.active() && !document.getElementById("raBar").hidden));
  const pt = await page.evaluate(() => { const node = document.querySelector("#reader .txt-body").firstChild; const i = node.data.indexOf("公园"); const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); const q = r.getBoundingClientRect(); return { x: q.left + 2, y: q.top + q.height / 2 }; });
  const t1 = Date.now();
  await page.mouse.click(pt.x, pt.y);
  check("点一句 → 喇叭里出来一段有声音的中文（1–8 秒）；sherpa 引擎文件是从 app 的 vendor 目录取的", await wait(() => window.__played.length === 1, null, 120000) && await page.evaluate(() => { const p = window.__played[0]; return p.sec > 1 && p.sec < 8 && p.rms > 0.005; }) && engineFetches >= 2, JSON.stringify({ played: await page.evaluate(() => window.__played), engineFetches }));
  console.log(`  （从点下去到开始出声 ${((Date.now() - t1) / 1000).toFixed(1)} s，含装引擎 ${engineFetches} 个引擎文件）`);
  check("念完这一句就停", await wait(() => window.__jrb.readAloud.debugState().state === "idle") && await page.evaluate(() => window.__played.length === 1));
  // 连读三句到书末
  await page.evaluate(() => { window.__played.length = 0; const el = document.getElementById("raModeSelect"); el.value = "continuous"; el.dispatchEvent(new Event("change")); });
  // 从第一句（「今天…」）起连读：正文首行「第1章 中文」也在同一个文本节点里，从 0 点会把它当一句念出来
  const p0 = await page.evaluate(() => { const node = document.querySelector("#reader .txt-body").firstChild; const i = node.data.indexOf("今天"); const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); const q = r.getBoundingClientRect(); return { x: q.left + 2, y: q.top + q.height / 2 }; });
  await page.mouse.click(p0.x, p0.y);
  check("连读到书末回到 idle", await wait(() => window.__jrb.readAloud.debugState().state === "idle" && window.__played.length >= 3, null, 120000));
  const played = await page.evaluate(() => window.__played);
  check("三句都真的出了声，每段 0.8–9 秒", played.length === 3 && played.every((p) => p.sec > 0.8 && p.sec < 9 && p.rms > 0.005), JSON.stringify(played));
  console.log(`  （各段时长 s：${played.map((p) => p.sec.toFixed(1)).join(" ")}）`);
  check("全程没有页面错误", pageErrors.length === 0, pageErrors.join(" | "));
} catch (e) { check("流程没抛", false, String(e)); }
await browser.close(); srv.close();
const bad = results.filter((r) => !r).length;
console.log(`  read-aloud import-voice smoke: ${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
