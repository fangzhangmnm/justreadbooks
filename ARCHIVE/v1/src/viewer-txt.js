// TXT 阅读器 —— 分章模式 (网络小说常见的"一章一屏"体验)。
//
// 数据模型:
//   text:     整本 utf-8 string (decode 完的)
//   chapters: [{title, start, end}]  (char offset 区间,start..<end)
//   currentChapter: 当前显示的章节 index
//   位置: {pageIndex: chapterIndex, yFraction}  — yFraction 是当前章 DOM 内的滚动比例
//
// 渲染策略:
//   - **每次只渲染当前一章**(网文一章一般 2000-5000 字,DOM 不会爆)
//   - 顶部 / 底部各一个"上一章" "下一章"按钮 + 进度 "12/250 章"
//   - 键盘: ← / [ 上一章, → / ] 下一章, Space / PageDown 翻页, Shift+Space / PageUp 上翻
//   - 切章 = teardown 本章 DOM + 渲染新章 + 滚到顶 (或 yFraction)
//
// 跨设备同步:章节边界稳定的前提下 pageIndex 可比;
// yFraction 是章内 DOM 高度比,只要章节内容不变也基本可比。
//
// 字体 / 字号 / 行高 / 阅读宽度:存 localStorage,跨论文共享。

import { READING_LINE_ANCHOR } from "./config.js";

const FONT_SIZE_KEY = "jrb.txt.fontSize";
const LINE_HEIGHT_KEY = "jrb.txt.lineHeight";
const FONT_FAMILY_KEY = "jrb.txt.fontFamily";
const MAX_WIDTH_KEY = "jrb.txt.maxWidth";

// 起点 / 番茄 / 七猫等手机阅读 app 默认大约 16-22 字 / 行。网文作者训练出来的节奏
// (短段落 + 对话独占行)在这个宽度下才不别扭。
// default: 19px × ~440px ≈ 22 字 / 行,行高 1.9 增加呼吸感。用户可在设置改。
const DEFAULTS = { fontSize: 19, lineHeight: 1.9, fontFamily: "sans", maxWidth: 440 };

function getPref(key, def) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return def;
    if (typeof def === "number") {
      const n = parseFloat(raw);
      return Number.isFinite(n) ? n : def;
    }
    return raw;
  } catch (_) { return def; }
}

function setPref(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (_) {}
}

let container = null;
let onPositionChange = null;
let onChapterPeek = null;

let currentDocId = null;
let text = "";
let chapters = [];
let currentChapter = 0;

let chapterBodyEl = null;   // 当前章节正文 div (.txt-body),用来算 scrollHeight
let pendingRestoreYFraction = null;

let scrollHandler = null;
let saveTimer = null;
const SAVE_DELAY_MS = 500;
let isRestoring = false;

function applyPrefs() {
  if (!container) return;
  const fs = getPref(FONT_SIZE_KEY, DEFAULTS.fontSize);
  const lh = getPref(LINE_HEIGHT_KEY, DEFAULTS.lineHeight);
  const ff = getPref(FONT_FAMILY_KEY, DEFAULTS.fontFamily);
  const mw = getPref(MAX_WIDTH_KEY, DEFAULTS.maxWidth);
  container.style.setProperty("--txt-font-size", `${fs}px`);
  container.style.setProperty("--txt-line-height", String(lh));
  container.style.setProperty("--txt-max-width", `${mw}px`);
  container.dataset.fontFamily = ff;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// 键盘:仅当 viewer 可见且没有 input/textarea/select 聚焦时响应
function isInputFocused() {
  const a = document.activeElement;
  if (!a) return false;
  const tag = a.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || a.isContentEditable;
}

function onKeyDown(e) {
  if (!container || container.classList.contains("hidden")) return;
  if (isInputFocused()) return;
  // 修饰键(Ctrl/Cmd)留给浏览器,自己不抢
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  switch (e.key) {
    case "ArrowLeft":
    case "[":
      e.preventDefault();
      prevChapter();
      break;
    case "ArrowRight":
    case "]":
      e.preventDefault();
      nextChapter();
      break;
    case "PageDown":
      e.preventDefault();
      pageDownOrNextChapter();
      break;
    case " ":
      if (e.shiftKey) { e.preventDefault(); pageUpOrPrevChapter(); }
      else { e.preventDefault(); pageDownOrNextChapter(); }
      break;
    case "PageUp":
      e.preventDefault();
      pageUpOrPrevChapter();
      break;
  }
}

function pageDownOrNextChapter() {
  if (!container) return;
  const max = container.scrollHeight - container.clientHeight;
  if (container.scrollTop >= max - 4) {
    // 已经到底 → 下一章
    nextChapter();
  } else {
    container.scrollBy({ top: container.clientHeight * 0.9, behavior: "smooth" });
  }
}

function pageUpOrPrevChapter() {
  if (!container) return;
  if (container.scrollTop <= 4) {
    prevChapter();
  } else {
    container.scrollBy({ top: -container.clientHeight * 0.9, behavior: "smooth" });
  }
}

export function initTxtViewer({ containerEl, onPosition, onChapterPeek: ocp }) {
  container = containerEl;
  onPositionChange = onPosition;
  onChapterPeek = ocp || null;
  applyPrefs();

  scrollHandler = () => {
    if (isRestoring) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const p = currentPosition();
      if (p && onPositionChange) onPositionChange(p);
    }, SAVE_DELAY_MS);
  };
  container.addEventListener("scroll", scrollHandler, { passive: true });
  document.addEventListener("keydown", onKeyDown);
}

// 加载 / 切换一本 TXT
export function loadTxt({ docId, text: t, chapters: chs, position }) {
  if (!container) throw new Error("txt viewer 未 init");
  currentDocId = docId;
  text = t;
  chapters = (chs && chs.length) ? chs : [{ title: "全文", start: 0, end: t.length }];
  currentChapter = Math.max(0, Math.min(chapters.length - 1, position?.pageIndex ?? 0));
  pendingRestoreYFraction = position?.yFraction ?? 0;
  renderCurrentChapter();
}

function renderCurrentChapter() {
  if (!container) return;
  container.innerHTML = "";
  const inner = document.createElement("div");
  inner.className = "txt-inner";

  // 顶部导航
  const topNav = buildChapterNav("top");
  inner.appendChild(topNav);

  // 章节
  const sec = document.createElement("section");
  sec.className = "txt-chapter";
  const ch = chapters[currentChapter];

  // 标题单独渲染 H2(big, 加粗,居中),正文从 ch.bodyStart 开始,不含标题行
  const titleEl = document.createElement("h2");
  titleEl.className = "txt-chapter-title";
  titleEl.textContent = ch.title || `第 ${currentChapter + 1} 章`;
  sec.appendChild(titleEl);

  const body = document.createElement("div");
  body.className = "txt-body";
  // 优先用 bodyStart (chapter-split 已经跳过标题行 + 空行);旧数据没 bodyStart 就用 start
  const bodyStart = (ch.bodyStart != null) ? ch.bodyStart : ch.start;
  body.textContent = text.slice(bodyStart, ch.end);
  sec.appendChild(body);
  inner.appendChild(sec);
  chapterBodyEl = body;

  // 底部导航
  const bottomNav = buildChapterNav("bottom");
  inner.appendChild(bottomNav);

  container.appendChild(inner);

  // restore yFraction
  isRestoring = true;
  requestAnimationFrame(() => {
    const yf = pendingRestoreYFraction ?? 0;
    pendingRestoreYFraction = null;
    const max = container.scrollHeight - container.clientHeight;
    container.scrollTop = Math.max(0, Math.min(max, max * yf));
    // 一帧后再校准 (字体加载完高度可能变)
    requestAnimationFrame(() => {
      const max2 = container.scrollHeight - container.clientHeight;
      container.scrollTop = Math.max(0, Math.min(max2, max2 * yf));
      isRestoring = false;
    });
  });

  // 通知 app 章号变了
  if (onChapterPeek) {
    onChapterPeek(currentChapter, chapters[currentChapter]?.title || "");
  }
}

function buildChapterNav(pos) {
  const wrap = document.createElement("div");
  wrap.className = `chapter-nav chapter-nav-${pos}`;
  const prev = document.createElement("button");
  prev.type = "button"; prev.className = "chapter-nav-button";
  prev.textContent = "‹ 上一章";
  prev.disabled = currentChapter <= 0;
  prev.addEventListener("click", prevChapter);

  const mid = document.createElement("div");
  mid.className = "chapter-nav-mid";
  const title = document.createElement("div");
  title.className = "chapter-nav-title";
  title.textContent = chapters[currentChapter]?.title || `第 ${currentChapter + 1} 章`;
  const prog = document.createElement("div");
  prog.className = "chapter-nav-progress";
  prog.textContent = `${currentChapter + 1} / ${chapters.length}`;
  mid.append(title, prog);

  const next = document.createElement("button");
  next.type = "button"; next.className = "chapter-nav-button";
  next.textContent = "下一章 ›";
  next.disabled = currentChapter >= chapters.length - 1;
  next.addEventListener("click", nextChapter);

  wrap.append(prev, mid, next);
  return wrap;
}

function nextChapter() {
  if (currentChapter >= chapters.length - 1) return;
  goToChapter(currentChapter + 1);
}

function prevChapter() {
  if (currentChapter <= 0) return;
  goToChapter(currentChapter - 1);
}

export function goToChapter(i) {
  if (chapters.length === 0) return;
  const newIdx = Math.max(0, Math.min(chapters.length - 1, i));
  if (newIdx === currentChapter && container.scrollTop < 4) return;
  currentChapter = newIdx;
  pendingRestoreYFraction = 0; // 跳章默认从顶看
  renderCurrentChapter();
  // 报位置给 session(立即,不等 debounce)
  if (onPositionChange) onPositionChange({ pageIndex: currentChapter, yFraction: 0 });
}

export function currentPosition() {
  if (!container || chapters.length === 0) return null;
  const max = Math.max(1, container.scrollHeight - container.clientHeight);
  const yFraction = clamp01(container.scrollTop / max);
  return { pageIndex: currentChapter, yFraction };
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

export function restorePosition({ pageIndex, yFraction }) {
  if (!container || chapters.length === 0) return false;
  const i = Math.max(0, Math.min(chapters.length - 1, pageIndex));
  if (i !== currentChapter) {
    currentChapter = i;
    pendingRestoreYFraction = yFraction;
    renderCurrentChapter();
  } else {
    // 同章内 nudge
    const max = Math.max(0, container.scrollHeight - container.clientHeight);
    isRestoring = true;
    container.scrollTop = max * (yFraction ?? 0);
    requestAnimationFrame(() => {
      const max2 = Math.max(0, container.scrollHeight - container.clientHeight);
      container.scrollTop = max2 * (yFraction ?? 0);
      isRestoring = false;
    });
  }
  return true;
}

export function getChapters() { return chapters; }
export function getCurrentChapter() { return currentChapter; }
export function getCurrentDocId() { return currentDocId; }

export function teardownCurrent() {
  if (container) container.innerHTML = "";
  chapters = [];
  text = "";
  chapterBodyEl = null;
  currentDocId = null;
  pendingRestoreYFraction = null;
}

// ── 阅读偏好 ─────────────────────────────────────────────────────────────

export function getReaderPrefs() {
  return {
    fontSize: getPref(FONT_SIZE_KEY, DEFAULTS.fontSize),
    lineHeight: getPref(LINE_HEIGHT_KEY, DEFAULTS.lineHeight),
    fontFamily: getPref(FONT_FAMILY_KEY, DEFAULTS.fontFamily),
    maxWidth: getPref(MAX_WIDTH_KEY, DEFAULTS.maxWidth),
  };
}

export function setReaderPrefs(patch) {
  if (patch.fontSize != null) setPref(FONT_SIZE_KEY, patch.fontSize);
  if (patch.lineHeight != null) setPref(LINE_HEIGHT_KEY, patch.lineHeight);
  if (patch.fontFamily != null) setPref(FONT_FAMILY_KEY, patch.fontFamily);
  if (patch.maxWidth != null) setPref(MAX_WIDTH_KEY, patch.maxWidth);
  applyPrefs();
}

// 切完章节(用户改了正则)→ 用 anchor 字符偏移找回新章节 + 重渲染
export function reapplyChapters(newChapters, anchorCharOffset) {
  if (!container) return;
  const t = text;
  chapters = (newChapters && newChapters.length)
    ? newChapters
    : [{ title: "全文", start: 0, end: t.length }];
  let newIdx = 0;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].start <= anchorCharOffset && anchorCharOffset < chapters[i].end) {
      newIdx = i; break;
    }
  }
  const ch = chapters[newIdx];
  const yFraction = ch.end > ch.start
    ? (anchorCharOffset - ch.start) / (ch.end - ch.start)
    : 0;
  currentChapter = newIdx;
  pendingRestoreYFraction = yFraction;
  renderCurrentChapter();
}

// 当前阅读位置对应的字符偏移(全文坐标)。切分变更时锚定用
export function currentCharOffset() {
  const pos = currentPosition();
  if (!pos) return 0;
  const ch = chapters[pos.pageIndex];
  if (!ch) return 0;
  return Math.floor(ch.start + (ch.end - ch.start) * pos.yFraction);
}
