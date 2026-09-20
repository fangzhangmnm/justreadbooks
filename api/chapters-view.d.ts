import { type Chapter, type OutlineNode } from "./chapters/index.ts";
export interface ChapterRow {
    index: number;
    depth: number;
    group: boolean;
    collapsed: boolean; /** 最近的祖先组头 index；-1 = 顶层。 */
    groupIndex: number;
}
/** 树 → 可见行（纯函数）。collapsed = 折叠的组头 index；keep = 搜索谓词（null = 不搜）：命中行 + 其祖先组头保留、折叠无视。 */
export declare function flattenOutline(nodes: readonly OutlineNode[], collapsed: ReadonlySet<number>, keep: ((n: OutlineNode) => boolean) | null): ChapterRow[];
/** 视口窗（纯函数）：[start, end) 要挂到 DOM 的行。 */
export declare function windowRange(total: number, rowH: number, scrollTop: number, viewportH: number, overscan: number): {
    start: number;
    end: number;
};
/** 每个节点的父组头 index（-1 = 顶层）；定位当前章时用来展开祖先。 */
export declare function parentMap(nodes: readonly OutlineNode[]): Map<number, number>;
export interface ChaptersViewDeps {
    el: HTMLElement;
    chapters: () => readonly Chapter[];
    titleOf: (i: number) => string;
    currentIndex: () => number;
    goTo: (i: number) => void;
    /** 折叠态按书记（本会话）；null = 没书。 */
    bookKey: () => string | null;
    /** 「目录 · N 章」 */
    title: (n: number) => string;
    /** chevron 的 aria：折叠 / 展开 */
    toggleLabel: (collapsed: boolean) => string;
    onClosed: () => void;
}
export interface ChaptersView {
    open(): void;
    close(): void;
    toggle(): void;
    isOpen(): boolean;
    /** 回到当前章（高亮行居中；祖先折叠着就展开）。 */
    locate(): void;
    /** 探针 / 测试：当前可见行数与 DOM 行数。 */
    stats(): {
        rows: number;
        mounted: number;
    };
}
export declare function initChaptersView(d: ChaptersViewDeps): ChaptersView;
