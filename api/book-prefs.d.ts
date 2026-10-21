import type { ChapterPref } from "./chapters/index.ts";
export interface BookPref extends ChapterPref {
    encoding?: string; /** 活书状态头（文件第一行；开书时记下，书架副标题用，跨设备可见）。 */
    header?: string;
}
export declare function getBookPref(name: string): BookPref | null;
/** 书改名 / 移动：规则跟着身份走（旧键墓碑、新键整条搬）。整条原样搬、不重打拍（更新版本写的那条搬过去仍是它自己的拍）。 */
export declare function moveBookPref(from: string, to: string): void;
export declare function setBookPref(name: string, patch: Partial<BookPref>): void;
