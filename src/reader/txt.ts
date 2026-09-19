// TXT 阅读器 —— 一章一屏（v1 viewer-txt.js 重写为 TS，语义不变；imperative island，不进任何 reactive 图）。created 2026-09-19 by Claude Fable 5.1
//   · 每次只渲染当前一章（DOM 不爆）；顶/底各一排「上一章 / 下一章」+ 进度 `i / n`
//   · 位置 = Anchor {chapter, title, frac}（frac = 章内滚动比例）；scroll 500ms 防抖后报位置；翻章立即报
//   · **adopt(newText)**（活书，计划 §4.6）：换底稿但**不重画当前章**——只更新章数/进度；翻章或 applyPending() 才用新字节
//   · 偏好（字号/行高/字体/行宽档）经 CSS 变量作用在容器上；由 app 从 device-kv 读了传进来
import type { Chapter, Anchor, LiveUpdate } from "../chapters/index.ts";
import { resolveAnchor, clampFrac, diff as chapterDiff } from "../chapters/index.ts";
import { READER_WIDTH_PX } from "../config.ts";

export interface ReaderPrefs { fontSize: number; lineHeight: number; fontFamily: "sans" | "serif"; widthTier: "novel" | "classic" }
export interface TxtReaderDeps {
  container: HTMLElement;
  onPosition: (a: Anchor) => void;
  onChapter: (index: number, title: string) => void;
  /** 合成章/无标题时的显示名 + 按钮文案（i18n 由 app 给）。 */
  text: { prev: string; next: string; head: string; whole: string; chapterN: (n: number) => string; progress: (i: number, n: number) => string };
}
export interface TxtReader {
  load(text: string, chapters: readonly Chapter[], anchor: Anchor | null): void;
  /** 换底稿不重画（返回 diff 给 chip）。 */
  adopt(text: string, chapters: readonly Chapter[]): LiveUpdate;
  /** 把 adopt 进来的新字节真正用上：按当前锚在新章节表里找回同一章并重画。 */
  applyPending(): boolean;
  hasPending(): boolean;
  current(): Anchor | null;
  restore(anchor: Anchor): boolean;
  goTo(index: number): void;
  next(): void;
  prev(): void;
  currentIndex(): number;
  chapters(): readonly Chapter[];
  titleOf(i: number): string;
  /** 翻屏（Space / PageDown）：到底则下一章。 */
  pageStep(dir: 1 | -1): void;
  /** 手柄 D-pad：N 行量化滚动、对齐行格（Quest）。 */
  lineStep(dir: 1 | -1, lines: number): void;
  applyPrefs(p: ReaderPrefs): void;
  /** load 之后用户动过没有（滚 / 翻章）——活书采纳「未动静默换底、已动出 chip」的判据。 */
  touched(): boolean;
  isLoaded(): boolean;
  teardown(): void;
}

export function createTxtReader(d: TxtReaderDeps): TxtReader {
  const c = d.container;
  let text = "", chapters: readonly Chapter[] = [], cur = 0;
  let pending: { text: string; chapters: readonly Chapter[] } | null = null;
  let pendingFrac: number | null = null, restoring = false, saveTimer: ReturnType<typeof setTimeout> | null = null, touchedFlag = false, loaded = false;

  const titleOf = (i: number): string => { const ch = chapters[i]; if (!ch) return ""; if (ch.synthetic === "head") return d.text.head; if (ch.synthetic === "whole") return d.text.whole; return ch.title || d.text.chapterN(i + 1); };
  const maxScroll = () => Math.max(0, c.scrollHeight - c.clientHeight);

  function render(): void {
    c.innerHTML = "";
    const inner = document.createElement("div"); inner.className = "txt-inner";
    inner.appendChild(nav("top"));
    const sec = document.createElement("section"); sec.className = "txt-chapter";
    const ch = chapters[cur];
    if (ch) {
      if (!ch.synthetic) { const h = document.createElement("h2"); h.className = "txt-chapter-title"; h.textContent = titleOf(cur); sec.appendChild(h); }
      const body = document.createElement("div"); body.className = "txt-body"; body.textContent = text.slice(ch.bodyStart, ch.end); sec.appendChild(body);
    }
    inner.appendChild(sec);
    inner.appendChild(nav("bottom"));
    c.appendChild(inner);
    // restore frac：一帧后再校准一次（字体晚加载高度会变）
    restoring = true;
    const yf = pendingFrac ?? 0; pendingFrac = null;
    requestAnimationFrame(() => {
      c.scrollTop = maxScroll() * yf;
      requestAnimationFrame(() => { c.scrollTop = maxScroll() * yf; restoring = false; });
    });
    d.onChapter(cur, titleOf(cur));
  }
  function nav(pos: "top" | "bottom"): HTMLElement {
    const wrap = document.createElement("div"); wrap.className = `chapter-nav chapter-nav-${pos}`;
    const prevB = document.createElement("button"); prevB.type = "button"; prevB.className = "chapter-nav-button"; prevB.textContent = d.text.prev; prevB.disabled = cur <= 0; prevB.addEventListener("click", prev);
    const mid = document.createElement("div"); mid.className = "chapter-nav-mid";
    const title = document.createElement("div"); title.className = "chapter-nav-title"; title.textContent = titleOf(cur);
    const prog = document.createElement("div"); prog.className = "chapter-nav-progress"; prog.textContent = d.text.progress(cur + 1, chapters.length);
    mid.append(title, prog);
    const nextB = document.createElement("button"); nextB.type = "button"; nextB.className = "chapter-nav-button"; nextB.textContent = d.text.next; nextB.disabled = cur >= chapters.length - 1; nextB.addEventListener("click", next);
    wrap.append(prevB, mid, nextB);
    return wrap;
  }
  function refreshProgressOnly(): void {
    const n = (pending?.chapters ?? chapters).length;
    c.querySelectorAll<HTMLElement>(".chapter-nav-progress").forEach((el) => { el.textContent = d.text.progress(cur + 1, n); });
    c.querySelectorAll<HTMLButtonElement>(".chapter-nav-bottom .chapter-nav-button:last-child, .chapter-nav-top .chapter-nav-button:last-child").forEach((b) => { b.disabled = cur >= n - 1; });
  }
  function current(): Anchor | null {
    if (!loaded || chapters.length === 0) return null;
    return { chapter: cur, title: chapters[cur]?.title ?? "", frac: clampFrac(c.scrollTop / Math.max(1, maxScroll())) };
  }
  const onScroll = () => {
    if (restoring) return;
    touchedFlag = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; const p = current(); if (p) d.onPosition(p); }, 500);
  };
  c.addEventListener("scroll", onScroll, { passive: true });

  /** 有 pending 就先切底稿：当前章按标题在新表里找回。 */
  function swapPending(): void {
    if (!pending) return;
    const anchor: Anchor = { chapter: cur, title: chapters[cur]?.title ?? "", frac: 0 };
    text = pending.text; chapters = pending.chapters; pending = null;
    cur = resolveAnchor(anchor, chapters);
  }
  function goTo(i: number): void {
    if (chapters.length === 0 && !pending) return;
    swapPending();
    const idx = Math.max(0, Math.min(chapters.length - 1, i));
    if (idx === cur && c.scrollTop < 4) return;
    cur = idx; pendingFrac = 0; touchedFlag = true;
    render();
    const p = current(); if (p) d.onPosition(p);
  }
  function next(): void { const n = (pending?.chapters ?? chapters).length; if (cur < n - 1) goTo(cur + 1); }
  function prev(): void { if (cur > 0) goTo(cur - 1); }

  return {
    load(t, chs, anchor) {
      text = t; chapters = chs.length ? chs : [{ title: "", start: 0, bodyStart: 0, end: t.length, synthetic: "whole" }]; pending = null; loaded = true; touchedFlag = false;
      cur = anchor ? resolveAnchor(anchor, chapters) : 0;
      pendingFrac = anchor ? clampFrac(anchor.frac) : 0;
      render();
    },
    adopt(t, chs) {
      const upd = chapterDiff(text, chapters, t, chs, cur);
      pending = { text: t, chapters: chs };
      refreshProgressOnly();
      return upd;
    },
    applyPending() {
      if (!pending) return false;
      const frac = clampFrac(c.scrollTop / Math.max(1, maxScroll()));
      swapPending(); pendingFrac = frac; render();
      const p = current(); if (p) d.onPosition(p);
      return true;
    },
    hasPending: () => pending != null,
    current,
    restore(anchor) {
      if (!loaded) return false;
      swapPending();
      const i = resolveAnchor(anchor, chapters);
      if (i !== cur) { cur = i; pendingFrac = clampFrac(anchor.frac); render(); }
      else { restoring = true; c.scrollTop = maxScroll() * clampFrac(anchor.frac); requestAnimationFrame(() => { c.scrollTop = maxScroll() * clampFrac(anchor.frac); restoring = false; }); }
      return true;
    },
    goTo, next, prev,
    currentIndex: () => cur,
    chapters: () => chapters,
    titleOf,
    pageStep(dir) {
      touchedFlag = true;
      if (dir > 0) { if (c.scrollTop >= maxScroll() - 4) next(); else c.scrollBy({ top: c.clientHeight * 0.9, behavior: "smooth" }); }
      else { if (c.scrollTop <= 4) prev(); else c.scrollBy({ top: -c.clientHeight * 0.9, behavior: "smooth" }); }
    },
    lineStep(dir, lines) {
      touchedFlag = true;
      const cs = getComputedStyle(c);
      const fs = parseFloat(cs.getPropertyValue("--txt-font-size")), lh = parseFloat(cs.getPropertyValue("--txt-line-height"));
      const lineHeight = Number.isFinite(fs) && Number.isFinite(lh) && fs > 0 ? fs * lh : null;
      if (!lineHeight) { c.scrollBy({ top: (dir * c.clientHeight) / 3 }); return; }
      const body = c.querySelector<HTMLElement>(".txt-body");
      const anchor = body ? body.offsetTop : 0;
      const targetRaw = c.scrollTop + dir * lineHeight * lines;
      const N = Math.round((targetRaw - anchor) / lineHeight);
      c.scrollTop = Math.max(0, anchor + N * lineHeight);
    },
    applyPrefs(p) {
      c.style.setProperty("--txt-font-size", `${p.fontSize}px`);
      c.style.setProperty("--txt-line-height", String(p.lineHeight));
      c.style.setProperty("--txt-max-width", `${READER_WIDTH_PX[p.widthTier]}px`);
      c.dataset.fontFamily = p.fontFamily;
    },
    touched: () => touchedFlag,
    isLoaded: () => loaded,
    teardown() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } c.innerHTML = ""; text = ""; chapters = []; pending = null; cur = 0; loaded = false; touchedFlag = false; },
  };
}
