export interface Chapter {
    /** 标题行文本（去首尾空白）；合成章为空串。 */
    title: string;
    /** 章首（含标题行）在全文的字符偏移。 */
    start: number;
    /** 正文起点（跳过标题行与其后空行）。 */
    bodyStart: number;
    /** 章尾（不含）。 */
    end: number;
    /** Markdown 多级：`#` 个数（1–6）；非 markdown 无。 */
    level?: number;
    /** 合成章：head = 第一个标题之前的内容；whole = 整本没切出章。 */
    synthetic?: "head" | "whole";
}
export interface ChapterPref {
    regexId?: string;
    regexCustom?: string;
}
export interface SplitResult {
    chapters: Chapter[]; /** 命中的内建 id / "custom" / null（整本一章）。 */
    chosen: string | null;
}
export declare function autoSplit(text: string): SplitResult;
export declare function splitByBuiltin(text: string, id: string): SplitResult;
/** 自定义正则：编译失败**抛**（调用方 surface 给用户，不静默退回 auto）。 */
export declare function splitByCustom(text: string, src: string): SplitResult;
/** 偏好 > 自动探测（≥3 命中）> 整本一章。自定义正则坏了退回下一级并把错误经 onError 报出（不吞）。 */
export declare function split(text: string, pref: ChapterPref | null | undefined, onError?: (e: unknown) => void): SplitResult;
export declare function listBuiltin(): readonly {
    id: string;
}[];
/** 章正文摘一句（目录 / 卡片副标题用）：压空白。 */
export declare function snippet(text: string, ch: Chapter, maxChars?: number): string;
/** 活书状态头（handoff §1：文件第一行是写入方的状态摘要）：第一行去空白、截断；空行 → null。app 不解析它的语义。 */
export declare function statusHeader(text: string, maxChars?: number): string | null;
