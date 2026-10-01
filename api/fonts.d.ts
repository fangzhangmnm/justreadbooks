/** CSS 里用的 family 名（styles.css `--font-reading-sans` 的第一位）。带 app 前缀 = 不和系统里装的同名字体撞。 */
export declare const SANS_FAMILY = "JRB Sans";
/** 取字体并解析成 FontFace（还没进文档）。成功只做一次；拿不到（文件不在 / 离线且没缓存 / 浏览器不支持）→ null，界面照旧用系统字体，下次调用再试。 */
export declare function loadSansFace(): Promise<FontFace | null>;
