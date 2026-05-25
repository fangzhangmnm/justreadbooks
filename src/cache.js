// IndexedDB blob 缓存 —— 同时也是"本地文件清单"的唯一 SSOT。
//
// 跟 JustReadPapers / BackgroundRadio 的区别:**本 app 没有"本地索引"另存于
// localStorage**;cache.meta 既存"OneDrive 文件本地副本",也存"用户上传的本地文件"。
// 区分靠 meta.source:
//   "onedrive" — 来自云端,有 OneDrive itemId 作为 key;blob 是云端副本,丢失可重下
//   "local"    — 用户本地上传 / drag-drop,itemId = "local:<rand>" 合成;
//                 blob 是**唯一副本**,绝对不能被淘汰 (sync-constraints #2)
//
// **明确用户授权才入缓存** (sync-constraints 推断 + BackgroundRadio 模式):
//   - 打开一本云端书 = 流式读到内存(blob URL),除非已在 cache 否则不入 IDB
//   - 用户点"缓存"按钮 → set() + pinned=true (意图明确,要离线看)
//   - 用户本地上传 → set() + source="local" + pinned=true + pendingUpload=true
//
// 淘汰规则 (constraint #2 critical):
//   - 永远跳过 source="local" (用户唯一副本,删了等于丢数据)
//   - 跳过 pinned=true (用户明确说"要保留")
//   - 剩下的非 pinned 云端缓存按 lastAccessed 升序淘汰
//   - 全 pinned + local 装不下 → 返回 false,UI toast 让用户去清
//
// meta 字段 (cache.meta 是本地文件的 SoT):
//   itemId          OneDrive itemId 或 "local:<rand>"
//   size, type      blob 元数据
//   name            显示文件名(带扩展)
//   folderPath      OneDrive 路径相对 books/(空字符串=根),local 文件 = "__local__"
//   source          "onedrive" | "local"
//   pinned          用户钉住,容量满也不淘汰
//   lastAccessed    LRU
//   eTag            OneDrive eTag,做 freshness 探测用
//   pendingUpload   本地文件:登录/上线后需要补推到云端 (constraint #4)
//   remoteFound     云端文件:上次同步是否在 OneDrive 上存在;false = ghost (constraint #5)

import { DEFAULT_CACHE_CAP_BYTES, MIN_CACHE_CAP_MB } from "./config.js";

const DB_NAME = "justreadbooks-cache";
const DB_VERSION = 1;
const STORE_BLOBS = "blobs";
const STORE_META = "meta";

const CAP_KEY = "jrb.cacheCapBytes";

function loadCap() {
  try {
    const raw = localStorage.getItem(CAP_KEY);
    if (raw) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n >= MIN_CACHE_CAP_MB * 1024 * 1024) return n;
    }
  } catch (_) {}
  return DEFAULT_CACHE_CAP_BYTES;
}

let capBytes = loadCap();

export function setCapMB(mb) {
  if (typeof mb !== "number" || !isFinite(mb) || mb < MIN_CACHE_CAP_MB) return false;
  capBytes = Math.floor(mb) * 1024 * 1024;
  try { localStorage.setItem(CAP_KEY, String(capBytes)); } catch (_) {}
  return true;
}
export function getCapMB() { return Math.round(capBytes / 1024 / 1024); }
export function getCapBytes() { return capBytes; }

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS);
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "itemId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function awaitTx(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getBlob(itemId) {
  const db = await openDb();
  const tx = db.transaction(STORE_BLOBS, "readonly");
  return reqAsPromise(tx.objectStore(STORE_BLOBS).get(itemId));
}

export async function getMeta(itemId) {
  const db = await openDb();
  const tx = db.transaction(STORE_META, "readonly");
  return reqAsPromise(tx.objectStore(STORE_META).get(itemId));
}

export async function isCached(itemId) {
  return !!(await getMeta(itemId));
}

export async function listMeta() {
  const db = await openDb();
  const tx = db.transaction(STORE_META, "readonly");
  return reqAsPromise(tx.objectStore(STORE_META).getAll());
}

export async function totalBytes() {
  const all = await listMeta();
  return all.reduce((acc, m) => acc + (m.size || 0), 0);
}

export async function touch(itemId) {
  const m = await getMeta(itemId);
  if (!m) return;
  m.lastAccessed = Date.now();
  const db = await openDb();
  const tx = db.transaction(STORE_META, "readwrite");
  tx.objectStore(STORE_META).put(m);
  return awaitTx(tx);
}

export async function del(itemId) {
  const db = await openDb();
  const tx = db.transaction([STORE_BLOBS, STORE_META], "readwrite");
  tx.objectStore(STORE_BLOBS).delete(itemId);
  tx.objectStore(STORE_META).delete(itemId);
  return awaitTx(tx);
}

// 是否可被自动淘汰。constraint #2:source="local" 永远不可淘汰(用户唯一副本)
function isEvictable(m) {
  return !m.pinned && m.source !== "local";
}

// 腾够 reserveBytes 空间。
// "保护区" = pinned 或 local (唯一副本)。"保护区 + 新 blob > cap" → false
async function ensureRoom(reserveBytes) {
  const all = await listMeta();
  const protectedItems = all.filter((m) => !isEvictable(m));
  const evictable = all.filter(isEvictable);

  const protectedSize = protectedItems.reduce((a, m) => a + (m.size || 0), 0);
  if (protectedSize + reserveBytes > capBytes) return false;

  evictable.sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0));
  let total = protectedSize + evictable.reduce((a, m) => a + (m.size || 0), 0);
  for (const m of evictable) {
    if (total + reserveBytes <= capBytes) break;
    await del(m.itemId);
    total -= m.size || 0;
  }
  return true;
}

// 写入 blob。容量塞不下返回 false,不抛 (UI toast)。
// 默认 pinned = true,因为本 app 入缓存全部都是用户明确点了"缓存"按钮的意图。
// 已有 meta(改名 / 重缓存)时保留 pinned / folderPath 等旧字段,
// 但 extraMeta 显式传入的字段会覆盖。
export async function set(itemId, blob, extraMeta = {}) {
  if (blob.size > capBytes) return false;
  const ok = await ensureRoom(blob.size);
  if (!ok) return false;

  const prev = await getMeta(itemId).catch(() => null);
  const meta = {
    ...(prev || {}),
    ...extraMeta,
    itemId,
    size: blob.size,
    type: blob.type || (prev?.type ?? "application/octet-stream"),
    lastAccessed: Date.now(),
  };
  // pinned 默认值:旧 meta 有就保留;否则 true(明确缓存意图)
  if (meta.pinned === undefined) meta.pinned = true;

  const db = await openDb();
  const tx = db.transaction([STORE_BLOBS, STORE_META], "readwrite");
  tx.objectStore(STORE_BLOBS).put(blob, itemId);
  tx.objectStore(STORE_META).put(meta);
  await awaitTx(tx);
  return true;
}

export async function setPinned(itemId, pinned) {
  const m = await getMeta(itemId);
  if (!m) return false;
  m.pinned = !!pinned;
  const db = await openDb();
  const tx = db.transaction(STORE_META, "readwrite");
  tx.objectStore(STORE_META).put(m);
  await awaitTx(tx);
  return true;
}

// 清空所有 — **包括本地文件**。调用方必须做强 confirm (constraint #2);
// 单独提供这个 API 而不是 caller 自己拼 del() 循环,是为了走单事务原子化。
export async function clearAll() {
  const db = await openDb();
  const tx = db.transaction([STORE_BLOBS, STORE_META], "readwrite");
  tx.objectStore(STORE_BLOBS).clear();
  tx.objectStore(STORE_META).clear();
  return awaitTx(tx);
}

// 列出所有本地上传文件 (source="local")。app.js 用它替代旧的 jrb.local.index
export async function listLocalFiles() {
  const all = await listMeta();
  return all.filter((m) => m.source === "local");
}

// 列出等待推云的本地文件 (constraint #4 新语义)。
// 跟"source === local" 不一样:
//   - drag-drop 登录时 → pendingUpload:true (隐式 consent,网失败时保留意图)
//   - drag-drop 未登录 → pendingUpload:false (consent 没覆盖未来登录的 cloud)
//   - 第一次登录 auto-promote → 整批 pendingUpload:true
//   - 用户在 collision 里点 [暂不上传] → pendingUpload:false + uploadDeferred:true
//                                          (won't auto-retry until 显式 [上传] 按钮)
// drain 只动 pendingUpload:true 的项。
export async function listPendingUploads() {
  const all = await listMeta();
  return all.filter((m) => m.source === "local" && m.pendingUpload === true);
}

// (`listLocalFiles` 上面定义,展示所有 source:"local",不区分 pending 状态)

// 设置 pendingUpload flag。用户在 UI 点 [上传到云端] 会调这个。
export async function setPendingUpload(itemId, pendingUpload) {
  const m = await getMeta(itemId);
  if (!m || m.source !== "local") return false;
  m.pendingUpload = !!pendingUpload;
  // 用户主动 opt-in → 清掉之前的 defer
  if (pendingUpload) m.uploadDeferred = false;
  const db = await openDb();
  const tx = db.transaction(STORE_META, "readwrite");
  tx.objectStore(STORE_META).put(m);
  await awaitTx(tx);
  return true;
}

// 用户在 collision 里点了 [暂不上传] —— 标 deferred 且清 pending
export async function setUploadDeferred(itemId) {
  const m = await getMeta(itemId);
  if (!m || m.source !== "local") return false;
  m.uploadDeferred = true;
  m.pendingUpload = false;
  m.uploadCollision = false;  // 用户已经知道了冲突,不再标 collision
  const db = await openDb();
  const tx = db.transaction(STORE_META, "readwrite");
  tx.objectStore(STORE_META).put(m);
  await awaitTx(tx);
  return true;
}

// 第一次登录的 auto-promote:所有 source:"local" 整批 pendingUpload:true
// **only-once 性** 由 caller 保证(`hasEverSignedIn` 标志)
export async function markAllLocalAsPending() {
  const all = await listMeta();
  let n = 0;
  for (const m of all) {
    if (m.source !== "local") continue;
    if (m.pendingUpload === true) continue;
    m.pendingUpload = true;
    m.uploadDeferred = false; // 第一次登录清掉历史 defer
    const db = await openDb();
    const tx = db.transaction(STORE_META, "readwrite");
    tx.objectStore(STORE_META).put(m);
    await awaitTx(tx);
    n++;
  }
  return n;
}

// 一个 set 后把 source 改成 onedrive (上传成功后从本地文件晋级成云端缓存)
// itemId 会从 "local:xxx" 换成 OneDrive 真 itemId,需要"搬家":blob+meta 都要重 key
export async function rekeyLocalToOnedrive(oldId, newId, patch = {}) {
  const oldMeta = await getMeta(oldId);
  if (!oldMeta) return false;
  const oldBlob = await getBlob(oldId);
  if (!oldBlob) return false;

  const newMeta = {
    ...oldMeta,
    ...patch,
    itemId: newId,
    source: "onedrive",
    pendingUpload: false,
    remoteFound: true,
  };

  const db = await openDb();
  const tx = db.transaction([STORE_BLOBS, STORE_META], "readwrite");
  tx.objectStore(STORE_BLOBS).put(oldBlob, newId);
  tx.objectStore(STORE_META).put(newMeta);
  tx.objectStore(STORE_BLOBS).delete(oldId);
  tx.objectStore(STORE_META).delete(oldId);
  await awaitTx(tx);
  return true;
}

// 标 ghost (云端 404)。不删 blob —— 用户上次缓存的副本还能用 (constraint #5)
export async function markGhost(itemId) {
  const m = await getMeta(itemId);
  if (!m) return false;
  m.remoteFound = false;
  const db = await openDb();
  const tx = db.transaction(STORE_META, "readwrite");
  tx.objectStore(STORE_META).put(m);
  await awaitTx(tx);
  return true;
}

// 反向:云端又出现了 (用户在 OneDrive 网页恢复了)
export async function markRemoteFound(itemId, patch = {}) {
  const m = await getMeta(itemId);
  if (!m) return false;
  m.remoteFound = true;
  Object.assign(m, patch);
  const db = await openDb();
  const tx = db.transaction(STORE_META, "readwrite");
  tx.objectStore(STORE_META).put(m);
  await awaitTx(tx);
  return true;
}

// 把鬼 (source:"onedrive" + remoteFound:false) 转成本地待上传 (source:"local")。
// 用户在鬼态点 [再上传] 时调:意图 = "云端没了,把本地副本再传上去"。
// 旧 itemId 没用了(那是云端的 ID),给个新 local: ID。drain 时会推到 folderPath
// 指示的原位置(如果用户希望就近恢复)。
export async function promoteGhostToLocal(oldId, newLocalId) {
  const oldMeta = await getMeta(oldId);
  if (!oldMeta || oldMeta.source !== "onedrive") return false;
  const oldBlob = await getBlob(oldId);
  if (!oldBlob) return false;

  const newMeta = {
    ...oldMeta,
    itemId: newLocalId,
    source: "local",
    pinned: true,  // 用户主动操作,默认 pin
    pendingUpload: true,  // [再上传] 是显式 opt-in → 立刻入 drain 队列
    uploadDeferred: false,
  };
  // 清掉 onedrive 专属字段
  delete newMeta.remoteFound;
  delete newMeta.eTag;
  delete newMeta.accountId;
  delete newMeta.uploadCollision; // 重新检查

  const db = await openDb();
  const tx = db.transaction([STORE_BLOBS, STORE_META], "readwrite");
  tx.objectStore(STORE_BLOBS).put(oldBlob, newLocalId);
  tx.objectStore(STORE_META).put(newMeta);
  tx.objectStore(STORE_BLOBS).delete(oldId);
  tx.objectStore(STORE_META).delete(oldId);
  await awaitTx(tx);
  return true;
}

// 标记 / 清除 "重名冲突" (sync-constraints #7:同名时禁止上传,要求用户本地改名)
export async function setUploadCollision(itemId, collide) {
  const m = await getMeta(itemId);
  if (!m) return false;
  m.uploadCollision = !!collide;
  const db = await openDb();
  const tx = db.transaction(STORE_META, "readwrite");
  tx.objectStore(STORE_META).put(m);
  await awaitTx(tx);
  return true;
}

// 只在本地 cache.meta 里改名,不动云端。适用于:
//   - source:"local" (没云端副本可改)
//   - source:"onedrive" + remoteFound:false (鬼态;云端那个 itemId 已经没了 / 不属于
//     当前账号,改了也没意义。用户改名是为了 再上传 时避开冲突)
// **不** 适用于:source:"onedrive" + remoteFound:true (活的云端项要走 graph.renameItem)
export async function renameLocal(itemId, newName) {
  const m = await getMeta(itemId);
  if (!m) return false;
  if (m.source === "onedrive" && m.remoteFound !== false) return false;
  m.name = newName;
  m.uploadCollision = false;  // 改名后让 drain 重新判
  const db = await openDb();
  const tx = db.transaction(STORE_META, "readwrite");
  tx.objectStore(STORE_META).put(m);
  await awaitTx(tx);
  return true;
}

// 用 listChildren 结果同步 cache.meta:
//   1) constraint #5: 云端改名 / 改 eTag / 跨文件夹移动 → cache.meta 跟上
//   2) ghost 检测:同 folderPath 的 onedrive 项在 list 里消失 → 标 ghost
//   3) ghost 复活:如果 list 里又出现了某鬼的 itemId (用户在 OneDrive 网页
//      把它放回了某个文件夹) → un-ghost + 更新 folderPath
//
// **空 list 安全网**:listChildren 抽风返回 [] 但 cache 里这文件夹本来有 N 项 →
//   不标鬼。避免一次 list 异常把所有缓存全鬼了。
//
// items: listChildren 返回的 driveItem[];folderPath: 它们所在的相对路径
// currentAccountId: MSAL homeAccountId,**只 stamp 老 entry 用** (新 entry 在 cache.set
//   时由调用方传入);不用做 cross-account 鬼检测 — 不同账号的 entry 通过列表 hide 隔离
// 返回 { updated, ghosted, unghosted }
export async function reconcileWithRemoteList(items, folderPath, currentAccountId = null) {
  let updated = 0;
  let unghosted = 0;

  // 已知 items 的字段同步(改名 / 改 etag / 改 folderPath / un-ghost / stamp accountId)
  const remoteIds = new Set();
  for (const it of items) {
    if (!it.id) continue;
    remoteIds.add(it.id);
    if (!it.file) continue;
    const m = await getMeta(it.id);
    if (!m) continue;
    let changed = false;
    if (it.name && m.name !== it.name) { m.name = it.name; changed = true; }
    if (m.folderPath !== folderPath) { m.folderPath = folderPath; changed = true; }
    if (it.eTag && m.eTag !== it.eTag) { m.eTag = it.eTag; changed = true; }
    // accountId 老 entry 没 stamp 过 → 乐观打上当前账号 (listChildren 拿到 = 一定是当前账号的)
    if (currentAccountId && !m.accountId) { m.accountId = currentAccountId; changed = true; }
    if (m.remoteFound === false) {
      // 鬼复活:云端那东西又被 list 看到了 (用户挪回 / 换号换回 / 网页端恢复)
      m.remoteFound = true;
      changed = true;
      unghosted++;
    }
    if (changed) {
      const db = await openDb();
      const tx = db.transaction(STORE_META, "readwrite");
      tx.objectStore(STORE_META).put(m);
      await awaitTx(tx);
      updated++;
    }
  }

  // 鬼检测:cache 里 source:"onedrive" + 同 folderPath + **属于当前账号** 但不在 list 里
  let ghosted = 0;
  const all = await listMeta();
  const cachedInFolder = all.filter((m) =>
    m.source === "onedrive"
    && m.folderPath === folderPath
    && m.remoteFound !== false
    && (!currentAccountId || !m.accountId || m.accountId === currentAccountId)
  );
  // 空 list 安全网
  if (items.length === 0 && cachedInFolder.length > 0) {
    return { updated, ghosted: 0, unghosted };
  }
  for (const m of cachedInFolder) {
    if (remoteIds.has(m.itemId)) continue;
    m.remoteFound = false;
    const db = await openDb();
    const tx = db.transaction(STORE_META, "readwrite");
    tx.objectStore(STORE_META).put(m);
    await awaitTx(tx);
    ghosted++;
  }

  return { updated, ghosted, unghosted };
}

// 清空所有未钉住的云端缓存。**本地文件(source="local")永远不动**,constraint #2。
export async function clearUnpinned() {
  const all = await listMeta();
  for (const m of all) {
    if (m.source === "local") continue;
    if (!m.pinned) await del(m.itemId);
  }
}

export async function stats() {
  const all = await listMeta();
  const total = all.reduce((acc, m) => acc + (m.size || 0), 0);
  const pinnedCount = all.filter((m) => m.pinned).length;
  const pinnedBytes = all.filter((m) => m.pinned).reduce((acc, m) => acc + (m.size || 0), 0);
  return { count: all.length, totalBytes: total, capBytes, pinnedCount, pinnedBytes };
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
