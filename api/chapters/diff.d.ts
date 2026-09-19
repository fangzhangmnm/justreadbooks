import type { Chapter } from "./split.ts";
export interface LiveUpdate {
    /** 新版比旧版多的章数（负数 = 少了，按 0 报，另有 currentChanged 兜底）。 */
    addedChapters: number;
    /** 正在读的那章（按标题在新版找回）正文变了。 */
    currentChanged: boolean;
    /** 正在读的那章在新版里的序号（标题命中或 clamp）。 */
    currentIndexInNew: number;
}
export declare function diff(oldText: string, oldCh: readonly Chapter[], newText: string, newCh: readonly Chapter[], current: number): LiveUpdate;
