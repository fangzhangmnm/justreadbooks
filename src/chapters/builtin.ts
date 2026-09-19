// 内建切章正则目录（v1 config.js BUILTIN_CHAPTER_REGEXES 移植）。created 2026-09-19 by Claude Fable 5.1
// 顺序很重要：先 markdown，再网文常见模式。自动探测时第一个命中 ≥ MIN_AUTO_HITS 的胜出。
// capture group 约定（split.ts tryRegex）：2 个 group → group1 长度 = level（如 "###" 当 level=3）、group2 = 标题；1 个 → 标题；0 个 → 整行。
// 标签是用户可见文案，走 i18n key `chapters.builtin.<id>`（本文件只放数据；hunt-raw-cjk 已豁免）。

export interface BuiltinChapterRegex { id: string; re: string }

export const BUILTIN_CHAPTER_REGEXES: readonly BuiltinChapterRegex[] = [
  { id: "md",      re: "^(#+)[ \\t]+(.+)$" },
  { id: "md1",     re: "^# (.+)$" },
  { id: "md2",     re: "^## (.+)$" },
  { id: "md3",     re: "^### (.+)$" },
  { id: "md4",     re: "^#### (.+)$" },
  { id: "zh-chap", re: "^[ \\t\\u00A0\\u3000]*第[零一二三四五六七八九十百千万0-9]+章.*$" },
  { id: "zh-hui",  re: "^[ \\t\\u00A0\\u3000]*第[零一二三四五六七八九十百千万0-9]+回.*$" },
  { id: "zh-jie",  re: "^[ \\t\\u00A0\\u3000]*第[零一二三四五六七八九十百千万0-9]+节.*$" },
  { id: "zh-juan", re: "^[ \\t\\u00A0\\u3000]*第[零一二三四五六七八九十百千万0-9]+卷.*$" },
  { id: "zh-pian", re: "^[ \\t\\u00A0\\u3000]*第[零一二三四五六七八九十百千万0-9]+篇.*$" },
  { id: "zh-spec", re: "^[ \\t\\u00A0\\u3000]*(楔子|序章|序言|引子|前言|尾声|后记|番外|外传|终章)([\\s :：·-].*)?$" },
  { id: "en-chap", re: "^[ \\t]*Chapter\\s+[0-9IVXLC]+.*$" },
];

/** 自动探测：候选正则里命中数 ≥ 此值的第一条胜出，否则整本一章。 */
export const MIN_AUTO_HITS = 3;
