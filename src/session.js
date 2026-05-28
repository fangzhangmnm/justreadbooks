// session.json (SSOT 阅读状态)。
//
// Schema:
// {
//   lastActive: itemId | null,
//   docs: {
//     [itemId]: {
//       position: { pageIndex, yFraction }, // PDF: pageIndex = 页号-1; TXT: pageIndex = 章节序号
//       kind: "pdf" | "txt",
//       addedAt
//     }
//   }
// }
//
// 章节切分规则 / encoding 这些"per-book metadata"放在 library.json,不进 session
// (session 越小越频繁写盘越好,library 几乎只读)。
//
// 设计原则(抄 JustReadPapers,**核心一致**):
//  - 内存 state 是 SSOT,UI 直接读
//  - 写盘 = debounce + ceiling 节流
//  - trivial 改动只更新内存,不调度 PUT (避免 OneDrive 版本爆)
//  - 412 → re-fetch + merge ("活跃 doc 本地优先") + retry
//  - 文件存在 / 文件名 等不进 session,只列 approot 拿
//  - localStorage 备份让离线冷启动也能立刻 resume

import { readApprootJson, writeApprootJson, encodeApprootPath } from "./graph.js";
import { getToken, isAuthConfigured } from "./auth.js";
import {
  SESSION_FILE,
  POSITION_DEBOUNCE_MS, POSITION_HEARTBEAT_MS,
  TRIVIAL_POSITION_Y_DELTA, TRIVIAL_POSITION_Y_DELTA_TXT,
} from "./config.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

function emptyState() { return { lastActive: null, lastActiveAt: 0, docs: {} }; }

const LOCAL_BACKUP_KEY = "jrb.session.backup";
function writeLocalBackup() {
  try { localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(state)); } catch (_) {}
}
function readLocalBackup() {
  try {
    const raw = localStorage.getItem(LOCAL_BACKUP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

let state = emptyState();
let knownETag = null;
let dirty = false;
let firstDirtyAt = 0;
let writeTimer = null;
let writeInFlight = null;
let lastSyncedAt = 0;
let lastError = null;
let listeners = new Set();
let lastPushedPositions = {};

function notify() {
  for (const fn of listeners) { try { fn(state); } catch (_) {} }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() { return state; }

export function getSyncSnapshot() {
  return { dirty, writeInFlight: !!writeInFlight, lastSyncedAt, lastError };
}

// ── init ──────────────────────────────────────────────────────────────────

export async function initSession() {
  const backup = readLocalBackup();
  const backupState = backup ? normalize(backup) : null;
  if (backupState) state = backupState;

  // 没配 Azure → 纯本地,localStorage backup 就是 SSOT,别去碰 Graph
  if (!isAuthConfigured()) {
    if (!backupState) state = emptyState();
    capturePushedPositions(state);
    writeLocalBackup();
    notify();
    return state;
  }

  // 关键改动 (修"登录前本地进度丢失" + "老设备覆盖新进度"):
  //   不再"remote 有就 overwrite local",而是 backup ⨁ remote 按时间戳 merge。
  //   - backup 比 remote 新的字段 → 用 backup,推回云端
  //   - remote 比 backup 新的字段 → 用 remote
  //   - 双边都没时间戳 (老 schema) → 都算 0,任一胜出,但相同时偏向 remote(更稳)
  try {
    const { data, eTag } = await readApprootJson(SESSION_FILE);
    if (data) {
      const remoteState = normalize(data);
      knownETag = eTag;
      if (backupState) {
        const merged = mergeByTimestamp(backupState, remoteState);
        state = merged;
        // 如果 merged 跟 remote 不一样,说明 backup 有新东西 → 标 dirty 推回云端
        if (!sameState(merged, remoteState)) {
          dirty = true;
          if (firstDirtyAt === 0) firstDirtyAt = Date.now();
          scheduleWrite(0);  // 立刻推,别等用户操作触发
        }
      } else {
        state = remoteState;
      }
    } else if (!backupState) {
      // 双边都没 → 写空 session.json
      state = emptyState();
      knownETag = null;
      try {
        const item = await writeApprootJson(SESSION_FILE, state, null);
        knownETag = item.eTag;
      } catch (_) {}
    } else {
      // remote 空,backup 有 → backup 就是 SSOT,推上去
      // (典型场景:用户本地模式读了一阵,第一次登录,云端没 session.json)
      try {
        const item = await writeApprootJson(SESSION_FILE, state, null);
        knownETag = item.eTag;
      } catch (_) {}
    }
  } catch (e) {
    console.warn("initSession remote failed, using local backup:", e?.message);
  }
  capturePushedPositions(state);
  writeLocalBackup();
  notify();
  return state;
}

function normalize(raw) {
  const s = emptyState();
  if (raw && typeof raw === "object") {
    if (typeof raw.lastActive === "string") s.lastActive = raw.lastActive;
    if (Number.isFinite(raw.lastActiveAt)) s.lastActiveAt = raw.lastActiveAt;
    if (raw.docs && typeof raw.docs === "object") {
      for (const [id, d] of Object.entries(raw.docs)) {
        if (!d || typeof d !== "object") continue;
        const entry = {};
        if (d.position && Number.isFinite(d.position.pageIndex)) {
          entry.position = {
            pageIndex: Math.max(0, Math.floor(d.position.pageIndex)),
            yFraction: clamp01(d.position.yFraction ?? 0),
          };
        }
        if (typeof d.kind === "string") entry.kind = d.kind;
        if (Number.isFinite(d.addedAt)) entry.addedAt = d.addedAt;
        // 新增时间戳 (老数据没有 = undefined,merge 时算 0)
        if (Number.isFinite(d.positionAt)) entry.positionAt = d.positionAt;
        if (Number.isFinite(d.lastReadAt)) entry.lastReadAt = d.lastReadAt;
        s.docs[id] = entry;
      }
    }
  }
  return s;
}

// 安全 merge:remote 跟 local 按 per-doc 时间戳分别取胜者。
// **不再**用"local 活跃 doc 一律赢"那种 LWW —— 那会让老设备覆盖新进度。
//
// 规则:
//   - 单边有 → 用那边
//   - 双边都有 → 用 positionAt 大的(更新的赢)
//   - positionAt 缺失 → 算 0(老 schema 一律输给有时间戳的新写入)
//   - lastActive 同样按 lastActiveAt 比
function mergeByTimestamp(local, remote) {
  const out = { lastActive: null, lastActiveAt: 0, docs: {} };
  const ids = new Set([
    ...Object.keys(local.docs || {}),
    ...Object.keys(remote.docs || {}),
  ]);
  for (const id of ids) {
    const l = local.docs?.[id];
    const r = remote.docs?.[id];
    if (!l) { out.docs[id] = r; continue; }
    if (!r) { out.docs[id] = l; continue; }
    // 双边都有 — 按 positionAt 选 position,addedAt 取 min,kind 取存在的
    const lAt = l.positionAt || 0;
    const rAt = r.positionAt || 0;
    const winner = lAt >= rAt ? l : r;
    const loser = lAt >= rAt ? r : l;
    const m = { ...loser, ...winner };
    // addedAt 取最小(谁先加的)
    if (l.addedAt && r.addedAt) m.addedAt = Math.min(l.addedAt, r.addedAt);
    // lastReadAt 取大的(最近读的)
    const lRead = l.lastReadAt || 0;
    const rRead = r.lastReadAt || 0;
    if (lRead || rRead) m.lastReadAt = Math.max(lRead, rRead);
    out.docs[id] = m;
  }
  const lAct = local.lastActiveAt || 0;
  const rAct = remote.lastActiveAt || 0;
  if (lAct >= rAct) {
    out.lastActive = local.lastActive;
    out.lastActiveAt = lAct;
  } else {
    out.lastActive = remote.lastActive;
    out.lastActiveAt = rAct;
  }
  return out;
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

// 浅深 hybrid 等价比较 —— 只用来判 initSession 后是否需要推回云。
// session state 是固定形状,JSON.stringify 比对够用。
function sameState(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); }
  catch (_) { return false; }
}

// ── mutations ────────────────────────────────────────────────────────────

export function setPosition(itemId, position, kind) {
  if (!itemId) return;
  const newPos = {
    pageIndex: Math.max(0, Math.floor(position.pageIndex ?? 0)),
    yFraction: clamp01(position.yFraction ?? 0),
  };
  if (!state.docs[itemId]) state.docs[itemId] = {};
  state.docs[itemId].position = newPos;
  state.docs[itemId].positionAt = Date.now();   // 时间戳:merge 时分胜负用
  if (kind) state.docs[itemId].kind = kind;

  const ref = lastPushedPositions[itemId];
  const trivialDelta = kind === "txt" ? TRIVIAL_POSITION_Y_DELTA_TXT : TRIVIAL_POSITION_Y_DELTA;
  const isTrivial = ref
    && ref.pageIndex === newPos.pageIndex
    && Math.abs(ref.yFraction - newPos.yFraction) < trivialDelta;
  if (isTrivial) {
    dirty = true;
    if (firstDirtyAt === 0) firstDirtyAt = Date.now();
    return;
  }
  scheduleWrite();
}

export function setLastActive(itemId) {
  if (state.lastActive === itemId) return;
  state.lastActive = itemId;
  state.lastActiveAt = Date.now();   // 时间戳:跨设备 merge 选最近 active
  if (itemId && !state.docs[itemId]) {
    state.docs[itemId] = { addedAt: Date.now() };
  }
  scheduleWrite(0);
}

// 标记某书"刚被打开过" (lastReadAt)。app.js 在 openBook 时调,
// 跟 setLastActive 类似但语义不同:
//   - lastActive: 当前正在读的(全局只有一个)
//   - lastReadAt: 这本书最后一次被打开 (每本书一个)
// 用于"最近阅读" list 排序。
export function markDocRead(itemId) {
  if (!itemId) return;
  if (!state.docs[itemId]) state.docs[itemId] = { addedAt: Date.now() };
  state.docs[itemId].lastReadAt = Date.now();
  scheduleWrite();   // 不用 0,跟着别的 mutation 走 debounce
}

export function ensureDoc(itemId, { addedAt, kind } = {}) {
  if (!state.docs[itemId]) {
    state.docs[itemId] = { addedAt: addedAt ?? Date.now() };
    if (kind) state.docs[itemId].kind = kind;
    scheduleWrite();
  } else if (kind && !state.docs[itemId].kind) {
    state.docs[itemId].kind = kind;
    scheduleWrite();
  }
}

export function forgetDoc(itemId) {
  if (state.docs[itemId]) {
    delete state.docs[itemId];
    if (state.lastActive === itemId) state.lastActive = null;
    scheduleWrite(0);
  }
}

export function getPosition(itemId) {
  return state.docs[itemId]?.position ?? null;
}

export function getDocKind(itemId) {
  return state.docs[itemId]?.kind ?? null;
}

// ── write scheduling ─────────────────────────────────────────────────────

function scheduleWrite(delay = POSITION_DEBOUNCE_MS) {
  dirty = true;
  if (firstDirtyAt === 0) firstDirtyAt = Date.now();
  writeLocalBackup();
  // 没配 Azure → 没必要调度 flush(localStorage backup 已经写过了)
  if (!isAuthConfigured()) { dirty = false; firstDirtyAt = 0; return; }
  if (writeTimer) clearTimeout(writeTimer);
  const now = Date.now();
  const target = delay === 0
    ? now
    : Math.min(now + delay, firstDirtyAt + POSITION_HEARTBEAT_MS);
  const wait = Math.max(0, target - now);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flush().catch((e) => console.warn("session flush failed:", e));
  }, wait);
}

export async function flush() {
  if (!isAuthConfigured()) return;
  if (!dirty && !writeInFlight) return;
  if (writeInFlight) {
    try { await writeInFlight; } catch (_) {}
    if (!dirty) return;
  }
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }

  dirty = false;
  const ceilingMarkAtSnapshot = firstDirtyAt;
  firstDirtyAt = 0;
  const snapshot = JSON.parse(JSON.stringify(state));
  const eTagAtSnapshot = knownETag;

  writeInFlight = (async () => {
    try {
      const item = await writeApprootJson(SESSION_FILE, snapshot, eTagAtSnapshot);
      knownETag = item.eTag;
      capturePushedPositions(snapshot);
      lastSyncedAt = Date.now();
      lastError = null;
      writeLocalBackup();
    } catch (e) {
      if (e.status === 412) {
        await mergeRemoteAndRetry(snapshot);
      } else {
        dirty = true;
        if (firstDirtyAt === 0) firstDirtyAt = ceilingMarkAtSnapshot || Date.now();
        lastError = e?.message || String(e);
        throw e;
      }
    }
  })();

  try { await writeInFlight; }
  finally { writeInFlight = null; }
}

async function mergeRemoteAndRetry(localSnapshot) {
  const { data: remote, eTag: remoteETag } = await readApprootJson(SESSION_FILE);
  const remoteState = remote ? normalize(remote) : emptyState();

  // 按时间戳合并 —— 老设备 long-offline 后过来不会用陈旧 position 覆盖新的。
  // 详见 mergeByTimestamp 注释 + docs/03-cross-device-sync.md。
  const merged = mergeByTimestamp(localSnapshot, remoteState);

  try {
    const item = await writeApprootJson(SESSION_FILE, merged, remoteETag);
    knownETag = item.eTag;
    state = merged;
    capturePushedPositions(merged);
    notify();
  } catch (e) {
    if (e.status === 412) {
      dirty = true;
    } else {
      dirty = true;
      throw e;
    }
  }
}

function capturePushedPositions(snap) {
  const map = {};
  for (const [id, d] of Object.entries(snap.docs || {})) {
    if (d.position) map[id] = { ...d.position };
  }
  lastPushedPositions = map;
}

// ── reconcile on window focus ────────────────────────────────────────────

export async function checkRemoteChanged() {
  if (!isAuthConfigured()) return false;
  if (!knownETag) return false;
  try {
    const token = await getToken();
    const r = await fetch(
      `${GRAPH_BASE}/me/drive/special/approot:/${encodeApprootPath(SESSION_FILE)}?$select=id,eTag`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!r.ok) return false;
    const meta = await r.json();
    return meta.eTag && meta.eTag !== knownETag;
  } catch (_) { return false; }
}

export async function reloadFromRemote() {
  if (!isAuthConfigured()) return state;
  if (dirty) { try { await flush(); } catch (_) {} }
  const { data, eTag } = await readApprootJson(SESSION_FILE);
  if (data) {
    state = normalize(data);
    knownETag = eTag;
    notify();
  }
  return state;
}

// ── keepalive flush ───────────────────────────────────────────────────────

export function flushKeepalive() {
  if (!isAuthConfigured()) return;
  if (!dirty) return;
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
  const snapshot = state;
  const eTag = knownETag;
  getToken().then((token) => {
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    if (eTag) headers["If-Match"] = eTag;
    fetch(
      `${GRAPH_BASE}/me/drive/special/approot:/${encodeApprootPath(SESSION_FILE)}:/content?@microsoft.graph.conflictBehavior=replace`,
      { method: "PUT", headers, body: JSON.stringify(snapshot), keepalive: true },
    ).catch(() => {});
  }).catch(() => {});
}

// ── library.json: per-book metadata (chapter regex / encoding) ─────────────
// library 写盘频率低,简化:不带 If-Match merge,直接 last-write-wins。
// {
//   books: {
//     [itemId]: {
//       chapterRegexId?: string,   // 用 BUILTIN 里的 id (例如 "md1", "zh-chap")
//       chapterRegexCustom?: string, // 用户自定义正则源(优先级 > Id)
//       encoding?: string,         // 上次成功解码用的 encoding (UI 显示用)
//     }
//   }
// }

import { LIBRARY_FILE } from "./config.js";

let library = { books: {} };
let libraryETag = null;
let libraryLoaded = false;
let libraryWriteTimer = null;
const LIBRARY_BACKUP_KEY = "jrb.library.backup";

function readLibraryBackup() {
  try {
    const raw = localStorage.getItem(LIBRARY_BACKUP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}
function writeLibraryBackup() {
  try { localStorage.setItem(LIBRARY_BACKUP_KEY, JSON.stringify(library)); } catch (_) {}
}

export async function initLibrary() {
  const backup = readLibraryBackup();
  if (backup && backup.books) library = backup;

  if (!isAuthConfigured()) {
    libraryLoaded = true;
    if (!backup) library = { books: {} };
    return library;
  }

  try {
    const { data, eTag } = await readApprootJson(LIBRARY_FILE);
    if (data?.books) {
      library = { books: { ...(data.books || {}) } };
      libraryETag = eTag;
    } else if (!backup) {
      library = { books: {} };
      try {
        const item = await writeApprootJson(LIBRARY_FILE, library, null);
        libraryETag = item.eTag;
      } catch (_) {}
    }
  } catch (e) {
    console.warn("initLibrary remote failed:", e?.message);
  }
  libraryLoaded = true;
  writeLibraryBackup();
  return library;
}

export function getBookMeta(itemId) {
  return library.books?.[itemId] || null;
}

export function setBookMeta(itemId, patch) {
  if (!library.books) library.books = {};
  library.books[itemId] = { ...(library.books[itemId] || {}), ...patch };
  writeLibraryBackup();
  scheduleLibraryWrite();
}

function scheduleLibraryWrite() {
  if (!isAuthConfigured()) return; // 本地模式只走 localStorage backup
  if (libraryWriteTimer) clearTimeout(libraryWriteTimer);
  libraryWriteTimer = setTimeout(() => {
    libraryWriteTimer = null;
    flushLibrary().catch((e) => console.warn("library flush failed:", e));
  }, 2000);
}

export async function flushLibrary() {
  if (!isAuthConfigured()) return;
  if (!libraryLoaded) return;
  try {
    const item = await writeApprootJson(LIBRARY_FILE, library, libraryETag);
    libraryETag = item.eTag;
    writeLibraryBackup();
  } catch (e) {
    if (e.status === 412) {
      // 远端被改 → reload + merge (本地优先)
      try {
        const { data, eTag } = await readApprootJson(LIBRARY_FILE);
        const remote = data?.books || {};
        const merged = { books: { ...remote, ...(library.books || {}) } };
        const item = await writeApprootJson(LIBRARY_FILE, merged, eTag);
        library = merged;
        libraryETag = item.eTag;
        writeLibraryBackup();
      } catch (e2) {
        console.warn("library merge retry failed:", e2);
      }
    } else {
      throw e;
    }
  }
}
