export type ErrorLevel = "error" | "warning" | "info" | "log";
export declare function initErrorBadge(deps: {
    status: (text: string) => void;
    dismissHint: () => string;
}): void;
/** 唯一 error 上报入口。app 各处 catch / store 的 ui.reportError 都汇到这里。 */
export declare function reportError(err: unknown, level?: ErrorLevel): void;
/** 诊断环（设置页展示用）。 */
export declare function errorLog(): readonly string[];
