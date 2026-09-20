// in-app 模态原语：busy 遮罩 / 确认 / 输入 / 多选 / sync gate。守家规「禁系统 alert/prompt/confirm」（Quest 沉浸态弹不出）。
// created 2026-09-03 by Claude Fable 5.1（WXHW）· 2026-09-19 拷入 JRB by Claude Fable 5.1（WeebPaint sheets.ts + fullscreen-busy.ts 塌成一个文件；纯 DOM，自持元素引用）。
//
// busy/sheet 互斥护栏（WeebPaint 2026-06-12 死锁修复）：busy 遮罩盖住输入框 → await 永不 resolve。
//   → 交互输入必须在 withBusy 之外；这里对 confirm/input/choice **响亮 throw**。gate 不受此限（自带 spinner，与 busy 协同）。

const $ = (id: string) => document.getElementById(id) as HTMLElement;

// ── busy 遮罩（可重入 ref-count；store 深模块内部也会嵌套调 busy）──
let _busyDepth = 0;
export function showBusy(label: string, hint = ""): void {
  $("busyOverlay").classList.remove("hidden");
  $("busyOverlayText").textContent = label;
  $("busyOverlayHint").textContent = hint;
}
export function hideBusy(): void { $("busyOverlay").classList.add("hidden"); }
export function isBusyActive(): boolean { return !$("busyOverlay").classList.contains("hidden"); }
export async function withBusy<T>(label: string, fn: () => Promise<T> | T, hint = ""): Promise<T> {
  _busyDepth++;
  showBusy(label, hint);
  try { return await fn(); }
  finally { _busyDepth--; if (_busyDepth <= 0) { _busyDepth = 0; hideBusy(); } }
}

function _assertNotBusy(what: string): void {
  if (isBusyActive()) throw new Error(`sheet "${what}" opened while busy overlay is active (would deadlock) — move the interaction outside withBusy`);
}

// ── 通用 sheet（#sheet：title / message / input / choices / confirm / cancel）──
const g = {
  sheet: () => $("sheet"),      // 全屏容器（.crypto-modal 自带 dim 背景）；点容器空白处 = 取消
  title: () => $("sheetTitle"),
  message: () => $("sheetMessage"),
  input: () => $("sheetInput") as HTMLInputElement,
  input2: () => $("sheetInput2") as HTMLInputElement,
  error: () => $("sheetError"),
  choices: () => $("sheetChoices"),
  pick: () => $("sheetPick") as HTMLUListElement,
  check: () => $("sheetCheck"),
  checkInput: () => $("sheetCheckInput") as HTMLInputElement,
  checkLabel: () => $("sheetCheckLabel"),
  confirm: () => $("sheetConfirm") as HTMLButtonElement,
  cancel: () => $("sheetCancel") as HTMLButtonElement,
};
let _open: (() => void) | null = null;   // 当前 sheet 的 cancel 路径（backdrop / Escape 用）

function _show(): void { g.sheet().classList.remove("hidden"); }
function _hide(): void {
  g.sheet().classList.add("hidden"); g.sheet().classList.remove("sheet-full");
  if (document.activeElement instanceof HTMLElement && g.sheet().contains(document.activeElement)) document.activeElement.blur();
  _open = null;
}
function _reset(): void {
  g.message().classList.add("hidden"); g.message().classList.remove("warning");
  g.input().classList.add("hidden"); g.input2().classList.add("hidden");
  g.error().classList.add("hidden"); g.error().textContent = "";
  g.choices().classList.add("hidden"); g.choices().innerHTML = "";
  g.pick().classList.add("hidden"); g.pick().innerHTML = "";
  g.check().classList.add("hidden"); g.checkInput().checked = false;
  g.confirm().classList.remove("hidden", "danger"); g.cancel().classList.remove("hidden");
  g.sheet().classList.remove("sheet-full");
  g.input().value = ""; g.input2().value = "";
  g.input().style.setProperty("-webkit-text-security", ""); g.input2().style.setProperty("-webkit-text-security", "");
}
export function initSheets(labels: { ok: string; cancel: string }): void {
  g.confirm().textContent = labels.ok;
  g.cancel().textContent = labels.cancel;
  g.sheet().addEventListener("click", (e) => { if (e.target === g.sheet()) _open?.(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && _open && !e.defaultPrevented) { e.preventDefault(); _open(); }
  }, true);
}

export interface ConfirmOpts { danger?: boolean; okLabel?: string; cancelLabel?: string; warning?: boolean; /** 一个勾（2.1「保留高清」）：结果经 openConfirmSheetEx 拿。 */ checkbox?: { label: string; checked?: boolean } }
export function openConfirmSheet(title: string, message: string, opts: ConfirmOpts = {}): Promise<boolean> {
  return openConfirmSheetEx(title, message, opts).then((r) => r.ok);
}
/** confirm + 可选一个复选框；返回 { ok, checked }。 */
export function openConfirmSheetEx(title: string, message: string, opts: ConfirmOpts = {}): Promise<{ ok: boolean; checked: boolean }> {
  _assertNotBusy("confirm");
  return new Promise((resolve) => {
    _reset();
    g.title().textContent = title;
    g.message().textContent = message; g.message().classList.remove("hidden");
    g.message().classList.toggle("warning", !!opts.warning);
    const okDefault = g.confirm().textContent, cancelDefault = g.cancel().textContent;
    if (opts.okLabel) g.confirm().textContent = opts.okLabel;
    if (opts.cancelLabel) g.cancel().textContent = opts.cancelLabel;
    g.confirm().classList.toggle("danger", !!opts.danger);
    if (opts.checkbox) { g.checkLabel().textContent = opts.checkbox.label; g.checkInput().checked = !!opts.checkbox.checked; g.check().classList.remove("hidden"); }
    const done = (v: boolean) => {
      const checked = g.checkInput().checked;
      g.confirm().removeEventListener("click", onOk); g.cancel().removeEventListener("click", onCancel);
      g.confirm().textContent = okDefault; g.cancel().textContent = cancelDefault;
      _hide(); resolve({ ok: v, checked });
    };
    const onOk = () => done(true), onCancel = () => done(false);
    g.confirm().addEventListener("click", onOk); g.cancel().addEventListener("click", onCancel);
    _open = onCancel;
    _show();
    setTimeout(() => g.confirm().focus(), 0);
  });
}

export interface InputOpts {
  message?: string; placeholder?: string; password?: boolean; defaultValue?: string; okLabel?: string;
  /** 密码二次确认（首次设密码）。 */
  confirmField?: boolean;
  /** 同步校验：返回错误文案则不关 sheet（显示在 #sheetError）。 */
  validate?: (value: string, second: string) => string | null;
  /** 初始错误提示（上一轮密码错时重开）。 */
  error?: string;
  /** 副按钮（2.1 加页 sheet 的「从图片…」）：点了 resolve INPUT_SECONDARY。 */
  secondary?: { label: string };
}
/** openInputSheet 的副按钮结果哨兵（不会和用户输入撞：含 NUL）。 */
export const INPUT_SECONDARY = "\u0000secondary";
/** 输入 sheet → string | null（取消）。密码态用 -webkit-text-security 打码（不用 type=password：绕开浏览器记密码弹窗——WeebPaint 教训）。 */
export function openInputSheet(title: string, opts: InputOpts = {}): Promise<string | null> {
  _assertNotBusy("input");
  return new Promise((resolve) => {
    _reset();
    g.title().textContent = title;
    if (opts.message) { g.message().textContent = opts.message; g.message().classList.remove("hidden"); }
    const inp = g.input(), inp2 = g.input2();
    inp.classList.remove("hidden");
    inp.type = "text"; inp.autocomplete = "off"; inp.placeholder = opts.placeholder ?? ""; inp.value = opts.defaultValue ?? "";
    if (opts.password) { inp.style.setProperty("-webkit-text-security", "disc"); inp2.style.setProperty("-webkit-text-security", "disc"); }
    if (opts.confirmField) { inp2.classList.remove("hidden"); inp2.type = "text"; inp2.autocomplete = "off"; }
    if (opts.error) { g.error().textContent = opts.error; g.error().classList.remove("hidden"); }
    const okDefault = g.confirm().textContent;
    if (opts.okLabel) g.confirm().textContent = opts.okLabel;
    let secondaryBtn: HTMLButtonElement | null = null;
    if (opts.secondary) {
      secondaryBtn = document.createElement("button"); secondaryBtn.type = "button"; secondaryBtn.className = "sheet-choice"; secondaryBtn.id = "sheetSecondary"; secondaryBtn.textContent = opts.secondary.label;
      g.choices().appendChild(secondaryBtn); g.choices().classList.remove("hidden");
    }
    const cleanup = () => {
      g.confirm().removeEventListener("click", onOk); g.cancel().removeEventListener("click", onCancel);
      inp.removeEventListener("keydown", onKey); inp2.removeEventListener("keydown", onKey);
      g.confirm().textContent = okDefault;
      inp.value = ""; inp2.value = "";
    };
    if (secondaryBtn) secondaryBtn.addEventListener("click", () => { cleanup(); _hide(); resolve(INPUT_SECONDARY); });
    const onOk = () => {
      const err = opts.validate?.(inp.value, inp2.value) ?? null;
      if (err) { g.error().textContent = err; g.error().classList.remove("hidden"); return; }
      const v = inp.value; cleanup(); _hide(); resolve(v);
    };
    const onCancel = () => { cleanup(); _hide(); resolve(null); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); if (opts.confirmField && e.target === inp) inp2.focus(); else onOk(); }
      else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    };
    g.confirm().addEventListener("click", onOk); g.cancel().addEventListener("click", onCancel);
    inp.addEventListener("keydown", onKey); inp2.addEventListener("keydown", onKey);
    _open = onCancel;
    _show();
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
  });
}

/** onPick（2026-09-09，对账 WeebPaint sheets）：在按钮 click 监听器里**同步**调——iOS 的 redirect 登录起跳 必须在手势同步栈起跳，resolve 之后的微任务续体会丢手势。 */
export interface Choice<T> { label: string; value: T; primary?: boolean; danger?: boolean; onPick?: () => void }
export function openChoiceSheet<T>(title: string, message: string, choices: Choice<T>[]): Promise<T | null> {
  _assertNotBusy("choice");
  return new Promise((resolve) => {
    _reset();
    g.title().textContent = title;
    if (message) { g.message().textContent = message; g.message().classList.remove("hidden"); }
    const box = g.choices(); box.classList.remove("hidden");
    g.confirm().classList.add("hidden");
    const onCancel = () => { g.cancel().removeEventListener("click", onCancel); _hide(); resolve(null); };
    for (const c of choices) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sheet-choice" + (c.primary ? " primary" : "") + (c.danger ? " danger" : "");
      btn.textContent = c.label;
      btn.addEventListener("click", () => { g.cancel().removeEventListener("click", onCancel); _hide(); c.onPick?.(); resolve(c.value); });
      box.appendChild(btn);
    }
    g.cancel().addEventListener("click", onCancel);
    _open = onCancel;
    _show();
  });
}

/** 通用「搜索 + 选一项」sheet（user 2026-09-10「点之后弹一个对话框，搜索，下拉，选中，就 reparent 了」「通用件同意」「不用原生 select」；created 2026-09-10 by Claude Fable 5.1）。
 *  首用 = 挪到…（app.ts movePageFlow）；「链接到已有页」「移到夹」之类以后同一个件。列表自绘（iOS 原生 select 是滚轮、Quest 更糟）。
 *  rows 由 search(q) **同步**给（q 空 = 默认列表，调用方决定给什么）；点行 = 选中 → 列表下方出现该行的动作钮（actions(row)，按行算：固定行可以只有一个动作）。
 *  键盘：Enter 没选中 = 选第一行、已选中 = 主动作（primary，没有就第一个）；↑↓ 换行；Esc / 取消 / 点空白 = null。 */
export interface PickRow<T> { value: T; label: string; icon?: string }
export interface PickAction<A extends string> { id: A; label: string; primary?: boolean }
export interface PickOpts<T, A extends string> {
  message?: string; placeholder?: string; emptyText: string;
  search: (q: string) => PickRow<T>[];
  actions: (row: PickRow<T>) => PickAction<A>[];
  fullscreen?: boolean;   // 撑满视口（目录用；长列表 + 触屏）；.sheet-full 由 _reset 清
}
export function openPickSheet<T, A extends string>(title: string, opts: PickOpts<T, A>): Promise<{ value: T; action: A } | null> {
  _assertNotBusy("pick");
  return new Promise((resolve) => {
    _reset();
    g.sheet().classList.toggle("sheet-full", !!opts.fullscreen);
    g.title().textContent = title;
    if (opts.message) { g.message().textContent = opts.message; g.message().classList.remove("hidden"); }
    const inp = g.input(), list = g.pick(), box = g.choices();
    inp.classList.remove("hidden"); inp.type = "text"; inp.autocomplete = "off"; inp.placeholder = opts.placeholder ?? ""; inp.value = "";
    list.classList.remove("hidden"); box.classList.remove("hidden");
    g.confirm().classList.add("hidden");
    let rows: PickRow<T>[] = []; let sel = -1; let done = false;
    const finish = (r: { value: T; action: A } | null) => { if (done) return; done = true; cleanup(); _hide(); resolve(r); };
    const renderActions = () => {
      box.innerHTML = "";
      const row = rows[sel]; if (!row) return;
      for (const a of opts.actions(row)) {
        const btn = document.createElement("button"); btn.type = "button"; btn.className = "sheet-choice" + (a.primary ? " primary" : ""); btn.dataset.action = a.id; btn.textContent = a.label;
        btn.addEventListener("click", () => finish({ value: row.value, action: a.id }));
        box.appendChild(btn);
      }
    };
    const select = (i: number) => {
      sel = i;
      const items = list.querySelectorAll("li[role=option]");
      items.forEach((li, k) => li.setAttribute("aria-selected", k === sel ? "true" : "false"));
      items[sel]?.scrollIntoView({ block: "nearest" });
      renderActions();
    };
    const renderRows = () => {
      rows = opts.search(inp.value.trim()); sel = -1; list.innerHTML = ""; box.innerHTML = "";
      if (!rows.length) { const li = document.createElement("li"); li.className = "empty"; li.textContent = opts.emptyText; list.appendChild(li); return; }
      rows.forEach((r, i) => {
        const li = document.createElement("li"); li.setAttribute("role", "option"); li.setAttribute("aria-selected", "false");
        const btn = document.createElement("button"); btn.type = "button";
        if (r.icon) btn.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#${r.icon}"/></svg>`;
        const span = document.createElement("span"); span.textContent = r.label; btn.appendChild(span);
        btn.addEventListener("click", () => select(i));
        li.appendChild(btn); list.appendChild(li);
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault(); if (!rows.length) return;
        if (sel < 0) { select(0); return; }
        const acts = opts.actions(rows[sel]!); const pick = acts.find((x) => x.primary) ?? acts[0];
        if (pick) finish({ value: rows[sel]!.value, action: pick.id });
      }
      else if (e.key === "ArrowDown") { e.preventDefault(); if (rows.length) select(Math.min(rows.length - 1, sel + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (rows.length) select(Math.max(0, sel - 1)); }
      else if (e.key === "Escape") { e.preventDefault(); finish(null); }
    };
    const onInput = () => renderRows();
    const onCancel = () => finish(null);
    const cleanup = () => { g.cancel().removeEventListener("click", onCancel); inp.removeEventListener("keydown", onKey); inp.removeEventListener("input", onInput); inp.value = ""; };
    g.cancel().addEventListener("click", onCancel); inp.addEventListener("keydown", onKey); inp.addEventListener("input", onInput);
    renderRows();
    _open = onCancel;
    _show();
    setTimeout(() => inp.focus(), 0);
  });
}

// ── sync gate（#gateSheet：锁屏 + 有限选项；冲突必 surface、不可 dismiss；允许穿透 busy）──
interface GateAction<T> { label: string; value: T; primary?: boolean }
interface GateOpts<T> { title: string; message: string; note?: string; showSpinner?: boolean; actions: GateAction<T>[] }
let _gatePending: ((v: unknown) => void) | null = null;
export function lockSyncGate<T = string>({ title, message, note, showSpinner, actions }: GateOpts<T>): Promise<T> {
  $("gateTitle").textContent = title;
  $("gateMessage").textContent = message;
  $("gateNote").textContent = note ?? ""; $("gateNote").classList.toggle("hidden", !note);
  $("gateSpinner").classList.toggle("hidden", !showSpinner);
  const box = $("gateActions"); box.innerHTML = "";
  return new Promise<T>((resolve) => {
    for (const a of actions) {
      const btn = document.createElement("button");
      btn.type = "button"; btn.textContent = a.label; if (a.primary) btn.classList.add("primary");
      btn.addEventListener("click", () => { unlockSyncGate(); resolve(a.value); });
      box.appendChild(btn);
    }
    $("gateSheet").classList.remove("hidden");
    _gatePending = resolve as (v: unknown) => void;
  });
}
export function unlockSyncGate(): void { $("gateSheet").classList.add("hidden"); _gatePending = null; }
export function settleSyncGate(value: unknown): void {
  if (_gatePending) { const r = _gatePending; unlockSyncGate(); r(value); }
}
