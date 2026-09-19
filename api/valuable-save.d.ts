export interface ValuableSaveConfig {
    commit: () => Promise<void>;
    keepalive?: () => void;
    debounceMs?: number;
    ceilingMs?: number;
    now?: () => number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
}
export interface ValuableSave {
    mark: () => void;
    markTrivial: () => void;
    flush: () => Promise<void>;
    flushKeepalive: () => void;
    isDirty: () => boolean;
    isInFlight: () => boolean;
    dispose: () => void;
}
export declare function createValuableSave(cfg: ValuableSaveConfig): ValuableSave;
