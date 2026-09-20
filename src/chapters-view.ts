// 目录 view：第三个整屏 view（与书架 #galleryFull / 设置 #settingsView 同族）。created 2026-09-20 by Claude Fable 5.1
//   user 2026-09-20：「目录视图不应该是模态对话框的丑样子，而是全屏 list（留出血线），右上角有退出」「目录退出钮右，分组清单同意」
//   「小心超级长书，网文几千章 + 蒸馏的 card 轻轻松松五位数」。
// 形状：**分组清单**——有子节点的章是组头（chevron 可折叠），叶子是行，按深度缩进；默认全展开、打开时定位到当前章（高亮居中）；
//   组头浮在清单顶上（floating header 模拟 sticky，告诉你滚到哪一篇了）。行一点即跳（目录不需要「选中 → 跳转」两步）。
// 五位数承重 = **虚拟化**：固定行高（CSS --ch-row），只挂视口 ±OVERSCAN 行，spacer 撑总高；搜索在预算好的标签数组上做，
//   无视折叠（命中行连祖先组头一起显示）。折叠态只记本会话（按书名），不落盘。
import { tree, type Chapter, type OutlineNode } from "./chapters/index.ts";

export interface ChapterRow { index: number; depth: number; group: boolean; collapsed: boolean; /** 最近的祖先组头 index；-1 = 顶层。 */ groupIndex: number }

/** 树 → 可见行（纯函数）。collapsed = 折叠的组头 index；keep = 搜索谓词（null = 不搜）：命中行 + 其祖先组头保留、折叠无视。 */
export function flattenOutline(nodes: readonly OutlineNode[], collapsed: ReadonlySet<number>, keep: ((n: OutlineNode) => boolean) | null): ChapterRow[] {
  const out: ChapterRow[] = [];
  const walk = (list: readonly OutlineNode[], depth: number, groupIndex: number): boolean => {
    let any = false;
    for (const n of list) {
      const group = n.children.length > 0;
      if (keep) {
        const mark = out.length;
        out.push({ index: n.index, depth, group, collapsed: false, groupIndex });
        const sub = group ? walk(n.children, depth + 1, n.index) : false;
        if (!keep(n) && !sub) out.length = mark; else any = true;
      } else {
        const isCollapsed = group && collapsed.has(n.index);
        out.push({ index: n.index, depth, group, collapsed: isCollapsed, groupIndex });
        if (group && !isCollapsed) walk(n.children, depth + 1, n.index);
        any = true;
      }
    }
    return any;
  };
  walk(nodes, 0, -1);
  return out;
}

/** 视口窗（纯函数）：[start, end) 要挂到 DOM 的行。 */
export function windowRange(total: number, rowH: number, scrollTop: number, viewportH: number, overscan: number): { start: number; end: number } {
  if (total <= 0 || rowH <= 0) return { start: 0, end: 0 };
  const start = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
  const end = Math.min(total, Math.ceil((scrollTop + viewportH) / rowH) + overscan);
  return { start, end: Math.max(start, end) };
}

/** 每个节点的父组头 index（-1 = 顶层）；定位当前章时用来展开祖先。 */
export function parentMap(nodes: readonly OutlineNode[]): Map<number, number> {
  const m = new Map<number, number>();
  const walk = (list: readonly OutlineNode[], parent: number) => { for (const n of list) { m.set(n.index, parent); if (n.children.length) walk(n.children, n.index); } };
  walk(nodes, -1);
  return m;
}

export interface ChaptersViewDeps {
  el: HTMLElement;
  chapters: () => readonly Chapter[];
  titleOf: (i: number) => string;
  currentIndex: () => number;
  goTo: (i: number) => void;
  /** 折叠态按书记（本会话）；null = 没书。 */
  bookKey: () => string | null;
  /** 「目录 · N 章」 */
  title: (n: number) => string;
  /** chevron 的 aria：折叠 / 展开 */
  toggleLabel: (collapsed: boolean) => string;
  onClosed: () => void;
}
export interface ChaptersView {
  open(): void; close(): void; toggle(): void; isOpen(): boolean;
  /** 回到当前章（高亮行居中；祖先折叠着就展开）。 */
  locate(): void;
  /** 探针 / 测试：当前可见行数与 DOM 行数。 */
  stats(): { rows: number; mounted: number };
}

const OVERSCAN = 20;
const $ = (root: ParentNode, id: string): HTMLElement => { const el = root.querySelector<HTMLElement>(`#${id}`); if (!el) throw new Error(`chapters-view: #${id} missing`); return el; };

export function initChaptersView(d: ChaptersViewDeps): ChaptersView {
  const el = d.el;
  const titleEl = $(el, "chaptersTitle"), search = $(el, "chaptersSearch") as HTMLInputElement, floatEl = $(el, "chaptersFloat");
  const scroll = $(el, "chaptersScroll"), spacer = $(el, "chaptersSpacer"), empty = $(el, "chaptersEmpty");
  const collapsedByBook = new Map<string, Set<number>>();
  let nodes: OutlineNode[] = [], parents = new Map<number, number>(), rows: ChapterRow[] = [];
  let lowers: string[] = [];   // 「N. 标题」小写，搜索用（打开时预算一次）
  let q = "", current = -1, rowH = 44, last: { start: number; end: number } | null = null;
  const pool: HTMLElement[] = [];

  const collapsed = (): Set<number> => { const k = d.bookKey() ?? ""; let s = collapsedByBook.get(k); if (!s) { s = new Set(); collapsedByBook.set(k, s); } return s; };
  const readRowH = (): number => { const v = parseFloat(getComputedStyle(el).getPropertyValue("--ch-row")); return Number.isFinite(v) && v > 0 ? v : 44; };

  const makeRow = (): HTMLElement => {
    const row = document.createElement("div"); row.className = "ch-row"; row.setAttribute("role", "option");
    const jump = document.createElement("button"); jump.type = "button"; jump.className = "ch-jump";
    const num = document.createElement("span"); num.className = "ch-num";
    const title = document.createElement("span"); title.className = "ch-title";
    jump.append(num, title);
    const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "ch-toggle";
    toggle.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#chevron-down"/></svg>`;
    row.append(jump, toggle);
    return row;
  };
  const paint = (row: HTMLElement, r: ChapterRow, k: number): void => {
    row.style.top = `${k * rowH}px`;
    row.dataset.index = String(r.index); row.dataset.kind = r.group ? "group" : "leaf";
    if (r.index === current) row.setAttribute("aria-current", "true"); else row.removeAttribute("aria-current");
    const jump = row.firstElementChild as HTMLElement; jump.style.paddingLeft = `${4 + r.depth * 16}px`;
    (jump.children[0] as HTMLElement).textContent = `${r.index + 1}.`;
    (jump.children[1] as HTMLElement).textContent = d.titleOf(r.index);
    const toggle = row.lastElementChild as HTMLElement;
    toggle.hidden = !r.group || q !== "";   // 搜索时无折叠
    if (r.group) { toggle.setAttribute("aria-label", d.toggleLabel(r.collapsed)); toggle.querySelector("use")?.setAttribute("href", r.collapsed ? "#chevron-right" : "#chevron-down"); }
  };

  const render = (force: boolean): void => {
    const w = windowRange(rows.length, rowH, scroll.scrollTop, scroll.clientHeight, OVERSCAN);
    if (!force && last && last.start === w.start && last.end === w.end) { paintFloat(); return; }
    last = w;
    const n = w.end - w.start;
    while (pool.length < n) { const row = makeRow(); pool.push(row); spacer.appendChild(row); }
    while (pool.length > n) pool.pop()!.remove();
    for (let i = 0; i < n; i++) paint(pool[i]!, rows[w.start + i]!, w.start + i);
    paintFloat();
  };
  const paintFloat = (): void => {
    const first = rows[Math.min(rows.length - 1, Math.max(0, Math.floor(scroll.scrollTop / rowH)))];
    const g = first ? first.groupIndex : -1;
    if (g < 0 || !first || first.index === g) { floatEl.hidden = true; return; }   // 顶层 / 组头自己就在视口顶 → 不浮
    floatEl.hidden = false; floatEl.textContent = `${g + 1}. ${d.titleOf(g)}`;
  };
  const rebuild = (): void => {
    const keep = q ? (n: OutlineNode) => (lowers[n.index] ?? "").includes(q) : null;
    rows = flattenOutline(nodes, collapsed(), keep);
    spacer.style.height = `${rows.length * rowH}px`;
    empty.hidden = rows.length > 0;
    last = null; render(true);
  };
  const locate = (): void => {
    if (current < 0) return;
    const set = collapsed(); let p = parents.get(current) ?? -1, changed = false;
    while (p >= 0) { if (set.delete(p)) changed = true; p = parents.get(p) ?? -1; }
    if (changed || q) { q = ""; search.value = ""; rebuild(); }
    const r = rows.findIndex((x) => x.index === current);
    if (r < 0) return;
    scroll.scrollTop = Math.max(0, r * rowH - (scroll.clientHeight - rowH) / 2);
    render(true);
  };

  spacer.addEventListener("click", (e) => {
    const t = e.target as HTMLElement | null;
    const row = t?.closest<HTMLElement>(".ch-row"); if (!row) return;
    const index = Number(row.dataset.index);
    if (t?.closest(".ch-toggle")) { const set = collapsed(); if (!set.delete(index)) set.add(index); rebuild(); return; }
    if (t?.closest(".ch-jump")) { close(); d.goTo(index); }
  });
  scroll.addEventListener("scroll", () => render(false), { passive: true });
  window.addEventListener("resize", () => { if (!el.hidden) { rowH = readRowH(); rebuild(); } });
  search.addEventListener("input", () => { q = search.value.trim().toLowerCase(); rebuild(); scroll.scrollTop = 0; render(true); });
  $(el, "chaptersClose").addEventListener("click", () => close());
  $(el, "chaptersLocate").addEventListener("click", () => locate());

  function open(): void {
    const chs = d.chapters();
    nodes = tree(chs); parents = parentMap(nodes);
    lowers = chs.map((_, i) => `${i + 1}. ${d.titleOf(i)}`.toLowerCase());
    current = d.currentIndex(); q = ""; search.value = "";
    titleEl.textContent = d.title(chs.length);
    el.hidden = false;
    rowH = readRowH();
    rebuild(); locate();
  }
  function close(): void { if (el.hidden) return; el.hidden = true; d.onClosed(); }
  return {
    open, close, locate,
    toggle: () => { if (el.hidden) open(); else close(); },
    isOpen: () => !el.hidden,
    stats: () => ({ rows: rows.length, mounted: pool.length }),
  };
}
