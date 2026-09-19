// 统一 error report —— 全 app + store 的错误唯一汇拢点（WeebPaint error-badge 同形，简化版）。
// created 2026-09-03 by Claude Fable 5.1（WXHW）· 2026-09-19 拷入 JRB by Claude Fable 5.1
//   "error"   → 红色横幅（#errBanner，盖在 busy 之上）+ console.error
//   "warning" → 琥珀横幅 + console.warn
//   "info"    → 状态栏（app 注入的 sink，瞬态）
//   "log"     → 只 console（良性 offline/fallback）
// 已毕业项目 logging 统一英文（家规 2026-08-19）；用户可见文案走 i18n（调用方传 t() 结果或 Error.message）。
// 这里是**最终消费者**：层层上报只有这里 console。

import { record as diagRecord } from "./diag-log.ts";   // 2026-09-09 黑匣子（diag-log 不反向 import 本文件，无环）

export type ErrorLevel = "error" | "warning" | "info" | "log";

let _statusSink: ((text: string) => void) | null = null;
const _ring: string[] = [];   // 最近 80 条（设置页「诊断」可看，Quest 无 devtools）
const RING_MAX = 80;

export function initErrorBadge(deps: { status: (text: string) => void; dismissHint: () => string }): void {
  _statusSink = deps.status;
  _dismissHint = deps.dismissHint;
  // 接管 index.html 内联 bootstrap 的 fatal shower：window.error / unhandledrejection 也过 severity
  (window as unknown as { __jrb_showFatal?: (t: string) => void }).__jrb_showFatal = (text) => showBanner(text, "error");
}
let _dismissHint: () => string = () => "";

function errToText(err: unknown): string {
  if (err == null) return "unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error) return (err.name && err.name !== "Error" ? `[${err.name}] ` : "") + (err.message || String(err));
  const e = err as { message?: unknown; name?: unknown };
  if (e && typeof e.message === "string") return (typeof e.name === "string" && e.name !== "Error" ? `[${e.name}] ` : "") + e.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}

function showBanner(text: string, level: "error" | "warning"): void {
  let bar = document.getElementById("errBanner");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "errBanner";
    bar.className = "err-banner";
    bar.addEventListener("click", () => bar!.classList.add("hidden"));
    (document.body || document.documentElement).appendChild(bar);
  }
  bar.classList.toggle("warning", level === "warning");
  bar.textContent = text + "  (" + _dismissHint() + ")";
  bar.classList.remove("hidden");
}

/** 唯一 error 上报入口。app 各处 catch / store 的 ui.reportError 都汇到这里。 */
export function reportError(err: unknown, level: ErrorLevel = "error"): void {
  const msg = errToText(err);
  try { diagRecord(level, msg); } catch { /* 黑匣子静默 */ }
  _ring.push(`${new Date().toISOString().slice(11, 19)} ${level} ${msg}`);
  if (_ring.length > RING_MAX) _ring.shift();
  if (level === "error") console.error("[jrb]", err);
  else if (level === "warning") console.warn("[jrb]", err);
  else console.log("[jrb]", err);
  if (level === "error" || level === "warning") showBanner(msg, level);
  else if (level === "info") _statusSink?.(msg);
}

/** 诊断环（设置页展示用）。 */
export function errorLog(): readonly string[] { return _ring; }
