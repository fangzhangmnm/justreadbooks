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
// 喇叭探针：数「同时在响的声源」有几个（任何时刻不许超过 1）。
// 「响完了」的监听在声源一出生就挂上（排在库自己的 onended 前面）：库在 onended 里会同步接着起下一段，探针得先记下这一段已经完了。
await page.addInitScript(() => {
  const live = (window.__live = { now: 0, max: 0 });
  const off = (n) => { if (n.__live) { n.__live = false; live.now--; } };
  const create0 = BaseAudioContext.prototype.createBufferSource;
  BaseAudioContext.prototype.createBufferSource = function (...a) { const n = create0.apply(this, a); n.addEventListener("ended", () => off(n)); return n; };
  const S = AudioBufferSourceNode.prototype, start0 = S.start, stop0 = S.stop;
  S.start = function (...a) { if (!this.__live) { this.__live = true; live.now++; live.max = Math.max(live.max, live.now); } return start0.apply(this, a); };
  S.stop = function (...a) { off(this); return stop0.apply(this, a); };
});
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

  // ── 装上假音色 + 假引擎（形状同库的 SpeechEngine：说的是「音色」）──
  await page.evaluate(() => {
    const log = (window.__raLog = []);
    const ALL = ["ja", "zh", "en"];
    let ready = false, asked = false, loaded = null; const missing = new Set();
    window.__raFake = { setReady(v) { ready = v; }, setMissing(l, on) { if (on) missing.add(l); else missing.delete(l); }, loadedLangs: () => (loaded ? loaded.langs.join("+") : ""), unload() { loaded = null; } };
    const st = (voice) => { asked = true; const langs = ready ? ALL.filter((l) => !missing.has(l)) : []; return { voice, ready: ready && !missing.size, langs, bytesCached: ready ? 4096 : 0, bytesTotal: 4096, packs: [] }; };
    const engine = {
      status: async (voice) => st(voice),
      download: async (voice, base, opts) => { log.push(`download:${base}`); opts?.onProgress?.({ done: 2048, total: 4096 }); await new Promise((r) => setTimeout(r, 60)); ready = true; return st(voice); },
      importFiles: async (voice, files) => { log.push(`import:${files.length}`); ready = true; return st(voice); },
      delete: async () => { log.push("delete"); ready = false; loaded = null; },
      load: async (voice, opts) => { const langs = opts?.langs ?? ALL; log.push(`load:${langs.join("+")}`); loaded = { voice, langs }; return { voice, langs, alreadyLoaded: false, createMs: 1, sampleRate: 22050, speakers: 2 }; },
      loaded: () => loaded,
      isKnownReady: (voice, lang) => (asked ? ready && !(lang && missing.has(lang)) : undefined),
      synth: async (text, o) => { window.__raSteadiness = o.steadiness; log.push(`synth:${o.lang}:${o.speed}:${text}`); return { samples: new Float32Array(2646), sampleRate: 22050 }; },
      dispose() { log.push("dispose"); loaded = null; },
    };
    const manifest = { v: 1, slug: "fake-pack", name: "fake", task: "tts", lang: ALL, engine: "fake", engineConfig: {}, files: [], chunkBytes: 1, chunks: [], totalBytes: 4096, sha256: "", license: { name: "test", file: "", sha256: "", attribution: "" } };
    const voice = { v: 1, id: "fake-voice", name: "测试音色", engine: "fake", packs: ["fake-pack"], langPacks: { ja: [], zh: [], en: [] }, speakers: [{ id: 0, name: "A" }, { id: 1, name: "B" }], credit: "署名：测试音色", terms: "条款：测试", attribution: ["出处：测试"] };
    window.__jrb.readAloud.debugInstall({ voices: { "fake-voice": voice }, packs: { "fake-pack": { packId: "fake", manifest } } }, engine);
  });
  await page.evaluate(async () => { const n = window.__jrb.book().name; window.__jrb.closeBook(); await window.__jrb.openBook(n, { quiet: true }); });
  await page.waitForTimeout(300);
  await showChrome();
  check("随附了音色、但这台设备没装：顶栏照样不露朗读钮（朗读是可选的）", await page.evaluate(() => document.getElementById("readAloudButton").hidden === true && document.body.dataset.chrome === "shown"));

  // ── 入口在设置的「朗读」栏 ──
  await page.click("#settingsButton"); await page.waitForTimeout(250);
  await page.click("#secReadAloud > summary"); await page.waitForTimeout(300);
  const s1 = await page.evaluate(() => { const terms = document.getElementById("raTerms"); return { row: document.querySelector("#raPacks .ra-pack")?.textContent ?? "", intro: document.querySelector("#secReadAloud .setting-note").textContent, voiceRow: getComputedStyle(document.getElementById("raVoiceRow")).display !== "none", speakerRow: getComputedStyle(document.getElementById("raSpeakerRow")).display !== "none", speakers: document.getElementById("raSpeakerSelect").options.length, termsOpen: terms?.open, termsSummary: terms?.querySelector("summary")?.textContent ?? "", termsText: terms?.textContent ?? "", creditPx: parseFloat(getComputedStyle(document.querySelector("#raTerms .ra-credit") ?? document.body).fontSize), speedRow: !!document.getElementById("raSpeedSelect") }; });
  check("「朗读」栏说明：朗读是可选的，讲清逐句和连续", s1.intro.includes("朗读是可选的") && s1.intro.includes("逐句") && s1.intro.includes("连续"), s1.intro);
  check("没装音色：朗读模式是灰的、停在「关」；三档 = 关 / 连续 / 逐句", await page.evaluate(() => { const m = document.getElementById("raModeSelect"); return m.disabled && m.value === "off" && [...m.options].map((o) => o.textContent).join("/") === "关/连续/逐句"; }));
  check("音色行：名字 · 语言 · 大小 · 未下载 · 出处", s1.row.includes("测试音色") && s1.row.includes("日语 / 中文 / 英语") && s1.row.includes("未下载") && s1.row.includes("出处：测试"), JSON.stringify(s1));
  check("使用条款是一个可展开的栏，标题带音色名；没装这个音色时默认展开，原文字号不小于 14", s1.termsOpen === true && s1.termsSummary.includes("测试音色") && s1.termsText.includes("署名：测试音色") && s1.termsText.includes("条款：测试") && s1.creditPx >= 14, JSON.stringify(s1));
  check("只有一个音色：不露音色选择；这个音色有两个说话人：露说话人选择；设置里没有语速（在控制条上）", !s1.voiceRow && s1.speakerRow && s1.speakers === 2 && !s1.speedRow, JSON.stringify(s1));
  await page.click("#raPacks .ra-pack-actions button");   // 下载
  check("点下载 → 已下载、出删除钮", await wait(() => { const r = document.querySelector("#raPacks .ra-pack"); return r && r.textContent.includes("已下载") && [...r.querySelectorAll("button")].some((b) => b.textContent === "删除"); }));
  check("下载用的是默认来源", await page.evaluate(() => window.__raLog.includes("download:https://fangzhangmnm.github.io/pwa-models")));
  check("装了之后使用条款默认收起；点标题展开，重画设置也保持展开", await page.evaluate(() => document.getElementById("raTerms").open === false) && (await page.click("#raTerms > summary"), await page.evaluate(async () => { window.__jrb.readAloud.renderSettings(); await new Promise((r) => setTimeout(r, 200)); return document.getElementById("raTerms").open === true; })));
  check("装了音色：朗读模式亮起来，默认「逐句」", await page.evaluate(() => { const m = document.getElementById("raModeSelect"); return !m.disabled && m.value === "sentence"; }));
  await page.selectOption("#raModeSelect", "off");
  check("朗读模式调到「关」：音色留着，顶栏喇叭钮收起", await page.evaluate(() => document.getElementById("readAloudButton").hidden === true && document.querySelector("#raPacks .ra-pack").textContent.includes("已下载")));
  check("到这里引擎一次都没装过（开书、开设置、下载都不备引擎）", await page.evaluate(() => !window.__raLog.some((x) => x.startsWith("load"))));
  check("念法（实验）滑块默认在「原样」一端（0）", await page.evaluate(() => document.getElementById("raStyleRange").value === "0"));
  await page.selectOption("#raModeSelect", "sentence");
  check("把朗读模式调开 = 有意图：后台开始备引擎", await wait(() => window.__raLog.includes("load:ja")));
  await page.click("#settingsClose"); await page.waitForTimeout(200);
  await showChrome();
  check("朗读模式不是「关」 + 装了音色 → 顶栏露出朗读钮", await page.evaluate(() => document.getElementById("readAloudButton").hidden === false));
  const setMode = (m) => page.evaluate((v) => { const el = document.getElementById("raModeSelect"); el.value = v; el.dispatchEvent(new Event("change")); }, m);
  const toEnd = () => wait(() => { const s = window.__jrb.readAloud.debugState(); return document.querySelector("#reader .txt-chapter-title")?.textContent === "第4章 结尾" && s.state === "idle" && !s.continuous && s.active; }, null, 30000);

  // ── 进朗读态 ──
  await showChrome();
  await page.click("#readAloudButton"); await page.waitForTimeout(300);
  check("点朗读 → 进朗读态、控制条出现、引擎开始装语音", await page.evaluate(() => window.__jrb.readAloud.active() && document.body.dataset.readAloud === "1" && !document.getElementById("raBar").hidden && window.__raLog.includes("load:ja")));

  check("朗读态下提示条在控制条上方，不盖住按钮", await page.evaluate(() => { const toast = document.getElementById("toast"), bar = document.getElementById("raBar"); const was = toast.hidden, txt = toast.textContent; toast.hidden = false; if (!txt) toast.textContent = "x"; const tr = toast.getBoundingClientRect(), br = bar.getBoundingClientRect(); toast.hidden = was; toast.textContent = txt; return tr.height > 0 && tr.bottom <= br.top; }));
  // 语速在控制条上：点一下换一档（1 → 1.1 → 1.25 → 0.8）
  check("控制条上的语速钮：显示 1×，一档一档点过 1.1 / 1.25 / 1.5，再点回到 0.8×", await page.evaluate(() => document.getElementById("raSpeed").textContent === "1×") && await page.evaluate(() => { const b = document.getElementById("raSpeed"), seen = []; for (let k = 0; k < 4; k++) { b.click(); seen.push(b.textContent); } return seen.join(" ") === "1.1× 1.25× 1.5× 0.8×"; }));

  // ── 逐句模式（学语言用）：点一句念一句 ──
  const pt = await page.evaluate(() => { const node = document.querySelector("#reader .txt-body").firstChild; const i = node.data.indexOf("きつね"); const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); const q = r.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; });
  const chromeBefore = await page.evaluate(() => document.body.dataset.chrome ?? "");
  await page.mouse.click(pt.x, pt.y);
  check("点一句 → 合成的正是那一句（整句，引号里的句号不拆）、语言 = 日语、语速 = 控制条上的 0.8", await wait(() => window.__raLog.some((x) => x === "synth:ja:0.8:「お前はだれだ。」と、きつねがたずねました。")), (await page.evaluate(() => window.__raLog.join(" | "))));
  check("正在读的句子被标出来（CSS Highlight）", await wait(() => CSS.highlights.has("jrb-reading")) && await ra(`body.slice(s.marked.start, s.marked.end) === "「お前はだれだ。」と、きつねがたずねました。"`));
  check("逐句：读完一句就停（不往下读）", await wait(() => window.__jrb.readAloud.debugState().state === "idle") && await page.evaluate(() => window.__raLog.filter((x) => x.startsWith("synth:")).length === 1));
  check("朗读态下点正文不切顶栏", (await page.evaluate(() => document.body.dataset.chrome ?? "")) === chromeBefore);
  await page.click("#raMenu"); await page.waitForTimeout(250);
  const chromeAfterMenu = await page.evaluate(() => document.body.dataset.chrome ?? "");
  check("朗读态下从控制条上的「⋯」叫出 / 收起顶栏", chromeAfterMenu !== chromeBefore && (await page.click("#raMenu"), await page.waitForTimeout(250), (await page.evaluate(() => document.body.dataset.chrome ?? "")) === chromeBefore), `${chromeBefore} → ${chromeAfterMenu}`);
  check("控制条在手机宽度里放得下（不超出屏幕）", await page.evaluate(() => { const r = document.getElementById("raBar").getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; }));
  await page.click("#raNext");
  check("逐句：下一句 → 只念下一句", await wait(() => window.__raLog.some((x) => x.endsWith(":雨が降ってきました。"))) && await wait(() => { const s = window.__jrb.readAloud.debugState(); return s.state === "idle" && !s.continuous; }));
  await page.click("#raPrev"); await wait(() => window.__jrb.readAloud.debugState().state === "idle"); await page.click("#raPrev");
  check("逐句：上一句两次 → 回到第一句", await wait(() => { const s = window.__jrb.readAloud.debugState(); return s.marked && s.marked.start === 0; }) && await wait(() => window.__jrb.readAloud.debugState().state === "idle"));
  const nSynth = await page.evaluate(() => window.__raLog.filter((x) => x.startsWith("synth:")).length);
  await page.evaluate(() => { window.__live.max = 0; });
  await page.click("#raPlay");
  check("逐句：播放键 = 重念标着的这一句（不重新合成、念完就停、不往下走）", await wait(() => window.__live.max === 1) && await wait(() => { const s = window.__jrb.readAloud.debugState(); return s.state === "idle" && !s.continuous && s.marked.start === 0; }) && await page.evaluate((n) => window.__raLog.filter((x) => x.startsWith("synth:")).length === n, nSynth));
  // 新点的优先：同一句（已合成好）连点四次、间隔比一句短 → 任何时刻只有一段在响（2026-10-01 真机听到的「unison」）
  const p0 = await page.evaluate(() => { const node = document.querySelector("#reader .txt-body").firstChild; const r = document.createRange(); r.setStart(node, 0); r.setEnd(node, 1); const q = r.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; });
  await page.evaluate(() => { window.__live.max = 0; });
  for (let k = 0; k < 4; k++) { await page.mouse.click(p0.x, p0.y); await page.waitForTimeout(40); }
  check("同一句连点四次：同时在响的声源最多一个，念完归零", await wait(() => window.__jrb.readAloud.debugState().state === "idle" && window.__live.now === 0) && await page.evaluate(() => window.__live.max === 1), JSON.stringify(await page.evaluate(() => window.__live)));

  // ── 连续模式：点一句 / 按播放 = 一路往下念，章末自动翻章，读到书末停 ──
  await setMode("continuous");
  check("换成「连续」：还在朗读态，喇叭钮还在", await page.evaluate(() => window.__jrb.readAloud.active() && document.getElementById("readAloudButton").hidden === false));
  await page.click("#raPlay");
  check("连续：播放钮变暂停", await wait(() => document.getElementById("raPlayIcon").getAttribute("href") === "#pause"));
  check("连读：章末自动翻章接着读，只有标题的空章直接跳过", await wait(() => document.querySelector("#reader .txt-chapter-title")?.textContent === "第3章 中间" && window.__raLog.some((x) => x.endsWith(":这是第三章的第一句。")), null, 20000), JSON.stringify(await page.evaluate(() => ({ log: window.__raLog, st: window.__jrb.readAloud.debugState(), title: document.querySelector("#reader .txt-chapter-title")?.textContent, body: window.__jrb.reader.bodyText().slice(0, 80), ctx: "n/a" }))));
  check("翻章后语言跟着这一章变（中文），引擎换装成只装中文", await page.evaluate(() => window.__raLog.some((x) => x.startsWith("synth:zh:") && x.endsWith(":这是第三章的第一句。")) && window.__raLog.indexOf("load:zh") > window.__raLog.indexOf("load:ja")));
  await page.click("#raPlay");
  check("暂停 → 状态 paused；再点 → 继续", await ra(`s.state === "paused"`) && (await page.click("#raPlay"), await ra(`s.state === "playing" || s.state === "loading"`)));
  check("读到书末：停下、还在朗读态、播放钮回到播放", await toEnd() && await page.evaluate(() => document.getElementById("raPlayIcon").getAttribute("href") === "#play"));
  const order = await page.evaluate(() => window.__raLog.filter((x) => x.startsWith("synth:")).map((x) => x.split(":").slice(3).join(":")));
  const ALL = ["森の中で、小さな女の子が赤い花を見つけました。", "「お前はだれだ。」と、きつねがたずねました。", "雨が降ってきました。", "这是第三章的第一句。", "这是第三章的第二句！", "最后一句。"];
  check("整本六句每句都合成过、且只合成一次（逐句时念过的句子连续时不重算）", order.length === 6 && ALL.every((x) => order.filter((y) => y === x).length === 1), JSON.stringify(order));
  check("后面几章按书里的顺序读", JSON.stringify(order.slice(3)) === JSON.stringify(ALL.slice(3)), JSON.stringify(order));

  // ── 连续模式里的跳转：点哪句就从哪句接着往下念（正在念 / 停着都一样）──
  await page.evaluate(() => { window.__jrb.reader.goTo(0); });
  await page.waitForTimeout(150);
  await page.click("#raPlay");
  await wait(() => { const st = window.__jrb.readAloud.debugState().state; return st === "playing" || st === "loading"; });
  const ptRain = await page.evaluate(() => { const node = document.querySelector("#reader .txt-body").firstChild; const i = node.data.indexOf("雨が"); const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); const q = r.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; });
  await page.evaluate(() => { window.__live.max = 0; });
  await page.mouse.click(ptRain.x, ptRain.y);
  check("连续：正在念的时候点另一句 → 跳到那一句，仍是连续", await wait(() => { const s = window.__jrb.readAloud.debugState(); const body = window.__jrb.reader.bodyText(); return s.continuous && s.marked && body.slice(s.marked.start, s.marked.end) === "雨が降ってきました。"; }), await ra(`JSON.stringify(s)`));
  check("…并且接着往下念：自动翻到后面的章，一路到书末；全程没有两段同时响", await toEnd() && await page.evaluate(() => window.__live.max === 1), JSON.stringify(await page.evaluate(() => window.__live)));
  await page.evaluate(() => { window.__jrb.reader.goTo(0); });
  await page.waitForTimeout(150);
  await page.mouse.click(ptRain.x, ptRain.y);
  check("连续：停着的时候点一句 → 从那一句开始一路往下念", await wait(() => { const s = window.__jrb.readAloud.debugState(); return s.continuous && s.marked; }) && await toEnd());
  // 念着的时候换语速：从标着的这一句按新速度重念，仍是连续
  await page.evaluate(() => { window.__jrb.reader.goTo(0); });
  await page.waitForTimeout(150);
  await page.click("#raPlay");
  await wait(() => window.__jrb.readAloud.debugState().state === "playing");
  await page.click("#raSpeed");
  check("念着的时候点语速钮（0.8 → 0.9）：这一句按新速度重新合成，接着连续念", await wait(() => window.__raLog.some((x) => x.startsWith("synth:ja:0.9:森の中で"))) && await page.evaluate(() => document.getElementById("raSpeed").textContent === "0.9×" && window.__jrb.readAloud.debugState().continuous) && await toEnd());

  // ── 念法（实验）：切到「平稳」，引擎收到 steady ──
  await page.evaluate(() => { const el = document.getElementById("raStyleRange"); el.value = "60"; el.dispatchEvent(new Event("change")); });
  const nSteady = await page.evaluate(() => window.__raLog.length);
  await setMode("sentence"); await page.evaluate(() => { window.__jrb.reader.goTo(0); }); await page.waitForTimeout(150); await page.mouse.click(pt.x, pt.y);
  check("念法滑块拖到 60 %：点一句，引擎收到 steadiness 0.6；设置重画后滑块还在 60", await wait(() => window.__raSteadiness === 0.6) && await page.evaluate(() => { window.__jrb.readAloud.renderSettings(); return document.getElementById("raStyleRange").value === "60"; }));
  await wait(() => window.__jrb.readAloud.debugState().state === "idle");
  await page.evaluate(() => { const el = document.getElementById("raStyleRange"); el.value = "0"; el.dispatchEvent(new Event("change")); });

  // ── 自己翻章 = 停；退出 = 清干净 ──
  await page.evaluate(() => { window.__jrb.reader.goTo(0); });
  await page.waitForTimeout(150);
  await page.click("#raPlay");
  await wait(() => window.__jrb.readAloud.debugState().state === "playing");
  await page.evaluate(() => window.__jrb.reader.next()); await page.waitForTimeout(200);
  check("连读中自己翻章 → 停下、标记清掉", await ra(`s.state === "idle" && s.marked === null && !s.continuous`) && await page.evaluate(() => !CSS.highlights.has("jrb-reading")));
  await page.evaluate(() => { window.__jrb.reader.goTo(0); });
  await page.waitForTimeout(150);
  await page.click("#raPlay");
  await wait(() => window.__jrb.readAloud.debugState().state === "playing" && window.__live.now === 1);
  await page.click("#raClose"); await page.waitForTimeout(150);
  check("正在念的时候退出朗读 → 立刻没声（没有还在响的声源）", await page.evaluate(() => window.__live.now === 0));
  check("退出朗读 → 控制条收起、不在朗读态", await page.evaluate(() => document.getElementById("raBar").hidden && !window.__jrb.readAloud.active() && document.body.dataset.readAloud === undefined));
  const chrome0 = await page.evaluate(() => document.body.dataset.chrome === "shown");
  await page.mouse.click(187, 300); await page.waitForTimeout(250);
  check("退出后中间轻点照旧切顶栏", (await page.evaluate(() => document.body.dataset.chrome === "shown")) === !chrome0);

  // ── 记着有、其实没了（浏览器清了缓存 / 同源的兄弟 app 删了共用的包）：点喇叭 → 带去设置如实说，喇叭钮收回；补下回来又露 ──
  await page.evaluate(() => window.__raFake.setReady(false));
  await showChrome();
  await page.click("#readAloudButton"); await page.waitForTimeout(300);
  const gone = await page.evaluate(() => ({ settings: !document.getElementById("settingsView").hidden, open: document.getElementById("secReadAloud").open, on: window.__jrb.readAloud.active(), toast: document.getElementById("toast").textContent }));
  check("音色没了还点喇叭 → 打开设置的「朗读」栏、提示先下载、没进朗读态", gone.settings && gone.open && !gone.on && gone.toast.includes("先下载语音包"), JSON.stringify(gone));
  check("…账记对之后喇叭钮收回", await wait(() => document.getElementById("readAloudButton").hidden === true));
  await page.click("#raPacks .ra-pack-actions button");   // 重新下载
  check("补下回来 → 喇叭钮又露出来", await wait(() => document.getElementById("readAloudButton").hidden === false));
  await page.click("#settingsClose"); await page.waitForTimeout(200);

  // ── 每句自己判语言 + 第二章多了新的语言（user 2026-10-01「碰到没装的会自动…比如第二章多了新的语言」）──
  //   第一章纯中文 → 引擎只装中文；连续念到第二章（中日英混排）→ 自动换装成日 + 中 + 英，每句按语言分段送进引擎
  const MIXBOOK = ["第1章 中文", "今天天气很好。", "我们去公园吧。", "", "第2章 混排", "这个词读作「せんせい」，意思是老师。", "他用iPhone拍了照片。", "The end of the story.", "", "第3章 结尾", "再见。", ""].join("\n");
  await page.setInputFiles("#uploadInput", { name: "混排测试.txt", mimeType: "text/plain", buffer: Buffer.from(MIXBOOK, "utf8") });
  await page.waitForFunction(() => window.__jrb.book()?.name?.includes("混排测试"), null, { timeout: 8000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__jrb.reader.goTo(0); window.__raFake.unload(); window.__raLog.length = 0; });
  await setMode("continuous");
  await showChrome();
  await page.click("#readAloudButton"); await page.waitForTimeout(300);
  check("纯中文的第一章：引擎只装中文", await wait(() => window.__raFake.loadedLangs() === "zh"), await page.evaluate(() => window.__raFake.loadedLangs() + " | " + window.__raLog.join(" | ")));
  await page.click("#raPlay");
  const synthOf = (lang, text) => `window.__raLog.some((x) => x.startsWith("synth:${lang}:") && x.endsWith(":${text}"))`;
  check("连续念到第二章：自动换装成日 + 中 + 英（这一章多了日语和英语）", await wait(() => window.__raFake.loadedLangs() === "ja+zh+en", null, 20000), await page.evaluate(() => window.__raFake.loadedLangs() + " | " + window.__raLog.join(" | ")));
  check("中日混排的一句分三段、各带各的语言：中「这个词读作」→ 日「「せんせい」，」→ 中「意思是老师。」", await wait(`${synthOf("zh", "这个词读作")} && ${synthOf("ja", "「せんせい」，")} && ${synthOf("zh", "意思是老师。")}`, null, 20000), await page.evaluate(() => window.__raLog.join(" | ")));
  check("中文夹英文词的一句整句交给中文（英文词由后端再切）；纯英文一句交给英语", await wait(`${synthOf("zh", "他用iPhone拍了照片。")} && ${synthOf("en", "The end of the story.")}`, null, 20000), await page.evaluate(() => window.__raLog.join(" | ")));
  await wait(() => window.__jrb.readAloud.debugState().state === "idle" && !window.__jrb.readAloud.debugState().continuous, null, 20000);
  // 缺一种语言就不念、明说缺哪种（user「主语言替代朗读（日文会念不准）不要这样，这是静默退化」）：假装日语没下载，回到第二章点一句
  await page.evaluate(() => { window.__raFake.setMissing("ja", true); window.__raFake.unload(); window.__raLog.length = 0; window.__jrb.reader.goTo(1); });
  await page.waitForTimeout(300);
  const ptMix = await page.evaluate(() => { const node = document.querySelector("#reader .txt-body").firstChild; const i = node.data.indexOf("意思"); const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); const q = r.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; });
  await page.mouse.click(ptMix.x, ptMix.y); await page.waitForTimeout(400);
  const miss = await page.evaluate(() => ({ toast: document.getElementById("toast").textContent, settings: !document.getElementById("settingsView").hidden, synth: window.__raLog.filter((x) => x.startsWith("synth:")).length, loaded: window.__raFake.loadedLangs() }));
  check("这一章用到的日语没下载：不念、不拿中文凑合，明说缺日语并带去设置", miss.toast.includes("日语") && miss.toast.includes("不在这台设备上") && miss.settings && miss.synth === 0 && miss.loaded === "", JSON.stringify(miss));
  await page.evaluate(() => window.__raFake.setMissing("ja", false));
  await page.click("#settingsClose"); await page.waitForTimeout(200);
  await showChrome();
  await page.click("#raClose"); await page.waitForTimeout(150);

  // ── 进书架 = 退出朗读 ──
  await showChrome();
  await page.click("#readAloudButton"); await page.waitForTimeout(250);
  check("再进朗读态", await page.evaluate(() => window.__jrb.readAloud.active()));
  await page.click("#raPlay");
  await wait(() => window.__jrb.readAloud.debugState().state === "playing" && window.__live.now === 1);
  await page.click("#libraryButton"); await page.waitForTimeout(300);
  check("正在念的时候离开这本书（进书架）→ 立刻没声", await page.evaluate(() => window.__live.now === 0));
  check("进书架 → 自动退出朗读", await page.evaluate(() => !window.__jrb.readAloud.active() && document.getElementById("raBar").hidden));
  // ── 清缓存重启只清自己的：家族共享的模型缓存、兄弟 app 的壳缓存不陪葬 ──
  await page.evaluate(async () => { for (const k of ["pwa-models", "xiaoheiwu-keepme", "jrb-oldshell"]) await (await caches.open(k)).put("/__probe__", new Response("x")); });
  await page.click("#gallerySettingsBtn"); await page.waitForTimeout(200);
  await page.click("#secApp > summary"); await page.waitForTimeout(100);
  await Promise.all([page.waitForURL(/[?&]reset=/, { timeout: 15000 }), page.click("#forceUpdateButton")]);
  await page.waitForFunction(() => !!window.__jrb, null, { timeout: 15000 });
  const kept = await page.evaluate(async () => { const keys = await caches.keys(); return { models: keys.includes("pwa-models"), sibling: keys.includes("xiaoheiwu-keepme"), ownOld: keys.includes("jrb-oldshell") }; });
  check("清缓存重启：共享模型缓存和兄弟 app 的缓存留着，自己的旧壳缓存清掉", kept.models && kept.sibling && !kept.ownOld, JSON.stringify(kept));
  check("零页面错误（未登录/断网的库日志除外）", pageErrors.filter((e) => !/Not signed in|Failed to fetch|net::ERR/.test(e)).length === 0, pageErrors.join(" | ").slice(0, 400));
} catch (e) { check("冒烟脚本自身", false, String(e).slice(0, 400)); }
finally { await browser.close(); srv.close(); }
const failed = results.filter((x) => !x).length;
console.log(`\n  read-aloud smoke: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
