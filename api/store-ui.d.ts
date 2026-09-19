import type { StoreUI } from "@internal/store";
/** 安静路径的状态行 sink（app 注入；不给 = 零 UI）。 */
export declare function setStoreQuietStatus(fn: (text: string) => void): void;
export declare const storeUI: StoreUI;
