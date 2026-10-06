// src/model-packs.ts —— 模型包的字节层：下载（逐片 sha256）/ 用户导入（按内容哈希认领）/ 缓存（Cache Storage `pwa-models`）/ 删除 / 取分片。
// created 2026-10-06 by Claude Fable 5.1。逐字移植自 @internal/read-aloud 0.1.19 `src/worker/runtime.ts` 的「缓存面」（2026-10-01 同一作者，
// 那一半又来自 WebXiaoHeiWu `src/asr/worker.ts`）——从 worker 搬到主线程，算法没动。
//
// 为什么在宿主而不在库：user 2026-10-02「库不应该管持久化，让app管，库不知道任何持久化的东西，string in, audio out. app喂」。
// 库（@internal/read-aloud 0.1.20 起）只收字节：`engine.load(voice, { chunks })`；这里的 `chunks(slug)` 就是喂它的勺子。
// 零 DOM、零 i18n、零 app 知识（只认内嵌清单）：候选抽成家族共享的 @internal/model-packs（WXHW `src/asr/worker.ts` 是同源的第二份，合一时一起搬）。
//
// 红线（test/redline-guard 守）：
//   · 本文件是 src/ 里**唯一**联网的地方：只读 GET 模型源的分片（CLAUDE.md「黄线区」白名单 ②），到手先对内嵌清单的 chunks[].sha256，对不上整包拒收。
//   · 本文件是 src/ 里**唯一**碰 Cache Storage `pwa-models` 的地方（家族共享名；key = 本 origin 下的合成路径 /__pwa-models__/<slug>/<chunk>，永不真的去 fetch 它）；
//     只写 / 删自己内嵌清单认得的包（家族 CLAUDE.md「共享模型库 · 命名与共享规矩」第 2 条）。
//   · 信任根 = 内嵌清单的 packId；哈希是流式的 Sha256（user 2026-09-03 定：不用 crypto.subtle.digest，切片大小不绑内存）。主线程上逐段 await 着算，不出长任务。
import type { EmbeddedPack, PackManifest } from "@internal/read-aloud";
import { Sha256 } from "./sha256.ts";

export interface PackStatus { slug: string; ready: boolean; bytesCached: number; bytesTotal: number }
export interface PackProgress { done: number; total: number }
export interface PackStore {
  /** 几个包各自的状态（就绪 = 每片都在、尺寸对、盖过「已验」章且 packId 没变）。 */
  status(slugs: readonly string[]): Promise<PackStatus[]>;
  /**
   * 从 base（模型源，如 https://…/pwa-models）下载并逐片校验。可续传；已经有的分片不重取。
   * 进度按「这次要的所有包」的总字节报，已经在缓存里的算在起点里。
   */
  download(slugs: readonly string[], base: string, onProgress?: (p: PackProgress) => void): Promise<PackStatus[]>;
  /**
   * 用户自己拿到的文件：按**内容哈希**认它们是哪个包的哪一片（文件名不作数——几个包的分片都叫 chunk-000）。
   * 认得的逐片入缓存；尺寸和哪一片都对不上的文件略过（把 manifest.json、LICENSE.txt 一起选进来不算错）；尺寸对、哈希不对 = 坏文件，报错；
   * 也收「整包一个文件」（= 所有分片按序拼接）。一个都不认识 → "no-matching-file"。
   */
  importFiles(slugs: readonly string[], files: readonly File[], onProgress?: (p: PackProgress) => void): Promise<PackStatus[]>;
  /** 删掉这几个包的分片和「已验」章。 */
  delete(slugs: readonly string[]): Promise<void>;
  /** 就绪的包的分片（Blob，按清单顺序；引用缓存里的字节，不拷贝）——喂给引擎的 load。没就绪 → 错误 "pack-missing"。 */
  chunks(slug: string): Promise<Blob[]>;
}

const SLICE = 1 << 20;   // 导入 / 复验时每次读 1 MiB 再 await：主线程上不出长任务

export function createPackStore(deps: { packs: Readonly<Record<string, EmbeddedPack>>; cacheName?: string }): PackStore {
  const cacheName = deps.cacheName ?? "pwa-models";
  const keyOf = (slug: string, name: string) => `${location.origin}/__pwa-models__/${slug}/${name}`;
  function manifestOf(slug: string): { packId: string; manifest: PackManifest } {
    const p = deps.packs[slug];
    if (!p) throw new Error(`unknown pack: ${slug}`);
    return p;
  }
  const openCache = () => caches.open(cacheName);
  /** 一个 Blob 的 sha256，逐段读、逐段喂（不整块进内存）。 */
  async function hashBlob(b: Blob): Promise<string> {
    const sha = new Sha256();
    for (let o = 0; o < b.size; o += SLICE) sha.update(new Uint8Array(await b.slice(o, Math.min(o + SLICE, b.size)).arrayBuffer()));
    return sha.hex();
  }

  // ── 缓存面 ──
  async function cachedChunkSizes(slug: string, m: PackManifest): Promise<number[]> {
    const cache = await openCache();
    const sizes: number[] = [];
    for (const c of m.chunks) {
      const r = await cache.match(keyOf(slug, c.name));
      sizes.push(r ? Number(r.headers.get("content-length") ?? 0) : 0);
    }
    return sizes;
  }
  async function putChunk(slug: string, name: string, bytes: Uint8Array | Blob): Promise<void> {
    const cache = await openCache();
    const size = bytes instanceof Blob ? bytes.size : bytes.length;
    await cache.put(keyOf(slug, name), new Response(bytes as unknown as BodyInit, { headers: { "content-length": String(size), "content-type": "application/octet-stream" } }));
  }
  async function markVerified(slug: string, packId: string): Promise<void> {
    const cache = await openCache();
    await cache.put(keyOf(slug, "verified.json"), new Response(JSON.stringify({ packId, at: new Date().toISOString() }), { headers: { "content-type": "application/json" } }));
  }
  async function status(slug: string): Promise<PackStatus> {
    const { packId, manifest: m } = manifestOf(slug);
    const cache = await openCache();
    const sizes = await cachedChunkSizes(slug, m);
    const complete = sizes.every((n, i) => n === m.chunks[i]!.bytes);
    const marker = await cache.match(keyOf(slug, "verified.json"));
    const verified = marker ? ((await marker.json()) as { packId?: string }).packId === packId : false;
    return { slug, ready: complete && verified, bytesCached: sizes.reduce((a, b) => a + b, 0), bytesTotal: m.totalBytes };
  }
  /** 同 slug 重打包过（缓存里的「已验」章是别的 packId）→ 旧分片全部作废。 */
  async function dropIfStale(slug: string): Promise<void> {
    const { packId, manifest: m } = manifestOf(slug);
    const cache = await openCache();
    const marker = await cache.match(keyOf(slug, "verified.json"));
    if (!marker || ((await marker.json()) as { packId?: string }).packId === packId) return;
    for (const c of m.chunks) await cache.delete(keyOf(slug, c.name));
    await cache.delete(keyOf(slug, "verified.json"));
  }
  /** 缓存里这个包的每一片重新算一遍哈希（没被这次调用验过的才算）；全对 → 盖「已验」章。有一片不对就删掉那一片、不盖章。 */
  async function sealIfComplete(slug: string, fresh: ReadonlySet<string>): Promise<void> {
    const { packId, manifest: m } = manifestOf(slug);
    const sizes = await cachedChunkSizes(slug, m);
    if (!sizes.every((n, i) => n === m.chunks[i]!.bytes)) return;
    const cache = await openCache();
    for (const c of m.chunks) {
      if (fresh.has(c.name)) continue;
      const r = await cache.match(keyOf(slug, c.name));
      const ok = !!r && (await hashBlob(await r.blob())) === c.sha256;
      if (!ok) { await cache.delete(keyOf(slug, c.name)); return; }
    }
    await markVerified(slug, packId);
  }

  async function download(slug: string, base: string, progress: (p: PackProgress) => void): Promise<PackStatus> {
    const { packId, manifest: m } = manifestOf(slug);
    await dropIfStale(slug);   // 同 slug 重打包（packId 变了）→ 旧分片全部作废重下，不能只看尺寸对就免验
    const sizes = await cachedChunkSizes(slug, m);
    let done = sizes.reduce((a, n, i) => a + (n === m.chunks[i]!.bytes ? n : 0), 0);
    progress({ done, total: m.totalBytes });
    const root = base.replace(/\/+$/, "");
    for (let i = 0; i < m.chunks.length; i++) {
      const c = m.chunks[i]!;
      if (sizes[i] === c.bytes) continue;
      const res = await fetch(`${root}/packs/${slug}/${c.name}`, { cache: "no-store" });
      if (!res.ok || !res.body) throw new Error(`fetch ${c.name}: HTTP ${res.status}`);
      const reader = res.body.getReader(); const sha = new Sha256(); const buf = new Uint8Array(c.bytes); let got = 0, lastReported = 0;
      for (;;) {
        const { value, done: end } = await reader.read(); if (end) break;
        if (got + value.length > c.bytes) throw new Error(`${c.name}: larger than manifest says`);
        sha.update(value); buf.set(value, got); got += value.length;
        if (got - lastReported >= 1048576 || got === c.bytes) { lastReported = got; progress({ done: done + got, total: m.totalBytes }); }   // ≥1 MiB 报一次
      }
      if (got !== c.bytes) throw new Error(`${c.name}: got ${got} bytes, expected ${c.bytes}`);
      if (sha.hex() !== c.sha256) throw new Error(`${c.name}: sha256 mismatch (source tampered or corrupted)`);
      await putChunk(slug, c.name, buf);
      done += got;
    }
    await markVerified(slug, packId);
    return status(slug);
  }

  async function importFiles(slugs: readonly string[], files: readonly File[], progress: (p: PackProgress) => void): Promise<PackStatus[]> {
    const packs = slugs.map((slug) => ({ slug, m: manifestOf(slug).manifest }));
    for (const p of packs) await dropIfStale(p.slug);
    const fresh = new Map(packs.map((p) => [p.slug, new Set<string>()] as const));
    const total = files.reduce((a, f) => a + f.size, 0);
    let done = 0, matched = 0; const bad: string[] = [];
    for (const f of files) {
      const whole = packs.find((p) => p.m.chunks.length > 1 && p.m.totalBytes === f.size);
      if (whole) {
        let offset = 0;
        for (const c of whole.m.chunks) {
          const piece = f.slice(offset, offset + c.bytes);
          if ((await hashBlob(piece)) !== c.sha256) throw new Error(`${f.name}: sha256 mismatch at ${c.name} (wrong or corrupted file)`);
          await putChunk(whole.slug, c.name, piece); fresh.get(whole.slug)!.add(c.name);
          offset += c.bytes; progress({ done: done + offset, total });
        }
        matched++;
      } else {
        const sameSize = packs.flatMap((p) => p.m.chunks.filter((c) => c.bytes === f.size).map((c) => ({ slug: p.slug, c })));
        if (sameSize.length) {
          const hex = await hashBlob(f);
          const hits = sameSize.filter((x) => x.c.sha256 === hex);
          if (!hits.length) bad.push(f.name);
          for (const h of hits) { await putChunk(h.slug, h.c.name, f); fresh.get(h.slug)!.add(h.c.name); }
          if (hits.length) matched++;
        }
      }
      done += f.size; progress({ done, total });
    }
    for (const p of packs) await sealIfComplete(p.slug, fresh.get(p.slug)!);
    if (bad.length) throw new Error(`${bad[0]}: sha256 mismatch (wrong or corrupted file)`);
    if (!matched) throw new Error("no-matching-file");
    return Promise.all(slugs.map(status));
  }

  async function downloadAll(slugs: readonly string[], base: string, progress: (p: PackProgress) => void): Promise<PackStatus[]> {
    const total = slugs.reduce((a, s) => a + manifestOf(s).manifest.totalBytes, 0);
    const have = (await Promise.all(slugs.map(status))).map((st) => st.bytesCached);   // 已经在缓存里的算在起点里
    const report = () => progress({ done: have.reduce((a, b) => a + b, 0), total });
    report();
    for (let i = 0; i < slugs.length; i++) await download(slugs[i]!, base, (p) => { have[i] = p.done; report(); });
    return Promise.all(slugs.map(status));
  }

  async function deletePack(slug: string): Promise<void> {
    const { manifest: m } = manifestOf(slug);
    const cache = await openCache();
    for (const c of m.chunks) await cache.delete(keyOf(slug, c.name));
    await cache.delete(keyOf(slug, "verified.json"));
  }

  const noop = () => { /* no progress */ };
  return {
    status: (slugs) => Promise.all(slugs.map(status)),
    download: (slugs, base, onProgress) => downloadAll(slugs, base, onProgress ?? noop),
    importFiles: (slugs, files, onProgress) => importFiles(slugs, files, onProgress ?? noop),
    async delete(slugs) { for (const slug of slugs) await deletePack(slug); },
    async chunks(slug) {
      if (!(await status(slug)).ready) throw new Error("pack-missing");
      const { manifest: m } = manifestOf(slug);
      const cache = await openCache();
      const out: Blob[] = [];
      for (const c of m.chunks) {
        const r = await cache.match(keyOf(slug, c.name));
        if (!r) throw new Error("pack-missing");
        out.push(await r.blob());
      }
      return out;
    },
  };
}
