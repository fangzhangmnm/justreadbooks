import { type SpeechEngine, type EmbeddedPack, type SentenceSpan } from "@internal/read-aloud";
import type { TxtReader } from "./reader/txt.ts";
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
    logError: (e: unknown) => void;
}
export interface ReadAloudHost {
    /** 这一版有没有随附语音包（没有 = 朗读钮不露）。 */
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
    /** smoke 探针：换成假的语音包清单和假引擎（真引擎的整链测试在库仓）。 */
    debugInstall(packs: Record<string, EmbeddedPack>, engine: SpeechEngine): void;
    debugState(): {
        active: boolean;
        state: string;
        marked: SentenceSpan | null;
        continuous: boolean;
    };
}
export declare function initReadAloudHost(deps: ReadAloudHostDeps): ReadAloudHost;
