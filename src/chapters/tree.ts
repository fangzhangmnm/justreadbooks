// 目录树：按 level 折叠（Markdown 多级）；无 level 的扁平。created 2026-09-19 by Claude Fable 5.1（v1 app.js buildChapterTree 移植）
import type { Chapter } from "./split.ts";

export interface OutlineNode { index: number; title: string; level: number; children: OutlineNode[] }

/** 每章一个节点；level 更小 = 更高层。无 level 的章一律 level 1。子节点挂在**前一个更高层**节点下；没有更高层就进根。 */
export function tree(chapters: readonly Chapter[]): OutlineNode[] {
  const root: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  chapters.forEach((ch, index) => {
    const level = ch.level ?? 1;
    const node: OutlineNode = { index, title: ch.title, level, children: [] };
    while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
    (stack.length ? stack[stack.length - 1]!.children : root).push(node);
    stack.push(node);
  });
  return root;
}
