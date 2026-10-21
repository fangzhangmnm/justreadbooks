// 身份的语法（store 0.16：文档种类表）。created 2026-10-21 by Claude Fable 5.1（照 WXHW src/identifiers.ts；行为差异表 = ai-docs/20261021-store-2.1.2-gallery-0.8.5-migration.md）
//   JRB 只有一种文档：书（`<夹/>书名.txt`，裸字节）。这张表报给 createStore（app-store.ts）；同一张表在这里再造一份 identifiers 给纯代码（books.ts / store-ui.ts）和测试用——两边永远是同一套切法。
//   **不带 tier** = 一等作品（store 2.1.0 四等表：书是用户的作品，冲突问人、删进回收站、脏的不驱逐）。JRB 没有自动快照（二等）、没有盘（三等）；语音包是三等但不走 store。
//   这是 @internal/store 的第二个值级 import 点（scripts/build.sh 接缝 lint + test/redline-guard 逐名放行）：createIdentifiers 是纯函数，不碰存储、不碰云。
//   用词（user 2026-09-29 定）：identifier 身份 / folder / stem 主干 / suffix 后缀 / kind 种类。name 不再指任何精确的东西。
import { createIdentifiers, type DocKind, type Identifiers } from "@internal/store";

export const BOOK_KIND = "book";
/** 书的后缀（0.1 只做 txt；pdf 下一轮出 @internal/pdf-viewer 控件时加一行）。 */
export const BOOK_SUFFIX = ".txt";
export const DOC_KINDS: readonly DocKind[] = Object.freeze([{ kind: BOOK_KIND, suffix: BOOK_SUFFIX, container: "raw" }]);
export const identifiers: Identifiers = createIdentifiers(DOC_KINDS);   // 显式标类型：createIdentifiers 返回的是库内的超集，声明生成（gen-api）命名不了它
