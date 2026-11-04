import type { BarView } from "./cloud-watch.ts";
export interface OfflineBarDeps {
    dirtyCount: () => Promise<number>;
    /** 点「重新登录」那种。 */
    signIn: () => void;
    /** 有没传上去的：图库「要处理的」列表（gallery 0.8.8）。 */
    openList: () => void;
    /** 什么都不缺：再核一次。 */
    retry: () => void;
}
export declare function createOfflineBar(o: OfflineBarDeps): (view: BarView) => void;
