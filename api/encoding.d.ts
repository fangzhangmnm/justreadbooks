export type TextEncodingName = "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" | "gb18030" | "big5" | "utf-8-lossy";
export declare function decodeBytes(buf: ArrayBuffer | Uint8Array): {
    text: string;
    encoding: TextEncodingName;
};
export declare function encodeUtf8(text: string): Uint8Array;
/** 采纳云端字节前的验真（store validateAdopt；库对加密透明这里无关）：可解码的文本且不是 captive-portal HTML。
 *  只看头部（大件不全量解码）：前 64 KiB 能按上面链路解出、非 lossy、不是 <html 开头、NUL 只有 UTF-16 合法。 */
export declare function looksLikeBookText(bytes: Uint8Array): boolean;
