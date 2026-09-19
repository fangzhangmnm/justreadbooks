// TXT 章节切分。
//
// 输入: text (utf-8 string), 用户选的 regex (or builtin id)
// 输出: chapters = [{title, start, end, bodyStart, hasTitleInText, level?}]
//   - 第一段 (从 0 到第一个 match 之前) = "前言" / "引子",如果非空,作为 chapter[0]
//   - 否则 chapters[0] 从第一个 match 开始
//   - 没切出来 (regex 不匹配) → 整本一章
//
// level 字段(可选):用 capture group 数量约定推出来,目录 UI 据此缩进。
//   - 2 个 group → group 1 = level 指示 (e.g. "###" 当 level=3),group 2 = 标题
//   - 1 个 group → group 1 = 标题,无 level
//   - 0 个 group → m[0] 当标题,无 level
//
// 自动选择:从 BUILTIN_CHAPTER_REGEXES 顺序试每个,第一个 match 数 ≥ MIN 的胜出。
// 都不行 → 不切。

import { BUILTIN_CHAPTER_REGEXES, MIN_AUTO_CHAPTER_HITS } from "./config.js";

export function snippet(text, start, end, maxChars = 60) {
  const slice = text.slice(start, Math.min(end, start + maxChars));
  return slice.replace(/\s+/g, " ").trim();
}

function compileRegex(src) {
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

    // 标题 + level 解析:看 capture group 数量
    let title, level;
    if (m[2] != null) {
      // 2 个 group: group1 长度 = level (cap 6),group2 = 标题
      const prefix = m[1] || "";
      level = Math.min(6, Math.max(1, prefix.length));
      title = m[2];
    } else if (m[1] != null && m[1] !== "") {
      // 1 个 group: 标题
      title = m[1];
    } else {
      // 0 个 group: m[0]
      title = m[0];
    }
    title = title.replace(/^[\s 　]+/, "").replace(/[\s 　]+$/, "");

    // titleLineEnd 用来切掉标题行,正文从下一行开始
    let titleLineEnd = text.indexOf("\n", m.index);
    if (titleLineEnd < 0 || titleLineEnd > m.index + m[0].length + 200) {
      titleLineEnd = m.index + m[0].length;
    }
    matches.push({ start: m.index, titleLineEnd, title, level });
    if (matches.length > 50_000) break;
  }
  return matches;
}

// 把 matches 数组转为 chapters[] (覆盖整本字符串)
function matchesToChapters(text, matches) {
  if (matches.length === 0) {
    return [{ title: "全文", start: 0, end: text.length, bodyStart: 0, hasTitleInText: false }];
  }
  const chapters = [];
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
    let bodyStart = m.titleLineEnd;
    while (bodyStart < nextStart) {
      const c = text.charCodeAt(bodyStart);
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
      level: m.level,
    });
  }
  return chapters;
}

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
    chapters: [{ title: "全文", start: 0, end: text.length, bodyStart: 0, hasTitleInText: false }],
    chosen: null,
  };
}

export function splitByBuiltin(text, id) {
  const def = BUILTIN_CHAPTER_REGEXES.find((d) => d.id === id);
  if (!def) return autoSplit(text);
  const matches = tryRegex(text, def.re);
  return {
    chapters: matchesToChapters(text, matches),
    chosen: { id: def.id, label: def.label, re: def.re },
  };
}

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

export function listBuiltinRegexes() {
  return BUILTIN_CHAPTER_REGEXES.map((d) => ({ id: d.id, label: d.label, re: d.re }));
}
