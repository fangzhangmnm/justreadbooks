export declare function deviceKvGet(key: string): string | null;
/** 还原出厂用（src/factory-reset.ts）：删掉本 app 前缀下的全部键——只动自己的前缀，同域名下兄弟 app 的键不碰；内存层一起清。返回删了几个。 */
export declare function deviceKvWipeAll(): number;
/** 还原出厂后验证归零用：本 app 前缀下还剩几个键（含内存层）。 */
export declare function deviceKvCount(): number;
/** v=null 删键。写失败（配额/隐私模式中途翻脸）→ 落内存层，绝不 throw（device 层是便利不是红线）。 */
export declare function deviceKvSet(key: string, v: string | null): void;
export declare function deviceKvGetJson<T>(key: string, fallback: T): T;
export declare function deviceKvSetJson(key: string, v: unknown): void;
