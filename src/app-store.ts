// app-store —— @internal/store 的**唯一接缝**（本仓唯一值级 import 点，build.sh lint + redline-guard 守着；src/identifiers.ts 只准拿纯函数 createIdentifiers）。
// created 2026-09-19 by Claude Fable 5.1 · 2026-10-21 收 store 2.1.2（Claude Fable 5.1；逐版行为差异与开关决定 = ai-docs/20261021-store-2.1.2-gallery-0.8.5-migration.md §1）
// 只做 config 注入（provider / ui bundle / encryption 表态 / validateAdopt / 种类表）+ collections 装配 + 窄再导出。
//
// 姿态（计划 §4.3，对齐 MASTER §A 与 WXHW app-store.ts）：
//   · 身份 = path/name（`[夹/]书名.txt`，种类表 = src/identifiers.ts 一行）；v1 的 itemId 身份废弃，本地 IDB 新命名空间 `jrb.defaultStore` 从零（旧 `justreadbooks-cache` 留孤儿）。
//   · docKinds **不带 tier** = 一等作品 = 0.18 全部行为（冲突面 / 回收站 / 脏的不驱逐）。store 2.x 的新开关一个不开：streaming 不传（读者下载一本书 = 一个顺序分片会话，
//     不要投机车道和镜像）、transport / pushRetry 默认（= 0.17.0；上传 > 4 MB 的书才分块，iOS 真机出现「上传永远转圈」再开超时那一个）、openLineageFromDurable 默认开（读者不编辑，无影响无害）。
//   · persistence:"app-managed"：登录手势 / 首次留离线手势时调 requestStoragePersistence()。
//   · reconcilePolicy:"app-driven"：focus/visibility/online + 前台 60s 复查**只对当前书 + 当前夹**，app 驱动。
//   · autoCacheOpenedFile:true：读者 = 开即留本地（离线可读；首帧秒开的前提）。
//   · readOnlyFiles:false：有上传（拖 txt 进来）；但 app 永不 save 到既有书（lint：save 只在 books.ts）。
//   · offlineUploadReplay:"ask"：推到一半断网的上传回线问一次再推。⚠ 库的这条队列只收「推过但没落地」的（save() 里 tryPush:false 直接返回、不入队）——
//     未登录时拖进来的书是本机唯一副本，库那条队列**不会**问它——所以 app.ts offerPushLocalOnly 在登录后 / 回线问一次再 files.dirty.pushAll()（0.2.20，user 2026-10-21「同意」）；
//     逐本的出路照旧 = 书架卡片「处理…」→ 库的面里选「本地覆盖云端」（cloudState never = 第一次上传）。
//   · encryption：零 codec 表态（0.1 不做加密书）。

import { createStore, createOneDriveProvider, requestStoragePersistence, isCached, isDirty } from "@internal/store";
import type { Store, Collection, OneDriveAuth } from "@internal/store";
import { APP_ID, CLIENT_ID, AUTHORITY, SCOPES, MSAL_URL, COLLECTIONS, HIDDEN_NAME_RE } from "./config.ts";
import { DOC_KINDS } from "./identifiers.ts";
import { storeUI } from "./store-ui.ts";
import { appEncryption } from "./encryption.ts";
import { looksLikeBookText } from "./encoding.ts";

const od = createOneDriveProvider({ clientId: CLIENT_ID, scopes: SCOPES, authority: AUTHORITY, msalUrl: MSAL_URL });
/** OneDrive auth 面（signIn/signOut/isSignedIn/onAuthChanged/retrySilentSignIn）。 */
export const auth: OneDriveAuth = od.auth;

let _activeBook: string | null = null;
/** 当前打开的书（身份 = 全路径）：cloud-gone 去抖 trash 绝不碰它。 */
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
  // 文档种类表（store 0.16，提案 = 库仓 ai-docs/20260929-proposal-doc-types.md）：身份怎么切、取回撞名戳插在哪，全由这张表推导。同一张表 src/identifiers.ts 也造了一份给纯代码用。
  docKinds: DOC_KINDS,
  autoCacheOpenedFile: true,
  offlineUploadReplay: "ask",
  readOnlyFiles: false,
  signedIn: () => od.auth.isSignedIn(),
  activeIdentifier: () => _activeBook,
  // 夹里有什么是 store 的事（0.14.0）：写入方半成品 *.part / ~* / .tmp 与 v1 遗留 session.json / library.json 不进帧、不进 cloud-gone 收敛
  hidden: (identifier) => HIDDEN_NAME_RE.test(identifier),
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
export { wipeAppNamespace, scanAppNamespace } from "@internal/store";   // maintenance 面经接缝转口（factory-reset.ts 消费；库内 typed consent）
/** 还原出厂前置：释放本 store 实例（否则库进 blocked 报告）。之后任何面抛 StoreDisposedError——只能 reload。 */
export async function disposeStore(): Promise<void> { await store.dispose(); }
export type { Store, Collection, OneDriveAuth };
