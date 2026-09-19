// 编码探测 + 采纳验真。created 2026-09-19 by Claude Fable 5.1
import { describe, it, eq, assert } from "./runner.mjs";
import { decodeBytes, encodeUtf8, looksLikeBookText } from "../src/encoding.ts";

describe("encoding", () => {
  it("UTF-8 / BOM / UTF-16LE", () => {
    eq(decodeBytes(encodeUtf8("你好")).encoding, "utf-8");
    eq(decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...encodeUtf8("你好")])).text, "你好");
    const le = new Uint8Array([0xff, 0xfe, 0x60, 0x4f]); eq(decodeBytes(le).text, "你"); eq(decodeBytes(le).encoding, "utf-16le");
  });
  it("GB18030（老网文）解出中文而不是锟斤拷", () => {
    const gb = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]);   // 你好 GBK
    const r = decodeBytes(gb); eq(r.encoding, "gb18030"); eq(r.text, "你好");
  });
  it("looksLikeBookText：文本 ✓、HTML ✗、二进制 NUL ✗、空 ✓", () => {
    assert(looksLikeBookText(encodeUtf8("第一章\n正文")));
    assert(!looksLikeBookText(encodeUtf8("<!DOCTYPE html><html><body>captive portal</body></html>")));
    assert(!looksLikeBookText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])));
    assert(looksLikeBookText(new Uint8Array(0)));
  });
  it("大件：头部切在多字节中间不误判", () => {
    const big = encodeUtf8("中".repeat(40000));   // 120000 字节 > 64 KiB，65536 不是 3 的倍数 → 切在字符中间
    assert(looksLikeBookText(big));
  });
});
