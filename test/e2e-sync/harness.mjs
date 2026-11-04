// 端到端同步测试台（node 侧）：真 app + 真 IndexedDB + 内存假云。created 2026-11-03 by Claude Opus 5.5（家族工单 E；照小黑屋 test/e2e-sync/harness.mjs，Claude Fable 5.1 2026-09-29 立）
//   用法：node test/e2e-sync/run.mjs（不进 npm test：要起无头浏览器，几十秒）。
//   假云 = `@internal/store/testing` 的 createMockProvider（库自带的测试替身）；浏览器里的 app 经 test/e2e-sync/bridge.ts 把云端调用转过来。
import { createRequire } from "node:module";
import http from "node:http";
import { readFile, writeFile, rm, mkdir, cp, symlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createMockProvider } from "@internal/store/testing";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const wpRequire = createRequire(new URL("../../../20260524 WeebPaint/package.json", import.meta.url));
const { chromium } = wpRequire("playwright");
const WORK = join(ROOT, "tmp", "e2e-sync");
const KV = "justreadbooks-2f8a41c7b9d3e650:";

/** 把产品源码拷一份、只换 app-store.ts 里造 provider 的那一行，打成测试 bundle。 */
export async function buildBundle() {
  await rm(WORK, { recursive: true, force: true });
  await mkdir(WORK, { recursive: true });
  await cp(join(ROOT, "src"), join(WORK, "src"), { recursive: true });
  await symlink(join(ROOT, "vendor"), join(WORK, "vendor"), "dir");   // 源码里的 ../vendor/… 相对路径照旧解析
  await cp(join(ROOT, "test", "e2e-sync", "bridge.ts"), join(WORK, "src", "e2e-bridge.ts"));
  const p = join(WORK, "src", "app-store.ts");
  let s = await readFile(p, "utf8");
  const re = /const od = createOneDriveProvider\([^\n]*\);/;
  if (!re.test(s)) throw new Error("app-store.ts: provider line not found — harness needs updating");
  s = s.replace(re, "const od = createBridgeProvider() as unknown as ReturnType<typeof createOneDriveProvider>;");
  s = `import { createBridgeProvider } from "./e2e-bridge.ts";\n` + s;
  await writeFile(p, s);
  execFileSync(join(ROOT, "tools/esbuild/esbuild"), [join(WORK, "src/app.ts"), "--bundle", "--format=esm", "--target=es2020", "--log-level=warning", `--outfile=${join(WORK, "app.mjs")}`], { cwd: ROOT, stdio: "inherit" });
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".png": "image/png", ".webmanifest": "application/manifest+json" };
export async function startServer() {
  const srv = http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html";
    try {
      if (p === "/service-worker.js") { res.writeHead(404); res.end(); return; }   // 测试不要 SW 缓存
      if (p === "/index.html") {
        const html = (await readFile(join(ROOT, "index.html"), "utf8")).replace(/src="\.\/dist\/jrb-[a-z0-9-]+\.mjs"/, 'src="./tmp/e2e-sync/app.mjs"');
        res.writeHead(200, { "content-type": MIME[".html"] }); res.end(html); return;
      }
      const b = await readFile(join(ROOT, p)); res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" }); res.end(b);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${srv.address().port}/index.html`, close: () => srv.close() };
}

// ── 线上编码（与 bridge.ts 对偶）──
const encW = (v) => { if (v === undefined) return { __u: true }; if (v == null || typeof v !== "object") return v; if (v instanceof Uint8Array) return { __b64: Buffer.from(v).toString("base64") }; if (v instanceof ArrayBuffer) return { __b64: Buffer.from(new Uint8Array(v)).toString("base64") }; if (Array.isArray(v)) return v.map(encW); const o = {}; for (const [k, x] of Object.entries(v)) o[k] = encW(x); return o; };
const decW = (v) => { if (v == null || typeof v !== "object") return v; if (Array.isArray(v)) return v.map(decW); if ("__u" in v) return undefined; if (typeof v.__b64 === "string") return new Uint8Array(Buffer.from(v.__b64, "base64")); const o = {}; for (const [k, x] of Object.entries(v)) o[k] = decW(x); return o; };

/** 一朵云 + 若干设备。cloud.provider = 内存云盘本体（测试可直接查 / 注入延迟）。 */
export async function createWorld() {
  const provider = createMockProvider();
  const gate = { delayMs: 0, holdUploads: null, loseUploadOf: null };   // loseUploadOf: 云端路径 —— 下一次对它的 upload 落地但回执丢失   // holdUploads: Promise —— 上传在到达云端前先等它（模拟慢上传，用来在上传窗口里打字）
  const browser = await chromium.launch();
  const log = [];
  async function handle(op, json) {
    try {
      const args = decW(JSON.parse(json));
      if (gate.delayMs) await new Promise((r) => setTimeout(r, gate.delayMs));
      if (op === "upload" && gate.holdUploads) await gate.holdUploads;
      if (op === "upload" && gate.loseUploadOf && args[0] === gate.loseUploadOf) {   // 回执丢失（定点）：云端真的写了，响应没回来——设备睡着把在途请求杀了的样子
        gate.loseUploadOf = null;
        await provider[op](...args); log.push(op + " " + args[0]);
        return JSON.stringify({ err: { message: "e2e: network dropped after the upload landed" } });
      }
      if ((op === "download") && gate.holdDownloads) await gate.holdDownloads;
      let r = await provider[op](...args);
      if (r instanceof Blob) r = new Uint8Array(await r.arrayBuffer());
      log.push(op + " " + (typeof args[0] === "string" ? args[0] : ""));
      return JSON.stringify({ ok: encW(r) });
    } catch (e) { return JSON.stringify({ err: { message: String(e?.message ?? e), status: e?.status, name: e?.name } }); }
  }
  async function device(tag, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: opts.width ?? 1100, height: opts.height ?? 800 }, deviceScaleFactor: 1 });
    await ctx.exposeFunction("__e2eCloud", handle);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`[${tag}] console.error: ${m.text()}`); });
    const dev = {
      tag, page, ctx, errors,
      async boot(url) { await page.goto(url, { waitUntil: "load" }); await page.waitForFunction(() => !!window.__jrb, null, { timeout: 20000 }); await page.waitForTimeout(500); },
      /** 只等 app 起来（闸门罩着也算）：闸门场景自己看罩。 */
      async bootRaw(url) { await page.goto(url, { waitUntil: "load" }); await page.waitForFunction(() => !!window.__jrb, null, { timeout: 20000 }); },
      /** 传一本书进库（走真的「选文件」）；回书的身份。 */
      async upload(fileName, text) { await page.setInputFiles("#uploadInput", { name: fileName, mimeType: "text/plain", buffer: Buffer.from(text) }); await page.waitForFunction((n) => window.__jrb.book()?.name?.endsWith(n), fileName, { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(500); return page.evaluate(() => window.__jrb.book()?.name ?? null); },
      /** 下次开页的认证 / 网络样子（写进 localStorage，bridge 读）。 */
      setGate: (cfg, signedOut = false) => page.evaluate(([c, o]) => { localStorage.setItem("e2eGate", JSON.stringify(c)); if (o) localStorage.setItem("e2eStartSignedOut", "1"); else localStorage.removeItem("e2eStartSignedOut"); }, [cfg, signedOut]),
      /** 这次打开里改：window.__e2eGate 的字段。 */
      patchGate: (cfg) => page.evaluate((c) => { Object.assign(window.__e2eGate, c); }, cfg),
      /** 模拟断网 / 回线（navigator.onLine + 事件）。 */
      net: (on) => page.evaluate((v) => { window.__e2eGate.net = v; window.dispatchEvent(new Event(v ? "online" : "offline")); }, on),
      /** 模拟藏到后台 / 回前台。 */
      hide: () => page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); }),
      show: () => page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange")); }),
      view: () => page.evaluate(() => { const g = document.getElementById("gateSheet"); return { gateUp: !g.classList.contains("hidden"), gateTitle: document.getElementById("gateTitle").textContent, bar: document.getElementById("offlineBar").classList.contains("hidden") ? null : document.querySelector("#offlineBar .offline-bar-text").textContent, off: window.__jrb.isCloudOff(), online: window.__jrb.cloudOnline(), reason: window.__jrb.watch.reason(), authCalls: window.__e2eAuthCalls ?? 0 }; }),
      wait: (ms) => page.waitForTimeout(ms),
      eval: (fn, arg) => page.evaluate(fn, arg),
      /** 等冲突面出来并点某个按钮（按文案正则）。 */
      async resolveGate(labelRe, timeout = 8000) {
        await page.waitForFunction(() => !document.getElementById("gateSheet").classList.contains("hidden") && document.querySelectorAll("#gateActions button").length > 0, null, { timeout });
        const labels = await page.evaluate(() => [...document.querySelectorAll("#gateActions button")].map((b) => b.textContent));
        const ok = await page.evaluate((src) => { const b = [...document.querySelectorAll("#gateActions button")].find((x) => new RegExp(src).test(x.textContent ?? "")); if (!b) return false; b.click(); return true; }, labelRe.source);
        if (!ok) throw new Error(`gate button ${labelRe} not found; have: ${labels.join(" | ")}`);
        return labels;
      },
      gateShown: () => page.evaluate(() => !document.getElementById("gateSheet").classList.contains("hidden")),
      listBackup: () => page.evaluate(async () => (await window.__jrb.store().files.listBackup()).map((b) => ({ name: b.identifier, side: b.side, ts: b.ts }))),
      close: () => ctx.close(),
    };
    return dev;
  }
  return {
    provider, gate, log, device,
    /** 云端某路径的字节（没有 → null）。 */
    async cloudBytes(path) { const it = await provider.getItemByPath(path); if (!it) return null; const b = await provider.download(it.ref); return new Uint8Array(b instanceof Blob ? await b.arrayBuffer() : b); },
    async cloudText(path) { const b = await this.cloudBytes(path); return b ? new TextDecoder().decode(b) : null; },
    async cloudList(folder = "") { return (await provider.list(folder)).map((i) => ({ name: i.name, path: i.path, isFolder: !!i.isFolder, size: i.size, eTag: i.eTag })); },
    close: () => browser.close(),
  };
}

export function makeChecker() {
  const results = [];
  const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok }); console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : "  ← " + detail}`); };
  return { check, results, failed: () => results.filter((r) => !r.ok).length };
}
