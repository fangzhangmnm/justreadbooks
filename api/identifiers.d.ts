import { type DocKind, type Identifiers } from "@internal/store";
export declare const BOOK_KIND = "book";
/** 书的后缀（0.1 只做 txt；pdf 下一轮出 @internal/pdf-viewer 控件时加一行）。 */
export declare const BOOK_SUFFIX = ".txt";
export declare const DOC_KINDS: readonly DocKind[];
export declare const identifiers: Identifiers;
