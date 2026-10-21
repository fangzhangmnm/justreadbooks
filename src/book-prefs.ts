// book-prefs —— 每本书的切章规则 / 编码（synced collection，key = 路径；替代 v1 library.json）。created 2026-09-19 by Claude Fable 5.1
// 2026-10-21 条目带拍 + 未知键直通（家族格式版本纪律；src/format/migrate/；Claude Fable 5.1）：每条 `{ version, minor, patch, regexId?, regexCustom?, encoding?, header?, …extra }`；
//   major 比本版新的那条不读也不写回（reading-position 那边已提醒过用户，这里只进黑匣子）；minor 更新 = 照常用、未知键原样带回。
import { bookPrefs } from "./app-store.ts";
import type { ChapterPref } from "./chapters/index.ts";
import { migrate, splitExtra, compose, FormatTooNewError } from "./format/migrate/index.ts";
import { reportError } from "./error-badge.ts";

export interface BookPref extends ChapterPref { encoding?: string; /** 活书状态头（文件第一行；开书时记下，书架副标题用，跨设备可见）。 */ header?: string }
type Inspected = { kind: "ok"; pref: BookPref; extra: Record<string, unknown> } | { kind: "too-new" } | { kind: "none" };
let toldTooNew = false;
function inspect(raw: unknown): Inspected {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { kind: "none" };
  let m: ReturnType<typeof migrate>;
  try { m = migrate("bookPref", raw as Record<string, unknown>); }
  catch (e) {
    if (e instanceof FormatTooNewError) { if (!toldTooNew) { toldTooNew = true; reportError(e, "log"); } return { kind: "too-new" }; }
    reportError(e, "log"); return { kind: "none" };
  }
  const { known, extra } = splitExtra("bookPref", m.json);
  const pref: BookPref = {};
  if (typeof known.regexId === "string") pref.regexId = known.regexId;
  if (typeof known.regexCustom === "string") pref.regexCustom = known.regexCustom;
  if (typeof known.encoding === "string") pref.encoding = known.encoding;
  if (typeof known.header === "string") pref.header = known.header;
  return { kind: "ok", pref, extra };
}
export function getBookPref(name: string): BookPref | null { const r = inspect(bookPrefs.getItem(name)); return r.kind === "ok" ? r.pref : null; }
/** 书改名 / 移动：规则跟着身份走（旧键墓碑、新键整条搬）。整条原样搬、不重打拍（更新版本写的那条搬过去仍是它自己的拍）。 */
export function moveBookPref(from: string, to: string): void {
  const v = bookPrefs.getItem(from);
  if (v == null || from === to) return;
  bookPrefs.setItem(to, v); bookPrefs.deleteItem(from);
}
export function setBookPref(name: string, patch: Partial<BookPref>): void {
  const cur = inspect(bookPrefs.getItem(name));
  if (cur.kind === "too-new") return;   // 这条是更新版本写的：不写回（家族格式纪律 §2）
  const next: Record<string, unknown> = { ...(cur.kind === "ok" ? cur.pref : {}), ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === "") delete next[k];
  bookPrefs.setItem(name, compose("bookPref", cur.kind === "ok" ? cur.extra : {}, next));
}
