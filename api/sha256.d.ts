export declare class Sha256 {
    private h;
    private buf;
    private bufLen;
    private total;
    private w;
    private done;
    update(bytes: Uint8Array): this;
    private block;
    hex(): string;
}
export declare function sha256Hex(bytes: Uint8Array): string;
