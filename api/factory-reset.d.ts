export interface FactoryResetDeps {
    setStatus: (msg: string, opts?: {
        error?: boolean;
    }) => void;
    /** wipe 前收口：关掉正在读的书（阅读器停、位置不再写），之后 store 就 dispose 了。 */
    beforeWipe: () => Promise<void>;
    /** 只注销管着当前页面的 SW + 只删 `jrb-` 前缀的缓存（pwa-shell 的那一步，不 reload）。 */
    clearOwnShell: () => Promise<void>;
}
/** 还原出厂主流程（设置 →「开发者」→「还原出厂设置…」）。全程 in-app sheet。 */
export declare function runFactoryReset(d: FactoryResetDeps): Promise<void>;
