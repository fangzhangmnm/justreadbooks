import { S, type Lang } from "./strings.ts";
export type { Lang } from "./strings.ts";
export type Key = keyof typeof S;
export declare const LANGS: Lang[];
export declare const LANG_NAME: Record<Lang, string>;
/** 当前语言：device-kv 里选过的 → 否则 zh（不跟系统：中文写作 app）。惰性解析后锁死（reload 制）。 */
export declare function lang(): Lang;
export declare function t(key: Key, params?: Record<string, string | number>): string;
export declare function setLang(l: Lang): void;
/** data-i18n 桥：静态 index.html 一次性填充（textContent / title / aria-label / placeholder）。不碰元素子节点（图标 <svg> 保留）。 */
export declare function localizeDom(root?: ParentNode): void;
export declare function setLocalizedText(el: HTMLElement, s: string): void;
export declare function initI18n(): void;
