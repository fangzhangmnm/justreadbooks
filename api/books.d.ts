import type { FreshResult } from "@internal/store";
export declare function isBookName(path: string): boolean;
export declare function splitPath(path: string): {
    dir: string;
    base: string;
};
export declare function joinPath(dir: string, base: string): string;
export declare function stemOf(path: string): string;
export type OpenBookResult = {
    kind: "ok";
    blob: Blob; /** 首帧来自本地副本（秒开）；false = 刚下载的。 */
    fromLocal: boolean;
} | {
    kind: "too-big";
    size: number;
} | {
    kind: "unavailable";
};
/** 有本地副本 → 立刻返回（不等 token、不等网）；没有 → 带进度下载（keepOffline 分片会话）再 open。size 已知且超阈值又没 allowBig → too-big（调用方弹诚实提示）。 */
export declare function openBook(name: string, opts?: {
    size?: number;
    allowBig?: boolean;
    onProgress?: (done: number, total: number) => void;
}): Promise<OpenBookResult>;
/** 后台追新（前提 0 ①③）：本地 clean ∧ 云端有新版 → 拉新版覆盖本地缓存；返回库的 FreshResult（status "fast-forwarded" = 换了字节，调用方决定静默换底还是出 chip）。 */
export declare function refreshBookInBackground(name: string, opts?: {
    onReplaceStart?: () => void;
}): Promise<FreshResult>;
export declare function isBookKeptOffline(name: string): Promise<boolean>;
export declare function keepBookOffline(name: string, onProgress?: (done: number, total: number) => void): Promise<void>;
/** 移除本机副本（只对可重取的 shadow 合法；本机唯一副本会抛 OffloadIllegalError——库 banner）。 */
export declare function offloadBook(name: string): Promise<void>;
export interface UploadResult {
    name: string;
    pushed: boolean;
    encoding: string;
}
/** 拖进来的 txt：探测编码，非 UTF-8 先转码（别的设备拿到不乱码）；撞名自动追加 " 1"…；未登录/离线只落本机（local-only，回线 ask 补推）。 */
export declare function uploadBook(src: File, dir: string): Promise<UploadResult>;
/** 本机唯一副本的书补推云端（卡片「推送到云端」）：字节不变，只是把 local-only 变 synced。 */
export declare function pushBook(name: string): Promise<boolean>;
export type RenameResult = {
    ok: true;
    name: string;
} | {
    ok: false;
    where: "local" | "cloud";
} | {
    ok: false;
    error: string;
};
export declare function renameBook(name: string, newStem: string): Promise<RenameResult>;
