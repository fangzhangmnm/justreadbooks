// 键盘 + 手柄（v1 app.js 移植）：阅读区可见且没有输入框聚焦时响应。created 2026-09-19 by Claude Fable 5.1
//   键盘：←/[ 上一章 · →/] 下一章 · Space/PageDown 翻屏（到底翻章）· Shift+Space/PageUp 上翻 · B 书架 · O 目录 · S 设置 · Esc 关面板
//   手柄（standard mapping；Quest 场景）：D-pad ↑↓(12/13) 4 行量化 · ←→(14/15) 上/下一章 · Select(8) 目录 · Start(9)/Home(16) 书架。边沿触发不连发。
import type { TxtReader } from "./txt.ts";

export interface KeysDeps {
  reader: () => TxtReader | null;
  readerVisible: () => boolean;
  modalOpen: () => boolean;
  toggleShelf: () => void;
  toggleChapters: () => void;
  /** 目录 view 开着：它是 modal，但 o / 手柄 Select 要能把它关掉（Quest 没 Escape）。 */
  chaptersOpen: () => boolean;
  toggleSettings: () => void;
}
const DPAD_LINES = 4;
function inputFocused(): boolean {
  const a = document.activeElement;
  if (!a) return false;
  const tag = a.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (a as HTMLElement).isContentEditable;
}
export function initKeys(d: KeysDeps): void {
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || inputFocused()) return;
    if (d.chaptersOpen()) { if (e.key === "o" || e.key === "O") { e.preventDefault(); d.toggleChapters(); } return; }
    if (d.modalOpen()) return;
    switch (e.key) {
      case "b": case "B": e.preventDefault(); d.toggleShelf(); return;
      case "o": case "O": e.preventDefault(); d.toggleChapters(); return;
      case "s": case "S": e.preventDefault(); d.toggleSettings(); return;
    }
    const r = d.reader(); if (!r || !d.readerVisible()) return;
    switch (e.key) {
      case "ArrowLeft": case "[": e.preventDefault(); r.prev(); break;
      case "ArrowRight": case "]": e.preventDefault(); r.next(); break;
      case "PageDown": e.preventDefault(); r.pageStep(1); break;
      case "PageUp": e.preventDefault(); r.pageStep(-1); break;
      case " ": e.preventDefault(); r.pageStep(e.shiftKey ? -1 : 1); break;
    }
  });
  const prev = new Set<number>();
  let raf: number | null = null;
  function poll(): void {
    raf = requestAnimationFrame(poll);
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp: Gamepad | null = null; for (const g of gps) { if (g) { gp = g; break; } }
    if (!gp) return;
    const pressed = (i: number) => !!gp!.buttons[i]?.pressed;
    const edge = (i: number) => pressed(i) && !prev.has(i);
    const r = d.reader();
    if (d.chaptersOpen() && !inputFocused()) { if (edge(8)) d.toggleChapters(); }
    else if (r && d.readerVisible() && !d.modalOpen() && !inputFocused()) {
      if (edge(12)) r.lineStep(-1, DPAD_LINES);
      if (edge(13)) r.lineStep(1, DPAD_LINES);
      if (edge(14)) r.prev();
      if (edge(15)) r.next();
      if (edge(8)) d.toggleChapters();
    }
    if (edge(9) || edge(16)) d.toggleShelf();
    prev.clear(); gp.buttons.forEach((b, i) => { if (b.pressed) prev.add(i); });
  }
  window.addEventListener("gamepadconnected", () => { if (raf == null) raf = requestAnimationFrame(poll); });
}
