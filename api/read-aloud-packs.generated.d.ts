import type { EmbeddedPack, VoiceDef } from "@internal/read-aloud";
import type { EmbeddedPack as PackStoreEmbeddedPack } from "@internal/model-packs";
export declare const READ_ALOUD_VOICES: Record<string, VoiceDef>;
export declare const READ_ALOUD_PACKS: Record<string, EmbeddedPack & PackStoreEmbeddedPack>;
/** 只准本机导入的音色（tools/local-voices/）：没有下载来源，界面上不给下载钮。 */
export declare const READ_ALOUD_IMPORT_ONLY: readonly string[];
