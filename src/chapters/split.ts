// 切章：文本 + 偏好 → Chapter[]（v1 chapter-split.js 移植；零 DOM 零 store）。created 2026-09-19 by Claude Fable 5.1
// 输出的 chapters 覆盖整本字符串（区间 start..<end 首尾相接）：
//   - 第一个命中之前若有非空内容 → 合成章 synthetic:"head"（标题空串，显示层用 i18n「开头」）
//   - 一个都没命中 → 整本一章 synthetic:"whole"（显示层「全文」）
// 合成章标题为空串 → 位置锚只能按序号兜底（anchor.ts），这是刻意的：它们没有稳定标题。
import { BUILTIN_CHAPTER_REGEXES, MIN_AUTO_HITS } from "./builtin.ts";

export interface Chapter {
  /** 标题行文本（去首尾空白）；合成章为空串。 */
  title: string;
  /** 章首（含标题行）在全文的字符偏移。 */
  start: number;
  /** 正文起点（跳过标题行与其后空行）。 */
  bodyStart: number;
  /** 章尾（不含）。 */
  end: number;
  /** Markdown 多级：`#` 个数（1–6）；非 markdown 无。 */
  level?: number;
  /** 合成章：head = 第一个标题之前的内容；whole = 整本没切出章。 */
  synthetic?: "head" | "whole";
}
export interface ChapterPref { regexId?: string; regexCustom?: string }
export interface SplitResult { chapters: Chapter[]; /** 命中的内建 id / "custom" / null（整本一章）。 */ chosen: string | null }

interface Hit { start: number; titleLineEnd: number; title: string; level?: number }
const MAX_HITS = 50_000;
/** 第一个标题前的内容超过这么多字符（且不止一行）才算 head 合成章。 */
const HEAD_MIN_CHARS = 120;

function tryRegex(text: string, src: string): Hit[] {
  const re = new RegExp(src, "gm");   // 编译失败直接抛：自定义正则的错误要 surface 给用户
  const hits: Hit[] = [];
  let m: RegExpExecArray | null;
  let lastIndex = -1;
  while ((m = re.exec(text)) !== null) {
    if (re.lastIndex === lastIndex) { re.lastIndex++; continue; }
    lastIndex = re.lastIndex;
    let title: string, level: number | undefined;
    if (m[2] != null) { level = Math.min(6, Math.max(1, (m[1] ?? "").length)); title = m[2]; }
    else if (m[1] != null && m[1] !== "") title = m[1];
    else title = m[0];
    title = title.replace(/^[\s 　]+/, "").replace(/[\s 　]+$/, "");
    let titleLineEnd = text.indexOf("\n", m.index);
    if (titleLineEnd < 0 || titleLineEnd > m.index + m[0].length + 200) titleLineEnd = m.index + m[0].length;
    hits.push({ start: m.index, titleLineEnd, title, level });
    if (hits.length > MAX_HITS) break;
  }
  return hits;
}

function isBlank(c: number): boolean { return c === 0x0a || c === 0x0d || c === 0x09 || c === 0x20 || c === 0x3000 || c === 0x00a0; }

function hitsToChapters(text: string, hits: Hit[]): Chapter[] {
  if (hits.length === 0) return [{ title: "", start: 0, end: text.length, bodyStart: 0, synthetic: "whole" }];
  const out: Chapter[] = [];
  const first = hits[0]!;
  // 第一个标题之前的内容：只有一行（活书的状态头 / 书名行）就不当章——它在设置页 / 卡片副标题里露面（statusHeader），阅读器开书直接进第 1 章；
  //   多行的前言 / 楔子才成 head 合成章（用户能读到）。
  const headText = text.slice(0, first.start).trim();
  if (first.start > 0 && headText.length > 0 && (headText.includes("\n") || headText.length > HEAD_MIN_CHARS)) out.push({ title: "", start: 0, end: first.start, bodyStart: 0, synthetic: "head" });
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]!;
    const nextStart = i + 1 < hits.length ? hits[i + 1]!.start : text.length;
    let bodyStart = h.titleLineEnd;
    while (bodyStart < nextStart && isBlank(text.charCodeAt(bodyStart))) bodyStart++;
    const ch: Chapter = { title: h.title, start: h.start, end: nextStart, bodyStart };
    if (h.level != null) ch.level = h.level;
    out.push(ch);
  }
  return out;
}

export function autoSplit(text: string): SplitResult {
  for (const def of BUILTIN_CHAPTER_REGEXES) {
    let hits: Hit[];
    try { hits = tryRegex(text, def.re); } catch { continue; }
    if (hits.length >= MIN_AUTO_HITS) return { chapters: hitsToChapters(text, hits), chosen: def.id };
  }
  return { chapters: hitsToChapters(text, []), chosen: null };
}
export function splitByBuiltin(text: string, id: string): SplitResult {
  const def = BUILTIN_CHAPTER_REGEXES.find((d) => d.id === id);
  if (!def) return autoSplit(text);
  return { chapters: hitsToChapters(text, tryRegex(text, def.re)), chosen: def.id };
}
/** 自定义正则：编译失败**抛**（调用方 surface 给用户，不静默退回 auto）。 */
export function splitByCustom(text: string, src: string): SplitResult {
  if (!src) return autoSplit(text);
  return { chapters: hitsToChapters(text, tryRegex(text, src)), chosen: "custom" };
}
/** 偏好 > 自动探测（≥3 命中）> 整本一章。自定义正则坏了退回下一级并把错误经 onError 报出（不吞）。 */
export function split(text: string, pref: ChapterPref | null | undefined, onError?: (e: unknown) => void): SplitResult {
  if (pref?.regexCustom) { try { return splitByCustom(text, pref.regexCustom); } catch (e) { onError?.(e); } }
  if (pref?.regexId) return splitByBuiltin(text, pref.regexId);
  return autoSplit(text);
}
export function listBuiltin(): readonly { id: string }[] { return BUILTIN_CHAPTER_REGEXES.map((d) => ({ id: d.id })); }

/** 章正文摘一句（目录 / 卡片副标题用）：压空白。 */
export function snippet(text: string, ch: Chapter, maxChars = 60): string {
  return text.slice(ch.bodyStart, Math.min(ch.end, ch.bodyStart + maxChars * 2)).replace(/\s+/g, " ").trim().slice(0, maxChars);
}
/** 活书状态头（handoff §1：文件第一行是写入方的状态摘要）：第一行去空白、截断；空行 → null。app 不解析它的语义。 */
export function statusHeader(text: string, maxChars = 120): string | null {
  const nl = text.indexOf("\n");
  const line = (nl < 0 ? text : text.slice(0, nl)).replace(/^﻿/, "").trim();
  if (!line) return null;
  return line.length > maxChars ? line.slice(0, maxChars - 1) + "…" : line;
}
