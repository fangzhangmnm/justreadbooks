import type { Chapter, Anchor, LiveUpdate } from "../chapters/index.ts";
export interface ReaderPrefs {
    fontSize: number;
    lineHeight: number;
    fontFamily: "sans" | "serif";
    widthTier: "novel" | "classic";
}
export interface TxtReaderDeps {
    container: HTMLElement;
    onPosition: (a: Anchor) => void;
    onChapter: (index: number, title: string) => void;
    /** 合成章/无标题时的显示名 + 按钮文案（i18n 由 app 给）。 */
    text: {
        prev: string;
        next: string;
        head: string;
        whole: string;
        chapterN: (n: number) => string;
        progress: (i: number, n: number) => string;
    };
}
export interface TxtReader {
    load(text: string, chapters: readonly Chapter[], anchor: Anchor | null): void;
    /** 换底稿不重画（返回 diff 给 chip）。 */
    adopt(text: string, chapters: readonly Chapter[]): LiveUpdate;
    /** 把 adopt 进来的新字节真正用上：按当前锚在新章节表里找回同一章并重画。 */
    applyPending(): boolean;
    hasPending(): boolean;
    current(): Anchor | null;
    restore(anchor: Anchor): boolean;
    goTo(index: number): void;
    next(): void;
    prev(): void;
    currentIndex(): number;
    chapters(): readonly Chapter[];
    titleOf(i: number): string;
    /** 翻屏（Space / PageDown）：到底则下一章。 */
    pageStep(dir: 1 | -1): void;
    /** 手柄 D-pad：N 行量化滚动、对齐行格（Quest）。 */
    lineStep(dir: 1 | -1, lines: number): void;
    applyPrefs(p: ReaderPrefs): void;
    /** load 之后用户动过没有（滚 / 翻章）——活书采纳「未动静默换底、已动出 chip」的判据。 */
    touched(): boolean;
    isLoaded(): boolean;
    teardown(): void;
}
export declare function createTxtReader(d: TxtReaderDeps): TxtReader;
