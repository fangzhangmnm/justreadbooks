// TXT 章节切分。
//
// 输入: text (utf-8 string), 用户选的 regex (or builtin id)
// 输出: chapters = [{title, start, end}]  (start/end 是 char offset,字符串切片用)
//   - 第一段 (从 0 到第一个 match 之前) = "前言" / "引子",如果非空,作为 chapter[0]
//   - 否则 chapters[0] 从第一个 match 开始
//   - 没切出来 (regex 不匹配) → 整本一章 [{title:'', start:0, end:text.length}]
//
// 自动选择:从 BUILTIN_CHAPTER_REGEXES 顺序试每个,第一个 match 数 ≥ MIN 的胜出。
// 都不行 → 不切。

import { BUILTIN_CHAPTER_REGEXES, MIN_AUTO_CHAPTER_HITS } from "./config.js";

// 字符串前 200 字 + 后 200 字摘要 (preview / 跳章后短暂显示之类的可以用)
export function snippet(text, start, end, maxChars = 60) {
  const slice = text.slice(start, Math.min(end, start + maxChars));
  return slice.replace(/\s+/g, " ").trim();
}

function compileRegex(src) {
  // 用 multiline 在多行模式下 ^ 匹配行首
  return new RegExp(src, "gm");
}

function tryRegex(text, src) {
  let re;
  try { re = compileRegex(src); }
  catch (e) { throw new Error(`正则编译失败: ${e.message}`); }
  const matches = [];
  let m;
  let lastIndex = -1;
  while ((m = re.exec(text)) !== null) {
    if (re.lastIndex === lastIndex) { re.lastIndex++; continue; }
    lastIndex = re.lastIndex;
    // 标题文本:
    //  - markdown 模式正则有 capture group(如 ^### (.+)$),用 group 1 → 不带 ###
    //  - 中文模式正则没 capture(如 ^.*第N章.*$),用 m[0] 整段 → "第N章 风起" 保留
    // 通用规则:有非空 group 1 用它,否则用 m[0],最后都 trim 一下
    let title = (m[1] != null && m[1] !== "") ? m[1] : m[0];
    title = title.replace(/^[\s 　]+/, "").replace(/[\s 　]+$/, "");

    // titleLineEnd 用来切掉标题行,正文从下一行开始
    let titleLineEnd = text.indexOf("\n", m.index);
    if (titleLineEnd < 0 || titleLineEnd > m.index + m[0].length + 200) {
      titleLineEnd = m.index + m[0].length;
    }
    matches.push({
      start: m.index,
      titleLineEnd,
      title,
    });
    if (matches.length > 50_000) break;
  }
  return matches;
}

// 把 matches 数组转为 chapters[] (覆盖整本字符串)
// chapter 字段:
//   title         显示标题
//   start, end    全文区间 (start..<end)
//   bodyStart     正文起点(已跳过标题行 + leading whitespace)
//   hasTitleInText 标题行是否在 [start, bodyStart) 区间内 (viewer 不要重复显示)
function matchesToChapters(text, matches) {
  if (matches.length === 0) {
    return [{ title: "全文", start: 0, end: text.length, bodyStart: 0, hasTitleInText: false }];
  }
  const chapters = [];
  // 前导:第一个 match 之前如有非空文本 → "(开头)"
  if (matches[0].start > 0) {
    const head = text.slice(0, matches[0].start).trim();
    if (head.length > 0) {
      chapters.push({
        title: "(开头)",
        start: 0,
        end: matches[0].start,
        bodyStart: 0,
        hasTitleInText: false,
      });
    }
  }
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const nextStart = i + 1 < matches.length ? matches[i + 1].start : text.length;
    // bodyStart = 标题行换行符之后,再跳过 leading 空行
    let bodyStart = m.titleLineEnd;
    while (bodyStart < nextStart) {
      const c = text.charCodeAt(bodyStart);
      // 跳过 \n \r \t 空格 全角空格(　)和非断空格( )
      if (c === 0x0A || c === 0x0D || c === 0x09 || c === 0x20 || c === 0x3000 || c === 0x00A0) {
        bodyStart++;
      } else break;
    }
    chapters.push({
      title: m.title,
      start: m.start,
      end: nextStart,
      bodyStart,
      hasTitleInText: true,
    });
  }
  return chapters;
}

// 自动选 BUILTIN 里第一个 match ≥ MIN 的
export function autoSplit(text) {
  for (const def of BUILTIN_CHAPTER_REGEXES) {
    try {
      const matches = tryRegex(text, def.re);
      if (matches.length >= MIN_AUTO_CHAPTER_HITS) {
        return {
          chapters: matchesToChapters(text, matches),
          chosen: { id: def.id, label: def.label, re: def.re },
        };
      }
    } catch (_) {}
  }
  return {
    chapters: [{ title: "全文", start: 0, end: text.length }],
    chosen: null,
  };
}

// 显式用某个 builtin id
export function splitByBuiltin(text, id) {
  const def = BUILTIN_CHAPTER_REGEXES.find((d) => d.id === id);
  if (!def) return autoSplit(text);
  const matches = tryRegex(text, def.re);
  return {
    chapters: matchesToChapters(text, matches),
    chosen: { id: def.id, label: def.label, re: def.re },
  };
}

// 用户自定义 regex (源字符串,不带 / /)
export function splitByCustom(text, src) {
  if (!src) return autoSplit(text);
  const matches = tryRegex(text, src);
  return {
    chapters: matchesToChapters(text, matches),
    chosen: { id: "custom", label: "自定义", re: src },
  };
}

// 根据 per-book preference 切。preference 来自 library.json。
// 优先级: chapterRegexCustom > chapterRegexId > auto
export function splitByPreference(text, pref) {
  if (pref?.chapterRegexCustom) {
    try { return splitByCustom(text, pref.chapterRegexCustom); }
    catch (e) { console.warn("custom regex failed:", e); }
  }
  if (pref?.chapterRegexId) {
    return splitByBuiltin(text, pref.chapterRegexId);
  }
  return autoSplit(text);
}

// list builtins for UI dropdown
export function listBuiltinRegexes() {
  return BUILTIN_CHAPTER_REGEXES.map((d) => ({ id: d.id, label: d.label, re: d.re }));
}
