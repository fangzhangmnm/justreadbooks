// 朗读真引擎冒烟：在 app 里把「下载音色 → 逐片校验进缓存 → 点一句念一句 → 连读跨语言翻章 → 删除」用真引擎走一遍。created 2026-10-01 by Claude Fable 5.1
// 音色 = 一份模型仓目录（voices/<id>.json + packs/…）。默认用还没发布的本机打包目录（检疫桶）；发布后把 READ_ALOUD_VOICE_DIR 指向模型仓工作目录即可。
// 目录不在 → 跳过（退出码 0，明说跳过了）。不进 npm run smoke：要读 66 MB 本地文件、真合成十来句，约一分钟。
// 用法：npm run smoke:voice（先 build）。这台机子的显卡可能在跑别的：浏览器 --disable-gpu。
import { createRequire } from "node:module";
import http from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const VOICE_DIR = process.env.READ_ALOUD_VOICE_DIR ?? join(process.env.HOME, "jupyter/third-party/piper-plus/packs-local");
const VOICE = process.env.READ_ALOUD_VOICE ?? "tsukuyomi-chan";
if (!existsSync(join(VOICE_DIR, "voices", `${VOICE}.json`))) { console.log(`  read-aloud voice smoke: SKIPPED (no ${VOICE}.json under ${VOICE_DIR})`); process.exit(0); }
const SHOTS = process.env.READ_ALOUD_SHOTS ?? "";
// READ_ALOUD_EMBEDDED=1：不往 app 里塞目录，用 app 自己内嵌的那份（= 线上用户看到的；要求 VOICE_DIR 里的字节就是内嵌清单钉的那些）。
const EMBEDDED = process.env.READ_ALOUD_EMBEDDED === "1";

const { chromium } = createRequire(new URL("../../20260524 WeebPaint/package.json", import.meta.url))("playwright");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".webmanifest": "application/manifest+json", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".gz": "application/gzip" };
let chunkFetches = 0;
const srv = http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  try {
    const file = p.startsWith("/__models/") ? join(VOICE_DIR, p.slice("/__models/".length)) : join(ROOT, p);
    if (/\/chunk-\d+$/.test(p)) chunkFetches++;
    const b = await readFile(file); res.writeHead(200, { "Content-Type": MIME[extname(p)] ?? "application/octet-stream" }); res.end(b);
  } catch { res.writeHead(404); res.end(); }
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
// 喇叭探针：每次真的往喇叭送一段声音就记下它的时长和响度
await page.addInitScript(() => {
  window.__played = [];
  // 同时在响的声源计数（任何时刻不许超过 1）：「响完了」的监听在声源出生时就挂上，排在库自己的 onended 前面
  const live = (window.__live = { now: 0, max: 0 });
  const off = (n) => { if (n.__live) { n.__live = false; live.now--; } };
  const create0 = BaseAudioContext.prototype.createBufferSource;
  BaseAudioContext.prototype.createBufferSource = function (...a) { const n = create0.apply(this, a); n.addEventListener("ended", () => off(n)); return n; };
  const S = AudioBufferSourceNode.prototype, start0 = S.start, stop0 = S.stop;
  S.start = function (...a) { if (!this.__live) { this.__live = true; live.now++; live.max = Math.max(live.max, live.now); } return start0.apply(this, a); };
  S.stop = function (...a) { off(this); return stop0.apply(this, a); };
  const orig = AudioBuffer.prototype.copyToChannel;
  AudioBuffer.prototype.copyToChannel = function (src, ch) { let s = 0; for (let i = 0; i < src.length; i++) s += src[i] * src[i]; window.__played.push({ sec: src.length / this.sampleRate, rms: Math.sqrt(s / Math.max(1, src.length)) }); return orig.call(this, src, ch); };
});
const wait = (fn, arg, ms = 60000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
const showChrome = async () => { if (!(await page.evaluate(() => document.body.dataset.chrome === "shown"))) { await page.mouse.click(195, 400); await page.waitForTimeout(250); } };
const shot = async (name) => { if (SHOTS) { await mkdir(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, name) }); } };
try {
  await page.goto(`${ORIGIN}/index.html`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__jrb, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  const BOOK = ["第1章 日本語", "森の中で、小さな女の子が赤い花を見つけました。「お前はだれだ。」と、きつねがたずねました。", "雨が降ってきました。", "", "第2章 English", "The quick brown fox jumps over the lazy dog. It was a bright cold day in April.", "", "第3章 中文", "今天天气很好，我们去公园散步吧。他说完就走了。", ""].join("\n");
  await page.setInputFiles("#uploadInput", { name: "朗读真引擎.txt", mimeType: "text/plain", buffer: Buffer.from(BOOK, "utf8") });
  await page.waitForFunction(() => !!window.__jrb.book(), null, { timeout: 8000 });
  await page.waitForTimeout(400);

  // ── 把这份音色目录当「随 app 内嵌的」装进去（产品里是 tools/gen-read-aloud-packs.mjs 在 build 前生成）；引擎用真的 ──
  const cat = await page.evaluate(async ([voice, embedded]) => {
    const hex = async (b) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");
    const def = await (await fetch(`/__models/voices/${voice}.json`)).json();
    const packs = {};
    for (const slug of [...new Set([...def.packs, ...Object.values(def.langPacks).flat()])]) {
      const bytes = new Uint8Array(await (await fetch(`/__models/packs/${slug}/manifest.json`)).arrayBuffer());
      packs[slug] = { packId: await hex(bytes), manifest: JSON.parse(new TextDecoder().decode(bytes)) };
    }
    if (!embedded) window.__jrb.readAloud.debugInstall({ voices: { [def.id]: def }, packs });
    return { ids: Object.entries(def.packIds).every(([s, id]) => packs[s]?.packId === id), n: Object.keys(packs).length, bytes: Object.values(packs).reduce((a, p) => a + p.manifest.totalBytes, 0) };
  }, [VOICE, EMBEDDED]);
  if (EMBEDDED) console.log("  （用的是 app 内嵌的音色目录）");
  check("音色目录：定义里写的 packId 和清单字节的哈希逐个相同", cat.ids && cat.n >= 1, JSON.stringify(cat));
  await page.evaluate(async () => { const n = window.__jrb.book().name; window.__jrb.closeBook(); await window.__jrb.openBook(n, { quiet: true }); });
  await page.waitForTimeout(300);
  await showChrome();

  // ── 没下载：带去设置；署名块在；填来源；下载 ──
  check("没装音色：顶栏不露朗读钮", await page.evaluate(() => document.getElementById("readAloudButton").hidden === true));
  await page.click("#settingsButton"); await page.waitForTimeout(250);
  await page.click("#secReadAloud > summary");
  check("设置 →「朗读」栏里有这个音色", await wait(() => document.querySelector("#raPacks .ra-pack-state")?.textContent === "未下载", null, 15000));
  const credit = await page.evaluate(() => { const el = document.querySelector("#raPacks .ra-credit"); return el ? { text: el.textContent, px: parseFloat(getComputedStyle(el).fontSize), visible: el.getBoundingClientRect().height > 0 } : null; });
  check("署名块和四条禁止用途的原文显示在设置里（字号 ≥ 14）", !!credit && credit.visible && credit.px >= 14 && credit.text.includes("つくよみちゃんコーパス（CV.夢前黎）") && credit.text.includes("https://tyc.rei-yumesaki.net/material/corpus/") && (credit.text.match(/■/g) ?? []).length === 5, JSON.stringify(credit)?.slice(0, 300));
  await page.evaluate(() => document.querySelector("#raPacks .ra-credit").scrollIntoView({ block: "center" }));
  await shot("voice-01-settings-credit.png");
  await page.fill("#raSourceInput", `${ORIGIN}/__models`); await page.dispatchEvent("#raSourceInput", "change");
  const t0 = Date.now();
  await page.click("#raPacks .ra-pack-actions button");   // 下载
  check("下载 → 逐片校验 → 「已下载」", await wait(() => document.querySelector("#raPacks .ra-pack-state")?.textContent === "已下载", null, 120000), await page.evaluate(() => document.querySelector("#raPacks .ra-pack")?.textContent.slice(0, 200) + " | " + document.getElementById("toast").textContent));
  console.log(`  （${(cat.bytes / 1048576).toFixed(1)} MB，${chunkFetches} 片，本机 ${((Date.now() - t0) / 1000).toFixed(1)} s）`);
  const cached = await page.evaluate(async () => (await (await caches.open("pwa-models")).keys()).map((r) => new URL(r.url).pathname));
  check("分片进了家族共享缓存 pwa-models（每个包一个「已验」章）", cached.filter((p) => p.endsWith("/verified.json")).length === cat.n && cached.every((p) => p.startsWith("/__pwa-models__/")), JSON.stringify(cached).slice(0, 300));
  await shot("voice-02-settings-downloaded.png");
  await page.click("#settingsClose"); await page.waitForTimeout(200);

  // ── 逐句：点一句，真的念出来 ──
  await showChrome();
  check("装了音色 → 顶栏露出朗读钮", await page.evaluate(() => document.getElementById("readAloudButton").hidden === false));
  await page.click("#readAloudButton");
  check("进朗读态", await wait(() => window.__jrb.readAloud.active() && !document.getElementById("raBar").hidden));
  const pt = await page.evaluate(() => { const node = document.querySelector("#reader .txt-body").firstChild; const i = node.data.indexOf("きつね"); const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); const q = r.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; });
  const t1 = Date.now();
  await page.mouse.click(pt.x, pt.y);
  check("点一句 → 喇叭里出来一段有声音的日语（1–8 秒）", await wait(() => window.__played.length === 1) && await page.evaluate(() => { const p = window.__played[0]; return p.sec > 1 && p.sec < 8 && p.rms > 0.01; }), JSON.stringify(await page.evaluate(() => window.__played)));
  console.log(`  （从点下去到开始出声 ${((Date.now() - t1) / 1000).toFixed(1)} s，含装引擎）`);
  check("正在念的那一句被标出来", await page.evaluate(() => { const s = window.__jrb.readAloud.debugState(); const body = window.__jrb.reader.bodyText(); return CSS.highlights.has("jrb-reading") && body.slice(s.marked.start, s.marked.end) === "「お前はだれだ。」と、きつねがたずねました。"; }));
  await shot("voice-03-reading-sentence.png");
  check("念完这一句就停", await wait(() => window.__jrb.readAloud.debugState().state === "idle") && await page.evaluate(() => window.__played.length === 1));

  // ── 连读：从第一句起，日语章 → 英语章 → 中文章，引擎跟着换装语言，读到书末停 ──
  const p0 = await page.evaluate(() => { const node = document.querySelector("#reader .txt-body").firstChild; const r = document.createRange(); r.setStart(node, 0); r.setEnd(node, 1); const q = r.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; });
  await page.mouse.click(p0.x, p0.y);
  check("点第一句 → 念第一句（逐句模式：念完就停）", await wait(() => window.__played.length === 2) && await wait(() => window.__jrb.readAloud.debugState().state === "idle"));
  // 新点的优先：真的几秒长的句子，隔 0.3 秒连点三次 → 任何时刻只有一段在响
  await page.evaluate(() => { window.__live.max = 0; });
  for (let k = 0; k < 3; k++) { await page.mouse.click(p0.x, p0.y); await page.waitForTimeout(300); }
  check("同一句连点三次：同时在响的声源最多一个", await wait(() => window.__jrb.readAloud.debugState().state === "idle" && window.__live.now === 0) && await page.evaluate(() => window.__live.max === 1), JSON.stringify(await page.evaluate(() => window.__live)));
  await page.evaluate(() => { window.__played.length = 2; const el = document.getElementById("raModeSelect"); el.value = "continuous"; el.dispatchEvent(new Event("change")); });   // 换成「连续」
  await page.click("#raPlay");
  check("连读到书末：停在最后一章、回到 idle", await wait(() => { const s = window.__jrb.readAloud.debugState(); return document.querySelector("#reader .txt-chapter-title")?.textContent === "第3章 中文" && s.state === "idle" && !s.continuous && window.__played.length >= 9; }, null, 180000), JSON.stringify(await page.evaluate(() => ({ s: window.__jrb.readAloud.debugState(), n: window.__played.length, title: document.querySelector("#reader .txt-chapter-title")?.textContent, toast: document.getElementById("toast").textContent }))));
  const played = await page.evaluate(() => window.__played);
  check("连续模式的三章七句都真的出了声（日 3 + 英 2 + 中 2），每段 0.8–9 秒；全程没有两段同时响", played.length === 9 && played.every((p) => p.sec > 0.8 && p.sec < 9 && p.rms > 0.005) && await page.evaluate(() => window.__live.max === 1), JSON.stringify(played.map((p) => +p.sec.toFixed(1))));
  console.log(`  （各段时长 s：${played.map((p) => p.sec.toFixed(1)).join(" ")}）`);

  // ── 删除 ──
  await page.click("#raClose"); await page.waitForTimeout(150);
  await showChrome();
  await page.click("#settingsButton"); await page.waitForTimeout(250);
  await page.evaluate(() => { const d = document.getElementById("secReadAloud"); if (!d.open) d.querySelector("summary").click(); });
  check("设置里这个音色有删除钮", await wait(() => [...document.querySelectorAll("#raPacks .ra-pack-actions button")].some((b) => b.textContent === "删除"), null, 15000));
  await page.evaluate(() => [...document.querySelectorAll("#raPacks .ra-pack-actions button")].find((b) => b.textContent === "删除").click());
  await page.waitForTimeout(300);
  await page.click("#sheetConfirm");
  check("删掉音色 → 顶栏的朗读钮收回", await wait(() => document.getElementById("readAloudButton").hidden === true, null, 15000));
  check("删除 → 「未下载」，缓存里这个音色的分片没了", await wait(() => document.querySelector("#raPacks .ra-pack-state")?.textContent === "未下载", null, 15000) && await page.evaluate(async () => (await (await caches.open("pwa-models")).keys()).length === 0), await page.evaluate(() => document.querySelector("#raPacks .ra-pack")?.textContent.slice(0, 120)));
  check("零页面错误（未登录/断网的库日志除外）", pageErrors.filter((e) => !/Not signed in|Failed to fetch|net::ERR/.test(e)).length === 0, pageErrors.join(" | ").slice(0, 400));
} catch (e) { check("冒烟脚本自身", false, String(e).slice(0, 400)); }
finally { await browser.close(); srv.close(); }
const failed = results.filter((x) => !x).length;
console.log(`\n  read-aloud voice smoke: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
