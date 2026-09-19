import { type Anchor } from "./chapters/index.ts";
export interface StoredPosition {
    anchor: Anchor;
    readAt: number;
}
export declare function getPosition(name: string): StoredPosition | null;
/** 阅读器报位置：trivial（同章微动）只标脏不调度；非 trivial 走防抖/封顶。 */
export declare function notePosition(name: string, anchor: Anchor): void;
/** 打开一本书（哪怕没滚）：刷 readAt（最近阅读排序）；没有位置条目就建一条。 */
export declare function markOpened(name: string): void;
export declare function isUnread(name: string): boolean;
/** 最近阅读（跨夹）：按 readAt 降序前 n 本。 */
export declare function recentBooks(n: number): {
    name: string;
    readAt: number;
}[];
export declare function flushPosition(): Promise<void>;
export declare function keepalivePosition(): void;
export declare function positionIsDirty(): boolean;
