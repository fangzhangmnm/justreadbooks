export type Component = "readingPosition" | "bookPref";
export interface Stamp {
    major: number;
    minor: number;
    patch: number;
}
/** 本版写出的拍子（SSoT）。两份都是 1.0.0 = 2026-09-19 现代化起的形状，2026-10-21 起才带拍。 */
export declare const FORMAT: Readonly<Record<Component, Readonly<Stamp>>>;
/** 缺 `version` 时当几：两份都从没写过 version = 1。 */
export declare const MISSING_MAJOR: Readonly<Record<Component, number>>;
/** 本版能读的最老 major。 */
export declare const MIN_MAJOR: Readonly<Record<Component, number>>;
/** 本版认识的键（拍子三键之外）。读取器把它们之外的键装进 extra 袋原样带回；写入器先铺 extra 再铺已知键（已知键永远赢）。 */
export declare const KNOWN_FIELDS: Readonly<Record<Component, readonly string[]>>;
export declare const STAMP_KEYS: readonly string[];
export type Step = (json: Record<string, unknown>) => Record<string, unknown>;
/** STEPS[子结构][major] = 把 major 升到 major+1 的纯函数（必须把 version 写成 major+1）。今天空表：两份都只有 1。 */
export declare const STEPS: Readonly<Partial<Record<Component, Readonly<Record<number, Step>>>>>;
export declare class FormatTooNewError extends Error {
    readonly component: Component;
    readonly fileStamp: Stamp;
    readonly appStamp: Stamp;
    constructor(component: Component, fileStamp: Stamp, appStamp: Stamp);
}
export declare class FormatTooOldError extends Error {
    readonly component: Component;
    readonly fileStamp: Stamp;
    constructor(component: Component, fileStamp: Stamp, minMajor: number);
}
export declare const fmt: (s: Stamp) => string;
/** 读一条 JSON 的拍子：version = major（缺 → MISSING_MAJOR）；minor / patch 缺或非法 = 0。 */
export declare function readStamp(c: Component, json: unknown): Stamp;
/** 同 major 下文件拍 vs 本版拍。too-new（major 大）不在这里——它走异常。 */
export type Verdict = "same" | "older" | "newer-minor" | "newer-patch";
export declare function compareStamp(file: Stamp, mine: Stamp): Verdict;
/** 把一条 JSON 升到本版 major，并给出判决。major 比本版大 → FormatTooNewError；比 MIN_MAJOR 小 → FormatTooOldError；
 *  中间每一步都要有 STEP，缺了 = 纪律破，响亮抛。steps 可注入（测试）。 */
export declare function migrate(c: Component, json: Record<string, unknown>, steps?: typeof STEPS): {
    json: Record<string, unknown>;
    stamp: Stamp;
    verdict: Verdict;
};
/** 直通：已知键 / 其余键分开。拍子三键既不算已知也不进 extra（拍子永远是自己的，写回时由 compose 重打）。 */
export declare function splitExtra(c: Component, json: Record<string, unknown>): {
    known: Record<string, unknown>;
    extra: Record<string, unknown>;
};
/** 写入器用：先铺 extra、再铺已知键（已知键永远赢）、最后本版的拍子。 */
export declare function compose(c: Component, extra: Record<string, unknown>, known: Record<string, unknown>): Record<string, unknown>;
