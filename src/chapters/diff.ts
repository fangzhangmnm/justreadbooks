// 活书 diff：同名覆盖后，新旧章节列表比一比，给 chip 用（计划 §4.6：+N 章 / 本章有更新）。created 2026-09-19 by Claude Fable 5.1
import type { Chapter } from "./split.ts";
import { resolveAnchor } from "./anchor.ts";

export interface LiveUpdate {
  /** 新版比旧版多的章数（负数 = 少了，按 0 报，另有 currentChanged 兜底）。 */
  addedChapters: number;
  /** 正在读的那章（按标题在新版找回）正文变了。 */
  currentChanged: boolean;
  /** 正在读的那章在新版里的序号（标题命中或 clamp）。 */
  currentIndexInNew: number;
}
export function diff(oldText: string, oldCh: readonly Chapter[], newText: string, newCh: readonly Chapter[], current: number): LiveUpdate {
  const cur = oldCh[current];
  const idx = cur ? resolveAnchor({ chapter: current, title: cur.title, frac: 0 }, newCh) : 0;
  const a = cur ? oldText.slice(cur.bodyStart, cur.end) : "";
  const n = newCh[idx];
  const b = n ? newText.slice(n.bodyStart, n.end) : "";
  return { addedChapters: Math.max(0, newCh.length - oldCh.length), currentChanged: a !== b, currentIndexInNew: idx };
}
