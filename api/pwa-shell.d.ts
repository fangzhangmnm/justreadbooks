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
    /** 手动检查更新（设置里的按钮）：poke registration.update()，等新 SW 装完。
     *  "found" = 有新版待应用（调用方弹「有新版本」toast）；"latest" = 已是最新；"unavailable" = 没有 SW（localhost / 不支持）。 */
    checkForUpdate: () => Promise<"found" | "latest" | "unavailable">;
}
export declare function initPwaShell(opts: PwaShellOptions): PwaShell;
