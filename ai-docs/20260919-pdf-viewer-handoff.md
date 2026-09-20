# Handoff：`@internal/pdf-viewer` 控件包 + JRB 接 PDF（给下一个 agent；user 2026-09-19「pdf 我倾向于开新的 agent」）

> created 20260919 · by Claude Fable 5.1 · as-of JRB 0.1.3 / gallery 0.3.1。读者：开新 session 做 PDF 的 agent。**先读家族根 `CLAUDE.md`（API .h ritual、署名制、四包只准走单接缝）与本仓 `CLAUDE.md`。**

## 1. user 原话（规格就是这几句，别加戏）

- 2026-09-19：「pdf viewer也包括双页和多页视图，可以做成控件（我们一起wp的时候讨论过控件化），不过视图按钮什么的app负责，不进控件。控件就是一个极简的无框pdf窗口」
- 2026-09-19：「pdf可以先sunset记账下一轮做，现在没需求」→ 本轮（0.1）JRB 只做 txt；`.pdf` 在书架里当杂物显示不可开。
- 2026-09-19：「jrp先不动，jrp是一个独立的产品」→ **JustReadPapers 一字不改**，只把它的两个文件当源抄。

## 2. 控件契约（提案 .h 草案，写进新包 `ai-docs/` 后 **user 过目才搬模块**）

```ts
export interface PdfViewerDeps { vue: VueRuntime; loadPdfjs: () => Promise<PdfjsLib>; anchorFraction?: number /* reading-line，默认 0.25 */ }
export interface PdfPosition { pageIndex: number; yFraction: number }   // 0-based 页 + 页内比例（跨设备硬不变量）
export type PdfLayout = "single" | "double" | "continuous";   // 单页 / 双页（spreadMode ODD：(1,2)(3,4)）/ 连续多页 —— 枚举名待过目
export interface PdfViewerHandle {
  load(blob: Blob, position: PdfPosition | null): Promise<void>;
  current(): PdfPosition | null;
  restore(p: PdfPosition): boolean;
  setLayout(l: PdfLayout): void; getLayout(): PdfLayout;
  zoomIn(): void; zoomOut(): void; fitWidth(): void;
  outline(): Promise<{ title: string; pageIndex: number; children: unknown[] }[]>;
  on(ev: "position" | "page" | "layout", cb: (v: unknown) => void): () => void;
  teardown(): void;
}
export function mountPdfViewer(el: HTMLElement, deps: PdfViewerDeps): PdfViewerHandle;
// 纯几何随包导出（node 测）：scrollTopForPosition / positionForScroll / cozyScale / pagesPerRow
```
**控件里没有任何按钮、工具栏、边框、页码显示**——视图切换钮、页码、目录面板、字号/缩放钮全归宿主 app。pdf.js 与 Vue 都由宿主 vendor 并注入（包不 bundle pdf.js，1 MB）。

## 3. 源在哪（抄，不 import）

| 件 | 路径 | 说明 |
|---|---|---|
| Vue imperative island 版 viewer | `../20260518 JustReadPapers/src/ui/viewer.ts`（313 行） | pdf.js 连续滚动 + spread；已是「零 reactive 图」形状；把 emit 换成 `on()`、把 settings/config import 换成 deps |
| 纯几何（有测试） | `../20260518 JustReadPapers/src/domain/viewer-geometry.ts` + 其 test | reading-line 位置复位 / cozy fit-scale / spread 分行；原样进包 `core/` |
| v1 的 pdf 阅读器（只当 spec） | `ARCHIVE/v1/src/viewer-pdf.js` | 懒加载 + 重试、outline、position 协议 `{pageIndex, yFraction}` |
| pdf.js vendor | `ARCHIVE/v1/src/vendor/pdfjs/`（pdf.mjs / pdf.worker.mjs / cmaps / standard_fonts / web/pdf_viewer.*） | `git mv` 回 `vendor/pdfjs/`；JRB `pdfjs-loader.ts` 抄 JRP `src/pdfjs-loader.ts`（惰性 import，不拖 boot） |
| 包仓骨架 | `../20260909 internal-workbench-elements/`（最小）或 `../20260909 internal-gallery/` | tsconfig / build.sh（tsc → dist + api-extractor 户口）/ release.sh（version=0.0.0 拒发）/ pull-package.sh / test runner |

## 4. JRB 接入点（0.1.x 已留好的缝）

1. `src/config.ts` `BOOK_EXTS` 加 `".pdf"`；`HIDDEN_NAME_RE` 不动。
2. `src/app-store.ts` `validateAdopt`：pdf 看 `%PDF` 魔数（前 5 字节），txt 照旧走编码链。
3. `src/books.ts` `BookKind` = `"txt" | "pdf"`（按扩展名）；`openBook` 不变（字节对库不透明）。
4. `src/reader/port.ts`（现只有 txt 实现内联在 `reader/txt.ts`）：加 pdf 适配 = 控件 `mountPdfViewer` + Anchor 映射。**位置模型**：txt 是 `{chapter, title, frac}`，pdf 是 `{page, frac}`——`reading-position` collection 的 value 加 `kind` 字段区分（`StoredPosition.anchor` 联合类型），旧条目无 kind 视为 txt。
5. `src/app.ts` `openBookByName`：按 kind 分派；顶栏「目录」对 pdf 用 `handle.outline()`；设置页「这本书」对 pdf 显示布局三选（单页 / 双页 / 连续）→ `handle.setLayout`，记 `book-prefs`（跨设备）或 device-kv（user 定）。
6. `src/gallery-host.ts`：`tilePlaceholderHtml` 对 `.pdf` 给 `file` 图标；缩略图（PDF 首页）**不做**——派生缓存要逐案 escalate（家规 store 节 2026-08-15）。
7. `service-worker.js` `STATIC_PRECACHE` **不**加 pdf.js（用到才下，fetch handler 运行时缓存），同 WXHW 的 7z-wasm 做法。
8. 冒烟：`test/boot-smoke.mjs` 加「上传一个最小 PDF → 打开 → 翻页 → 刷新回原页」；最小 PDF 可用 `%PDF-1.4` 手写单页字节。

## 5. 顺序（API ritual）

1. 新仓 `20260919 internal-pdf-viewer/`（或 user 定名）：骨架 + 提案 .h（§2）→ **user 过目**。
2. 搬 viewer-geometry（测试随行）→ 塑 viewer.ts 成控件 → build/test 绿 → user 过目 `api/` 真实 exports → 写版本号 0.1.0 → release + tag + gh release。
3. JRB：pull-package → §4 八点 → 冒烟 → bump minor（0.2.0 = PDF 纪元；bump 前问 user 要不要先把 0.1.x push prod）。
4. JRP 不动（user 拍板独立产品）。

## 6. 别踩

- `@internal/store` 只准从 `src/app-store.ts` 值级 import；`save(` 只准在 `src/books.ts`（build.sh lint 会红）。
- 不要把 pdf.js 塞进控件包（体重）；不要在控件里画按钮（user 原话）。
- 位置模型别用内容哈希当 key（家族否决，`feedback_content_hash_rejected`）。
