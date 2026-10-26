// 书架屏（@internal/gallery 的 JRB 消费面）：独立一屏，默认列表视图（gallery 0.3.0 的 JRB 提案）。created 2026-09-19 by Claude Fable 5.1 · 2026-10-21 收 gallery 0.8.5 重写（Claude Fable 5.1；逐版差异 = ai-docs/20261021-store-2.1.2-gallery-0.8.5-migration.md §2）
// 包出屏幕 + 动词 + 数据面；本文件只出：Vue 注入（递**整个模块** = 用构建时编好的模板、运行时零 eval，0.8.4）、DocHost（阅读器端口）、policy（无图片、无缩略图）、
//   记忆（当前夹 / 上次场景走 device-kv）、文案 override（书架口吻）。chrome 按钮（返回 / 云 / 刷新 / 上传 / 回收站·备份箱 / 设置）在 app.ts 接线。
//   哪些是书、主干怎么切、显示名去 .txt、改名只编辑主干 —— 全由 store 的种类表说（gallery 0.6.0 起吃 store.identifiers；宿主不再给 naming / isDoc / isZipDoc / hasThumb；
//   0.1.3 那套 bare/full 剥 .txt 的边界随之退役）。隐藏名（半成品 / 遗留 json）与改名事件也都在 store（createStore hidden / files.onRenamed），图库只画、只发起。
//   卡片上的「推送到云端」0.8.1 起不存在：没同步好的行只有「处理…」→ store file.resolve()，由人在库弹的面里三选一（user 2026-10-16「禁止越狱」）。
import * as Vue from "../vendor/vue/vue.esm-browser.prod.js";
import { createGallery, configureGalleryRegistry, type CreateGalleryDeps, type GalleryDocHost, type VueRuntime, type GItem, type VerbStore, type DataFaceStore, type Gallery, type GalleryView } from "@internal/gallery";
import { iconHtml } from "@internal/workbench-elements";
import { requireStore, auth } from "./app-store.ts";
import { GALLERY_REGISTRY_DB } from "./config.ts";
import { isUnread } from "./reading-position.ts";
import { getBookPref } from "./book-prefs.ts";
import { openConfirmSheet, openInputSheet, openChoiceSheet, withBusy } from "./sheets.ts";
import { deviceKvGet, deviceKvSet } from "./device-kv.ts";
import { reportError } from "./error-badge.ts";
import { lang, t } from "./i18n/index.ts";

export interface GalleryHostDeps {
  mountEl: HTMLElement;
  fullEl: HTMLElement;
  /** 正在读的那本（身份 = 全路径）。 */
  activeName: () => string | null;
  /** 打开一本书（身份 + 已知大小）。返回 true = 阅读器已切过去。 */
  openBook: (identifier: string, size?: number) => Promise<boolean>;
  /** 顶栏改名（阅读器自己的改名 UI）；返回新身份。 */
  renameActive: () => Promise<string | null>;
  /** 正在读的那本被图库移动 / 改名 → 阅读器换身份。 */
  setActiveName: (identifier: string) => void;
  offloadBook: (identifier: string) => Promise<void>;
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
  // 「只在本机」（user 2026-10-21「标『只在本机』」）：图库包对从没传过的书只画同步态图标 + hover 提示，iPad 上看不见字——提示文案统一成这个词；看得见的字由下面 tile.subtitle 前置。
  "gv.badge.localOnly": "galx.badgeLocalOnly", "gv.badge.float": "galx.badgeFloat", "gv.badge.localPlain": "galx.localOnly",
};
/** 从没传到云端的书：local-only = 云端确认没有；float = 没登录 / 离线、云端不可知。syncState 是 store 给的事实，这里只翻成字，不重推导。 */
const neverUploaded = (item: GItem): boolean => item.syncState === "local-only" || item.syncState === "float";

// gallery 0.8.7：图库包这台设备的记事本（多库登记）库名归宿主——不配会写进包里写死的 WeebPaint GUID 名下。第一次开库之前配一次（import 期即可，包是懒开库）。
configureGalleryRegistry({ dbName: GALLERY_REGISTRY_DB });

export function initGalleryHost(d: GalleryHostDeps) {
  const vue = Vue as unknown as VueRuntime;   // 整个模块：有全部 helper = 用构建时编好的 render（gallery 0.8.4），运行时不编译模板；Teleport（0.6.2 卡片菜单出卡片）也在里面
  const storeFace = (): (VerbStore & DataFaceStore) | null => {
    try { return requireStore() as unknown as VerbStore & DataFaceStore; } catch { return null; }
  };
  const doc: GalleryDocHost = {
    open: async (item: GItem) => { const ok = await d.openBook(item.identifier, item.size); if (ok) close(); },
    renameActive: () => d.renameActive(),
    setIdentifier: (identifier) => d.setActiveName(identifier),
    // gallery >= 0.8.1 never calls push (the "push to cloud" verb left the vocabulary; unsynced rows go through verbs.resolve → store file.resolve()).
    // VerbDoc still requires the member; if it ever fires, say so instead of silently doing nothing — the reader has no save path for an existing book.
    push: async (item: GItem) => { reportError(new Error(`[gallery] push verb is retired (gallery >= 0.8.1 routes "resolve" to the store); nothing done for "${item.identifier}"`), "warning"); },
    unload: async (item: GItem) => { await d.offloadBook(item.identifier); },
    exit: async () => { await d.flushLocal(); },
    dropCheckpoint: () => {},
  };
  const deps: CreateGalleryDeps = {
    vue,
    store: storeFace,
    doc,
    host: {
      signedIn: () => auth.isSignedIn(), online: () => (typeof navigator === "undefined" || navigator.onLine !== false), activeIdentifier: () => d.activeName(),
      confirm: (title, msg) => openConfirmSheet(title, msg),
      input: (title, def, opts) => openInputSheet(title, { defaultValue: def, placeholder: opts?.placeholder, okLabel: t("common.ok") }),
      chooseFolder: (title, msg, options) => openChoiceSheet<string>(title, msg, options.map((o) => ({ label: o.label, value: o.value }))),
      status: (msg, isError) => d.setStatus(msg, { error: !!isError }),
      busy: (label, fn) => withBusy(label, fn),
    },
    ui: { iconHtml: (name, opts) => iconHtml(name, opts), tilePlaceholderHtml: () => iconHtml("book") },
    // 没有图片、没有缩略图（txt 书）；哪些是书由 store 的种类表说（src/identifiers.ts 一行）。
    policy: { isImage: () => false },
    // list = 长书名整行；副标题 = 状态头（开书时记进 book-prefs，跨设备可见、不用读字节）；未读点 = reading-position 无条目。卡片布局时竖版 2:3。
    //   副标题前置「只在本机」（0.2.25）：没登录 / 离线时拖进来、从没传过的书一眼能认；出路 = ⋯ →「处理…」或登录后那一问。
    tile: {
      aspect: 2 / 3, layout: shelfLayout(),
      subtitle: (item) => { const header = getBookPref(item.identifier)?.header ?? null; const mark = neverUploaded(item) ? t("galx.localOnly") : null; return mark && header ? `${mark} · ${header}` : (mark ?? header); },
      marker: (item) => (isUnread(item.identifier) ? "unread" : null),
    },
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
  /** gallery 0.8.8：开书架直接进「要处理的」视图（顶部横幅 + 每本一粒「处理…」）。登录 / 回线后发现有没同步好的 → 「去处理」走这里（2026-10-26，家族周账 F-98 / F-88）。 */
  async function openAttention(): Promise<void> { await open(); ensureMounted().handle.setAttentionOnly(true); }
  return {
    open, close, isOpen, openAttention,
    setAttentionOnly: (on: boolean) => gallery?.handle.setAttentionOnly(on),
    wasInGallery: () => deviceKvGet(KV_SCENE) === "gallery",
    refresh: () => gallery?.handle.refresh(),
    setView: (v: GalleryView) => ensureMounted().handle.setView(v),
    getView: (): GalleryView => gallery?.handle.getView() ?? "files",
    currentFolder: () => gallery?.handle.getFolder() ?? (deviceKvGet(KV_FOLDER) ?? ""),
    setLayout: (l: ShelfLayout) => { deviceKvSet(KV_LAYOUT, l === "cards" ? "cards" : null); gallery?.handle.setLayout(l); },
  };
}
export type GalleryHost = ReturnType<typeof initGalleryHost>;
