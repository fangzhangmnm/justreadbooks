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

function emptyState() { return { lastActive: null, docs: {} }; }

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
  if (backup) state = normalize(backup);

  // 没配 Azure → 纯本地,localStorage backup 就是 SSOT,别去碰 Graph
  if (!isAuthConfigured()) {
    if (!backup) state = emptyState();
    capturePushedPositions(state);
    writeLocalBackup();
    notify();
    return state;
  }

  try {
    const { data, eTag } = await readApprootJson(SESSION_FILE);
    if (data) {
      state = normalize(data);
      knownETag = eTag;
    } else if (!backup) {
      state = emptyState();
      knownETag = null;
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
        s.docs[id] = entry;
      }
    }
  }
  return s;
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
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
  if (itemId && !state.docs[itemId]) {
    state.docs[itemId] = { addedAt: Date.now() };
  }
  scheduleWrite(0);
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

  // remote base + 本地"活跃 doc"的位置和 lastActive 盖上
  const merged = JSON.parse(JSON.stringify(remoteState));
  if (localSnapshot.lastActive) merged.lastActive = localSnapshot.lastActive;
  for (const [id, d] of Object.entries(localSnapshot.docs)) {
    if (!merged.docs[id]) merged.docs[id] = {};
    if (d.position) merged.docs[id].position = d.position;
    if (d.kind && !merged.docs[id].kind) merged.docs[id].kind = d.kind;
    if (d.addedAt && !merged.docs[id].addedAt) merged.docs[id].addedAt = d.addedAt;
  }

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
