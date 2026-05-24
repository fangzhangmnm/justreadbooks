// PDF 阅读器,基于 pdf.js。
// 几乎照搬 JustReadPapers/src/viewer.js,只是少了一些论文专用功能(双页 spread、截图、文本提取
// 在网络小说和图书场景用得不多,精简掉)。

import { READING_LINE_ANCHOR } from "./config.js";

// 全本地化:pdf.js 整包 vendor 到 src/vendor/pdfjs/。不再外链 CDN
// (避免离线 / Tracking Prevention 拦截 / 旅馆网拉不动)
const PDFJS_BASE = new URL("./vendor/pdfjs/", import.meta.url).href;

const ZOOM_FACTOR_KEY_PREFIX = "jrb.pdf.zoomf:";

function zoomFactorKey(docId) {
  return `${ZOOM_FACTOR_KEY_PREFIX}${docId}`;
}
function currentZoomFactorKey() {
  if (!currentDocId) return null;
  return zoomFactorKey(currentDocId);
}

let pdfjsLib = null;
let pdfViewerNs = null;
let viewer = null;
let linkService = null;
let eventBus = null;
let container = null;
let currentPdf = null;
let currentDocId = null;
let pendingRestore = null;
let scrollHandler = null;
let onPositionChange = null;
let onPagePeek = null;
let pagePeekRaf = null;
let saveTimer = null;
const SAVE_DELAY_MS = 500;
let programmaticScale = false;

const TARGET_INCHES_PER_PAGE = 7;  // 图书页通常比论文小,7" 阅读舒适
const CSS_PX_PER_INCH = 96;
const PAGE_BORDER_RESERVE = 4;
const PDF_TO_CSS_UNITS = 96 / 72;

let _scrollbarWidth = null;
function detectScrollbarWidth() {
  if (_scrollbarWidth != null) return _scrollbarWidth;
  try {
    const d = document.createElement("div");
    d.style.cssText = "width:50px;height:50px;overflow:scroll;position:absolute;top:-9999px;visibility:hidden;";
    document.body.appendChild(d);
    _scrollbarWidth = d.offsetWidth - d.clientWidth;
    document.body.removeChild(d);
  } catch (_) { _scrollbarWidth = 0; }
  return _scrollbarWidth;
}

function computeCozyScale() {
  try {
    const pv = viewer.getPageView(0);
    if (!pv) return null;
    let naturalCssWidth;
    if (pv.pdfPage?.view) {
      const view = pv.pdfPage.view;
      const pageWidthPts = view[2] - view[0];
      naturalCssWidth = pageWidthPts * PDF_TO_CSS_UNITS;
    } else if (pv.viewport) {
      naturalCssWidth = pv.viewport.width * PDF_TO_CSS_UNITS / pv.viewport.scale;
    } else { return null; }

    const sbw = detectScrollbarWidth();
    const scrollbarShowing = container.offsetWidth - container.clientWidth >= sbw - 1 && sbw > 0;
    const scrollbarReserve = (sbw > 0 && !scrollbarShowing) ? sbw : 0;
    const availCss = container.clientWidth - PAGE_BORDER_RESERVE - scrollbarReserve;
    if (availCss <= 0) return null;

    const cap = TARGET_INCHES_PER_PAGE * CSS_PX_PER_INCH;
    const targetCss = Math.min(availCss, cap);
    const s = targetCss / naturalCssWidth;
    return Math.max(0.1, Math.min(4, s));
  } catch (_) { return null; }
}

function applyAutoFit() {
  if (!viewer) return;
  programmaticScale = true;
  const s = computeCozyScale();
  viewer.currentScale = s ?? 1.0;
  programmaticScale = false;
}

function applySavedZoomOrAutoFit() {
  if (!viewer) return;
  const k = currentZoomFactorKey();
  const raw = k ? localStorage.getItem(k) : null;
  const factor = raw ? parseFloat(raw) : NaN;
  const cozy = computeCozyScale();
  programmaticScale = true;
  if (Number.isFinite(factor) && factor > 0 && cozy) {
    const s = Math.max(0.1, Math.min(8, factor * cozy));
    viewer.currentScale = s;
  } else {
    viewer.currentScale = cozy ?? 1.0;
  }
  programmaticScale = false;
}

export function fitToWidth() {
  if (!viewer) return;
  const k = currentZoomFactorKey();
  if (k) { try { localStorage.removeItem(k); } catch (_) {} }
  applyAutoFit();
}

export function zoomBy(factor) {
  if (!viewer) return;
  const cur = viewer.currentScale || 1;
  const next = Math.max(0.1, Math.min(8, cur * factor));
  viewer.currentScale = next;
}

// dynamic import + 退避重试。GH Pages 冷启动 / 弱网 / 第一次缓存竞态偶尔会让
// import() 一次性失败,重试 3 次几乎可以兜底所有 transient 问题。
async function loadModule(rel, attempts = 3) {
  const u = `${PDFJS_BASE}${rel}`;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await import(/* @vite-ignore */ u); }
    catch (e) {
      lastErr = e;
      console.warn(`pdf.js ${rel} 第 ${i + 1}/${attempts} 次加载失败:`, e?.message);
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 300 * (i + 1)));
      }
    }
  }
  throw new Error(`pdf.js 加载失败 (${rel}): ${lastErr?.message}`);
}

async function ensureLib() {
  if (pdfjsLib && pdfViewerNs) return;
  [pdfjsLib, pdfViewerNs] = await Promise.all([
    loadModule("pdf.mjs"),
    loadModule("web/pdf_viewer.mjs"),
  ]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}pdf.worker.mjs`;
}

// 同步初始化:只记下 container 引用 + callback + 挂 scrollHandler
// (handler 内部 `if (!viewer) return` 自己保护)。**不加载** pdf.js,
// 让只看 TXT 的用户永远不下 4MB 的 pdf.js + cmaps。
export function initPdfViewer({ containerEl, onPosition, onPagePeek: opp }) {
  container = containerEl;
  onPositionChange = onPosition;
  onPagePeek = opp || null;

  scrollHandler = () => {
    if (!viewer || isRestoring) return;
    if (onPagePeek && !pagePeekRaf) {
      pagePeekRaf = requestAnimationFrame(() => {
        pagePeekRaf = null;
        const p = currentPosition();
        if (p) onPagePeek(p.pageIndex);
      });
    }
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const p = currentPosition();
      if (p && onPositionChange) onPositionChange(p);
    }, SAVE_DELAY_MS);
  };
  container.addEventListener("scroll", scrollHandler, { passive: true });
}

// 第一次 loadPdf 时才真正构建 PDFViewer / 装 eventBus / resize 监听
// (single-flight via pendingBuild,多次并发 loadPdf 也只构一次)
let pendingBuild = null;
async function ensureViewerBuilt() {
  if (viewer) return;
  if (pendingBuild) return pendingBuild;
  pendingBuild = (async () => {
    await ensureLib();
    eventBus = new pdfViewerNs.EventBus();
    linkService = new pdfViewerNs.PDFLinkService({ eventBus });
    viewer = new pdfViewerNs.PDFViewer({ container, eventBus, linkService });
    linkService.setViewer(viewer);

    eventBus.on("pagesinit", () => {
      applySavedZoomOrAutoFit();
      if (pendingRestore) {
        const p = pendingRestore;
        pendingRestore = null;
        restorePosition(p);
      }
    });
    eventBus.on("pagesloaded", () => {
      if (pendingRestore) {
        const p = pendingRestore;
        pendingRestore = null;
        restorePosition(p);
      }
    });
    eventBus.on("scalechanging", (evt) => {
      if (programmaticScale) return;
      const k = currentZoomFactorKey();
      if (!k) return;
      const cozy = computeCozyScale();
      if (!cozy) return;
      const factor = (evt.scale ?? viewer.currentScale) / cozy;
      if (!Number.isFinite(factor) || factor <= 0) return;
      try { localStorage.setItem(k, String(Math.max(0.1, Math.min(8, factor)))); } catch (_) {}
    });

    container.addEventListener("wheel", (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      const factor = dir > 0 ? 1.1 : 1 / 1.1;
      const cur = viewer.currentScale || 1;
      const next = Math.max(0.2, Math.min(8, cur * factor));
      viewer.currentScale = next;
    }, { passive: false });

    // resize → 重 fit (没手动 zoom 时)
    let autoFitGuard = false;
    const refit = () => {
      if (!currentPdf || !currentDocId || autoFitGuard) return;
      autoFitGuard = true;
      try { applySavedZoomOrAutoFit(); } catch (_) {}
      requestAnimationFrame(() => requestAnimationFrame(() => { autoFitGuard = false; }));
    };
    const ro = new ResizeObserver(refit);
    ro.observe(container);
    window.addEventListener("resize", refit);
  })().catch((e) => {
    pendingBuild = null;   // 让下次 loadPdf 可以重试 build
    throw e;
  });
  return pendingBuild;
}

export async function loadPdf({ docId, data, position }) {
  await ensureViewerBuilt();   // 真·懒加载入口
  currentDocId = docId;
  if (currentPdf) {
    try { currentPdf.destroy(); } catch (_) {}
    currentPdf = null;
  }
  pendingRestore = position || null;

  let docData = data;
  if (data instanceof Blob) docData = await data.arrayBuffer();

  const loadingTask = pdfjsLib.getDocument({
    data: docData,
    cMapUrl: `${PDFJS_BASE}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_BASE}/standard_fonts/`,
  });
  currentPdf = await loadingTask.promise;
  viewer.setDocument(currentPdf);
  linkService.setDocument(currentPdf);
  return currentPdf;
}

export function getNumPages() { return currentPdf?.numPages ?? 0; }

let isRestoring = false;

export function restorePosition({ pageIndex, yFraction }) {
  if (!viewer) return false;
  const pv = viewer.getPageView(pageIndex);
  if (!pv?.div) {
    pendingRestore = { pageIndex, yFraction };
    return false;
  }
  const pageTop = pv.div.offsetTop;
  const pageH = pv.div.offsetHeight;
  if (!pageH) {
    pendingRestore = { pageIndex, yFraction };
    return false;
  }
  const readingLineY = pageTop + pageH * yFraction;
  const desired = readingLineY - container.clientHeight * READING_LINE_ANCHOR;
  isRestoring = true;
  container.scrollTop = Math.max(0, desired);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const pv2 = viewer.getPageView(pageIndex);
      if (pv2?.div?.offsetHeight) {
        const recompute = pv2.div.offsetTop + pv2.div.offsetHeight * yFraction
          - container.clientHeight * READING_LINE_ANCHOR;
        container.scrollTop = Math.max(0, recompute);
      }
      isRestoring = false;
    });
  });
  return true;
}

export function currentPosition() {
  if (!viewer || !container) return null;
  const pages = viewer.pagesCount;
  if (!pages) return null;
  const readingLineY = container.scrollTop + container.clientHeight * READING_LINE_ANCHOR;
  for (let i = 0; i < pages; i++) {
    const pv = viewer.getPageView(i);
    if (!pv?.div) continue;
    const top = pv.div.offsetTop;
    const h = pv.div.offsetHeight;
    if (!h) continue;
    if (readingLineY >= top && readingLineY < top + h) {
      return { pageIndex: i, yFraction: (readingLineY - top) / h };
    }
  }
  return null;
}

export function teardownCurrent() {
  if (currentPdf) {
    try { currentPdf.destroy(); } catch (_) {}
    currentPdf = null;
  }
  if (viewer) viewer.setDocument(null);
  currentDocId = null;
  pendingRestore = null;
}

export function getCurrentDocId() { return currentDocId; }

export async function getOutline() {
  if (!currentPdf) return [];
  try {
    return (await currentPdf.getOutline()) || [];
  } catch (_) { return []; }
}

export function jumpToDest(dest) {
  if (!linkService || !dest) return;
  try { linkService.goToDestination(dest); }
  catch (e) { console.warn("jumpToDest failed:", e); }
}

export function goToPage(pageNumber) {
  if (!viewer) return;
  viewer.currentPageNumber = pageNumber;
}
