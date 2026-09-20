// 书架屏（@internal/gallery 的 JRB 消费面）：独立一屏 card view（列表视图等包 0.3.0 发版后切 layout:"list"）。created 2026-09-19 by Claude Fable 5.1
// 包出屏幕 + 动词 + 数据面；本文件只出：Vue 注入、DocHost（阅读器端口）、policy（只认 .txt、身份=全名、显示去扩展名、无缩略图）、
//   记忆（当前夹 / 上次场景走 device-kv）、文案 override（书架口吻）。chrome 按钮（返回 / 云 / 刷新 / 上传 / 回收站 / 设置）在 app.ts 接线。
import { createApp, defineComponent, reactive, ref, computed, watch, onMounted, onUnmounted, nextTick } from "../vendor/vue/vue.esm-browser.prod.js";
import { createGallery, type CreateGalleryDeps, type GalleryDocHost, type VueRuntime, type GItem, type VerbStore, type DataFaceStore, type Gallery } from "@internal/gallery";
import { iconHtml } from "@internal/workbench-elements";
import { requireStore, auth } from "./app-store.ts";
import { isBookName, stemOf } from "./books.ts";
import { isUnread } from "./reading-position.ts";
import { getBookPref } from "./book-prefs.ts";
import { openConfirmSheet, openInputSheet, openChoiceSheet, withBusy } from "./sheets.ts";
import { deviceKvGet, deviceKvSet } from "./device-kv.ts";
import { reportError } from "./error-badge.ts";
import { lang, t } from "./i18n/index.ts";

export interface GalleryHostDeps {
  mountEl: HTMLElement;
  fullEl: HTMLElement;
  activeName: () => string | null;
  /** 打开一本书（全路径 + 已知大小）。返回 true = 阅读器已切过去。 */
  openBook: (name: string, size?: number) => Promise<boolean>;
  renameActive: () => Promise<string | null>;
  /** 活动书被图库移动/改名 → 阅读器换身份。 */
  setActiveName: (name: string) => void;
  pushBook: (name: string) => Promise<void>;
  offloadBook: (name: string) => Promise<void>;
  flushLocal: () => Promise<void>;
  setStatus: (text: string, opts?: { error?: boolean }) => void;
  currentDir: () => string;
  onOpened?: () => void;
  onClosed?: () => void;
}
const KV_FOLDER = "gallery-folder";
/** 书架布局（device-kv；默认列表：长书名整行，user 2026-09-19）。 */
const KV_LAYOUT = "shelf-layout";
export type ShelfLayout = "cards" | "list";
export function shelfLayout(): ShelfLayout { return deviceKvGet(KV_LAYOUT) === "cards" ? "cards" : "list"; }
/** 上次离开时在哪个场景（WeebPaint 行为：从书架出 → 回来在书架）。 */
const KV_SCENE = "last-scene";
const GALLERY_TEXT_OVERRIDES: Record<string, Parameters<typeof t>[0]> = {
  "gal.empty.none": "galx.emptyNone", "gal.empty.folder": "galx.emptyFolder", "gal.empty.trash": "galx.emptyTrash",
  "gal.firstFrameFailed": "galx.firstFrameFailed", "gal.firstFrameTimeout": "galx.firstFrameTimeout",
  "gal.tile.active": "galx.tileActive", "gal.otherFile": "galx.otherFile",
};
/** 命名边界（WeebPaint 同款 bare/full）：包里流转的 GItem.name 是**裸名**（去 .txt），store 身份是全名（加 .txt）。
 *  为什么剥：改名框默认值若带 .txt，用户删掉扩展名就把书改成了非 txt 文件（2026-09-19 冒烟抓到）；剥了之后改名只改书名，扩展名包不碰。 */
const bareOf = (full: string): string => full.replace(/\.txt$/i, "");
const fullOf = (bare: string): string => `${bare}.txt`;
const NAMING = { bare: bareOf, full: fullOf, display: (n: string) => stemOf(n) };

export function initGalleryHost(d: GalleryHostDeps) {
  const vue = { createApp, defineComponent, reactive, ref, computed, watch, onMounted, onUnmounted, nextTick } as unknown as VueRuntime;
  const storeFace = (): (VerbStore & DataFaceStore) | null => {
    try { return requireStore() as unknown as VerbStore & DataFaceStore; } catch { return null; }
  };
  const sizeOf = (item: GItem): number | undefined => { const c = item.cloud as { size?: number } | null; const l = item.local as { size?: number } | null; return c?.size ?? l?.size; };
  const doc: GalleryDocHost = {
    open: async (item: GItem) => { const ok = await d.openBook(fullOf(item.name), sizeOf(item)); if (ok) close(); },
    renameActive: async () => { const n = await d.renameActive(); return n ? bareOf(n) : null; },
    setName: (name) => d.setActiveName(fullOf(name)),
    push: async (item) => { await d.pushBook(fullOf(item.name)); },
    unload: async (item) => { await d.offloadBook(fullOf(item.name)); },
    exit: async () => { await d.flushLocal(); },
    dropCheckpoint: () => {},
  };
  const deps: CreateGalleryDeps = {
    vue,
    store: storeFace,
    doc,
    host: {
      signedIn: () => auth.isSignedIn(), online: () => (typeof navigator === "undefined" || navigator.onLine !== false), activeName: () => { const n = d.activeName(); return n ? bareOf(n) : null; },
      confirm: (title, msg) => openConfirmSheet(title, msg),
      input: (title, def, opts) => openInputSheet(title, { defaultValue: def, placeholder: opts?.placeholder, okLabel: t("common.ok") }),
      chooseFolder: (title, msg, options) => openChoiceSheet<string>(title, msg, options.map((o) => ({ label: o.label, value: o.value }))),
      status: (msg, isError) => d.setStatus(msg, { error: !!isError }),
      busy: (label, fn) => withBusy(label, fn),
    },
    ui: { iconHtml: (name, opts) => iconHtml(name, opts), tilePlaceholderHtml: () => iconHtml("book") },
    naming: NAMING,
    isZipDoc: () => false,
    hasThumb: () => false,
    // list = 长书名整行；副标题 = 状态头（开书时记进 book-prefs，跨设备可见、不用读字节）；未读点 = reading-position 无条目。
    //   隐藏名（半成品 / 遗留 json）与改名事件都在 store（createStore hiddenName / files.onRenamed），图库不管数据。
    policy: { isDoc: (p) => isBookName(p), isImage: () => false, naming: NAMING },
    tile: { aspect: "2/3", layout: shelfLayout(), subtitle: (item) => getBookPref(fullOf(item.name))?.header ?? null, marker: (item) => (isUnread(fullOf(item.name)) ? "unread" : null) },
    folderMemory: { get: () => deviceKvGet(KV_FOLDER) ?? "", set: (p) => deviceKvSet(KV_FOLDER, p || null) },
    isGalleryVisible: () => document.body.dataset.mode === "gallery",
    reportError: (e, level) => reportError(e, level ?? "error"),
    reloadApp: () => location.reload(),
    text: { lang: lang(), t: (key, params) => { const k = GALLERY_TEXT_OVERRIDES[key]; return k ? t(k, params) : undefined; } },
    deviceKv: { get: deviceKvGet, set: deviceKvSet },
  };
  let gallery: Gallery | null = null;
  function ensureMounted(): Gallery { if (!gallery) gallery = createGallery(d.mountEl, deps); return gallery; }
  async function open(): Promise<void> {
    await d.flushLocal();
    const g = ensureMounted();
    document.body.dataset.mode = "gallery";
    d.fullEl.classList.remove("hidden"); d.fullEl.setAttribute("aria-hidden", "false");
    const dir = d.currentDir();
    if (dir !== g.handle.getFolder()) g.handle.setFolder(dir);
    g.handle.setView("files");
    deviceKvSet(KV_SCENE, "gallery");
    d.onOpened?.();
  }
  function close(): void {
    d.fullEl.classList.add("hidden"); d.fullEl.setAttribute("aria-hidden", "true");
    delete document.body.dataset.mode;
    deviceKvSet(KV_SCENE, null);
    d.onClosed?.();
  }
  const isOpen = () => !d.fullEl.classList.contains("hidden");
  return {
    open, close, isOpen,
    wasInGallery: () => deviceKvGet(KV_SCENE) === "gallery",
    refresh: () => gallery?.handle.refresh(),
    setView: (v: "files" | "trash") => ensureMounted().handle.setView(v),
    getView: () => gallery?.handle.getView() ?? "files",
    emptyTrash: (scope: "local" | "cloud" | "both") => ensureMounted().handle.emptyTrash(scope),
    currentFolder: () => gallery?.handle.getFolder() ?? (deviceKvGet(KV_FOLDER) ?? ""),
    setLayout: (l: ShelfLayout) => { deviceKvSet(KV_LAYOUT, l === "cards" ? "cards" : null); gallery?.handle.setLayout(l); },
  };
}
export type GalleryHost = ReturnType<typeof initGalleryHost>;
