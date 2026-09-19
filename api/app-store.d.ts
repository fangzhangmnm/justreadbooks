import { requestStoragePersistence, isCached, isDirty } from "@internal/store";
import type { Store, Collection, OneDriveAuth } from "@internal/store";
/** OneDrive auth 面（signIn/signOut/isSignedIn/onAuthChanged/retrySilentSignIn）。 */
export declare const auth: OneDriveAuth;
/** 当前打开的书（全路径）：cloud-gone 去抖 trash 绝不碰它。 */
export declare function setActiveBookName(name: string | null): void;
export declare function activeBookName(): string | null;
export declare function requireStore(): Store;
/** 每本书阅读位置：manual —— setItem 只落本地（400ms 防抖），推云由 reading-position.ts 的 valuable-save 节律驱动 reconcileWithRemote。 */
export declare const readingPos: Collection;
/** 每本书切章规则 / 编码：改一次推一次（自动防抖）。 */
export declare const bookPrefs: Collection;
/** boot 门：hydrate 两个 collection（本地快、离线 OK、不碰网；云端后台对齐）。 */
export declare function initCollections(): Promise<void>;
/** 事件驱动对齐（focus/online/复查）——读 status，别只 await。 */
export declare function reconcileCollections(): Promise<void>;
export declare function flushCollections(): Promise<void>;
export { requestStoragePersistence, isCached, isDirty };
export type { Store, Collection, OneDriveAuth };
