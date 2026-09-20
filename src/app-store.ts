// app-store —— @internal/store 的**唯一接缝**（本仓唯一值级 import 点，build.sh lint + redline-guard 守着）。created 2026-09-19 by Claude Fable 5.1
// 只做 config 注入（provider / ui bundle / encryption 表态 / validateAdopt）+ collections 装配 + 窄再导出。
//
// 姿态（计划 §4.3，对齐 MASTER §A 与 WXHW app-store.ts）：
//   · 身份 = path/name（`[夹/]书名.txt`）；v1 的 itemId 身份废弃，本地 IDB 新命名空间 `jrb.defaultStore` 从零（旧 `justreadbooks-cache` 留孤儿）。
//   · persistence:"app-managed"：登录手势 / 首次留离线手势时调 requestStoragePersistence()。
//   · reconcilePolicy:"app-driven"：focus/visibility/online + 前台 60s 复查**只对当前书 + 当前夹**，app 驱动。
//   · autoCacheOpenedFile:true：读者 = 开即留本地（离线可读；首帧秒开的前提）。
//   · readOnlyFiles:false：有上传（拖 txt 进来）；但 app 永不 save 到既有书（lint：save 只在 books.ts）。
//   · offlineUploadReplay:"ask"：未登录时拖进来的书 = 本机唯一副本，回线问一次再推（≈ v1 constraint #4 consent 语义）。
//   · encryption：零 codec 表态（0.1 不做加密书）。

import { createStore, createOneDriveProvider, requestStoragePersistence, isCached, isDirty } from "@internal/store";
import type { Store, Collection, OneDriveAuth } from "@internal/store";
import { APP_ID, CLIENT_ID, AUTHORITY, SCOPES, MSAL_URL, COLLECTIONS, HIDDEN_NAME_RE } from "./config.ts";
import { storeUI } from "./store-ui.ts";
import { appEncryption } from "./encryption.ts";
import { looksLikeBookText } from "./encoding.ts";

const od = createOneDriveProvider({ clientId: CLIENT_ID, scopes: SCOPES, authority: AUTHORITY, msalUrl: MSAL_URL });
/** OneDrive auth 面（signIn/signOut/isSignedIn/onAuthChanged/retrySilentSignIn）。 */
export const auth: OneDriveAuth = od.auth;

let _activeBook: string | null = null;
/** 当前打开的书（全路径）：cloud-gone 去抖 trash 绝不碰它。 */
export function setActiveBookName(name: string | null): void { _activeBook = name; }
export function activeBookName(): string | null { return _activeBook; }

const store: Store = createStore({
  provider: od.provider,
  ui: storeUI,
  appId: APP_ID,
  persistence: "app-managed",
  encryption: appEncryption,
  reconcilePolicy: "app-driven",
  // 采纳云端字节前验真（挡 captive-portal HTML / 二进制垃圾）；只看头 64 KiB，大件不全量解码。
  validateAdopt: async (plain) => looksLikeBookText(new Uint8Array(await plain.slice(0, 64 * 1024 + 8).arrayBuffer())),
  autoCacheOpenedFile: true,
  offlineUploadReplay: "ask",
  readOnlyFiles: false,
  signedIn: () => od.auth.isSignedIn(),
  activeFileName: () => _activeBook,
  // 夹里有什么是 store 的事（0.14.0）：写入方半成品 *.part / ~* / .tmp 与 v1 遗留 session.json / library.json 不进帧、不进 cloud-gone 收敛
  hiddenName: (p) => HIDDEN_NAME_RE.test(p),
});

export function requireStore(): Store { return store; }

// ── collections（app schema；名字见 config.COLLECTIONS）──
/** 每本书阅读位置：manual —— setItem 只落本地（400ms 防抖），推云由 reading-position.ts 的 valuable-save 节律驱动 reconcileWithRemote。 */
export const readingPos: Collection = store.collection(COLLECTIONS.readingPos, { manual: true });
/** 每本书切章规则 / 编码：改一次推一次（自动防抖）。 */
export const bookPrefs: Collection = store.collection(COLLECTIONS.bookPrefs);

/** boot 门：hydrate 两个 collection（本地快、离线 OK、不碰网；云端后台对齐）。 */
export async function initCollections(): Promise<void> { await Promise.all([readingPos.init(), bookPrefs.init()]); }
/** 事件驱动对齐（focus/online/复查）——读 status，别只 await。 */
export async function reconcileCollections(): Promise<void> { await Promise.allSettled([readingPos.reconcileWithRemote(), bookPrefs.reconcileWithRemote()]); }
export async function flushCollections(): Promise<void> { await Promise.allSettled([readingPos.flushLocal(), bookPrefs.flushLocal()]); }

export { requestStoragePersistence, isCached, isDirty };
export type { Store, Collection, OneDriveAuth };
