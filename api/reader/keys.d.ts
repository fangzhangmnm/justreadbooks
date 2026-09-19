import type { TxtReader } from "./txt.ts";
export interface KeysDeps {
    reader: () => TxtReader | null;
    readerVisible: () => boolean;
    modalOpen: () => boolean;
    toggleShelf: () => void;
    toggleChapters: () => void;
    toggleSettings: () => void;
}
export declare function initKeys(d: KeysDeps): void;
