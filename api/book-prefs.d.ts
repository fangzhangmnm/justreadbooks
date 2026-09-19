import type { ChapterPref } from "./chapters/index.ts";
export interface BookPref extends ChapterPref {
    encoding?: string;
}
export declare function getBookPref(name: string): BookPref | null;
export declare function setBookPref(name: string, patch: Partial<BookPref>): void;
