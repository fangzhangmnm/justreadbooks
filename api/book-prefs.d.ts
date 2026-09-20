import type { ChapterPref } from "./chapters/index.ts";
export interface BookPref extends ChapterPref {
    encoding?: string; /** 活书状态头（文件第一行；开书时记下，书架副标题用，跨设备可见）。 */
    header?: string;
}
export declare function getBookPref(name: string): BookPref | null;
export declare function setBookPref(name: string, patch: Partial<BookPref>): void;
