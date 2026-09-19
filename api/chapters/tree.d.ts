import type { Chapter } from "./split.ts";
export interface OutlineNode {
    index: number;
    title: string;
    level: number;
    children: OutlineNode[];
}
/** 每章一个节点；level 更小 = 更高层。无 level 的章一律 level 1。子节点挂在**前一个更高层**节点下；没有更高层就进根。 */
export declare function tree(chapters: readonly Chapter[]): OutlineNode[];
