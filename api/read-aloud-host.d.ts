import { type SpeechEngine, type EmbeddedPack, type VoiceDef, type SentenceSpan } from "@internal/read-aloud";
import type { TxtReader } from "./reader/txt.ts";
/** 随 app 内嵌的音色目录。 */
export interface ReadAloudCatalog {
    voices: Record<string, VoiceDef>;
    packs: Record<string, EmbeddedPack>;
}
export interface ReadAloudHostDeps {
    reader: TxtReader;
    status: (text: string, opts?: {
        error?: boolean;
    }) => void;
    hasBook: () => boolean;
    /** 连读到章末：有下一章就翻过去并返回 true。 */
    nextChapter: () => boolean;
    /** 打开设置并展开「朗读」栏。 */
    openSettings: () => void;
    confirm: (title: string, message: string) => Promise<boolean>;
    /** available() 的答案变了（装上 / 删掉了音色）：宿主重画顶栏。 */
    availabilityChanged: () => void;
    /** 显示 / 收起顶栏（朗读态下点正文是点句子，顶栏只能从控制条上叫出来）。 */
    toggleChrome: () => void;
    logError: (e: unknown) => void;
}
export interface ReadAloudHost {
    /** 顶栏露不露朗读钮：这一版随附了音色，**而且这台设备上装了一个**（user 2026-10-01：大部分时候不需要语音，别干扰阅读）。 */
    available(): boolean;
    active(): boolean;
    /** 顶栏朗读钮：必须在点击处理函数里同步调（iOS 的喇叭要在手势里解锁）。 */
    toggle(): void;
    exit(): void;
    /** 朗读态下的轻点。吃掉了（点在正文上）返回 true。 */
    tapAt(clientX: number, clientY: number): boolean;
    /** 正文换了（翻章 / 换书 / 活书换底）：停下、清标记。 */
    contentChanged(): void;
    renderSettings(): void;
    /** smoke 探针：换一份音色目录；给了 engine 就用它（假引擎），不给 = 用真引擎跑这份目录。 */
    debugInstall(catalog: ReadAloudCatalog, engine?: SpeechEngine): void;
    debugState(): {
        active: boolean;
        state: string;
        marked: SentenceSpan | null;
        continuous: boolean;
    };
}
export declare function initReadAloudHost(deps: ReadAloudHostDeps): ReadAloudHost;
