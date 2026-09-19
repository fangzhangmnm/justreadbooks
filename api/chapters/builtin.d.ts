export interface BuiltinChapterRegex {
    id: string;
    re: string;
}
export declare const BUILTIN_CHAPTER_REGEXES: readonly BuiltinChapterRegex[];
/** 自动探测：候选正则里命中数 ≥ 此值的第一条胜出，否则整本一章。 */
export declare const MIN_AUTO_HITS = 3;
