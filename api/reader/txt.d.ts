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
    /** 当前章的正文。 */
    bodyText(): string;
    /** 屏幕坐标落在正文的第几个字符上；没点在正文上 = null。 */
    offsetAt(clientX: number, clientY: number): number | null;
    /** 屏幕上第一行可见正文的字符偏移（「从这里开始读」）。 */
    firstVisibleOffset(): number;
    /** 把正文里的一段标成「正在读」（CSS Custom Highlight，画在文本节点上）；null = 清掉。浏览器不支持就不标。 */
    markReading(span: {
        start: number;
        end: number;
    } | null): void;
    /** 让这一段落在阅读线附近；已经在舒服的范围里就不动。 */
    revealSpan(span: {
        start: number;
        end: number;
    }): void;
}
export declare function createTxtReader(d: TxtReaderDeps): TxtReader;
