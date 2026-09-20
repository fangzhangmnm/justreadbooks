import type { TxtReader } from "./txt.ts";
export interface KeysDeps {
    reader: () => TxtReader | null;
    readerVisible: () => boolean;
    modalOpen: () => boolean;
    toggleShelf: () => void;
    toggleChapters: () => void;
    /** 目录 view 开着：它是 modal，但 o / 手柄 Select 要能把它关掉（Quest 没 Escape）。 */
    chaptersOpen: () => boolean;
    toggleSettings: () => void;
}
export declare function initKeys(d: KeysDeps): void;
