// 字符编码探测 + 解码。
//
// 网络小说 .txt 经常是 GB2312 / GBK / GB18030 / Big5 (老的繁体网文)。
// 直接 UTF-8 decode 会出乱码 "锟斤拷" 类。
//
// 策略 (抄自 webxiaoheiwu):
//   1. 看 BOM (UTF-8 / UTF-16 LE/BE)
//   2. UTF-8 strict (fatal=true) → 不抛 = 是 UTF-8
//   3. GB18030 strict → covers GB2312 / GBK / GB18030 全家
//   4. Big5 strict
//   5. 都失败 → lossy UTF-8 (≈ Latin-1 落地,至少不抛错)
//
// 本地上传(file picker / drag-drop)的 TXT 会自动探测 + 转 UTF-8 再上传(可选);
// **OneDrive 上已经放着的 .txt 不主动改,只下载时按上面顺序探测解码**。

export function decodeBytes(buf) {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf);

  // UTF-8 BOM (EF BB BF)
  if (arr.length >= 3 && arr[0] === 0xef && arr[1] === 0xbb && arr[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(arr.slice(3)), encoding: "utf-8-bom" };
  }
  // UTF-16 LE (FF FE)
  if (arr.length >= 2 && arr[0] === 0xff && arr[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(arr.slice(2)), encoding: "utf-16le" };
  }
  // UTF-16 BE (FE FF)
  if (arr.length >= 2 && arr[0] === 0xfe && arr[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(arr.slice(2)), encoding: "utf-16be" };
  }

  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(arr), encoding: "utf-8" };
  } catch (_) {}
  try {
    return { text: new TextDecoder("gb18030", { fatal: true }).decode(arr), encoding: "gb18030" };
  } catch (_) {}
  try {
    return { text: new TextDecoder("big5", { fatal: true }).decode(arr), encoding: "big5" };
  } catch (_) {}
  // 兜底:不抛错
  return { text: new TextDecoder("utf-8").decode(arr), encoding: "utf-8-lossy" };
}

// 给本地上传用:File → {text, encoding}
export async function decodeFile(file) {
  const buf = await file.arrayBuffer();
  return decodeBytes(buf);
}

// UTF-8 编码(本地上传转码用)
export function encodeUtf8(text) {
  return new TextEncoder().encode(text);
}
