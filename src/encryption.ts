// encryption 表态 —— @internal/store 0.7.0 起 `encryption` 必填、无 dormant 替身：JRB 0.1 不做加密书，传零 codec 实例
//（探测照常、pack/unpack 响亮抛）。这是 @internal/encryption 在本仓的**唯一值级 import 点**（build.sh lint 守着）。
// created 2026-09-19 by Claude Fable 5.1
import { createEncryption } from "@internal/encryption";
import { reportError } from "./error-badge.ts";

export const appEncryption = createEncryption({
  codec: null,
  reportError: (e) => reportError(e instanceof Error ? e : new Error(String(e)), "log"),
});
