// 朗读界面冒烟：静态起服 → 无头开页 → 上传一本三章小书 → 用**假引擎 + 假语音包**把朗读的界面流程走一遍。created 2026-10-01 by Claude Fable 5.1
// 假引擎：合成 = 0.12 秒静音（记下合成了哪句）。真引擎（下载 / 校验 / 缓存 / 合成）的整链测试在库仓 `../20261001 internal-read-aloud` 的 npm run e2e。
// 用法：npm run smoke（先 build）。这台机子的显卡可能在跑别的：浏览器 --disable-gpu。
import { createRequire } from "node:module";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(new URL("../../20260524 WeebPaint/package.json", import.meta.url))("playwright");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".webmanifest": "application/manifest+json", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".gz": "application/octet-stream" };
const srv = http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  try { const b = await readFile(join(ROOT, p)); res.writeHead(200, { "Content-Type": MIME[extname(p)] ?? "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : "  " + detail}`); };
const browser = await chromium.launch({ args: ["--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 375, height: 667 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") pageErrors.push("console.error: " + m.text()); });
const wait = (fn, arg, ms = 15000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
/** 顶栏藏着就中间轻点一下把它叫出来（藏着时是透明 + 不可点，Playwright 的 isVisible 认不出）。 */
const showChrome = async () => { if (!(await page.evaluate(() => document.body.dataset.chrome === "shown"))) { await page.mouse.click(187, 300); await page.waitForTimeout(250); } };
const ra = (expr) => page.evaluate(`(() => { const s = window.__jrb.readAloud.debugState(); const body = window.__jrb.reader.bodyText(); return ${expr}; })()`);
try {
  await page.goto(`http://127.0.0.1:${srv.address().port}/index.html`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__jrb, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  const BOOK = ["第1章 开头", "森の中で、小さな女の子が赤い花を見つけました。「お前はだれだ。」と、きつねがたずねました。", "雨が降ってきました。", "", "第2章 空章", "", "第3章 中间", "这是第三章的第一句。这是第三章的第二句！", "", "第4章 结尾", "最后一句。", ""].join("\n");   // 第 2 章只有标题：连读要跳过它
  await page.setInputFiles("#uploadInput", { name: "朗读测试.txt", mimeType: "text/plain", buffer: Buffer.from(BOOK, "utf8") });
  await page.waitForFunction(() => !!window.__jrb.book(), null, { timeout: 8000 });
  await page.waitForTimeout(400);
  check("开书：四章（第 2 章是空章）", await page.evaluate(() => window.__jrb.book().chapters.length === 4), JSON.stringify(await page.evaluate(() => ({ n: window.__jrb.book().chapters.length, titles: window.__jrb.book().chapters.map((c) => c.title), chosen: window.__jrb.book().chosen, len: window.__jrb.book().text.length }))));

  // ── 没有随附语音包：朗读钮不露，设置里如实说 ──
  check("没有语音包的版本：顶栏不露朗读钮", await page.evaluate(() => document.getElementById("readAloudButton").hidden === true));

  // ── 装上假语音包 + 假引擎 ──
  await page.evaluate(() => {
    const log = (window.__raLog = []);
    let ready = false, known, loaded = null;
    const st = (slug) => { known = ready; return { slug, ready, bytesCached: ready ? 4096 : 0, bytesTotal: 4096 }; };
    const engine = {
      status: async (slug) => st(slug),
      download: async (slug, base, onProgress) => { log.push(`download:${base}`); onProgress?.({ done: 2048, total: 4096 }); await new Promise((r) => setTimeout(r, 60)); ready = true; return st(slug); },
      importFiles: async (slug, files) => { log.push(`import:${files.length}`); ready = true; return st(slug); },
      delete: async () => { log.push("delete"); ready = false; known = false; loaded = null; },
      load: async (slug) => { log.push("load"); loaded = slug; return { slug, alreadyLoaded: false, createMs: 1, sampleRate: 22050, voices: 1 }; },
      loaded: () => loaded,
      isKnownReady: () => known,
      synth: async (text, o) => { log.push(`synth:${o.lang}:${o.speed}:${text}`); return { samples: new Float32Array(2646), sampleRate: 22050 }; },
      dispose() { log.push("dispose"); loaded = null; },
    };
    const manifest = { v: 1, slug: "fake-voice", name: "测试音色", task: "tts", lang: ["ja", "zh", "en"], engine: "fake", engineConfig: { langs: ["ja", "zh", "en"], voices: [{ id: 0, name: "A" }, { id: 1, name: "B" }] }, files: [], chunkBytes: 1, chunks: [], totalBytes: 4096, sha256: "", license: { name: "test", file: "", sha256: "", attribution: "署名：测试音色" }, notes: "条款：测试" };
    window.__jrb.readAloud.debugInstall({ "fake-voice": { packId: "fake", manifest } }, engine);
  });
  await page.evaluate(async () => { const n = window.__jrb.book().name; window.__jrb.closeBook(); await window.__jrb.openBook(n, { quiet: true }); });
  await page.waitForTimeout(300);
  await showChrome();
  check("有语音包：顶栏露出朗读钮", await page.evaluate(() => document.getElementById("readAloudButton").hidden === false && document.body.dataset.chrome === "shown"));

  // ── 没下载就点朗读：带去设置的「朗读」栏 ──
  await page.click("#readAloudButton"); await page.waitForTimeout(300);
  const s1 = await page.evaluate(() => ({ settings: !document.getElementById("settingsView").hidden, open: document.getElementById("secReadAloud").open, on: window.__jrb.readAloud.active(), toast: document.getElementById("toast").textContent, row: document.querySelector("#raPacks .ra-pack")?.textContent ?? "", voiceRow: getComputedStyle(document.getElementById("raVoiceRow")).display !== "none", voices: document.getElementById("raVoiceSelect").options.length }));
  check("没下载就点朗读 → 打开设置并展开「朗读」栏、提示先下载、没进朗读态", s1.settings && s1.open && !s1.on && s1.toast.includes("先下载语音包"), JSON.stringify(s1));
  check("语音包行：名字 · 大小 · 未下载 · 署名与条款；多音色才露音色选择", s1.row.includes("测试音色") && s1.row.includes("未下载") && s1.row.includes("署名：测试音色") && s1.row.includes("条款：测试") && s1.voiceRow && s1.voices === 2, JSON.stringify(s1));
  await page.click("#raPacks .ra-pack-actions button");   // 下载
  check("点下载 → 已下载、出删除钮", await wait(() => { const r = document.querySelector("#raPacks .ra-pack"); return r && r.textContent.includes("已下载") && [...r.querySelectorAll("button")].some((b) => b.textContent === "删除"); }));
  check("下载用的是默认来源", await page.evaluate(() => window.__raLog.includes("download:https://fangzhangmnm.github.io/pwa-models")));
  // 只有一个音色的包：音色那一行真的不显示（查实际显示，不查 hidden 属性——作者层 display 会盖掉它）
  check("单音色的包不露音色选择", await page.evaluate(() => { const ra = window.__jrb.readAloud; const row = document.getElementById("raVoiceRow"); const was = row.hidden; row.hidden = true; const gone = getComputedStyle(row).display === "none"; row.hidden = was; return gone; }));
  await page.selectOption("#raSpeedSelect", "0.8");
  await page.click("#settingsClose"); await page.waitForTimeout(200);

  // ── 进朗读态 ──
  await showChrome();
  await page.click("#readAloudButton"); await page.waitForTimeout(300);
  check("点朗读 → 进朗读态、控制条出现、引擎开始装语音", await page.evaluate(() => window.__jrb.readAloud.active() && document.body.dataset.readAloud === "1" && !document.getElementById("raBar").hidden && window.__raLog.includes("load")));

  // ── 逐句：点一句读一句 ──
  const pt = await page.evaluate(() => { const node = document.querySelector("#reader .txt-body").firstChild; const i = node.data.indexOf("きつね"); const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); const q = r.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; });
  const chromeBefore = await page.evaluate(() => document.body.dataset.chrome ?? "");
  await page.mouse.click(pt.x, pt.y);
  check("点一句 → 合成的正是那一句（整句，引号里的句号不拆）、语言 = 日语、语速 = 设置的 0.8", await wait(() => window.__raLog.some((x) => x === "synth:ja:0.8:「お前はだれだ。」と、きつねがたずねました。")), (await page.evaluate(() => window.__raLog.join(" | "))));
  check("正在读的句子被标出来（CSS Highlight）", await wait(() => CSS.highlights.has("jrb-reading")) && await ra(`body.slice(s.marked.start, s.marked.end) === "「お前はだれだ。」と、きつねがたずねました。"`));
  check("读完一句就停（不往下读）", await wait(() => window.__jrb.readAloud.debugState().state === "idle") && await page.evaluate(() => window.__raLog.filter((x) => x.startsWith("synth:")).length === 1));
  check("朗读态下点正文不切顶栏", (await page.evaluate(() => document.body.dataset.chrome ?? "")) === chromeBefore);

  // ── 上一句 / 下一句 ──
  await page.click("#raNext");
  check("下一句 → 读下一句", await wait(() => window.__raLog.some((x) => x.endsWith(":雨が降ってきました。"))) && await wait(() => window.__jrb.readAloud.debugState().state === "idle"));
  await page.click("#raPrev"); await page.click("#raPrev");
  check("上一句两次 → 回到第一句", await wait(() => { const s = window.__jrb.readAloud.debugState(); return s.marked && s.marked.start === 0; }) && await wait(() => window.__jrb.readAloud.debugState().state === "idle"));

  // ── 亮屏连读：从标着的句子一路读，章末自动翻章，读到书末停 ──
  await page.click("#raPlay");
  check("连读：播放钮变暂停", await wait(() => document.getElementById("raPlayIcon").getAttribute("href") === "#pause"));
  check("连读：章末自动翻章接着读，只有标题的空章直接跳过", await wait(() => document.querySelector("#reader .txt-chapter-title")?.textContent === "第3章 中间" && window.__raLog.some((x) => x.endsWith(":这是第三章的第一句。")), null, 20000), JSON.stringify(await page.evaluate(() => ({ log: window.__raLog, st: window.__jrb.readAloud.debugState(), title: document.querySelector("#reader .txt-chapter-title")?.textContent, body: window.__jrb.reader.bodyText().slice(0, 80), ctx: "n/a" }))));
  check("翻章后语言跟着这一章变（中文）", await page.evaluate(() => window.__raLog.some((x) => x.startsWith("synth:zh:") && x.endsWith(":这是第三章的第一句。"))));
  await page.click("#raPlay");
  check("暂停 → 状态 paused；再点 → 继续", await ra(`s.state === "paused"`) && (await page.click("#raPlay"), await ra(`s.state === "playing" || s.state === "loading"`)));
  check("读到书末：停下、还在朗读态、播放钮回到播放", await wait(() => { const s = window.__jrb.readAloud.debugState(); return document.querySelector("#reader .txt-chapter-title")?.textContent === "第4章 结尾" && s.state === "idle" && !s.continuous && s.active; }, null, 20000) && await page.evaluate(() => document.getElementById("raPlayIcon").getAttribute("href") === "#play"));
  const order = await page.evaluate(() => window.__raLog.filter((x) => x.startsWith("synth:")).map((x) => x.split(":").slice(3).join(":")));
  const ALL = ["森の中で、小さな女の子が赤い花を見つけました。", "「お前はだれだ。」と、きつねがたずねました。", "雨が降ってきました。", "这是第三章的第一句。", "这是第三章的第二句！", "最后一句。"];
  check("整本六句每句都合成过、且只合成一次（点过 / 跳过的句子连读时不重算）", order.length === 6 && ALL.every((x) => order.filter((y) => y === x).length === 1), JSON.stringify(order));
  check("后面几章按书里的顺序读", JSON.stringify(order.slice(3)) === JSON.stringify(ALL.slice(3)), JSON.stringify(order));

  // ── 自己翻章 = 停；退出 = 清干净 ──
  await page.evaluate(() => { window.__jrb.reader.goTo(0); });
  await page.waitForTimeout(150);
  await page.click("#raPlay");
  await wait(() => window.__jrb.readAloud.debugState().state === "playing");
  await page.evaluate(() => window.__jrb.reader.next()); await page.waitForTimeout(200);
  check("连读中自己翻章 → 停下、标记清掉", await ra(`s.state === "idle" && s.marked === null && !s.continuous`) && await page.evaluate(() => !CSS.highlights.has("jrb-reading")));
  await page.click("#raClose"); await page.waitForTimeout(150);
  check("退出朗读 → 控制条收起、不在朗读态", await page.evaluate(() => document.getElementById("raBar").hidden && !window.__jrb.readAloud.active() && document.body.dataset.readAloud === undefined));
  const chrome0 = await page.evaluate(() => document.body.dataset.chrome === "shown");
  await page.mouse.click(187, 300); await page.waitForTimeout(250);
  check("退出后中间轻点照旧切顶栏", (await page.evaluate(() => document.body.dataset.chrome === "shown")) === !chrome0);

  // ── 进书架 = 退出朗读 ──
  await showChrome();
  await page.click("#readAloudButton"); await page.waitForTimeout(250);
  check("再进朗读态", await page.evaluate(() => window.__jrb.readAloud.active()));
  await page.click("#libraryButton"); await page.waitForTimeout(300);
  check("进书架 → 自动退出朗读", await page.evaluate(() => !window.__jrb.readAloud.active() && document.getElementById("raBar").hidden));
  check("零页面错误（未登录/断网的库日志除外）", pageErrors.filter((e) => !/Not signed in|Failed to fetch|net::ERR/.test(e)).length === 0, pageErrors.join(" | ").slice(0, 400));
} catch (e) { check("冒烟脚本自身", false, String(e).slice(0, 400)); }
finally { await browser.close(); srv.close(); }
const failed = results.filter((x) => !x).length;
console.log(`\n  read-aloud smoke: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
