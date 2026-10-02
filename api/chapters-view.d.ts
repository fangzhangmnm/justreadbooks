import { type Chapter, type OutlineNode } from "./chapters/index.ts";
export interface ChapterRow {
    index: number;
    depth: number;
    group: boolean; /** 最近的祖先组头 index；-1 = 顶层。 */
    groupIndex: number; /** 收起时底下藏了几章（0 = 没收起）。 */
    folded: number;
}
/** 树有几级（扁平 = 1）。 */
export declare function outlineDepth(nodes: readonly OutlineNode[]): number;
/**
 * 树 → 可见行（纯函数）。keep = 搜索谓词（null = 不搜）：命中行 + 其祖先组头保留，这时不看级数。
 * levels = 不搜时展开到几级（1 = 只有最上一级；Infinity = 全部）；被收起的组头 folded = 底下藏了几章。
 */
export declare function flattenOutline(nodes: readonly OutlineNode[], keep: ((n: OutlineNode) => boolean) | null, levels?: number, toggled?: ReadonlyMap<number, boolean> | null): ChapterRow[];
/** 每章的父节点 index（-1 = 顶层）。 */
export declare function parentMap(nodes: readonly OutlineNode[], n: number): Int32Array;
/** 视口窗（纯函数）：[start, end) 要挂到 DOM 的行。 */
export declare function windowRange(total: number, rowH: number, scrollTop: number, viewportH: number, overscan: number): {
    start: number;
    end: number;
};
export interface ChaptersViewDeps {
    el: HTMLElement;
    chapters: () => readonly Chapter[];
    titleOf: (i: number) => string;
    currentIndex: () => number;
    goTo: (i: number) => void;
    /** 「目录 · N 章」 */
    title: (n: number) => string;
    /** 「展开到」下拉的选项文字：n 级 / 全部。 */
    levelLabel: (n: number | "all") => string;
    /** 小三角的读屏 / 悬停文字：open = 现在是展开的。 */
    toggleLabel: (open: boolean) => string;
    onClosed: () => void;
}
export interface ChaptersView {
    open(): void;
    close(): void;
    toggle(): void;
    isOpen(): boolean;
    /** 回到当前章（高亮行居中；搜索中就先清搜索）。 */
    locate(): void;
    /** 探针 / 测试：当前可见行数与 DOM 行数。 */
    stats(): {
        rows: number;
        mounted: number;
    };
}
export declare function initChaptersView(d: ChaptersViewDeps): ChaptersView;
