import type { EmbeddedPack, VoiceDef } from "@internal/read-aloud";
import type { EmbeddedPack as PackStoreEmbeddedPack } from "@internal/model-packs";
export declare const READ_ALOUD_VOICES: Record<string, VoiceDef>;
export declare const READ_ALOUD_PACKS: Record<string, EmbeddedPack & PackStoreEmbeddedPack>;
/** 只准本机导入的音色（tools/local-voices/）：没有下载来源，界面上不给下载钮。 */
export declare const READ_ALOUD_IMPORT_ONLY: readonly string[];
/** 退役包（JRB 以前内嵌过、现在不用）：只给「清理旧版音色」认领用——问缓存里还剩多少、删掉。永不下载。 */
export declare const READ_ALOUD_RETIRED_PACKS: Record<string, PackStoreEmbeddedPack>;
