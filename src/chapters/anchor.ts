// 阅读位置锚（计划 §4.6；user 2026-09-19「串章是小事…行 hash 不确定靠谱」→ 只做标题命中 + 序号兜底，不做 hash）。created 2026-09-19 by Claude Fable 5.1
import type { Chapter } from "./split.ts";

/** 位置 = 第几章 + 那章的标题文本（覆盖后按它找回）+ 章内滚动比例。txt 专用；pdf 下一轮另立 {page, frac}。 */
export interface Anchor { chapter: number; title: string; frac: number }

/** 标题命中 > 序号 clamp：① 序号处标题相同 → 序号；② 全书找第一个同标题（非空）→ 它；③ clamp(序号)。 */
export function resolveAnchor(a: Anchor, chapters: readonly Chapter[]): number {
  if (chapters.length === 0) return 0;
  const i = Math.max(0, Math.min(chapters.length - 1, Math.floor(a.chapter || 0)));
  if (a.title && chapters[i]?.title === a.title) return i;
  if (a.title) { const j = chapters.findIndex((c) => c.title === a.title); if (j >= 0) return j; }
  return i;
}
/** valuable-save 的 trivial 判定：同章且比例微动 < delta（v1：TXT 一章可能很长，0.05）。 */
export function isTrivialMove(a: Anchor | null, b: Anchor, delta: number): boolean {
  if (!a) return false;
  return a.chapter === b.chapter && a.title === b.title && Math.abs(a.frac - b.frac) < delta;
}
export function clampFrac(x: number): number { return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0; }
