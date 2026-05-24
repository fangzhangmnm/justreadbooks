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

// 列出所有等待推云的本地文件。
// **简化语义** (constraint #4):source==="local" 就意味着"云端没有,等待推"。
// 不需要额外的 pendingUpload flag — 推成功后会 rekeyLocalToOnedrive 改 source,
// 自然就不再被列出。
export async function listPendingUploads() {
  const all = await listMeta();
  return all.filter((m) => m.source === "local");
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

// 本地 (source:"local") 文件改名 —— 不动云端 (没云端副本),
// 只改 meta.name + 清掉 uploadCollision(下次 drain 重新检查)
export async function renameLocal(itemId, newName) {
  const m = await getMeta(itemId);
  if (!m) return false;
  if (m.source !== "local") return false; // 云端的走 graph.renameItem
  m.name = newName;
  m.uploadCollision = false;  // 改名后让 drain 重新判
  const db = await openDb();
  const tx = db.transaction(STORE_META, "readwrite");
  tx.objectStore(STORE_META).put(m);
  await awaitTx(tx);
  return true;
}

// 用 listChildren 结果同步 cache.meta —— constraint #5:用户在 OneDrive 网页
// 改名 / 改文件夹 / 改 eTag 后,本地 cache 元数据要跟上,不然 UI 显示旧名字。
// items: listChildren 返回的 driveItem[],folderPath: 它们所在的相对路径
// 返回:更新条数
export async function reconcileWithRemoteList(items, folderPath) {
  let updated = 0;
  for (const it of items) {
    if (!it.id || !it.file) continue;
    const m = await getMeta(it.id);
    if (!m) continue;
    let changed = false;
    if (it.name && m.name !== it.name) { m.name = it.name; changed = true; }
    if (m.folderPath !== folderPath) { m.folderPath = folderPath; changed = true; }
    if (it.eTag && m.eTag !== it.eTag) { m.eTag = it.eTag; changed = true; }
    if (m.remoteFound === false) { m.remoteFound = true; changed = true; }
    if (changed) {
      const db = await openDb();
      const tx = db.transaction(STORE_META, "readwrite");
      tx.objectStore(STORE_META).put(m);
      await awaitTx(tx);
      updated++;
    }
  }
  return updated;
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
