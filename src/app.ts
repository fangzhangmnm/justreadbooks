// 组合根：把 store 接缝 / 书架屏 / 阅读器 / 设置 / PWA 壳接成一个 app。created 2026-09-19 by Claude Fable 5.1
// 这里只有接线与事件编排，没有业务规则（规则住各模块头注释）。计划 = ai-docs/20260919-modernization-plan.md。
import { APP_VERSION } from "./version.ts";
import { FOREGROUND_POLL_MS, READER_DEFAULTS, FONT_SIZE_RANGE, BOOK_EXTS } from "./config.ts";
import { initI18n, t, lang, setLang, LANGS, LANG_NAME, type Lang } from "./i18n/index.ts";
import { initErrorBadge, reportError, errorLog } from "./error-badge.ts";
import { initDiagLog, note as diagNote, entries as diagEntries } from "./diag-log.ts";
import { initSheets, openConfirmSheet, openChoiceSheet, openInputSheet, openPickSheet, withBusy } from "./sheets.ts";
import { configureFloors, togglePopupMenu, currentPopupMenu, showNotice, closeNotice } from "@internal/workbench-elements";
import { humanSize } from "@internal/gallery";
import { auth, initCollections, reconcileCollections, flushCollections, requireStore, requestStoragePersistence, setActiveBookName, readingPos } from "./app-store.ts";
import { openBook, refreshBookInBackground, keepBookOffline, offloadBook, uploadBook, pushBook, renameBook, stemOf, splitPath, isBookName } from "./books.ts";
import { getPosition, notePosition, markOpened, flushPosition, keepalivePosition, recentBooks } from "./reading-position.ts";
import { getBookPref, setBookPref } from "./book-prefs.ts";
import { split, listBuiltin, statusHeader, type Chapter, type Anchor, type ChapterPref } from "./chapters/index.ts";
import { decodeBytes } from "./encoding.ts";
import { createTxtReader, type ReaderPrefs } from "./reader/txt.ts";
import { initKeys } from "./reader/keys.ts";
import { initGalleryHost } from "./gallery-host.ts";
import { initPwaShell } from "./pwa-shell.ts";
import { holdUntilSettled } from "./settle-hold.ts";
import { setStoreQuietStatus } from "./store-ui.ts";
import { deviceKvGet, deviceKvSet, deviceKvGetJson, deviceKvSetJson } from "./device-kv.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ── 早期初始化（DOM 已就绪：module 默认 deferred）──
initI18n();
const toastEl = $("toast");
let toastTimer: ReturnType<typeof setTimeout> | null = null;
/** 瞬时状态：底部 toast，3s 淡出（错误 8s），空串立即收。 */
function setStatus(text: string, opts: { error?: boolean } = {}): void {
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  toastEl.textContent = text;
  toastEl.classList.toggle("error", !!opts.error);
  toastEl.classList.toggle("show", !!text);
  if (text) toastTimer = setTimeout(() => { toastEl.classList.remove("show"); toastTimer = null; }, opts.error ? 8000 : 3000);
}
initErrorBadge({ status: (text) => setStatus(text), dismissHint: () => t("err.dismissHint") });
initDiagLog();
initSheets({ ok: t("common.ok"), cancel: t("common.cancel") });
setStoreQuietStatus((text) => setStatus(text));
const topBar = $("topBar");
configureFloors({ toolbarBottom: () => topBar.getBoundingClientRect().bottom });
console.log("[jrb] build:", APP_VERSION);
$("settingsBuild").textContent = APP_VERSION;

// ── 主题 / 阅读偏好（device-kv，设备属性不跟云）──
type Theme = "auto" | "day" | "night";
const KV_THEME = "theme", KV_PREFS = "reader-prefs", KV_LAST_OPEN = "last-open";
function theme(): Theme { const v = deviceKvGet(KV_THEME); return v === "day" || v === "night" ? v : "auto"; }
function applyTheme(v: Theme): void { deviceKvSet(KV_THEME, v === "auto" ? null : v); document.documentElement.dataset.theme = v; }
function readerPrefs(): ReaderPrefs {
  const p = deviceKvGetJson<Partial<ReaderPrefs>>(KV_PREFS, {});
  return {
    fontSize: Math.min(FONT_SIZE_RANGE.max, Math.max(FONT_SIZE_RANGE.min, Number(p.fontSize) || READER_DEFAULTS.fontSize)),
    lineHeight: Number(p.lineHeight) || READER_DEFAULTS.lineHeight,
    fontFamily: p.fontFamily === "serif" ? "serif" : "sans",
    widthTier: p.widthTier === "classic" ? "classic" : "novel",
  };
}
function setReaderPrefs(patch: Partial<ReaderPrefs>): void { const next = { ...readerPrefs(), ...patch }; deviceKvSetJson(KV_PREFS, next); reader.applyPrefs(next); renderSettings(); }
applyTheme(theme());

// ── 阅读器 ──
const readerEl = $("reader"), landingEl = $("landing"), titleEl = $("bookTitle"), chapterEl = $("chapterLine");
const reader = createTxtReader({
  container: readerEl,
  onPosition: (a) => { if (book) notePosition(book.name, a); },
  onChapter: (_i, title) => { chapterEl.textContent = title; },
  text: { prev: t("rd.prev"), next: t("rd.next"), head: t("rd.head"), whole: t("rd.whole"), chapterN: (n) => t("rd.chapterN", { n }), progress: (i, n) => t("rd.progress", { i, n }) },
});
reader.applyPrefs(readerPrefs());

interface OpenBookState { name: string; text: string; chapters: readonly Chapter[]; chosen: string | null; encoding: string; header: string | null }
let book: OpenBookState | null = null;
const activeName = () => book?.name ?? null;

function renderTopbar(): void {
  titleEl.textContent = book ? stemOf(book.name) : t("ui.appTitle");
  $("chaptersButton").hidden = !book;
  landingEl.classList.toggle("hidden", !!book);
  readerEl.classList.toggle("hidden", !book);
  if (!book) chapterEl.textContent = "";
}
function splitFor(name: string, text: string): { chapters: readonly Chapter[]; chosen: string | null } {
  const pref = getBookPref(name);
  return split(text, pref, (e) => { reportError(e, "warning"); setStatus(t("settings.chapterBad", { e: String((e as Error).message ?? e) }), { error: true }); });
}
/** 字节 → 状态（解码 + 切章 + 状态头）。 */
function decodeBook(name: string, blob: Blob): Promise<OpenBookState> {
  return blob.arrayBuffer().then((buf) => {
    const { text, encoding } = decodeBytes(buf);
    const { chapters, chosen } = splitFor(name, text);
    return { name, text, chapters, chosen, encoding, header: statusHeader(text) };
  });
}

// 首开下载进度（不是模态：可回书架，下载继续、变本机副本）
const progressEl = $("openProgress"), progressText = $("openProgressText"), progressFill = $("openProgressFill");
function showProgress(done: number, total: number): void {
  progressEl.classList.remove("hidden");
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
  progressText.textContent = pct == null ? t("rd.downloadingUnknown") : t("rd.downloading", { pct });
  progressFill.style.width = `${pct ?? 0}%`;
}
function hideProgress(): void { progressEl.classList.add("hidden"); }
$("openProgressCancel").addEventListener("click", () => { hideProgress(); void galleryHost.open(); });

let openSeq = 0;
/** 打开一本书（计划 §2 前提 0：本地优先秒开，后台追新）。返回 true = 已切过去。 */
async function openBookByName(name: string, opts: { size?: number; allowBig?: boolean; quiet?: boolean } = {}): Promise<boolean> {
  if (!isBookName(name)) { setStatus(t("rd.badTxt"), { error: true }); return false; }
  if (book?.name === name) return true;
  const seq = ++openSeq;
  closeNotice("book-updated");
  if (!opts.quiet) setStatus(t("rd.statusOpening", { name: stemOf(name) }));
  let r;
  try { r = await openBook(name, { ...(opts.size != null ? { size: opts.size } : {}), ...(opts.allowBig ? { allowBig: true } : {}), onProgress: showProgress }); }
  catch (e) { hideProgress(); reportError(e, "error"); return false; }
  finally { if (seq === openSeq) hideProgress(); }
  if (seq !== openSeq) return false;   // 期间又开了别本
  if (r.kind === "too-big") {
    const ok = await openConfirmSheet(t("rd.bigTitle"), t("rd.bigMsg", { name: stemOf(name), size: humanSize(r.size) }), { okLabel: t("rd.bigOpen") });
    return ok ? openBookByName(name, { ...opts, allowBig: true }) : false;
  }
  if (r.kind === "unavailable") { setStatus(t("rd.unavailable"), { error: true }); return false; }
  let st: OpenBookState;
  try { st = await decodeBook(name, r.blob); } catch (e) { reportError(e, "error"); setStatus(t("rd.badTxt"), { error: true }); return false; }
  if (seq !== openSeq) return false;
  await flushPosition();
  book = st; setActiveBookName(name); deviceKvSet(KV_LAST_OPEN, name);
  reader.load(st.text, st.chapters, getPosition(name)?.anchor ?? null);
  markOpened(name);
  renderTopbar(); renderSettings();
  if (!opts.quiet) setStatus("");
  diagNote("book", `open "${name}" fromLocal=${r.fromLocal} chapters=${st.chapters.length} enc=${st.encoding}`);
  void refreshCurrentBook();   // 后台追新（不阻塞首帧）
  return true;
}
function closeBook(): void { if (!book) return; keepalivePosition(); book = null; setActiveBookName(null); reader.teardown(); closeNotice("book-updated"); renderTopbar(); renderSettings(); }

/** 后台追新（前提 0 ①③）：库快进了字节 → 用户没动就静默换底、动过就出 chip。 */
let refreshing: Promise<void> | null = null;
function refreshCurrentBook(): Promise<void> {
  if (!book || !auth.isSignedIn() || navigator.onLine === false) return Promise.resolve();
  if (refreshing) return refreshing;
  const name = book.name;
  refreshing = (async () => {
    try {
      const r = await refreshBookInBackground(name);
      if (r.status !== "fast-forwarded" || !book || book.name !== name) return;
      const again = await openBook(name);
      if (again.kind !== "ok" || !book || book.name !== name) return;
      const st = await decodeBook(name, again.blob);
      if (!book || book.name !== name) return;
      book = st;
      if (!reader.touched()) { reader.load(st.text, st.chapters, reader.current()); setStatus(t("st.refreshed")); diagNote("book", `silent swap "${name}" chapters=${st.chapters.length}`); return; }
      const upd = reader.adopt(st.text, st.chapters);
      diagNote("book", `adopt pending "${name}" +${upd.addedChapters} currentChanged=${upd.currentChanged}`);
      showNotice({
        id: "book-updated", level: "info", dismissible: true, dismissLabel: t("common.later"),
        text: upd.addedChapters > 0 ? t("rd.updated", { n: upd.addedChapters }) : upd.currentChanged ? t("rd.updatedCurrent") : t("rd.updatedPlain"),
        actions: [{ label: t("rd.reload"), primary: true, onClick: () => { reader.applyPending(); closeNotice("book-updated"); } }],
      });
      renderSettings();
    } catch (e) { reportError(e, "log"); }
  })().finally(() => { refreshing = null; });
  return refreshing;
}

// ── 书架屏 ──
const galleryHost = initGalleryHost({
  mountEl: $("galleryMount"), fullEl: $("galleryFull"),
  activeName,
  openBook: (name, size) => openBookByName(name, size != null ? { size } : {}),
  renameActive: renameActiveBook,
  setActiveName: (name) => { if (book) { moveReadingPosition(book.name, name); book = { ...book, name }; setActiveBookName(name); deviceKvSet(KV_LAST_OPEN, name); renderTopbar(); } },
  pushBook: async (name) => { const ok = await pushBook(name); setStatus(ok ? t("st.pushed", { name: stemOf(name) }) : t("st.pushFail"), { error: !ok }); },
  offloadBook: async (name) => { try { await offloadBook(name); setStatus(t("st.offloaded", { name: stemOf(name) })); if (book?.name === name) closeBook(); } catch (e) { reportError(e, "warning"); } },
  flushLocal: async () => { await flushPosition(); await flushCollections(); },
  setStatus,
  currentDir: () => (book ? splitPath(book.name).dir : galleryHost?.currentFolder() ?? ""),
  onOpened: () => { $("galleryTrashBar").classList.add("hidden"); renderRecent(); },
});
function moveReadingPosition(from: string, to: string): void { const v = readingPos.getItem(from); if (v != null) { readingPos.setItem(to, v); readingPos.deleteItem(from); } }
async function renameActiveBook(): Promise<string | null> {
  if (!book) return null;
  const input = await openInputSheet(t("gal.title"), { defaultValue: stemOf(book.name) });
  if (input == null) return book.name;
  const r = await renameBook(book.name, input);
  if (r.ok) { if (r.name !== book.name) { moveReadingPosition(book.name, r.name); book = { ...book, name: r.name }; setActiveBookName(r.name); deviceKvSet(KV_LAST_OPEN, r.name); renderTopbar(); setStatus(t("st.renamed", { name: stemOf(r.name) })); } return r.name; }
  setStatus("where" in r ? t("st.renameTaken", { loc: r.where === "local" ? t("st.locLocal") : t("st.locCloud") }) : t("st.renameFail", { e: r.error }), { error: true });
  return book.name;
}
$("libraryButton").addEventListener("click", () => { void galleryHost.open(); });
$("landingOpenShelf").addEventListener("click", () => { void galleryHost.open(); });
$("galleryBack").addEventListener("click", () => galleryHost.close());
$("gallerySettingsBtn").addEventListener("click", () => openSettings());
$("galleryTrashBtn").addEventListener("click", () => { galleryHost.setView("trash"); $("galleryTrashBar").classList.remove("hidden"); });
$("galleryTrashBack").addEventListener("click", () => { galleryHost.setView("files"); $("galleryTrashBar").classList.add("hidden"); });
$("galleryEmptyTrash").addEventListener("click", () => {
  void openChoiceSheet<"local" | "cloud" | "both">(t("gal.emptyTrash"), t("gal.emptyTrashWhich"), [
    { label: t("gal.emptyTrashLocal"), value: "local" }, { label: t("gal.emptyTrashCloud"), value: "cloud" }, { label: t("gal.emptyTrashBoth"), value: "both" },
  ]).then((v) => { if (v) galleryHost.emptyTrash(v); });
});
// 「继续读」条：跨夹最近 N 本（reading-position 的 readAt），宿主 chrome（包只订阅当前夹）
const recentEl = $("galleryRecent");
function renderRecent(): void {
  const rows = recentBooks(6).filter((r) => r.name !== book?.name);
  recentEl.innerHTML = "";
  recentEl.hidden = rows.length === 0;
  if (!rows.length) return;
  const label = document.createElement("span"); label.className = "recent-label"; label.textContent = t("galx.recent"); recentEl.appendChild(label);
  for (const r of rows) {
    const b = document.createElement("button"); b.type = "button"; b.className = "recent-chip"; b.textContent = stemOf(r.name); b.title = r.name;
    b.addEventListener("click", () => { void openBookByName(r.name).then((ok) => { if (ok) galleryHost.close(); }); });
    recentEl.appendChild(b);
  }
}

// ── 云端（chip 在书架顶栏；菜单 = 连接 / 断开 / 刷新）──
const galleryCloudBtn = $<HTMLButtonElement>("galleryCloudBtn"), galleryRefreshBtn = $<HTMLButtonElement>("galleryRefreshBtn");
const cloudWho = (): string => { const s = auth.getAuthState(); const a = s.account as { username?: string; name?: string } | null; return s.signedIn ? (a?.username || a?.name || t("auth.signedIn")) : ""; };
function renderCloudButton(): void {
  const s = auth.getAuthState();
  const offline = navigator.onLine === false;
  const state = s.signedIn ? (offline ? "offline" : "signedin") : "out";
  const who = cloudWho();
  const title = state === "signedin" ? t("cloud.titleIn", { who }) : state === "offline" ? t("cloud.titleOffline", { who }) : t("cloud.titleOut");
  galleryCloudBtn.dataset.cloudState = state;
  galleryCloudBtn.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#${state === "signedin" ? "cloud-synced" : state === "offline" ? "cloud-unavailable" : "cloud"}"/></svg>`;
  galleryCloudBtn.title = title; galleryCloudBtn.setAttribute("aria-label", title);
  galleryRefreshBtn.hidden = state !== "signedin";
}
async function refreshCloudNow(): Promise<void> {
  if (!auth.isSignedIn() && navigator.onLine !== false) { await auth.retrySilentSignIn().catch((e) => reportError(e, "log")); renderCloudButton(); }
  galleryHost.refresh(); void reconcileCollections().then(renderRecent); void refreshCurrentBook();
}
function openCloudMenu(anchor: HTMLElement): void {
  const s = auth.getAuthState(); const who = cloudWho();
  togglePopupMenu({
    anchor, align: "right",
    items: () => s.signedIn
      ? [{ id: "who", label: navigator.onLine === false ? t("cloud.accountOffline", { who }) : t("cloud.account", { who }), icon: "cloud-synced", disabled: true },
         { id: "refresh", label: t("cloud.refresh"), icon: "refresh", hidden: navigator.onLine === false },
         { id: "signout", label: t("cloud.disconnect"), icon: "cloud-unavailable", danger: true, separatorBefore: true }]
      : [{ id: "who", label: t("cloud.notConnected"), icon: "cloud", disabled: true }, { id: "signin", label: t("cloud.connect"), icon: "cloud-upload" }],
    onPick: (id) => { if (id === "refresh") void refreshCloudNow(); else if (id === "signout") void onSignOut(); else if (id === "signin") void onSignIn(); },
  });
}
galleryCloudBtn.addEventListener("click", (e) => { e.stopPropagation(); openCloudMenu(galleryCloudBtn); });
galleryRefreshBtn.addEventListener("click", () => { void refreshCloudNow(); });
/** 登录（两步手势，对账 WeebPaint/WXHW）：先落盘，再弹「去登录」，onPick 在 click 同步栈里起跳 redirect。 */
async function onSignIn(): Promise<void> {
  try { await flushPosition(); await flushCollections(); }
  catch (e) { reportError(new Error("[sign-in] flush before redirect failed — not navigating: " + String(e)), "error"); setStatus(t("auth.flushFailed"), { error: true }); return; }
  await openChoiceSheet<"go">(t("auth.readyTitle"), t("auth.readyMsg"), [{
    label: t("auth.go"), value: "go", primary: true,
    onPick: () => {
      setStatus(t("auth.redirecting"));
      void requestStoragePersistence();
      auth.signIn({ prompt: "select_account" }).catch((e) => { reportError(e); setStatus(t("auth.signInFailed", { e: e instanceof Error ? e.message : String(e) }), { error: true }); });
    },
  }]);
}
async function onSignOut(): Promise<void> {
  if (!(await openConfirmSheet(t("auth.signOutTitle"), t("auth.signOutMsg")))) return;
  await flushPosition(); await flushCollections();
  try { await auth.signOut(); setStatus(t("auth.signedOut")); } catch (e) { reportError(e); }
  renderCloudButton(); galleryHost.refresh();
}

// ── 上传（读者唯一的写路径：拖放 / 选文件 → books.uploadBook mode:"new"）──
const uploadInput = $<HTMLInputElement>("uploadInput"), dropOverlay = $("dropOverlay");
$("galleryUploadBtn").addEventListener("click", () => uploadInput.click());
uploadInput.addEventListener("change", () => { const fs = Array.from(uploadInput.files ?? []); uploadInput.value = ""; void uploadFiles(fs); });
let dragDepth = 0;
document.addEventListener("dragenter", (e) => { if (e.dataTransfer?.types.includes("Files")) { dragDepth++; dropOverlay.classList.remove("hidden"); } });
document.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; dropOverlay.classList.add("hidden"); } });
document.addEventListener("dragover", (e) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); });
document.addEventListener("drop", (e) => { dragDepth = 0; dropOverlay.classList.add("hidden"); if (!e.dataTransfer?.files.length) return; e.preventDefault(); void uploadFiles(Array.from(e.dataTransfer.files)); });
async function uploadFiles(files: File[]): Promise<void> {
  const dir = galleryHost.isOpen() ? galleryHost.currentFolder() : (book ? splitPath(book.name).dir : "");
  let last: string | null = null;
  for (const f of files) {
    if (!BOOK_EXTS.some((x) => f.name.toLowerCase().endsWith(x)) && !f.type.startsWith("text/")) { setStatus(t("st.notTxt", { name: f.name }), { error: true }); continue; }
    try {
      void requestStoragePersistence();
      const r = await withBusy(t("st.uploading"), () => uploadBook(f, dir));
      setStatus(r.pushed ? t("st.uploaded", { name: stemOf(r.name) }) : t("st.uploadedLocal", { name: stemOf(r.name) }));
      last = r.name;
    } catch (e) { reportError(e, "warning"); setStatus(t("st.uploadFail", { e: String((e as Error).message ?? e) }), { error: true }); }
  }
  galleryHost.refresh();
  if (last && files.length === 1) { const ok = await openBookByName(last); if (ok) galleryHost.close(); }
}

// ── 目录（pick sheet：搜索 + 跳转；Quest/触屏友好）──
function openChapters(): void {
  if (!book) return;
  const chs = reader.chapters();
  void openPickSheet<number, "go">(t("rd.chaptersTitle", { n: chs.length }), {
    placeholder: t("rd.chaptersSearchPh"), emptyText: t("rd.chaptersEmpty"),
    search: (q) => chs.map((_c, i) => ({ value: i, label: `${i + 1}. ${reader.titleOf(i)}` })).filter((r) => !q || r.label.toLowerCase().includes(q.toLowerCase())),
    actions: () => [{ id: "go", label: t("rd.jump"), primary: true }],
  }).then((r) => { if (r) reader.goTo(r.value); });
}
$("chaptersButton").addEventListener("click", openChapters);

// ── 设置面板 ──
const settingsView = $("settingsView");
function openSettings(): void { renderSettings(); settingsView.hidden = false; }
function closeSettings(): void { settingsView.hidden = true; }
$("settingsButton").addEventListener("click", () => { if (settingsView.hidden) openSettings(); else closeSettings(); });
$("settingsClose").addEventListener("click", closeSettings);
const chapterRuleSelect = $<HTMLSelectElement>("chapterRuleSelect");
function renderSettings(): void {
  const p = readerPrefs();
  $("fontSizeValue").textContent = String(p.fontSize);
  $<HTMLSelectElement>("lineHeightSelect").value = String(p.lineHeight);
  $<HTMLSelectElement>("fontSelect").value = p.fontFamily;
  $<HTMLSelectElement>("widthSelect").value = p.widthTier;
  $<HTMLSelectElement>("themeSelect").value = theme();
  const ls = $<HTMLSelectElement>("langSelect");
  if (!ls.options.length) for (const l of LANGS) { const o = document.createElement("option"); o.value = l; o.textContent = LANG_NAME[l]; ls.appendChild(o); }
  ls.value = lang();
  // 这本书
  $("chapterRuleBook").textContent = book ? stemOf(book.name) : t("settings.noBook");
  $("encodingInfo").textContent = book ? t("settings.encoding", { enc: book.encoding }) : "";
  $("bookHeader").textContent = book?.header ?? "";
  chapterRuleSelect.disabled = !book;
  if (!chapterRuleSelect.options.length) {
    const add = (v: string, label: string) => { const o = document.createElement("option"); o.value = v; o.textContent = label; chapterRuleSelect.appendChild(o); };
    add("auto", t("settings.chapterAuto"));
    for (const b of listBuiltin()) add(b.id, t(`chapters.builtin.${b.id}` as Parameters<typeof t>[0]));
    add("custom", t("settings.chapterCustom"));
  }
  const pref = book ? getBookPref(book.name) : null;
  chapterRuleSelect.value = pref?.regexCustom ? "custom" : pref?.regexId ?? "auto";
  void requireStore().files.usage().then((u) => { $("storageInfo").textContent = t("settings.storage", { n: u.count, size: humanSize(u.bytes) }); }).catch(() => {});
}
$("fontSizeDown").addEventListener("click", () => setReaderPrefs({ fontSize: Math.max(FONT_SIZE_RANGE.min, readerPrefs().fontSize - 1) }));
$("fontSizeUp").addEventListener("click", () => setReaderPrefs({ fontSize: Math.min(FONT_SIZE_RANGE.max, readerPrefs().fontSize + 1) }));
$<HTMLSelectElement>("lineHeightSelect").addEventListener("change", (e) => setReaderPrefs({ lineHeight: Number((e.target as HTMLSelectElement).value) }));
$<HTMLSelectElement>("fontSelect").addEventListener("change", (e) => setReaderPrefs({ fontFamily: (e.target as HTMLSelectElement).value === "serif" ? "serif" : "sans" }));
$<HTMLSelectElement>("widthSelect").addEventListener("change", (e) => setReaderPrefs({ widthTier: (e.target as HTMLSelectElement).value === "classic" ? "classic" : "novel" }));
$<HTMLSelectElement>("themeSelect").addEventListener("change", (e) => applyTheme((e.target as HTMLSelectElement).value as Theme));
$<HTMLSelectElement>("langSelect").addEventListener("change", (e) => setLang((e.target as HTMLSelectElement).value as Lang));
chapterRuleSelect.addEventListener("change", () => { void applyChapterRule(chapterRuleSelect.value); });
/** 换切章规则：同一文本重切，按当前**字符偏移**找回同一段（章节标题全变了，锚的标题命中不适用）。 */
async function applyChapterRule(v: string): Promise<void> {
  if (!book) return;
  let pref: ChapterPref;
  if (v === "auto") pref = {};
  else if (v === "custom") {
    const cur = getBookPref(book.name)?.regexCustom ?? "";
    const src = await openInputSheet(t("settings.chapterCustomTitle"), { message: t("settings.chapterCustomMsg"), defaultValue: cur, placeholder: t("settings.chapterCustomPh"), validate: (s) => { try { new RegExp(s, "gm"); return null; } catch (e) { return t("settings.chapterBad", { e: String((e as Error).message) }); } } });
    if (src == null) { renderSettings(); return; }
    pref = { regexCustom: src };
  } else pref = { regexId: v };
  setBookPref(book.name, { regexId: pref.regexId, regexCustom: pref.regexCustom });
  const a = reader.current();
  const chs = reader.chapters();
  const ch = a ? chs[a.chapter] : undefined;
  const offset = ch ? Math.floor(ch.bodyStart + (ch.end - ch.bodyStart) * a!.frac) : 0;
  const { chapters, chosen } = splitFor(book.name, book.text);
  book = { ...book, chapters, chosen };
  let idx = chapters.findIndex((c) => c.start <= offset && offset < c.end); if (idx < 0) idx = 0;
  const nc = chapters[idx]!;
  const frac = nc.end > nc.bodyStart ? Math.min(1, Math.max(0, (offset - nc.bodyStart) / (nc.end - nc.bodyStart))) : 0;
  reader.load(book.text, chapters, { chapter: idx, title: nc.title, frac });
  renderSettings();
}
$("forceUpdateButton").addEventListener("click", () => { void shell.forceReset(); });
$("diagButton").addEventListener("click", () => { const pre = $("diagLog"); pre.hidden = !pre.hidden; if (!pre.hidden) pre.textContent = [...diagEntries().map((e) => `${new Date(e.t).toISOString().slice(11, 19)} ${e.l} ${e.m}`), ...errorLog()].join("\n") || t("settings.diagEmpty"); });
$("diagCopy").addEventListener("click", () => { void navigator.clipboard?.writeText($("diagLog").textContent ?? "").then(() => setStatus(t("settings.diagCopied"))).catch((e) => reportError(e, "warning")); });

// ── 键盘 / 手柄 ──
function modalOpen(): boolean { return !!document.querySelector('[role="dialog"]:not(.hidden):not(#galleryFull)') || !!currentPopupMenu() || !settingsView.hidden; }
initKeys({
  reader: () => (book ? reader : null),
  readerVisible: () => !!book && !galleryHost.isOpen(),
  modalOpen,
  toggleShelf: () => { if (galleryHost.isOpen()) galleryHost.close(); else void galleryHost.open(); },
  toggleChapters: openChapters,
  toggleSettings: () => { if (settingsView.hidden) openSettings(); else closeSettings(); },
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  if (!settingsView.hidden) { closeSettings(); return; }
  if (galleryHost.isOpen() && book) galleryHost.close();
});

// ── 生命周期：切后台落盘；回前台 / 联网 / 前台轮询 → 追新当前书 + 对齐 collections ──
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { keepalivePosition(); void flushPosition(); void flushCollections(); } });
window.addEventListener("pagehide", (e: PageTransitionEvent) => { if (!e.persisted) { keepalivePosition(); void flushCollections(); } });
window.addEventListener("online", () => {
  renderCloudButton();
  if (auth.isSignedIn()) { setStatus(t("st.online")); void resumeSync(); }
  else void auth.retrySilentSignIn().then((ok) => diagNote("auth", `retrySilentSignIn on online → ${String(ok)}`)).catch((e) => reportError(e, "log"));
});
window.addEventListener("offline", () => { renderCloudButton(); });
setInterval(() => { if (document.visibilityState === "visible") { void refreshCurrentBook(); if (galleryHost.isOpen()) galleryHost.refresh(); } }, FOREGROUND_POLL_MS);
async function resumeSync(): Promise<void> {
  await flushPosition();
  await requireStore().files.drainOfflineQueue().catch((e) => reportError(e, "log"));
  await reconcileCollections();
  await refreshCurrentBook();
  if (galleryHost.isOpen()) { galleryHost.refresh(); renderRecent(); }
}
{
  const mq = matchMedia("(display-mode: standalone), (display-mode: fullscreen)");
  const apply = () => document.documentElement.toggleAttribute("data-standalone", mq.matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
  apply(); mq.addEventListener?.("change", apply);
}
// ── PWA 壳 ──
const updateToast = $("updateToast");
let _authBootResolve: () => void = () => {};
const authBootP = new Promise<void>((r) => { _authBootResolve = r; });
const authBootSettled = () => holdUntilSettled(authBootP, 8000);
const shell = initPwaShell({
  onUpdateAvailable: () => { void authBootSettled().then((how) => { diagNote("sw", `update available → toast (auth boot ${how})`); updateToast.classList.remove("hidden"); }); },
  onForeground: () => {
    if (!auth.isSignedIn() && navigator.onLine !== false) void auth.retrySilentSignIn().catch((e) => reportError(e, "log"));
    void refreshCurrentBook(); void reconcileCollections().then(() => { if (galleryHost.isOpen()) { galleryHost.refresh(); renderRecent(); } });
  },
  onBeforeReload: async () => { const how = await authBootSettled(); diagNote("sw", `reload requested (auth boot ${how})`); await flushPosition(); await flushCollections(); },
});
$("updateReloadButton").addEventListener("click", () => { void shell.reload(); });
$("updateDismissButton").addEventListener("click", () => updateToast.classList.add("hidden"));
if (shell.isDevRoute) $("settingsBuild").textContent += " · dev";

// ── auth ──
let afterSignInInFlight: Promise<void> | null = null;
function afterSignIn(): Promise<void> {
  if (afterSignInInFlight) return afterSignInInFlight;
  afterSignInInFlight = (async () => {
    try {
      diagNote("auth", "afterSignIn: reconcile collections + drain offline queue + refresh current book");
      await reconcileCollections();
      void requireStore().files.drainOfflineQueue().catch((e) => reportError(e, "log"));
      await refreshCurrentBook();
      if (galleryHost.isOpen()) { galleryHost.refresh(); renderRecent(); }
    } catch (e) { reportError(e, "warning"); }
  })().finally(() => { afterSignInInFlight = null; });
  return afterSignInInFlight;
}
auth.onAuthChanged((st) => { renderCloudButton(); diagNote("auth", `changed signedIn=${st.signedIn} reason=${st.reason ?? "?"}`); if (st.signedIn) void afterSignIn(); });

// ── boot（计划 §4.9：首帧 = 本机；没有阻塞蒙层）──
async function boot(): Promise<void> {
  renderTopbar(); renderCloudButton();
  await initCollections();
  const last = deviceKvGet(KV_LAST_OPEN);
  let opened = false;
  if (last && !galleryHost.wasInGallery()) opened = await openBookByName(last, { quiet: true });
  if (!opened) await galleryHost.open();
  // auth 在首帧之后（不阻塞）：silent probe → onAuthChanged 里 afterSignIn
  auth.initAuth().then((st) => { renderCloudButton(); if (st.signedIn) void afterSignIn(); }).catch((e) => reportError(e, "log")).finally(() => _authBootResolve());
  if (new URLSearchParams(location.search).has("reset")) { setStatus(t("st.forceUpdated", { v: APP_VERSION })); try { history.replaceState(null, "", location.pathname + location.hash); } catch { /* ignore */ } }
}
window.addEventListener("error", (event) => { reportError(new Error(`[window] ${(event.message || "").slice(0, 160)}`)); });
window.addEventListener("unhandledrejection", (event) => {
  const err = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
  reportError(err, err.message === "Not signed in" ? "log" : "error");
});
void boot();

// 供 boot smoke / 调试台探针（非 API）
(window as unknown as { __jrb?: unknown }).__jrb = { version: APP_VERSION, openBook: openBookByName, closeBook, reader, gallery: galleryHost, store: requireStore, book: () => book, prefs: readerPrefs, confirm: openConfirmSheet, choice: openChoiceSheet };
