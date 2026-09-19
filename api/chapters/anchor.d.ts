import type { Chapter } from "./split.ts";
/** 位置 = 第几章 + 那章的标题文本（覆盖后按它找回）+ 章内滚动比例。txt 专用；pdf 下一轮另立 {page, frac}。 */
export interface Anchor {
    chapter: number;
    title: string;
    frac: number;
}
/** 标题命中 > 序号 clamp：① 序号处标题相同 → 序号；② 全书找第一个同标题（非空）→ 它；③ clamp(序号)。 */
export declare function resolveAnchor(a: Anchor, chapters: readonly Chapter[]): number;
/** valuable-save 的 trivial 判定：同章且比例微动 < delta（v1：TXT 一章可能很长，0.05）。 */
export declare function isTrivialMove(a: Anchor | null, b: Anchor, delta: number): boolean;
export declare function clampFrac(x: number): number;
