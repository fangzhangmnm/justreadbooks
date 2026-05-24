// 主编排:启动序列、UI 绑定、folder 树导航、TXT/PDF 双 viewer、本地+云端混合模式。
//
// 启动序列 (the jumpscare,抄 JustReadPapers):
//   1. viewer 先 init (不依赖 auth)
//   2. 并行:initAuth (silent probe) + initSession (从 localStorage backup hydrate)
//   3. 拿 lastActive → 看 cache 命中 → 立即 loadXxx,**全程不要把书架弹给用户挑**
//      (扼杀选择困难症,直接回到上次的书)
//   4. 没 lastActive 或拿不到 → 空态,提示"上传或登录"
//
// 离线 / 未登录 / OneDrive 抽风 全都不阻塞 boot —— 本地缓存里有的都能直接开。
//
// 数据源:
//   - OneDrive (已登录) → approot/books/<可任意层级>/<book.txt|pdf>
//   - 本地上传 → cache.js 直接进 IDB,itemId = "local:<rand>",source = "local"
//   - 缓存的 OneDrive 文件 → cache.js,itemId = OneDrive itemId
//   - 列表合并:当前文件夹下 OneDrive 子项 + (root 时) "本地" 虚拟文件夹 (展开 = 所有 local: 项)

import {
  initAuth, signIn, signOut, isSignedIn, getActiveAccount, isAuthConfigured,
} from "./auth.js";
import {
  listChildren, listChildrenOfFolderId, getItemMeta,
  downloadItemBlob, downloadItemText, uploadFileToApproot,
  renameItem, moveItemToFolder, deleteItem,
  ensureSubfolder, getApprootId, encodeApprootPath,
} from "./graph.js";
import {
  initSession, initLibrary, getState, setPosition, setLastActive, ensureDoc,
  forgetDoc, getPosition, getDocKind, flush, flushKeepalive,
  checkRemoteChanged, reloadFromRemote, getSyncSnapshot,
  getBookMeta, setBookMeta, flushLibrary,
} from "./session.js";
import * as cache from "./cache.js";
import { decodeFile, encodeUtf8, decodeBytes } from "./encoding.js";
import {
  autoSplit, splitByPreference, splitByBuiltin, splitByCustom,
  listBuiltinRegexes,
} from "./chapter-split.js";
import {
  initPdfViewer, loadPdf, restorePosition as restorePdfPosition,
  currentPosition as currentPdfPosition, teardownCurrent as teardownPdf,
  getOutline as getPdfOutline, jumpToDest as pdfJumpToDest,
  fitToWidth as pdfFitToWidth, zoomBy as pdfZoomBy,
  getNumPages as pdfGetNumPages, goToPage as pdfGoToPage,
} from "./viewer-pdf.js";
import {
  initTxtViewer, loadTxt, restorePosition as restoreTxtPosition,
  currentPosition as currentTxtPosition, teardownCurrent as teardownTxt,
  getChapters as txtGetChapters, getCurrentChapter as txtGetCurrentChapter,
  goToChapter as txtGoToChapter, getReaderPrefs as txtGetReaderPrefs,
  setReaderPrefs as txtSetReaderPrefs, reapplyChapters as txtReapplyChapters,
  currentCharOffset as txtCurrentCharOffset,
} from "./viewer-txt.js";
import {
  BOOKS_FOLDER, TRASH_FOLDER, RESERVED_NAMES, IDLE_MS, MIN_CACHE_CAP_MB,
} from "./config.js";

// 拼 approot 子路径,处理 BOOKS_FOLDER 为空 (= 直接放 approot 根) 的情况。
// e.g.  joinApprootPath("", "novels", "foo.txt") → "novels/foo.txt"
//       joinApprootPath("books", "", "bar.pdf") → "books/bar.pdf"
function joinApprootPath(...segments) {
  return segments.filter((s) => s !== null && s !== undefined && s !== "").join("/");
}

// ── DOM refs ─────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const pdfViewerContainer = $("pdfViewerContainer");
const txtViewerContainer = $("txtViewerContainer");
const emptyLanding = $("emptyLanding");
const emptyTitle = $("emptyTitle");
const emptyHint = $("emptyHint");
const emptyUploadButton = $("emptyUploadButton");
const progressBar = $("progressBar");
const progressFill = $("progressFill");
const menuButton = $("menuButton");
const outlineButton = $("outlineButton");
const settingsButton = $("settingsButton");
const currentTitle = $("currentTitle");
const pageStatus = $("pageStatus");
const syncStatus = $("syncStatus");
const drawer = $("drawer");
const drawerBackdrop = $("drawerBackdrop");
const drawerCloseButton = $("drawerCloseButton");
const drawerSortButton = $("drawerSortButton");
const drawerRefreshButton = $("drawerRefreshButton");
const drawerTitle = $("drawerTitle");
const authWho = $("authWho");
const loginButton = $("loginButton");
const logoutButton = $("logoutButton");
const breadcrumb = $("breadcrumb");
const booksActions = $("booksActions");
const trashActions = $("trashActions");
const fileInput = $("fileInput");
const uploadButton = $("uploadButton");
const newFolderButton = $("newFolderButton");
const openTrashButton = $("openTrashButton");
const backFromTrashButton = $("backFromTrashButton");
const emptyTrashButton = $("emptyTrashButton");
const docList = $("docList");
const docListEmpty = $("docListEmpty");
const cacheStatsText = $("cacheStatsText");
const themeButton = $("themeButton");
const themeLabel = $("themeLabel");
const updateToast = $("updateToast");
const updateToastReload = $("updateToastReload");
const updateToastDismiss = $("updateToastDismiss");
const idleOverlay = $("idleOverlay");
const dropOverlay = $("dropOverlay");
const outlineDrawer = $("outlineDrawer");
const outlineCloseButton = $("outlineCloseButton");
const outlineList = $("outlineList");
const outlineEmpty = $("outlineEmpty");
const outlineTitle = $("outlineTitle");
const settingsPanel = $("settingsPanel");
const settingsCloseButton = $("settingsCloseButton");
const cacheStatsDetail = $("cacheStatsDetail");
const cacheBarFill = $("cacheBarFill");
const cacheBarPinned = $("cacheBarPinned");
const cacheCapInput = $("cacheCapInput");
const clearUnpinnedButton = $("clearUnpinnedButton");
const clearAllCacheButton = $("clearAllCacheButton");
const txtFontSize = $("txtFontSize");
const txtLineHeight = $("txtLineHeight");
const txtMaxWidth = $("txtMaxWidth");
const txtFontFamily = $("txtFontFamily");
const txtChapterSection = $("txtChapterSection");
const chapterRegexSelect = $("chapterRegexSelect");
const chapterRegexCustom = $("chapterRegexCustom");
const chapterSplitStatus = $("chapterSplitStatus");
const reapplyChaptersButton = $("reapplyChaptersButton");
const themeSelect = $("themeSelect");

// ── UI state ─────────────────────────────────────────────────────────────

const SORT_KEY = "jrb.sort";
const THEME_KEY = "jrb.theme";
const VIEW_KEY = "jrb.view";       // "books" | "trash"
// constraint #1 (零账户一等公民):登过一次以后才会自动 silent。从没登过就不挡屏。
const EVER_SIGNED_IN_KEY = "jrb.everSignedIn";
function rememberEverSignedIn() {
  try { localStorage.setItem(EVER_SIGNED_IN_KEY, "1"); } catch (_) {}
}
function hasEverSignedIn() {
  try { return localStorage.getItem(EVER_SIGNED_IN_KEY) === "1"; } catch (_) { return false; }
}

let sortMode = localStorage.getItem(SORT_KEY) || "modified";
let drawerView = "books";

// 当前 drawer 在哪个文件夹。空 = books/(根),否则相对 books/ 的路径。
// 特殊值 "__local__" 表示"本地"虚拟文件夹。
let currentFolder = "";
let folderItemsCache = new Map(); // path → driveItem[]
let currentDocId = null;
let currentDocKind = null;        // "txt" | "pdf"
let currentDocText = null;        // TXT 原文本(切章重切用)
let currentDocChapters = null;    // 当前 TXT 章节切分
let trashFolderIdCache = null;
let idleTimer = null;
let pendingUploadDraining = false;

// ── 小工具 ───────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d)) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function fmtHM(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function detectKindByName(name) {
  if (/\.txt$/i.test(name)) return "txt";
  if (/\.pdf$/i.test(name)) return "pdf";
  if (/\.epub$/i.test(name)) return "epub";  // 未来
  return null;
}

function sanitizeFilename(name) {
  return String(name ?? "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 200);
}

function nameToTitle(name) {
  return (name || "").replace(/\.(txt|pdf|epub)$/i, "");
}

// ── sync status ──────────────────────────────────────────────────────────

let statusTransientUntil = 0;
function setSyncStatus(text, opts = {}) {
  syncStatus.textContent = text;
  syncStatus.classList.toggle("error", !!opts.error);
  syncStatus.classList.toggle("unsynced", !!opts.unsynced);
  syncStatus.classList.toggle("syncing", !!opts.syncing);
  if (opts.sticky !== true) {
    statusTransientUntil = Date.now() + (opts.duration || (opts.error ? 5000 : 1800));
  }
}

function computeSyncStatus() {
  if (!isSignedIn()) return { text: "离线" };  // 本地模式不焦虑
  if (!currentDocId) return { text: "就绪" };
  const s = getSyncSnapshot();
  if (s.lastError && s.dirty) return { text: "同步失败 · 重试中", error: true };
  if (s.writeInFlight) return { text: "同步中…", syncing: true };
  if (s.dirty) return { text: "未同步", unsynced: true };
  if (s.lastSyncedAt > 0) return { text: `已同步 ${fmtHM(s.lastSyncedAt)}` };
  return { text: "已同步" };
}

function tickSyncStatus() {
  if (Date.now() < statusTransientUntil) return;
  const r = computeSyncStatus();
  syncStatus.textContent = r.text;
  syncStatus.classList.toggle("error", !!r.error);
  syncStatus.classList.toggle("unsynced", !!r.unsynced);
  syncStatus.classList.toggle("syncing", !!r.syncing);
}
setInterval(tickSyncStatus, 500);

function showProgress(v) {
  if (v == null) { progressBar.classList.add("hidden"); return; }
  progressBar.classList.remove("hidden");
  progressFill.style.width = `${Math.min(100, Math.max(0, v * 100))}%`;
}

function showLanding({ title, hint, showUpload }) {
  emptyTitle.textContent = title;
  emptyHint.textContent = hint;
  emptyUploadButton.hidden = !showUpload;
  emptyLanding.classList.remove("hidden");
}
function hideLanding() { emptyLanding.classList.add("hidden"); }

// ── Drawer / panel mutex ────────────────────────────────────────────────

let openPanel = null; // "books" | "outline" | "settings" | null

function closeAllPanels() {
  drawer.classList.add("hidden");
  outlineDrawer.classList.add("hidden");
  settingsPanel.classList.add("hidden");
  drawerBackdrop.classList.add("hidden");
  openPanel = null;
}

function openBooksDrawer() {
  closeAllPanels();
  drawer.classList.remove("hidden");
  drawerBackdrop.classList.remove("hidden");
  openPanel = "books";
  renderDocList();
}

function openOutlinePanel() {
  closeAllPanels();
  outlineDrawer.classList.remove("hidden");
  drawerBackdrop.classList.remove("hidden");
  openPanel = "outline";
}

function openSettingsPanel() {
  closeAllPanels();
  settingsPanel.classList.remove("hidden");
  drawerBackdrop.classList.remove("hidden");
  openPanel = "settings";
  refreshSettingsPanel();
}

function togglePanel(name) {
  if (openPanel === name) closeAllPanels();
  else if (name === "books") openBooksDrawer();
  else if (name === "outline") openOutlinePanel();
  else if (name === "settings") openSettingsPanel();
}

// ── Auth UI ──────────────────────────────────────────────────────────────

function refreshAuthRow(account) {
  if (account) {
    authWho.textContent = account.username || account.name || "已登录";
    loginButton.hidden = true;
    logoutButton.hidden = false;
  } else if (!isAuthConfigured()) {
    authWho.textContent = "本地模式(未配置 OneDrive)";
    loginButton.hidden = true;
    logoutButton.hidden = true;
  } else {
    authWho.textContent = "未登录(本地模式)";
    loginButton.hidden = false;
    logoutButton.hidden = true;
  }
}

// ── 列文件夹内容 ─────────────────────────────────────────────────────────
// path = "" → books/ 根 (合并 OneDrive 列表 + "本地" 虚拟项)
// path = "__local__" → 列所有 cache 里 source==="local" 的项
// path = "其它" → books/<path>/ 下的子项 (纯 OneDrive)

async function loadCurrentFolderItems() {
  if (drawerView === "trash") {
    if (!isSignedIn()) return [];
    try {
      const items = await listChildren(TRASH_FOLDER);
      return items.filter((i) => i.file && detectKindByName(i.name));
    } catch (_) { return []; }
  }

  // 本地虚拟文件夹:cache.meta 里 source==="local" 的就是
  if (currentFolder === "__local__") {
    const local = await cache.listLocalFiles();
    return local.map((m) => ({
      id: m.itemId,
      name: m.name || m.itemId,
      file: { mimeType: m.type || "application/octet-stream" },
      size: m.size || 0,
      lastModifiedDateTime: new Date(m.lastAccessed || Date.now()).toISOString(),
      _local: true,
      _pendingUpload: !!m.pendingUpload,
    }));
  }

  // OneDrive 文件夹
  let items = [];
  if (isSignedIn()) {
    const subPath = joinApprootPath(BOOKS_FOLDER, currentFolder);
    try {
      const cached = folderItemsCache.get(subPath);
      if (cached) {
        items = cached;
      } else {
        items = await listChildren(subPath);
        folderItemsCache.set(subPath, items);
        // constraint #5: 用户在 OneDrive 网页改了名 / 挪了文件夹 → cache.meta 跟上
        cache.reconcileWithRemoteList(items, currentFolder).catch(() => {});
      }
    } catch (e) {
      console.warn("listChildren failed", e?.message);
    }
    // 文件夹和文件混合;文件只保留可读类型;**根目录**还要过滤掉 RESERVED_NAMES
    // (session.json / library.json / .trash 是 app 内部用的,不该出现在书架里)
    items = items.filter((i) => {
      if (currentFolder === "" && i.name && RESERVED_NAMES.has(i.name)) return false;
      return i.folder || (i.file && detectKindByName(i.name));
    });
  }

  // 根目录:append 一个虚拟"本地"文件夹。
  // 已登录时,所有 source:"local" 文件都是"待上传";未登录时它们是"纯本地"
  if (currentFolder === "" && drawerView === "books") {
    const local = await cache.listLocalFiles();
    if (local.length > 0) {
      const label = isSignedIn()
        ? `本地文件 (${local.length} 待上传)`
        : "本地文件";
      items = [
        {
          id: "__local__",
          name: label,
          folder: { childCount: local.length },
          _virtualLocal: true,
        },
        ...items,
      ];
    }
  }

  return items;
}

function sortItems(items) {
  // 文件夹永远在前
  const folders = items.filter((i) => i.folder);
  const files = items.filter((i) => !i.folder);
  const sorter = sortMode === "name"
    ? (a, b) => (a.name || "").localeCompare(b.name || "", "zh")
    : (a, b) => {
        const ta = Date.parse(a.lastModifiedDateTime || "") || 0;
        const tb = Date.parse(b.lastModifiedDateTime || "") || 0;
        return tb - ta;
      };
  folders.sort(sorter);
  files.sort(sorter);
  return [...folders, ...files];
}

function renderBreadcrumb() {
  breadcrumb.innerHTML = "";
  // 根
  const rootBtn = document.createElement("button");
  rootBtn.className = "breadcrumb-seg";
  rootBtn.textContent = "书架";
  rootBtn.addEventListener("click", () => { navigateTo(""); });
  breadcrumb.appendChild(rootBtn);

  if (currentFolder === "__local__") {
    const sep = document.createElement("span");
    sep.className = "breadcrumb-sep"; sep.textContent = "›"; breadcrumb.appendChild(sep);
    const seg = document.createElement("span");
    seg.className = "breadcrumb-seg"; seg.textContent = "本地文件"; seg.style.cursor = "default";
    breadcrumb.appendChild(seg);
    return;
  }

  if (!currentFolder) return;
  const segs = currentFolder.split("/").filter(Boolean);
  let accum = "";
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    accum = accum ? `${accum}/${seg}` : seg;
    const sep = document.createElement("span");
    sep.className = "breadcrumb-sep"; sep.textContent = "›"; breadcrumb.appendChild(sep);
    if (i === segs.length - 1) {
      const span = document.createElement("span");
      span.className = "breadcrumb-seg"; span.textContent = seg; span.style.cursor = "default";
      breadcrumb.appendChild(span);
    } else {
      const path = accum;
      const btn = document.createElement("button");
      btn.className = "breadcrumb-seg"; btn.textContent = seg;
      btn.addEventListener("click", () => navigateTo(path));
      breadcrumb.appendChild(btn);
    }
  }
}

function navigateTo(path) {
  currentFolder = path;
  renderDocList();
}

async function renderDocList() {
  renderBreadcrumb();
  // 在本地模式 / trash 模式下隐藏 / 显示对应 actions
  if (drawerView === "trash") {
    booksActions.classList.add("hidden");
    trashActions.classList.remove("hidden");
    drawerTitle.textContent = "垃圾箱";
  } else {
    booksActions.classList.remove("hidden");
    trashActions.classList.add("hidden");
    drawerTitle.textContent = currentFolder === "__local__" ? "本地文件" : "书架";
  }

  // 上传 / 新建文件夹仅 OneDrive 路径下可用 (本地虚拟夹也允许 upload)
  newFolderButton.hidden = !isSignedIn() || currentFolder === "__local__";

  docList.innerHTML = "";
  docListEmpty.classList.remove("hidden");
  docListEmpty.textContent = "加载中…";

  let items = [];
  try { items = await loadCurrentFolderItems(); }
  catch (e) {
    console.warn(e);
    docListEmpty.textContent = `加载失败: ${e.message}`;
    return;
  }
  items = sortItems(items);

  if (items.length === 0) {
    docListEmpty.classList.remove("hidden");
    if (drawerView === "trash") docListEmpty.textContent = "垃圾箱是空的。";
    else if (currentFolder === "__local__") docListEmpty.textContent = "还没有本地文件。";
    else if (!isSignedIn()) docListEmpty.textContent = "本地模式 · 点上面「上传」选 TXT/PDF。";
    else docListEmpty.textContent = "这个文件夹是空的。";
    updateCacheStats();
    return;
  }
  docListEmpty.classList.add("hidden");

  // 并发查 cache
  const cacheMeta = new Map();
  await Promise.all(items.filter((i) => i.file).map(async (it) => {
    try { cacheMeta.set(it.id, await cache.getMeta(it.id)); }
    catch (_) {}
  }));

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "doc-row";
    li.dataset.itemId = item.id;
    if (item.id === currentDocId) li.classList.add("active");

    if (item.folder) {
      // 文件夹行
      li.innerHTML = `
        <span class="icon" title="文件夹">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
        </span>
        <span class="name">${escapeHtml(item.name)}</span>
        <span class="meta">${item.folder.childCount ?? ""} 项</span>
      `;
      li.addEventListener("click", () => {
        if (item._virtualLocal) navigateTo("__local__");
        else {
          const newPath = currentFolder ? `${currentFolder}/${item.name}` : item.name;
          navigateTo(newPath);
        }
      });
      docList.appendChild(li);
      continue;
    }

    // 文件行
    const kind = detectKindByName(item.name) || "?";
    const meta = cacheMeta.get(item.id);
    const cached = !!meta;
    const pinned = !!meta?.pinned;
    const isLocal = !!item._local;
    const pendingUpload = !!item._pendingUpload || !!meta?.pendingUpload;
    const isGhost = meta?.remoteFound === false;
    if (cached) li.classList.add("cached");
    const dateText = fmtDate(item.lastModifiedDateTime);

    // tag 优先级:
    //   - source:"local" + 已登录 → 待上传 (登录后会自动 drain)
    //   - source:"local" + 未登录 → 本地 (没账号,无处可推)
    //   - ghost (云端找不到了但本地缓存还有) → 已不在云端
    //   - 默认 → 文件扩展名
    let tag = kind.toUpperCase();
    let tagTitle = "";
    let tagCls = "";
    if (isLocal && isSignedIn()) { tag = "待上传"; tagCls = "pending"; tagTitle = "本地副本,马上会自动推到 OneDrive"; }
    else if (isLocal) { tag = "本地"; tagTitle = "用户上传的本地文件(登录 OneDrive 后会自动同步)"; }
    else if (isGhost) { tag = "已不在云端"; tagCls = "ghost"; tagTitle = "云端找不到了(可能你在 OneDrive 网页删了),本地缓存还能看"; }

    li.innerHTML = `
      <span class="cache-dot" title="${cached ? '已缓存' : '未缓存'}"></span>
      <span class="ext-tag ${tagCls}" title="${escapeHtml(tagTitle)}">${escapeHtml(tag)}</span>
      <span class="name">${escapeHtml(nameToTitle(item.name))}</span>
      <span class="meta">${escapeHtml(dateText)}</span>
      <span class="row-actions">
        ${ drawerView === "books" ? `
          ${ !cached && !isLocal ? `
            <button data-act="cache" title="缓存到本地(飞机上能看)" aria-label="缓存">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="8 12 12 16 16 12"></polyline><line x1="12" y1="2" x2="12" y2="16"></line></svg>
            </button>
          ` : `
            <button data-act="pin" class="${pinned ? 'pinned' : ''}" title="${pinned ? '已钉住:容量满也不会被淘汰' : '钉住:容量满也保留'}" aria-label="钉住">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="${pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14l-2-5V5a3 3 0 0 0-3-3h-4a3 3 0 0 0-3 3v7l-2 5z"></path></svg>
            </button>
            <button data-act="uncache" title="从本地缓存删除" aria-label="清缓存">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg>
            </button>
          ` }
          ${ !isLocal ? `
            <button data-act="rename" title="改名" aria-label="改名">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            </button>
            <button data-act="trash" title="移到垃圾箱" aria-label="移到垃圾箱">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg>
            </button>
          ` : `
            <button data-act="deleteLocal" title="删除(永久)" aria-label="删除">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          ` }
        ` : `
          <button data-act="restore" title="还原" aria-label="还原">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>
          </button>
          <button data-act="purge" title="永久删除" aria-label="永久删除">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        ` }
      </span>
    `;
    li.addEventListener("click", (e) => {
      if (e.target.closest(".row-actions")) return;
      if (drawerView === "books") openBook(item);
    });
    const acts = li.querySelector(".row-actions");
    acts?.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === "cache") downloadAndCache(item);
      else if (act === "pin") togglePinned(item);
      else if (act === "uncache") uncacheItem(item);
      else if (act === "rename") startRename(li, item);
      else if (act === "trash") trashBook(item);
      else if (act === "deleteLocal") deleteLocalBook(item);
      else if (act === "restore") restoreBook(item);
      else if (act === "purge") purgeBook(item);
    });
    docList.appendChild(li);
  }
  updateCacheStats();
}

async function updateCacheStats() {
  try {
    const s = await cache.stats();
    cacheStatsText.textContent = `缓存 ${cache.formatBytes(s.totalBytes)} / ${cache.formatBytes(s.capBytes)}`;
  } catch (_) { cacheStatsText.textContent = "缓存 -"; }
}

// ── Inline rename ────────────────────────────────────────────────────────

function startRename(rowEl, item) {
  const nameEl = rowEl.querySelector(".name");
  const current = nameToTitle(item.name);
  const ext = (item.name.match(/\.[a-z0-9]+$/i) || [""])[0];
  const input = document.createElement("input");
  input.type = "text"; input.className = "name-input"; input.value = current;
  input.style.flex = "1"; input.style.minWidth = "0"; input.style.fontSize = "13px";
  input.style.background = "var(--bg-1)"; input.style.color = "var(--ink)";
  input.style.border = "1px solid var(--line-strong)"; input.style.borderRadius = "4px";
  input.style.padding = "2px 6px"; input.style.fontFamily = "inherit";
  nameEl.replaceWith(input);
  input.focus(); input.select();
  const cancel = () => {
    const span = document.createElement("span");
    span.className = "name"; span.textContent = current; input.replaceWith(span);
  };
  const commit = async () => {
    const next = sanitizeFilename(input.value);
    if (!next || next === current) { cancel(); return; }
    const newName = next + ext;
    try {
      setSyncStatus("改名中…");
      const updated = await renameItem(item.id, newName, item.eTag);
      item.name = updated.name; item.eTag = updated.eTag;
      setSyncStatus("已同步");
      if (currentDocId === item.id) currentTitle.textContent = nameToTitle(updated.name);
      folderItemsCache.clear();
      await renderDocList();
    } catch (e) {
      console.warn("rename failed", e);
      setSyncStatus(`改名失败: ${e.message}`, { error: true });
      cancel();
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); cancel(); }
  });
  input.addEventListener("blur", commit);
}

// ── Cache actions ────────────────────────────────────────────────────────

async function downloadAndCache(item) {
  if (!isSignedIn()) return;
  try {
    setSyncStatus("缓存中…");
    showProgress(0);
    const { blob } = await downloadItemBlob(item.id, { onProgress: (p) => showProgress(p) });
    const folderPath = currentFolder;
    const ok = await cache.set(item.id, blob, {
      name: item.name, folderPath, eTag: item.eTag,
      source: "onedrive", pinned: true,
    });
    showProgress(null);
    if (!ok) {
      setSyncStatus("缓存失败:容量不够(钉住的太多)", { error: true });
      return;
    }
    setSyncStatus("已缓存");
    await renderDocList();
  } catch (e) {
    console.warn("cache failed", e);
    setSyncStatus(`缓存失败: ${e.message}`, { error: true });
    showProgress(null);
  }
}

async function togglePinned(item) {
  const meta = await cache.getMeta(item.id);
  if (!meta) return;
  await cache.setPinned(item.id, !meta.pinned);
  await renderDocList();
}

async function uncacheItem(item) {
  if (!confirm(`从本地缓存删除「${nameToTitle(item.name)}」?(云端不动)`)) return;
  await cache.del(item.id);
  await renderDocList();
}

// ── Trash actions ────────────────────────────────────────────────────────

async function getTrashFolderId() {
  if (trashFolderIdCache) return trashFolderIdCache;
  trashFolderIdCache = await ensureSubfolder(TRASH_FOLDER);
  return trashFolderIdCache;
}

async function trashBook(item) {
  if (!isSignedIn()) return;
  if (!confirm(`把「${nameToTitle(item.name)}」移到垃圾箱?`)) return;
  try {
    setSyncStatus("移动中…");
    const trashId = await getTrashFolderId();
    await moveItemToFolder(item.id, trashId);
    await cache.del(item.id).catch(() => {});
    if (currentDocId === item.id) closeCurrentBook();
    forgetDoc(item.id);
    setSyncStatus("已同步");
    folderItemsCache.clear();
    await renderDocList();
  } catch (e) {
    console.warn("trash failed", e);
    setSyncStatus(`移动失败: ${e.message}`, { error: true });
  }
}

async function restoreBook(item) {
  if (!isSignedIn()) return;
  try {
    setSyncStatus("还原中…");
    // BOOKS_FOLDER 为空时,"还原"的目标 = approot 根本身
    const targetId = BOOKS_FOLDER
      ? await ensureSubfolder(BOOKS_FOLDER)
      : await getApprootId();
    await moveItemToFolder(item.id, targetId);
    setSyncStatus("已同步");
    folderItemsCache.clear();
    await renderDocList();
  } catch (e) {
    console.warn("restore failed", e);
    setSyncStatus(`还原失败: ${e.message}`, { error: true });
  }
}

async function purgeBook(item) {
  if (!isSignedIn()) return;
  if (!confirm(`永久删除「${nameToTitle(item.name)}」?不可撤销。`)) return;
  try {
    setSyncStatus("删除中…");
    await deleteItem(item.id);
    await cache.del(item.id).catch(() => {});
    forgetDoc(item.id);
    setSyncStatus("已同步");
    await renderDocList();
  } catch (e) {
    console.warn("purge failed", e);
    setSyncStatus(`删除失败: ${e.message}`, { error: true });
  }
}

async function emptyAllTrash() {
  if (!isSignedIn()) return;
  if (!confirm("清空垃圾箱,所有文件永久删除?")) return;
  setSyncStatus("清空中…");
  try {
    const items = await listChildren(TRASH_FOLDER);
    for (const it of items) {
      try { await deleteItem(it.id); } catch (_) {}
      cache.del(it.id).catch(() => {});
      forgetDoc(it.id);
    }
    setSyncStatus("已同步");
    await renderDocList();
  } catch (e) {
    console.warn("empty trash failed", e);
    setSyncStatus(`失败: ${e.message}`, { error: true });
  }
}

async function deleteLocalBook(item) {
  // constraint #2:本地文件是唯一副本,强 confirm 文案
  if (!confirm(
    `永久删除「${nameToTitle(item.name)}」?\n\n` +
    `这是本地副本,删除后无法恢复(没在云端备份过)。`
  )) return;
  await cache.del(item.id).catch(() => {});
  if (currentDocId === item.id) closeCurrentBook();
  forgetDoc(item.id);
  await renderDocList();
}

// ── 打开 (open) 一本书 ──────────────────────────────────────────────────

async function openBook(item) {
  hideLanding();
  closeAllPanels();
  currentDocId = item.id;
  const kind = detectKindByName(item.name);
  currentDocKind = kind;
  currentTitle.textContent = nameToTitle(item.name);
  pageStatus.textContent = "";
  setSyncStatus("加载中…");

  setLastActive(item.id);
  ensureDoc(item.id, {
    addedAt: Date.parse(item.createdDateTime || "") || Date.now(),
    kind,
  });

  // 切换 viewer 可见性
  if (kind === "pdf") {
    pdfViewerContainer.classList.remove("hidden");
    txtViewerContainer.classList.add("hidden");
  } else if (kind === "txt") {
    txtViewerContainer.classList.remove("hidden");
    pdfViewerContainer.classList.add("hidden");
  } else {
    setSyncStatus(`不支持的格式: ${item.name}`, { error: true });
    return;
  }

  // 1) 试 cache
  let blob = null;
  try { blob = await cache.getBlob(item.id); } catch (_) {}
  if (blob) {
    cache.touch(item.id).catch(() => {});
    showProgress(null);
  } else if (item._local) {
    // 本地索引里有但 blob 没了(用户清缓存) → 失效
    setSyncStatus("本地文件已丢失", { error: true });
    showLanding({ title: "找不到这个本地文件", hint: "可能缓存被清了。请重新上传。", showUpload: true });
    return;
  } else {
    // 2) Graph 下载(仅缓存读到内存,不入 IDB —— 缓存是用户明确点 cache 按钮的事)
    if (!isSignedIn()) {
      setSyncStatus("未登录,无法从云端读", { error: true });
      showLanding({ title: "请先登录", hint: "或上传一份本地文件。", showUpload: true });
      return;
    }
    showProgress(0);
    try {
      const { blob: downloaded } = await downloadItemBlob(item.id, {
        onProgress: (p) => showProgress(p),
      });
      blob = downloaded;
    } catch (e) {
      showProgress(null);
      console.warn("download failed", e);
      // constraint #5:云端 404 = 用户在 OneDrive 网页里删/挪了这文件。
      // **不要** 误以为是网错把本地状态清掉。也不要默默吞掉,要让用户知道。
      if (e.status === 404) {
        await cache.markGhost(item.id).catch(() => {});
        setSyncStatus("这本书在云端找不到了", { error: true });
        showLanding({
          title: "云端找不到这本书",
          hint: "可能在 OneDrive 网页里被删了或挪了文件夹。可以从书架打开别的,或上传本地副本。",
          showUpload: true,
        });
        return;
      }
      setSyncStatus(`下载失败: ${e.message}`, { error: true });
      showLanding({ title: "加载失败", hint: e.message, showUpload: false });
      return;
    }
    showProgress(null);
  }

  // 3) 进 viewer
  try {
    const pos = getPosition(item.id);
    if (kind === "pdf") {
      await loadPdf({ docId: item.id, data: blob, position: pos });
      if (pos) pageStatus.textContent = `第 ${pos.pageIndex + 1} 页`;
      refreshOutline();
      outlineTitle.textContent = "目录";
      txtChapterSection.hidden = true;
    } else {
      const buf = await blob.arrayBuffer();
      const { text, encoding } = decodeBytes(buf);
      currentDocText = text;
      // 章节切分:看 library.json 偏好,否则 auto
      const pref = getBookMeta(item.id);
      const { chapters, chosen } = splitByPreference(text, pref);
      currentDocChapters = chapters;
      loadTxt({ docId: item.id, text, chapters, position: pos });
      if (pos) pageStatus.textContent = `第 ${pos.pageIndex + 1} 章`;
      renderOutline(chapters.map((c, i) => ({ title: c.title, chapterIndex: i })), { kind: "txt" });
      outlineButton.hidden = chapters.length <= 1;
      outlineTitle.textContent = `目录 · ${chapters.length} 章`;
      txtChapterSection.hidden = false;
      // 记下 encoding 到 library
      if (encoding && encoding !== pref?.encoding) {
        setBookMeta(item.id, { encoding });
      }
      // 更新 chapterRegexSelect 的"当前规则"显示
      updateChapterSettingsForCurrentBook(chosen);
    }
    for (const el of docList.querySelectorAll(".doc-row.active")) el.classList.remove("active");
    const row = docList.querySelector(`[data-item-id="${CSS.escape(item.id)}"]`);
    if (row) row.classList.add("active");
  } catch (e) {
    console.warn("viewer load failed", e);
    setSyncStatus(`渲染失败: ${e.message}`, { error: true });
    showLanding({ title: "渲染失败", hint: e.message, showUpload: false });
    outlineButton.hidden = true;
  }
}

function closeCurrentBook() {
  teardownPdf();
  teardownTxt();
  pdfViewerContainer.classList.add("hidden");
  txtViewerContainer.classList.add("hidden");
  currentDocId = null;
  currentDocKind = null;
  currentDocText = null;
  currentDocChapters = null;
  currentTitle.textContent = "";
  pageStatus.textContent = "";
  outlineButton.hidden = true;
  txtChapterSection.hidden = true;
}

// ── viewer 回调 ──────────────────────────────────────────────────────────

function onPdfPositionFromViewer(pos) {
  if (!currentDocId || !pos) return;
  setPosition(currentDocId, pos, "pdf");
  pageStatus.textContent = `第 ${pos.pageIndex + 1} 页`;
}

function onPdfPagePeek(pageIndex) {
  if (currentDocId && currentDocKind === "pdf") {
    pageStatus.textContent = `第 ${pageIndex + 1} 页`;
  }
}

function onTxtPositionFromViewer(pos) {
  if (!currentDocId || !pos) return;
  setPosition(currentDocId, pos, "txt");
  const total = currentDocChapters?.length ?? 0;
  pageStatus.textContent = total ? `第 ${pos.pageIndex + 1}/${total} 章` : `第 ${pos.pageIndex + 1} 章`;
}

function onTxtChapterPeek(idx, title) {
  if (currentDocId && currentDocKind === "txt") {
    const total = currentDocChapters?.length ?? 0;
    pageStatus.textContent = total ? `第 ${idx + 1}/${total} 章` : `第 ${idx + 1} 章`;
  }
}

// ── Outline (TXT 章节 / PDF outline) ────────────────────────────────────

function renderOutline(nodes, { kind } = {}) {
  outlineList.innerHTML = "";
  if (!nodes || nodes.length === 0) {
    outlineEmpty.classList.remove("hidden");
    return;
  }
  outlineEmpty.classList.add("hidden");
  if (kind === "txt") {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const li = document.createElement("li");
      const row = document.createElement("div");
      row.className = "outline-item";
      row.innerHTML = `<span class="twisty"></span><span class="label">${escapeHtml(node.title || `第 ${i + 1} 章`)}</span>`;
      row.addEventListener("click", () => {
        for (const el of outlineList.querySelectorAll(".outline-item.active")) el.classList.remove("active");
        row.classList.add("active");
        txtGoToChapter(i);
        flush().catch(() => {});
        closeAllPanels();
      });
      li.appendChild(row);
      outlineList.appendChild(li);
    }
    return;
  }
  // PDF
  for (const node of nodes) outlineList.appendChild(buildPdfOutlineItem(node, 0));
}

function buildPdfOutlineItem(node, depth) {
  const li = document.createElement("li");
  const row = document.createElement("div");
  row.className = "outline-item";
  row.style.paddingLeft = `${12 + depth * 14}px`;
  const hasChildren = node.items && node.items.length > 0;
  const twisty = document.createElement("span");
  twisty.className = "twisty";
  twisty.textContent = hasChildren ? "▾" : "";
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = node.title || "(无标题)";
  if (node.bold) label.style.fontWeight = "600";
  if (node.italic) label.style.fontStyle = "italic";
  row.append(twisty, label);
  row.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.target === twisty && hasChildren) {
      const kidsEl = li.querySelector(".outline-children");
      if (kidsEl) {
        const collapsed = kidsEl.classList.toggle("collapsed");
        twisty.textContent = collapsed ? "▸" : "▾";
      }
      return;
    }
    if (node.dest) {
      for (const el of outlineList.querySelectorAll(".outline-item.active")) el.classList.remove("active");
      row.classList.add("active");
      pdfJumpToDest(node.dest);
      setTimeout(() => flush().catch(() => {}), 800);
    }
  });
  li.appendChild(row);
  if (hasChildren) {
    const kids = document.createElement("ul");
    kids.className = "outline-children";
    for (const c of node.items) kids.appendChild(buildPdfOutlineItem(c, depth + 1));
    li.appendChild(kids);
  }
  return li;
}

async function refreshOutline() {
  if (currentDocKind === "pdf") {
    try {
      const outline = await getPdfOutline();
      renderOutline(outline, { kind: "pdf" });
      outlineButton.hidden = !outline || outline.length === 0;
    } catch (_) {
      renderOutline([], { kind: "pdf" });
      outlineButton.hidden = true;
    }
  }
}

// ── 上传 (本地 / OneDrive) ───────────────────────────────────────────────

// 统一上传:无论在线 / 离线,都先入 cache (source:"local") + 试推云端。
// 推成功 → rekey 成 onedrive itemId,pendingUpload 清零。
// 推失败 / 未登录 → 留 source:"local", pendingUpload:true,以后 drain。
// 这样 constraint #4(默认推云)+ #2(本地副本永远在)同时满足。
async function uploadFiles(files) {
  if (!files || !files.length) return;
  closeAllPanels();
  showProgress(0);

  let lastItem = null;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const kind = detectKindByName(f.name);
    if (!kind) { console.warn("skip unknown type:", f.name); continue; }
    showProgress(i / files.length);

    // 1) 先确定要存的 blob (TXT 本地非 UTF-8 → 转 UTF-8 后存,云端也好处理)
    let storedBlob = f;
    const contentType = kind === "pdf" ? "application/pdf" : "text/plain; charset=utf-8";
    if (kind === "txt") {
      try {
        const { text, encoding } = await decodeFile(f);
        if (encoding !== "utf-8" && encoding !== "utf-8-bom") {
          console.log(`auto-convert ${f.name}: ${encoding} → utf-8`);
          storedBlob = new Blob([encodeUtf8(text)], { type: "text/plain; charset=utf-8" });
        }
      } catch (e) { console.warn("decode failed:", e); }
    }

    // 2) 先入本地 cache (source:"local" + pinned:true)
    //    constraint #2:即使后续推云失败,本地副本也不会丢
    //    source:"local" 本身就是"待推云"标记;一旦 rekeyLocalToOnedrive 改成 onedrive 就不再待推
    const localId = `local:${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;
    setSyncStatus(`保存本地 ${f.name}…`);
    const ok = await cache.set(localId, storedBlob, {
      name: f.name,
      folderPath: "__local__",
      source: "local",
      pinned: true,
    });
    if (!ok) {
      alert(`本地存储空间不够 (${f.name}),先去设置里调大缓存上限或清掉一些缓存。`);
      continue;
    }
    ensureDoc(localId, { addedAt: Date.now(), kind });

    let currentItemId = localId;
    let currentItemName = f.name;
    let currentItemKind = kind;

    // 3) 试推云端 (constraint #4)
    if (isSignedIn() && currentFolder !== "__local__") {
      try {
        setSyncStatus(`上传到云端 ${f.name}…`);
        const item = await uploadFileToApproot(
          joinApprootPath(BOOKS_FOLDER, currentFolder, sanitizeFilename(f.name)),
          storedBlob,
          contentType,
        );
        // 推成功 → 把本地 cache 项 rekey 成云端 itemId
        await cache.rekeyLocalToOnedrive(localId, item.id, {
          name: item.name,
          folderPath: currentFolder,
          eTag: item.eTag,
        });
        // session.docs 也搬:旧的 localId 还在,新的 item.id 用同样 position
        await migrateSessionDocId(localId, item.id);
        ensureDoc(item.id, { addedAt: Date.now(), kind });
        currentItemId = item.id;
        currentItemName = item.name;
        folderItemsCache.clear();
      } catch (e) {
        // 推失败 → 留 pendingUpload,下次 drain
        console.warn("upload to cloud failed (will retry later):", e?.message);
        setSyncStatus(`${f.name} 暂存本地,稍后重试上传`, { error: true });
      }
    }

    lastItem = {
      id: currentItemId,
      name: currentItemName,
      file: { mimeType: currentItemKind === "pdf" ? "application/pdf" : "text/plain" },
      size: storedBlob.size,
      lastModifiedDateTime: new Date().toISOString(),
      _local: currentItemId.startsWith("local:"),
    };
  }
  showProgress(null);
  setSyncStatus("上传完成");
  if (lastItem) await openBook(lastItem);
  else await renderDocList();
}

// 把 session.docs[oldId] 的位置/kind 等数据搬到 newId,删 oldId。
// 本来想加到 session.js 当 API,但只有 upload→onedrive 一处用,先放这里。
async function migrateSessionDocId(oldId, newId) {
  const st = getState();
  const oldDoc = st.docs[oldId];
  if (!oldDoc) return;
  if (!st.docs[newId]) {
    // 用 ensureDoc + setPosition 间接写,触发 dirty + scheduleWrite
    ensureDoc(newId, { addedAt: oldDoc.addedAt, kind: oldDoc.kind });
    if (oldDoc.position) {
      setPosition(newId, oldDoc.position, oldDoc.kind);
    }
  }
  if (st.lastActive === oldId) setLastActive(newId);
  forgetDoc(oldId);
}

// 排干所有 pendingUpload 的本地文件 → 推云端 → rekey。
// 触发点:initAuth 成功 / online event / 用户手动点"立即同步"
// (constraint #4 + constraint #7 的简版:这里 collision 直接 OneDrive conflictBehavior=rename
//  自动加后缀,不主动 surface 给用户。等以后做约束 #7 时再改成"surface + 用户决定")
async function drainPendingUploads() {
  if (!isSignedIn() || pendingUploadDraining) return;
  pendingUploadDraining = true;
  try {
    const pending = await cache.listPendingUploads();
    if (pending.length === 0) return;
    setSyncStatus(`补推 ${pending.length} 个本地文件到云端…`, { sticky: true });
    let okCount = 0;
    for (const m of pending) {
      const blob = await cache.getBlob(m.itemId);
      if (!blob) continue;
      const kind = detectKindByName(m.name);
      const contentType = kind === "pdf" ? "application/pdf" : "text/plain; charset=utf-8";
      try {
        // 默认推到 approot 根 (本地上传时的 currentFolder 信息没保留,简化:都进根)
        // 之后 v2 可以记录 originalFolder
        const item = await uploadFileToApproot(
          joinApprootPath(BOOKS_FOLDER, sanitizeFilename(m.name)),
          blob,
          contentType,
        );
        await cache.rekeyLocalToOnedrive(m.itemId, item.id, {
          name: item.name,
          folderPath: "",
          eTag: item.eTag,
        });
        await migrateSessionDocId(m.itemId, item.id);
        okCount++;
      } catch (e) {
        console.warn("drain upload failed:", m.name, e?.message);
        // 保留 pendingUpload,下次再试
      }
    }
    if (okCount > 0) {
      folderItemsCache.clear();
      setSyncStatus(`已补推 ${okCount}/${pending.length}`);
      if (openPanel === "books") renderDocList().catch(() => {});
    } else {
      setSyncStatus("补推失败,稍后重试", { error: true });
    }
  } finally {
    pendingUploadDraining = false;
  }
}

async function createNewFolder() {
  if (!isSignedIn()) return;
  const name = prompt("新建文件夹名:");
  if (!name) return;
  const clean = sanitizeFilename(name);
  if (!clean) return;
  try {
    setSyncStatus("新建文件夹…");
    const targetPath = joinApprootPath(BOOKS_FOLDER, currentFolder, clean);
    await ensureSubfolder(targetPath);
    setSyncStatus("已建");
    folderItemsCache.clear();
    await renderDocList();
  } catch (e) {
    setSyncStatus(`失败: ${e.message}`, { error: true });
  }
}

// ── 启动序列 (the jumpscare) ────────────────────────────────────────────
// 关键:**先**根据 lastActive (从 localStorage backup 拿到的) 立即试着打开,
// 不等 OneDrive 列表。哪怕没登录、没网,只要 cache 有 → 直接开。
// 选择困难症杀手。

async function jumpscareLocal() {
  const st = getState();
  const lastId = st.lastActive;
  if (!lastId) return false;
  // 本地缓存有 → 直接开,先拼一个伪 driveItem
  const meta = await cache.getMeta(lastId).catch(() => null);
  if (meta) {
    const item = {
      id: lastId,
      name: meta.name || lastId,
      file: { mimeType: meta.type || "application/octet-stream" },
      size: meta.size,
      lastModifiedDateTime: meta.lastAccessed ? new Date(meta.lastAccessed).toISOString() : null,
      _local: meta.source === "local",
    };
    await openBook(item);
    return true;
  }
  return false;
}

async function jumpscareRemote() {
  if (!isSignedIn()) return false;
  const st = getState();
  const lastId = st.lastActive;
  if (!lastId) return false;
  try {
    const item = await getItemMeta(lastId);
    await openBook(item);
    return true;
  } catch (_) {
    return false;
  }
}

// ── reconcile / idle ─────────────────────────────────────────────────────

async function reconcileOnFocus() {
  if (!isAuthConfigured() || !isSignedIn()) return;
  // constraint #5:用户可能在 OneDrive 网页改了 / 增删了文件,清掉本地 listing 缓存
  // 下次打开书架重新列。renderDocList 内部 reconcileWithRemoteList 会更新 cache.meta。
  folderItemsCache.clear();
  try {
    const changed = await checkRemoteChanged();
    if (changed) showUpdateToast("session", "云端有更新", "同步");
  } catch (_) {}
}

let updateMode = null;
function showUpdateToast(mode, text, label) {
  updateMode = mode;
  $("updateToastText").textContent = text;
  $("updateToastReload").textContent = label;
  updateToast.classList.remove("hidden");
}
function hideUpdateToast() {
  updateToast.classList.add("hidden");
  updateMode = null;
}

async function applyRemoteUpdate() {
  hideUpdateToast();
  try {
    setSyncStatus("同步中…");
    await reloadFromRemote();
    const st = getState();
    if (st.lastActive && st.lastActive !== currentDocId) {
      try {
        const item = await getItemMeta(st.lastActive);
        await openBook(item);
      } catch (_) {}
    } else if (currentDocId) {
      const pos = getPosition(currentDocId);
      if (pos) {
        if (currentDocKind === "pdf") restorePdfPosition(pos);
        else if (currentDocKind === "txt") restoreTxtPosition(pos);
      }
    }
    setSyncStatus("已同步");
  } catch (e) {
    setSyncStatus(`同步失败: ${e.message}`, { error: true });
  }
}

function resetIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleOverlay.classList.add("hidden");
  idleTimer = setTimeout(() => { idleOverlay.classList.remove("hidden"); }, IDLE_MS);
}
["mousemove", "keydown", "wheel", "touchstart", "scroll"].forEach((ev) => {
  window.addEventListener(ev, resetIdle, { passive: true, capture: true });
});
idleOverlay.addEventListener("click", async () => {
  idleOverlay.classList.add("hidden"); resetIdle();
  await applyRemoteUpdate();
});

// 离页 keepalive
window.addEventListener("beforeunload", () => { flushKeepalive(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    flush().catch(() => {});
    flushLibrary().catch(() => {});
    flushKeepalive();
  }
});
window.addEventListener("pagehide", () => {
  flush().catch(() => {});
  flushLibrary().catch(() => {});
  flushKeepalive();
});
window.addEventListener("focus", reconcileOnFocus);
window.addEventListener("online", () => {
  flush().catch(() => {});
  // constraint #4:online 后试着 drain 之前堆的本地文件
  drainPendingUploads().catch(() => {});
  if (openPanel === "books") renderDocList().catch(() => {});
});

// ── 键盘 + 手柄快捷键 ────────────────────────────────────────────────────
// 输入框聚焦 / 抽屉打开 / 没在读书 → 不抢
//
// 键盘:
//   B           切换书库 (books drawer)
//   O           切换目录 (outline,本书章节列表)
//   S           切换设置
//   Escape      关任何打开的 panel
//   ←/→/[/]    上/下一章 (TXT) — viewer-txt 自己处理
//   ↑/↓/PgUp/PgDn/Space — 浏览器原生 / viewer-txt 自己处理
//
// 手柄 (Xbox / Quest / DualShock standard mapping):
//   D-pad ↑ (12)    持续滚动当前 viewer 向上
//   D-pad ↓ (13)    持续滚动当前 viewer 向下
//   D-pad ← (14)    上一章 (TXT) / 上一屏 (PDF)
//   D-pad → (15)    下一章 (TXT) / 下一屏 (PDF)
//   Select / View (8)   切换目录
//   Start / Menu (9)    切换书库
//   Home / Guide (16)   切换书库 (备用)

function isReadingInputFocused() {
  const a = document.activeElement;
  if (!a) return false;
  const tag = a.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || a.isContentEditable;
}

function getActiveViewerContainer() {
  if (currentDocKind === "pdf") return pdfViewerContainer;
  if (currentDocKind === "txt") return txtViewerContainer;
  return null;
}

// 在 capture 阶段绑,优先级在 viewer-txt 的 doc-level handler 之前
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isReadingInputFocused()) return;
  // 单字符快捷键
  switch (e.key) {
    case "b":
    case "B":
      e.preventDefault(); togglePanel("books"); return;
    case "o":
    case "O":
      e.preventDefault(); togglePanel("outline"); return;
    case "s":
    case "S":
      e.preventDefault(); togglePanel("settings"); return;
  }
});

// 手柄
const gamepadState = { rafId: null, prevPressed: new Set() };

window.addEventListener("gamepadconnected", (e) => {
  console.log("[gamepad] connected:", e.gamepad?.id);
  if (gamepadState.rafId == null) {
    gamepadState.rafId = requestAnimationFrame(pollGamepad);
  }
});
window.addEventListener("gamepaddisconnected", (e) => {
  console.log("[gamepad] disconnected:", e.gamepad?.id);
  // 不停 polling —— 别的手柄可能还插着
});

function pollGamepad() {
  gamepadState.rafId = requestAnimationFrame(pollGamepad);

  const gps = navigator.getGamepads ? navigator.getGamepads() : [];
  let active = null;
  for (const gp of gps) { if (gp) { active = gp; break; } }
  if (!active) return;

  const inputFocused = isReadingInputFocused();
  const container = getActiveViewerContainer();
  const viewerOk = !!container && !container.classList.contains("hidden");

  // 边沿触发(按下一次才触发,持按不连发,避免"按一下就过头")
  const wasPressed = (i) => gamepadState.prevPressed.has(i);
  const isPressed = (i) => !!active.buttons[i]?.pressed;
  const edge = (i) => isPressed(i) && !wasPressed(i);

  if (viewerOk && !openPanel && !inputFocused) {
    // D-pad ↑/↓:每按一次 4 行 (TXT) / 1/3 屏 (PDF fallback)。边沿触发,
    // 不连发。TXT 还会 snap 到行边界,避免每帧顶上切半行。
    if (edge(12)) dpadStep(container, -1);
    if (edge(13)) dpadStep(container, +1);

    // D-pad ←/→:章节 (TXT) / 一屏 (PDF)
    if (edge(14)) gamepadNavBack();
    if (edge(15)) gamepadNavForward();
  }

  // Select (8) → 目录 toggle (要求至少有 viewer,否则没目录可看)
  if (viewerOk && edge(8)) togglePanel("outline");
  // Start (9) → 书库 toggle
  if (edge(9)) togglePanel("books");
  // Home/Guide (16) → 书库 toggle (备用,有些控制器才有)
  if (edge(16)) togglePanel("books");

  // 更新 prev pressed
  gamepadState.prevPressed.clear();
  for (let i = 0; i < active.buttons.length; i++) {
    if (active.buttons[i]?.pressed) gamepadState.prevPressed.add(i);
  }
}

function gamepadNavBack() {
  if (currentDocKind === "txt") {
    const ch = txtGetCurrentChapter();
    if (ch > 0) txtGoToChapter(ch - 1);
  } else if (currentDocKind === "pdf") {
    pdfViewerContainer.scrollBy({ top: -pdfViewerContainer.clientHeight * 0.9 });
  }
}
function gamepadNavForward() {
  if (currentDocKind === "txt") {
    const ch = txtGetCurrentChapter();
    const total = txtGetChapters().length;
    if (ch < total - 1) txtGoToChapter(ch + 1);
  } else if (currentDocKind === "pdf") {
    pdfViewerContainer.scrollBy({ top: pdfViewerContainer.clientHeight * 0.9 });
  }
}

// D-pad ↑/↓ 单步。dir = -1 (上) 或 +1 (下)。
//   TXT: 4 行 = 4 × (font-size × line-height),滚完 snap 到 body 内部行边界,
//        避免下一次滚动顶上切半行。多次按累计也不漂移。
//   PDF: 1/3 屏 (PDF 没行概念,做不了量化)。
function dpadStep(container, dir) {
  const cs = getComputedStyle(container);
  const fs = parseFloat(cs.getPropertyValue("--txt-font-size"));
  const lhRatio = parseFloat(cs.getPropertyValue("--txt-line-height"));
  const lineHeight = (Number.isFinite(fs) && Number.isFinite(lhRatio) && fs > 0)
    ? fs * lhRatio : null;
  if (lineHeight) {
    const body = container.querySelector(".txt-body");
    const anchor = body ? body.offsetTop : 0;
    const targetRaw = container.scrollTop + dir * lineHeight * 4;
    // snap 到 (anchor + N × lineHeight),从 anchor 起的行格子
    const N = Math.round((targetRaw - anchor) / lineHeight);
    container.scrollTop = Math.max(0, anchor + N * lineHeight);
  } else {
    container.scrollBy({ top: dir * container.clientHeight / 3 });
  }
}

// ── Settings panel ──────────────────────────────────────────────────────

function refreshSettingsPanel() {
  // cache
  cache.stats().then((s) => {
    cacheStatsDetail.textContent =
      `${cache.formatBytes(s.totalBytes)} / ${cache.formatBytes(s.capBytes)}  ·  ${s.count} 项,其中钉住 ${s.pinnedCount}`;
    const pct = s.capBytes > 0 ? Math.min(100, s.totalBytes / s.capBytes * 100) : 0;
    const pinPct = s.capBytes > 0 ? Math.min(100, s.pinnedBytes / s.capBytes * 100) : 0;
    cacheBarFill.style.width = `${pct}%`;
    cacheBarPinned.style.width = `${pinPct}%`;
  });
  cacheCapInput.value = cache.getCapMB();
  cacheCapInput.min = MIN_CACHE_CAP_MB;

  // TXT prefs
  const p = txtGetReaderPrefs();
  txtFontSize.value = p.fontSize;
  txtLineHeight.value = p.lineHeight;
  txtMaxWidth.value = p.maxWidth;
  txtFontFamily.value = p.fontFamily;

  // theme
  themeSelect.value = localStorage.getItem(THEME_KEY) || "auto";

  // chapter regex (only meaningful for TXT)
  refreshChapterDropdown();
}

function refreshChapterDropdown() {
  chapterRegexSelect.innerHTML = "";
  const autoOpt = document.createElement("option");
  autoOpt.value = ""; autoOpt.textContent = "自动选择(推荐)";
  chapterRegexSelect.appendChild(autoOpt);
  for (const d of listBuiltinRegexes()) {
    const opt = document.createElement("option");
    opt.value = d.id; opt.textContent = `${d.label}  (${d.re.slice(0, 40)})`;
    chapterRegexSelect.appendChild(opt);
  }
  if (currentDocId && currentDocKind === "txt") {
    const pref = getBookMeta(currentDocId);
    chapterRegexSelect.value = pref?.chapterRegexId || "";
    chapterRegexCustom.value = pref?.chapterRegexCustom || "";
  } else {
    chapterRegexSelect.value = "";
    chapterRegexCustom.value = "";
  }
}

function updateChapterSettingsForCurrentBook(chosen) {
  if (!chosen) {
    chapterSplitStatus.textContent = `当前未切分(整本一章)`;
  } else {
    chapterSplitStatus.textContent = `当前使用:${chosen.label}  ·  ${currentDocChapters.length} 章`;
  }
}

cacheCapInput.addEventListener("change", () => {
  const v = parseInt(cacheCapInput.value, 10);
  if (cache.setCapMB(v)) {
    refreshSettingsPanel();
    updateCacheStats();
  }
});
clearUnpinnedButton.addEventListener("click", async () => {
  if (!confirm("清空所有未钉住的缓存?(钉住的保留)")) return;
  await cache.clearUnpinned();
  await renderDocList();
  refreshSettingsPanel();
});
clearAllCacheButton.addEventListener("click", async () => {
  // constraint #2:清空 cache 会丢本地唯一副本,强 confirm 列清单
  const local = await cache.listLocalFiles();
  let warning = "清空全部本地缓存?(包括钉住的)";
  if (local.length > 0) {
    const names = local.slice(0, 5).map((m) => `· ${m.name}`).join("\n");
    const more = local.length > 5 ? `\n· … 还有 ${local.length - 5} 个` : "";
    warning = `⚠️ 你有 ${local.length} 个本地文件没有云端备份,清空缓存它们会永久丢失:\n\n${names}${more}\n\n确认清空?`;
  }
  if (!confirm(warning)) return;
  await cache.clearAll();
  if (currentDocId) closeCurrentBook();
  await renderDocList();
  refreshSettingsPanel();
});

for (const [el, key] of [
  [txtFontSize, "fontSize"], [txtLineHeight, "lineHeight"],
  [txtMaxWidth, "maxWidth"],
]) {
  el.addEventListener("change", () => {
    const v = parseFloat(el.value);
    if (Number.isFinite(v)) txtSetReaderPrefs({ [key]: v });
  });
}
txtFontFamily.addEventListener("change", () => {
  txtSetReaderPrefs({ fontFamily: txtFontFamily.value });
});

reapplyChaptersButton.addEventListener("click", async () => {
  if (!currentDocId || currentDocKind !== "txt" || !currentDocText) return;
  const id = chapterRegexSelect.value || null;
  const custom = chapterRegexCustom.value.trim() || null;
  setBookMeta(currentDocId, {
    chapterRegexId: id, chapterRegexCustom: custom,
  });
  let res;
  try {
    if (custom) res = splitByCustom(currentDocText, custom);
    else if (id) res = splitByBuiltin(currentDocText, id);
    else res = autoSplit(currentDocText);
  } catch (e) {
    alert(`正则错误: ${e.message}`);
    return;
  }
  const anchor = txtCurrentCharOffset();
  currentDocChapters = res.chapters;
  txtReapplyChapters(res.chapters, anchor);
  renderOutline(res.chapters.map((c, i) => ({ title: c.title, chapterIndex: i })), { kind: "txt" });
  outlineButton.hidden = res.chapters.length <= 1;
  outlineTitle.textContent = `目录 · ${res.chapters.length} 章`;
  updateChapterSettingsForCurrentBook(res.chosen);
});

themeSelect.addEventListener("change", () => {
  localStorage.setItem(THEME_KEY, themeSelect.value);
  applyTheme();
});

// ── Wiring ───────────────────────────────────────────────────────────────

menuButton.addEventListener("click", () => togglePanel("books"));
outlineButton.addEventListener("click", () => togglePanel("outline"));
settingsButton.addEventListener("click", () => togglePanel("settings"));
drawerCloseButton.addEventListener("click", closeAllPanels);
outlineCloseButton.addEventListener("click", closeAllPanels);
settingsCloseButton.addEventListener("click", closeAllPanels);
drawerBackdrop.addEventListener("click", closeAllPanels);

drawerSortButton.addEventListener("click", async () => {
  sortMode = sortMode === "modified" ? "name" : "modified";
  localStorage.setItem(SORT_KEY, sortMode);
  await renderDocList();
});
drawerRefreshButton.addEventListener("click", async () => {
  folderItemsCache.clear();
  await renderDocList();
});

uploadButton.addEventListener("click", () => fileInput.click());
emptyUploadButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const files = Array.from(fileInput.files || []);
  fileInput.value = "";
  uploadFiles(files);
});

newFolderButton.addEventListener("click", createNewFolder);

openTrashButton.addEventListener("click", async () => {
  drawerView = "trash"; currentFolder = "";
  await renderDocList();
});
backFromTrashButton.addEventListener("click", async () => {
  drawerView = "books";
  await renderDocList();
});
emptyTrashButton.addEventListener("click", emptyAllTrash);

loginButton.addEventListener("click", async () => {
  try {
    // 记下"用户明确表达过登录意愿" → 下次启动会自动 silent
    rememberEverSignedIn();
    await signIn();
  } catch (e) { alert(`登录失败: ${e.message}`); }
});
logoutButton.addEventListener("click", async () => {
  await signOut();
  // 登出 = 用户表达"不想自动登录了" → 下次启动回到本地模式
  try { localStorage.removeItem(EVER_SIGNED_IN_KEY); } catch (_) {}
  refreshAuthRow(null);
  await renderDocList();
});

// 顶栏点 cacheStats 进设置(快捷)
$("cacheStatsButton").addEventListener("click", () => openSettingsPanel());

// 主题快捷循环
const THEME_LABELS = { day: "日", night: "夜", auto: "跟随系统" };
function applyTheme() {
  const m = localStorage.getItem(THEME_KEY) || "auto";
  document.documentElement.setAttribute("data-theme", m);
  if (themeLabel) themeLabel.textContent = THEME_LABELS[m] || "跟随系统";
}
applyTheme();
themeButton?.addEventListener("click", () => {
  const order = ["auto", "day", "night"];
  const cur = localStorage.getItem(THEME_KEY) || "auto";
  const next = order[(order.indexOf(cur) + 1) % order.length];
  localStorage.setItem(THEME_KEY, next);
  applyTheme();
});

updateToastReload.addEventListener("click", async () => {
  if (updateMode === "site") {
    hideUpdateToast();
    flushKeepalive();
    try { navigator.serviceWorker.controller?.postMessage({ type: "skip-waiting" }); } catch (_) {}
    location.reload();
    return;
  }
  if (updateMode === "session") await applyRemoteUpdate();
  else hideUpdateToast();
});
updateToastDismiss.addEventListener("click", hideUpdateToast);

// 拖拽上传 (整个 window;dragenter counter 防抖)
let dragDepth = 0;
function dtHasFiles(dt) {
  if (!dt?.types) return false;
  for (const t of dt.types) if (t === "Files" || t === "application/x-moz-file") return true;
  return false;
}
window.addEventListener("dragenter", (e) => {
  if (!dtHasFiles(e.dataTransfer)) return;
  e.preventDefault(); dragDepth += 1;
  dropOverlay.classList.remove("hidden");
});
window.addEventListener("dragover", (e) => {
  if (!dtHasFiles(e.dataTransfer)) return;
  e.preventDefault(); e.dataTransfer.dropEffect = "copy";
});
window.addEventListener("dragleave", (e) => {
  if (!dtHasFiles(e.dataTransfer)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.classList.add("hidden");
});
window.addEventListener("drop", (e) => {
  if (!dtHasFiles(e.dataTransfer)) return;
  e.preventDefault(); dragDepth = 0;
  dropOverlay.classList.add("hidden");
  const files = Array.from(e.dataTransfer.files || []).filter((f) => detectKindByName(f.name));
  if (files.length === 0) { setSyncStatus("不是 TXT/PDF", { error: true }); return; }
  uploadFiles(files);
});

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  // 两个 viewer 都先 init (内部用到 pdf.js 是 lazy import)
  await initPdfViewer({
    containerEl: pdfViewerContainer,
    onPosition: onPdfPositionFromViewer,
    onPagePeek: onPdfPagePeek,
  });
  initTxtViewer({
    containerEl: txtViewerContainer,
    onPosition: onTxtPositionFromViewer,
    onChapterPeek: onTxtChapterPeek,
  });

  // 立刻 hydrate session backup (无网也有 lastActive)
  // initSession 即使 Graph 失败也会 hydrate 备份
  await Promise.allSettled([initSession(), initLibrary()]);

  // 申请持久化存储 (constraint #2 + #3 保险): 浏览器存储压力下不会清掉 IDB
  if (navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {});
  }

  // 1) 先试本地 jumpscare —— 不等 OneDrive 登录
  const localJumped = await jumpscareLocal();

  // 决定是否尝试自动登录:
  //   - Azure 没配 → 纯本地,不试
  //   - 从没登过 → 纯本地,不试 (constraint #1)
  //   - 登过且配了 → 后台 silent
  const tryAuth = isAuthConfigured() && hasEverSignedIn();

  if (!localJumped) {
    showLanding({
      title: tryAuth ? "正在准备…" : "本地模式",
      hint: tryAuth
        ? "正在尝试自动登录 OneDrive。"
        : (isAuthConfigured()
            ? "上传 TXT/PDF 直接读;想要跨设备同步可以从书架登录 OneDrive。"
            : "上传 TXT/PDF 直接读,或拖拽到窗口。"),
      showUpload: true,
    });
  }

  // 从没登过 / Azure 没配 → 直接结束 main,本地路径就够了
  if (!tryAuth) {
    refreshAuthRow(null);
    setSyncStatus("本地模式", { sticky: true });
    resetIdle();
    return;
  }

  // 2) 背景:initAuth (silent probe)
  let authResult;
  try { authResult = await initAuth(); }
  catch (e) {
    console.warn("auth init failed", e);
    refreshAuthRow(null);
    if (!localJumped) {
      showLanding({
        title: "本地模式",
        hint: "登录失败 —— 仍可上传本地 TXT/PDF 阅读。",
        showUpload: true,
      });
    }
    return;
  }
  refreshAuthRow(authResult.account);
  if (authResult.signedIn) rememberEverSignedIn();

  if (!authResult.signedIn) {
    if (!localJumped) {
      showLanding({
        title: authResult.probedAccount ? "需要授权" : "未登录",
        hint: authResult.probedAccount
          ? `检测到账号 ${authResult.probedAccount.username},点左上角菜单登录授权。也可以上传本地文件。`
          : "登录 OneDrive 同步,或上传本地 TXT/PDF 直接看。",
        showUpload: true,
      });
    }
    setSyncStatus("离线");
    return;
  }

  // 3) 已登录:再试远端 jumpscare (上次的书可能没缓存但在 OneDrive 上)
  if (!localJumped) {
    setSyncStatus("加载…");
    try { await reloadFromRemote(); } catch (_) {}
    const remoteJumped = await jumpscareRemote();
    if (!remoteJumped) {
      showLanding({
        title: "选一本开始,或上传新的",
        hint: "点左上角菜单浏览书架。",
        showUpload: true,
      });
    }
  } else {
    // 已经从本地 jumpscare 开了书,但仍可后台 reconcile session (检测远端有没有更新)
    setTimeout(() => reconcileOnFocus(), 1000);
  }

  // 登录成功 → 试 drain 之前堆的本地文件 (constraint #4)
  setTimeout(() => drainPendingUploads().catch(() => {}), 1500);

  resetIdle();
}

main().catch((e) => {
  console.error("启动失败", e);
  setSyncStatus(`启动失败: ${e.message}`, { error: true });
});

// ── Service worker ───────────────────────────────────────────────────────

const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""]);

if ("serviceWorker" in navigator && !LOCAL_DEV_HOSTS.has(location.hostname)) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "asset-updated") {
      showUpdateToast("site", "本站有新版本", "刷新");
    }
  });
  window.addEventListener("load", async () => {
    let reg;
    try { reg = await navigator.serviceWorker.register("./service-worker.js"); }
    catch (e) { console.warn("SW register failed", e); return; }
    if (reg.waiting && navigator.serviceWorker.controller) {
      showUpdateToast("site", "本站有新版本", "刷新");
    }
    reg.addEventListener("updatefound", () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener("statechange", () => {
        if (nw.state === "installed" && navigator.serviceWorker.controller) {
          showUpdateToast("site", "本站有新版本", "刷新");
        }
      });
    });
  });
}
