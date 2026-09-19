export interface PwaShellOptions {
    onUpdateAvailable: () => void;
    onForeground?: () => void;
    onBeforeReload?: () => void | Promise<void>;
}
export interface PwaShell {
    readonly isDevRoute: boolean;
    /** 应用等待中的新 SW 并 reload（toast「刷新」按钮调）。 */
    reload: () => Promise<void>;
    /** 清缓存重启（PWA 卡旧版的逃生舱）：unregister 全部 SW + 清 Cache Storage + reload。IDB（书的本地副本）不碰。 */
    forceReset: () => Promise<void>;
}
export declare function initPwaShell(opts: PwaShellOptions): PwaShell;
