// 目录 view：第三个整屏 view（与书架 #galleryFull / 设置 #settingsView 同族）。created 2026-09-20 by Claude Fable 5.1
//   user 2026-09-20：「目录视图不应该是模态对话框的丑样子，而是全屏 list（留出血线），右上角有退出」「目录退出钮右，分组清单同意」
//   「小心超级长书，网文几千章 + 蒸馏的 card 轻轻松松五位数」。
// 形状：**分组清单**——有子节点的章是组头（只是加粗的一行，点了跳篇首），每深一级缩进一格；一维、打开时定位到当前章（高亮居中）；
//   组头浮在清单顶上（floating header 模拟 sticky，告诉你滚到哪一篇了）。行一点即跳（目录不需要「选中 → 跳转」两步）。
//   **展开收起**（user 2026-10-01「目录帮我做一个缩进，然后默认全锁进，可以选择展开几级」「per行小三角也要」）：
//     · 整本一起：搜索框旁「展开到：1 级 / 2 级 / … / 全部」，默认 1 级；书只有一级时不出现。选一次级数 = 把单独点过的组都重置。
//     · 每一组：组头左边一个小三角，点三角只展开 / 收起这一组；点这一行别的地方照旧跳过去。
//     · 收起的组头后面标底下有几章；当前章被收起时高亮它所在的、看得见的那一级；搜索时不看展开收起，命中的都摊开（三角藏起来）。
//     · 这些只记在这次打开 app 期间、换书清掉（不新加存储字段）。
//   来由：0.1.7 时 AI 推荐「分组清单」的理由里写过「折叠树在 iPad / Quest 上戳三角很烦」，然后实现时又塞了三角，user 指出前后矛盾
//   （「不是说不做展开小三角吗」）→ 0.1.8 撤。2026-10-01 user 自己要回来了。
// 五位数承重 = **虚拟化**：固定行高（CSS --ch-row），只挂视口 ±OVERSCAN 行，spacer 撑总高；搜索在预算好的标签数组上做（命中行连祖先组头一起显示）。
import { tree, type Chapter, type OutlineNode } from "./chapters/index.ts";

export interface ChapterRow { index: number; depth: number; group: boolean; /** 最近的祖先组头 index；-1 = 顶层。 */ groupIndex: number; /** 收起时底下藏了几章（0 = 没收起）。 */ folded: number }

/** 一棵（子）树里有几个节点（不含自己）。 */
function countBelow(n: OutlineNode): number { let c = 0; for (const k of n.children) c += 1 + countBelow(k); return c; }
/** 树有几级（扁平 = 1）。 */
export function outlineDepth(nodes: readonly OutlineNode[]): number {
  let max = 0;
  const walk = (list: readonly OutlineNode[], d: number): void => { for (const n of list) { if (d > max) max = d; if (n.children.length) walk(n.children, d + 1); } };
  walk(nodes, 1);
  return max;
}
/**
 * 树 → 可见行（纯函数）。keep = 搜索谓词（null = 不搜）：命中行 + 其祖先组头保留，这时不看级数。
 * levels = 不搜时展开到几级（1 = 只有最上一级；Infinity = 全部）；被收起的组头 folded = 底下藏了几章。
 */
export function flattenOutline(nodes: readonly OutlineNode[], keep: ((n: OutlineNode) => boolean) | null, levels = Infinity, toggled: ReadonlyMap<number, boolean> | null = null): ChapterRow[] {
  const out: ChapterRow[] = [];
  const walk = (list: readonly OutlineNode[], depth: number, groupIndex: number): boolean => {
    let any = false;
    for (const n of list) {
      const group = n.children.length > 0;
      const mark = out.length;
      const own = toggled?.get(n.index);   // 这一组单独点过：true = 展开，false = 收起；没点过 = 按级数
      const fold = !keep && group && (own !== undefined ? !own : depth + 1 >= levels);
      out.push({ index: n.index, depth, group, groupIndex, folded: fold ? countBelow(n) : 0 });
      const sub = group && !fold ? walk(n.children, depth + 1, n.index) : false;
      if (keep && !keep(n) && !sub) out.length = mark; else any = true;
    }
    return any;
  };
  walk(nodes, 0, -1);
  return out;
}
/** 每章的父节点 index（-1 = 顶层）。 */
export function parentMap(nodes: readonly OutlineNode[], n: number): Int32Array {
  const p = new Int32Array(n).fill(-1);
  const walk = (list: readonly OutlineNode[], parent: number): void => { for (const x of list) { p[x.index] = parent; if (x.children.length) walk(x.children, x.index); } };
  walk(nodes, -1);
  return p;
}

/** 视口窗（纯函数）：[start, end) 要挂到 DOM 的行。 */
export function windowRange(total: number, rowH: number, scrollTop: number, viewportH: number, overscan: number): { start: number; end: number } {
  if (total <= 0 || rowH <= 0) return { start: 0, end: 0 };
  const start = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
  const end = Math.min(total, Math.ceil((scrollTop + viewportH) / rowH) + overscan);
  return { start, end: Math.max(start, end) };
}

export interface ChaptersViewDeps {
  el: HTMLElement;
  chapters: () => readonly Chapter[];
  titleOf: (i: number) => string;
  currentIndex: () => number;
  goTo: (i: number) => void;
  /** 「目录 · N 章」 */
  title: (n: number) => string;
  /** 「展开到」下拉的选项文字：n 级 / 全部。 */
  levelLabel: (n: number | "all") => string;
  /** 小三角的读屏 / 悬停文字：open = 现在是展开的。 */
  toggleLabel: (open: boolean) => string;
  onClosed: () => void;
}
export interface ChaptersView {
  open(): void; close(): void; toggle(): void; isOpen(): boolean;
  /** 回到当前章（高亮行居中；搜索中就先清搜索）。 */
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
  const levelSel = $(el, "chaptersLevels") as HTMLSelectElement, levelRow = $(el, "chaptersLevelRow");
  let nodes: OutlineNode[] = [], rows: ChapterRow[] = [], parents = new Int32Array(0), depthMax = 1;
  let levels = 1;          // 展开到几级（这次打开 app 期间记着；默认 1 = 全收起）
  let toggled = new Map<number, boolean>();   // 单独点过三角的组：true = 展开，false = 收起
  let bookKey: readonly Chapter[] | null = null;   // 换书就清掉 toggled
  let shown = -1;          // 高亮哪一行：当前章；当前章被收起时 = 它所在的、看得见的那一级组头
  let lowers: string[] = [];   // 「N. 标题」小写，搜索用（打开时预算一次）
  let q = "", current = -1, rowH = 44, last: { start: number; end: number } | null = null;
  const pool: HTMLElement[] = [];

  const readRowH = (): number => { const v = parseFloat(getComputedStyle(el).getPropertyValue("--ch-row")); return Number.isFinite(v) && v > 0 ? v : 44; };

  const makeRow = (): HTMLElement => {
    const row = document.createElement("div"); row.className = "ch-row"; row.setAttribute("role", "option");
    const tog = document.createElement("button"); tog.type = "button"; tog.className = "ch-toggle";
    tog.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#chevron-right"/></svg>';
    const jump = document.createElement("button"); jump.type = "button"; jump.className = "ch-jump";
    const num = document.createElement("span"); num.className = "ch-num";
    const title = document.createElement("span"); title.className = "ch-title";
    const count = document.createElement("span"); count.className = "ch-count";
    jump.append(num, title, count);
    row.append(tog, jump);
    return row;
  };
  const paint = (row: HTMLElement, r: ChapterRow, k: number): void => {
    row.style.top = `${k * rowH}px`;
    row.dataset.index = String(r.index); row.dataset.kind = r.group ? "group" : "leaf";
    if (r.index === shown) row.setAttribute("aria-current", "true"); else row.removeAttribute("aria-current");
    const tog = row.children[0] as HTMLButtonElement, jump = row.children[1] as HTMLElement;
    tog.style.marginLeft = `${r.depth * 20}px`;
    const canToggle = r.group && !q;
    tog.style.visibility = canToggle ? "visible" : "hidden"; tog.tabIndex = canToggle ? 0 : -1;
    if (canToggle) { const open = r.folded === 0; tog.setAttribute("aria-expanded", String(open)); tog.setAttribute("aria-label", d.toggleLabel(open)); tog.title = d.toggleLabel(open); }
    else { tog.removeAttribute("aria-expanded"); tog.removeAttribute("aria-label"); tog.removeAttribute("title"); }
    (jump.children[0] as HTMLElement).textContent = `${r.index + 1}.`;
    (jump.children[1] as HTMLElement).textContent = d.titleOf(r.index);
    (jump.children[2] as HTMLElement).textContent = r.folded ? String(r.folded) : "";
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
    rows = flattenOutline(nodes, keep, levels >= depthMax ? Infinity : levels, toggled);
    // 当前章被收起来了：往上找到看得见的那一级
    const visible = new Set(rows.map((r) => r.index));
    shown = current;
    if (q) { if (!visible.has(shown)) shown = -1; }   // 搜索时：当前章不在结果里就不高亮（结果里的组头只是命中行的上级，高亮它会误导）
    else while (shown >= 0 && !visible.has(shown)) shown = parents[shown] ?? -1;
    spacer.style.height = `${rows.length * rowH}px`;
    empty.hidden = rows.length > 0;
    last = null; render(true);
  };
  const locate = (): void => {
    if (current < 0) return;
    if (q) { q = ""; search.value = ""; rebuild(); }
    const r = rows.findIndex((x) => x.index === shown);
    if (r < 0) return;
    scroll.scrollTop = Math.max(0, r * rowH - (scroll.clientHeight - rowH) / 2);
    render(true);
  };

  spacer.addEventListener("click", (e) => {
    const t = e.target as HTMLElement | null;
    const row = t?.closest<HTMLElement>(".ch-row"); if (!row) return;
    if (t?.closest(".ch-toggle")) {   // 只展开 / 收起这一组，不跳
      const i = Number(row.dataset.index), r = rows.find((x) => x.index === i);
      if (!r || !r.group || q) return;
      toggled.set(i, r.folded > 0);
      const top = scroll.scrollTop; rebuild(); scroll.scrollTop = top; render(true);
      return;
    }
    if (t?.closest(".ch-jump")) { close(); d.goTo(Number(row.dataset.index)); }
  });
  scroll.addEventListener("scroll", () => render(false), { passive: true });
  window.addEventListener("resize", () => { if (!el.hidden) { rowH = readRowH(); rebuild(); } });
  search.addEventListener("input", () => { q = search.value.trim().toLowerCase(); rebuild(); scroll.scrollTop = 0; render(true); });
  $(el, "chaptersClose").addEventListener("click", () => close());
  levelSel.addEventListener("change", () => { levels = Math.max(1, Number(levelSel.value) || 1); toggled = new Map(); rebuild(); locate(); });
  $(el, "chaptersLocate").addEventListener("click", () => locate());

  function open(): void {
    const chs = d.chapters();
    nodes = tree(chs);
    if (chs !== bookKey) { bookKey = chs; toggled = new Map(); }
    parents = parentMap(nodes, chs.length);
    depthMax = outlineDepth(nodes);
    levelRow.hidden = depthMax <= 1;
    if (depthMax > 1) {
      levels = Math.min(levels, depthMax);
      levelSel.textContent = "";
      for (let n = 1; n <= depthMax; n++) { const o = document.createElement("option"); o.value = String(n); o.textContent = n === depthMax ? d.levelLabel("all") : d.levelLabel(n); levelSel.appendChild(o); }
      levelSel.value = String(levels);
    }
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
