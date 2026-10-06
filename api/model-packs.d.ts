import type { EmbeddedPack } from "@internal/read-aloud";
export interface PackStatus {
    slug: string;
    ready: boolean;
    bytesCached: number;
    bytesTotal: number;
}
export interface PackProgress {
    done: number;
    total: number;
}
export interface PackStore {
    /** 几个包各自的状态（就绪 = 每片都在、尺寸对、盖过「已验」章且 packId 没变）。 */
    status(slugs: readonly string[]): Promise<PackStatus[]>;
    /**
     * 从 base（模型源，如 https://…/pwa-models）下载并逐片校验。可续传；已经有的分片不重取。
     * 进度按「这次要的所有包」的总字节报，已经在缓存里的算在起点里。
     */
    download(slugs: readonly string[], base: string, onProgress?: (p: PackProgress) => void): Promise<PackStatus[]>;
    /**
     * 用户自己拿到的文件：按**内容哈希**认它们是哪个包的哪一片（文件名不作数——几个包的分片都叫 chunk-000）。
     * 认得的逐片入缓存；尺寸和哪一片都对不上的文件略过（把 manifest.json、LICENSE.txt 一起选进来不算错）；尺寸对、哈希不对 = 坏文件，报错；
     * 也收「整包一个文件」（= 所有分片按序拼接）。一个都不认识 → "no-matching-file"。
     */
    importFiles(slugs: readonly string[], files: readonly File[], onProgress?: (p: PackProgress) => void): Promise<PackStatus[]>;
    /** 删掉这几个包的分片和「已验」章。 */
    delete(slugs: readonly string[]): Promise<void>;
    /** 就绪的包的分片（Blob，按清单顺序；引用缓存里的字节，不拷贝）——喂给引擎的 load。没就绪 → 错误 "pack-missing"。 */
    chunks(slug: string): Promise<Blob[]>;
}
export declare function createPackStore(deps: {
    packs: Readonly<Record<string, EmbeddedPack>>;
    cacheName?: string;
}): PackStore;
