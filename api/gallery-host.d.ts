import { type GalleryView } from "@internal/gallery";
export interface GalleryHostDeps {
    mountEl: HTMLElement;
    fullEl: HTMLElement;
    /** 正在读的那本（身份 = 全路径）。 */
    activeName: () => string | null;
    /** 打开一本书（身份 + 已知大小）。返回 true = 阅读器已切过去。 */
    openBook: (identifier: string, size?: number) => Promise<boolean>;
    /** 顶栏改名（阅读器自己的改名 UI）；返回新身份。 */
    renameActive: () => Promise<string | null>;
    /** 正在读的那本被图库移动 / 改名 → 阅读器换身份。 */
    setActiveName: (identifier: string) => void;
    offloadBook: (identifier: string) => Promise<void>;
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
    setView: (v: GalleryView) => void;
    getView: () => GalleryView;
    currentFolder: () => string;
    setLayout: (l: ShelfLayout) => void;
};
export type GalleryHost = ReturnType<typeof initGalleryHost>;
