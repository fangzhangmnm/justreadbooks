export type OffReason = "expired" | "offline" | "noResponse";
export type BarView = {
    kind: "hidden";
} | {
    kind: "offline";
    reason: OffReason;
} | {
    kind: "syncing";
};
export declare function isCloudOff(): boolean;
export declare function rawOnline(): boolean;
/** 浏览器说有网 ∧ 这边没判成「连不上」。原来散在各处的 `navigator.onLine` 云端判断都换成它。 */
export declare function cloudOnline(): boolean;
export declare function onCloudOffChange(f: () => void): () => void;
export interface AuthFailure {
    where: string;
    name: string;
    code: string;
    sub: string;
    reason: OffReason;
}
export declare function parseAuthFailure(message: string): AuthFailure | null;
export declare function noteAuthFailure(message: string): AuthFailure | null;
export interface CloudWatchDeps {
    hasHome(): boolean;
    signedIn(): boolean;
    /** 静默续签一次。 */
    renew(): Promise<boolean>;
    /** 问云端一次；回库的终态串（"cloud-error" = 没问成）。 */
    check(): Promise<string | undefined>;
    /** 连上之后补一轮。 */
    catchUp(): Promise<void>;
    show(view: BarView): void;
    note(line: string): void;
    now?(): number;
    timeoutMs?: number;
}
export interface CloudWatch {
    /** 悄悄核一次（开机 / 醒来 / 回线 / 点条）。同时只跑一趟；永不抛、永不挡人。 */
    check(trigger: string): Promise<void>;
    /** 断网了：不等下一趟，条马上挂上。 */
    netLost(): void;
    authChanged(signedIn: boolean, reason?: string): void;
    reason(): OffReason | null;
}
export declare function createCloudWatch(d: CloudWatchDeps): CloudWatch;
