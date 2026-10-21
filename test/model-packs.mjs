// 字节层整链：@internal/model-packs（0.2.19 起；0.2.14–0.2.18 是 src/model-packs.ts，2026-10-21 Claude Fable 5.1 随周账 F-29 换成家族库）在无头 Chromium 里对着真 Cache Storage 走「下载 → 逐片校验 → 缓存 → 取分片 → 导入 → 删除」——留着当宿主的整链冒烟（库自己的测试在库仓）。created 2026-10-06 by Claude Fable 5.1
// 检查项逐字来自 @internal/read-aloud 0.1.19 的整链测试（那时下载 / 缓存在库的 worker 里；0.1.20 起库不管持久化，这些检查随代码搬到宿主）。
// 数据 = 兄弟仓模型仓里真的小包（运行时 + 英语 / 中文词典，约 5 MB）；仓不在 → 跳过（退出码 0，明说跳过了）。用法：node test/model-packs.mjs（npm run smoke 里带着）。
// 缓存名用测试专用的 jrb-model-packs-test（不碰家族共享的 pwa-models），结束时删掉。
import { createRequire } from "node:module";
import http from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MODELS = process.env.PWA_MODELS_DIR ?? join(ROOT, "..", "20260903 PWA Models");
const RT = "runtime-onnxruntime-web-1.30.0-20261001", EN = "lang-en-cmudict-20261001", ZH = "lang-zh-pinyin-20261001";
if (!existsSync(join(MODELS, "packs", RT, "manifest.json"))) { console.log(`  model-packs: SKIPPED (no models repo at ${MODELS})`); process.exit(0); }
const { chromium } = createRequire(new URL("../../20260524 WeebPaint/package.json", import.meta.url))("playwright");

await mkdir(join(ROOT, "tmp"), { recursive: true });
const BUNDLE = join(ROOT, "tmp", "model-packs-test.js");
execFileSync(join(ROOT, "tools/esbuild/esbuild"), [join(ROOT, "node_modules/@internal/model-packs/dist/index.js"), "--bundle", "--format=esm", "--target=es2022", `--outfile=${BUNDLE}`, "--log-level=warning"]);
const PAGE = `<!doctype html><meta charset="utf-8"><script type="module">
import { createPackStore } from "./bundle.js";
const hex = async (b) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");
window.t = {
  async make(slugs, cacheName) {
    const packs = {};
    for (const s of slugs) { const bytes = new Uint8Array(await (await fetch("/models/packs/" + s + "/manifest.json", { cache: "no-store" })).arrayBuffer()); packs[s] = { packId: await hex(bytes), manifest: JSON.parse(new TextDecoder().decode(bytes)) }; }
    window.t.packs = packs; window.t.store = createPackStore({ packs, cacheName }); window.t.cacheName = cacheName;
    return Object.fromEntries(Object.entries(packs).map(([k, v]) => [k, { packId: v.packId, bytes: v.manifest.totalBytes, chunks: v.manifest.chunks.map((c) => c.bytes) }]));
  },
  /** 一个包的分片取成 File（文件名故意都叫 chunk-NNN，几个包撞名），外加 manifest.json 当干扰。 */
  async files(slug, base = "/models") {
    const out = [];
    for (const c of window.t.packs[slug].manifest.chunks) out.push(new File([await (await fetch(base + "/packs/" + slug + "/" + c.name)).arrayBuffer()], c.name));
    out.push(new File([await (await fetch("/models/packs/" + slug + "/manifest.json")).arrayBuffer()], "manifest.json"));
    return out;
  },
  /** 整包一个文件（所有分片按序拼接）。 */
  async whole(slug) { const parts = []; for (const c of window.t.packs[slug].manifest.chunks) parts.push(await (await fetch("/models/packs/" + slug + "/" + c.name)).arrayBuffer()); return new File(parts, "whole.bin"); },
  async keys() { return (await (await caches.open(window.t.cacheName)).keys()).map((r) => new URL(r.url).pathname); },
  async stampVerified(slug, packId) { await (await caches.open(window.t.cacheName)).put(location.origin + "/__pwa-models__/" + slug + "/verified.json", new Response(JSON.stringify({ packId }), { headers: { "content-type": "application/json" } })); },
};
window.ready = true;
</script>`;

const MIME = { ".js": "text/javascript", ".json": "application/json" };
let chunkFetches = 0;
const srv = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  try {
    if (p === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(PAGE); return; }
    if (p === "/bundle.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(await readFile(BUNDLE)); return; }
    let file, corrupt = false;
    if (p.startsWith("/models/")) file = join(MODELS, p.slice("/models/".length));
    else if (p.startsWith("/tampered/")) { file = join(MODELS, p.slice("/tampered/".length)); corrupt = /chunk-\d+$/.test(p); }
    else throw new Error("404");
    if (/chunk-\d+$/.test(p)) chunkFetches++;
    const b = await readFile(file);
    if (corrupt) b[b.length >> 1] ^= 0xff;   // 「被黑的镜像站」：中间翻一个字节
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }); res.end(b);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${srv.address().port}`;

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : "  " + detail}`); };
const browser = await chromium.launch({ args: ["--disable-gpu"] });
try {
  const page = await browser.newPage(); page.setDefaultTimeout(0);
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(ORIGIN + "/"); await page.waitForFunction("window.ready === true", null, { timeout: 30000 });
  const CACHE = "jrb-model-packs-test";
  const packs = await page.evaluate(([a, b, c, n]) => window.t.make([a, b, c], n), [RT, EN, ZH, CACHE]);
  const bytesOf = (s) => packs[s].bytes;
  const st = (slugs) => page.evaluate((ss) => window.t.store.status(ss), slugs);

  check("起步：三个包都没有", (await st([RT, EN, ZH])).every((p) => !p.ready && p.bytesCached === 0));
  const bad = await page.evaluate((s) => window.t.store.download([s], "/tampered").then(() => "accepted", (e) => e.message), EN);
  check("被篡改的源：sha256 对不上 → 拒收", /sha256 mismatch/.test(bad), bad);
  check("拒收之后仍然没有包（坏分片没进缓存）", (await st([EN]))[0].bytesCached === 0 && (await page.evaluate(() => window.t.keys())).length === 0);
  const dl = await page.evaluate(async (ss) => { const seen = []; const r = await window.t.store.download(ss, "/models", (p) => seen.push(p)); return { r, first: seen[0], last: seen[seen.length - 1], n: seen.length }; }, [RT, EN]);
  check("下载两个包 + 逐片校验 → 就绪；进度按两个包的总字节报、报到满", dl.r.every((p) => p.ready) && dl.first.total === bytesOf(RT) + bytesOf(EN) && dl.last.done === dl.first.total, JSON.stringify(dl));
  let before = chunkFetches;
  await page.evaluate((ss) => window.t.store.download(ss, "/models"), [RT, EN]);
  check("再下载一次：已有的分片不重取", chunkFetches === before, `${chunkFetches - before} refetched`);
  const keys = await page.evaluate(() => window.t.keys());
  check("缓存键全在 /__pwa-models__/<包名>/ 下（只动自己认得的包）", keys.length > 0 && keys.every((k) => k.startsWith("/__pwa-models__/") && (k.includes(`/${RT}/`) || k.includes(`/${EN}/`))), keys.join(" "));
  const ch = await page.evaluate(async (s) => (await window.t.store.chunks(s)).map((b) => b.size), RT);
  check("取分片：Blob 数和每片字节数都等于清单", JSON.stringify(ch) === JSON.stringify(packs[RT].chunks), JSON.stringify(ch));
  const notReady = await page.evaluate((s) => window.t.store.chunks(s).then(() => "ok", (e) => e.message), ZH);
  check("没就绪的包取分片 → pack-missing", notReady === "pack-missing", notReady);
  const dz = await page.evaluate(async (ss) => { const seen = []; await window.t.store.download(ss, "/models", (p) => seen.push(p)); return seen[0]; }, [RT, EN, ZH]);
  check("补齐第三个包：进度的起点 = 已经有的两个包的字节", dz.done === bytesOf(RT) + bytesOf(EN) && dz.total === bytesOf(RT) + bytesOf(EN) + bytesOf(ZH), JSON.stringify(dz));

  // ── 删除 / 导入 ──
  await page.evaluate((ss) => window.t.store.delete(ss), [EN, ZH]);
  const afterDel = await st([RT, EN, ZH]);
  check("删掉两个包：它们的字节没了，第三个不动", afterDel[0].ready && afterDel[1].bytesCached === 0 && afterDel[2].bytesCached === 0, JSON.stringify(afterDel));
  const imp = await page.evaluate(async ([a, b]) => { const files = [...(await window.t.files(a)), ...(await window.t.files(b))]; const r = await window.t.store.importFiles([a, b], files); return { n: files.length, names: [...new Set(files.map((f) => f.name))], r }; }, [EN, ZH]);
  check("一把文件按内容认领（分片文件名撞名、混着清单文件）→ 两个包就绪", imp.r.every((p) => p.ready) && imp.names.includes("manifest.json"), JSON.stringify(imp));
  await page.evaluate((ss) => window.t.store.delete(ss), [EN]);
  const impWhole = await page.evaluate(async (s) => window.t.store.importFiles([s], [await window.t.whole(s)]), EN);
  check("整包一个文件也认（按序切片逐片校验）", impWhole[0].ready === true, JSON.stringify(impWhole));
  const impBad = await page.evaluate(async (s) => { const files = await window.t.files(s, "/tampered"); await window.t.store.delete([s]); return window.t.store.importFiles([s], files).then(() => "accepted", (e) => e.message); }, EN);
  check("导入坏文件 → 拒收，缓存里一片都没进", /sha256 mismatch/.test(impBad) && (await st([EN]))[0].bytesCached === 0, impBad);
  const impNone = await page.evaluate((s) => window.t.store.importFiles([s], [new File(["hello"], "notes.txt")]).then(() => "accepted", (e) => e.message), EN);
  check("导入的文件一个都不认识 → no-matching-file", impNone === "no-matching-file", impNone);

  // ── 同名重打包：缓存里「已验」章的 packId 变了 → 旧分片作废重下 ──
  await page.evaluate((s) => window.t.stampVerified(s, "someone-elses-pack-id"), RT);
  check("章上的 packId 对不上 = 不算就绪", (await st([RT]))[0].ready === false);
  before = chunkFetches;
  const redl = await page.evaluate((s) => window.t.store.download([s], "/models"), RT);
  check("重下：旧分片全部作废、整包重取、重新盖章", redl[0].ready && chunkFetches - before === packs[RT].chunks.length, `${chunkFetches - before} fetched`);

  await page.evaluate((n) => caches.delete(n), CACHE);
  check("零页面错误", errors.length === 0, errors.join(" | ").slice(0, 300));
} finally { await browser.close(); srv.close(); }
const failed = results.filter((x) => !x).length;
console.log(`\n  model-packs: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
