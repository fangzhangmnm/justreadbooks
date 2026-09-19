// 切章深模块唯一门牌（user 2026-09-19「切章专门独立一个深模块」）：文本进、章节列表 / 目录树 / 位置锚 / 活书 diff 出。零 DOM、零 store、node 全测。
// created 2026-09-19 by Claude Fable 5.1
export type { Chapter, ChapterPref, SplitResult } from "./split.ts";
export { split, autoSplit, splitByBuiltin, splitByCustom, listBuiltin, snippet, statusHeader } from "./split.ts";
export { BUILTIN_CHAPTER_REGEXES, MIN_AUTO_HITS } from "./builtin.ts";
export type { OutlineNode } from "./tree.ts";
export { tree } from "./tree.ts";
export type { Anchor } from "./anchor.ts";
export { resolveAnchor, isTrivialMove, clampFrac } from "./anchor.ts";
export type { LiveUpdate } from "./diff.ts";
export { diff } from "./diff.ts";
