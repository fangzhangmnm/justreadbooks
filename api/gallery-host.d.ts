export interface GalleryHostDeps {
    mountEl: HTMLElement;
    fullEl: HTMLElement;
    activeName: () => string | null;
    /** 打开一本书（全路径 + 已知大小）。返回 true = 阅读器已切过去。 */
    openBook: (name: string, size?: number) => Promise<boolean>;
    renameActive: () => Promise<string | null>;
    /** 活动书被图库移动/改名 → 阅读器换身份。 */
    setActiveName: (name: string) => void;
    pushBook: (name: string) => Promise<void>;
    offloadBook: (name: string) => Promise<void>;
    flushLocal: () => Promise<void>;
    setStatus: (text: string, opts?: {
        error?: boolean;
    }) => void;
    currentDir: () => string;
    onOpened?: () => void;
    onClosed?: () => void;
}
export type ShelfLayout = "cards" | "list";
export declare function shelfLayout(): ShelfLayout;
export declare function initGalleryHost(d: GalleryHostDeps): {
    open: () => Promise<void>;
    close: () => void;
    isOpen: () => boolean;
    wasInGallery: () => boolean;
    refresh: () => void | undefined;
    setView: (v: "files" | "trash") => void;
    getView: () => "files" | "trash";
    emptyTrash: (scope: "local" | "cloud" | "both") => void;
    currentFolder: () => string;
    setLayout: (l: ShelfLayout) => void;
};
export type GalleryHost = ReturnType<typeof initGalleryHost>;
