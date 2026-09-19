// 字符编码探测 + 解码（v1 encoding.js 移植，纯函数）。created 2026-09-19 by Claude Fable 5.1
//
// 网络小说 .txt 经常是 GB2312 / GBK / GB18030 / Big5。直接 UTF-8 decode 会出乱码「锟斤拷」。
// 策略：BOM → UTF-8 strict → GB18030 strict（覆盖 GB2312/GBK 全家）→ Big5 strict → lossy UTF-8 兜底（至少不抛）。
// 本地上传的 TXT 探测后转 UTF-8 再上传；**OneDrive 上已有的 .txt 永不改写**，只在读时探测解码。

export type TextEncodingName = "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" | "gb18030" | "big5" | "utf-8-lossy";

export function decodeBytes(buf: ArrayBuffer | Uint8Array): { text: string; encoding: TextEncodingName } {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (arr.length >= 3 && arr[0] === 0xef && arr[1] === 0xbb && arr[2] === 0xbf) return { text: new TextDecoder("utf-8").decode(arr.subarray(3)), encoding: "utf-8-bom" };
  if (arr.length >= 2 && arr[0] === 0xff && arr[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(arr.subarray(2)), encoding: "utf-16le" };
  if (arr.length >= 2 && arr[0] === 0xfe && arr[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(arr.subarray(2)), encoding: "utf-16be" };
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(arr), encoding: "utf-8" }; } catch { /* next */ }
  try { return { text: new TextDecoder("gb18030", { fatal: true }).decode(arr), encoding: "gb18030" }; } catch { /* next */ }
  try { return { text: new TextDecoder("big5", { fatal: true }).decode(arr), encoding: "big5" }; } catch { /* next */ }
  return { text: new TextDecoder("utf-8").decode(arr), encoding: "utf-8-lossy" };
}

export function encodeUtf8(text: string): Uint8Array { return new TextEncoder().encode(text); }

/** 采纳云端字节前的验真（store validateAdopt；库对加密透明这里无关）：可解码的文本且不是 captive-portal HTML。
 *  只看头部（大件不全量解码）：前 64 KiB 能按上面链路解出、非 lossy、不是 <html 开头、NUL 只有 UTF-16 合法。 */
export function looksLikeBookText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  const head = bytes.subarray(0, 64 * 1024);
  const { text, encoding } = decodeBytes(head);
  if (encoding === "utf-8-lossy" && bytes.length > 3) {
    // 头部切在多字节字符中间也会 lossy：退一步只判前 4 KiB 的整字符区（用 UTF-8 strict 找最后一个完整边界）
    const short = bytes.subarray(0, Math.min(bytes.length, 4096));
    try { new TextDecoder("utf-8", { fatal: true }).decode(trimToUtf8Boundary(short)); }
    catch { try { new TextDecoder("gb18030", { fatal: true }).decode(short.subarray(0, short.length - 2)); } catch { return false; } }
  }
  const lead = text.slice(0, 256).trimStart().toLowerCase();
  if (lead.startsWith("<!doctype html") || lead.startsWith("<html")) return false;
  if (head.subarray(0, 512).some((b) => b === 0)) return encoding.startsWith("utf-16");
  return true;
}
function trimToUtf8Boundary(b: Uint8Array): Uint8Array {
  let end = b.length;
  for (let i = b.length - 1; i >= Math.max(0, b.length - 4); i--) { const c = b[i]!; if ((c & 0xc0) === 0x80) continue; const need = c >= 0xf0 ? 4 : c >= 0xe0 ? 3 : c >= 0xc0 ? 2 : 1; if (i + need > b.length) end = i; break; }
  return b.subarray(0, end);
}
