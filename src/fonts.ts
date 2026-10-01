// 内置字体（兜底）：思源黑体 / Noto Sans SC Regular，全量、gzip 压着放在 vendor/fonts/sans.ttf.gz（家族公共字体；出处、制作命令、覆盖、许可证见该目录 README）。
// created 2026-10-01 by Claude Fable 5.1（抄 WXHW src/fonts.ts）。user 2026-09-30「以后家族项目也慢慢都迁移过去」、2026-10-01「我们的公共字体也查收一下」。
//   不挡启动：字体没到之前 CSS 自然落到后面的系统字体；调用方在首帧之后的空闲片里才取。
//   不留字节：交给 FontFace 之后就放手（解压后 10 MB）。只有黑体档才取，宋体档一个字节都不下。
//   这里只「取 + 解 + 解析」，不往文档里装——装的那一下会重排正文，调用方要先记下阅读位置、装完再对回去（app.ts）。

/** CSS 里用的 family 名（styles.css `--font-reading-sans` 的第一位）。带 app 前缀 = 不和系统里装的同名字体撞。 */
export const SANS_FAMILY = "JRB Sans";

async function gunzip(b: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === "undefined") return null;   // 很老的浏览器：不装，照旧用系统字体（JRB 没 vendor 解压库，不为这一处多带一个）
  try { return new Uint8Array(await new Response(new Blob([b as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()); }
  catch { return null; }
}
let loading: Promise<FontFace | null> | null = null;
/** 取字体并解析成 FontFace（还没进文档）。成功只做一次；拿不到（文件不在 / 离线且没缓存 / 浏览器不支持）→ null，界面照旧用系统字体，下次调用再试。 */
export function loadSansFace(): Promise<FontFace | null> {
  return (loading ??= (async () => {
    if (typeof FontFace === "undefined" || typeof document === "undefined") return null;
    try {
      const r = await fetch("./vendor/fonts/sans.ttf.gz");   // 路径直接写字面量：黄线区守卫只认 fetch("./…")
      if (!r.ok) return null;
      const raw = new Uint8Array(await r.arrayBuffer());
      const bytes = raw[0] === 0x1f && raw[1] === 0x8b ? await gunzip(raw) : raw;   // 有的主机会替 .gz 加 Content-Encoding 先解掉：看魔数，别解两次
      if (!bytes) return null;
      const face = new FontFace(SANS_FAMILY, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      await face.load();
      return face;
    } catch (e) { console.warn("[fonts] built-in font failed to load", e); return null; }
  })().then((face) => { if (!face) loading = null; return face; }));
}
