// book-prefs —— 每本书的切章规则 / 编码（synced collection，key = 路径；替代 v1 library.json）。created 2026-09-19 by Claude Fable 5.1
import { bookPrefs } from "./app-store.ts";
import type { ChapterPref } from "./chapters/index.ts";

export interface BookPref extends ChapterPref { encoding?: string; /** 活书状态头（文件第一行；开书时记下，书架副标题用，跨设备可见）。 */ header?: string }
export function getBookPref(name: string): BookPref | null {
  const v = bookPrefs.getItem(name) as BookPref | null | undefined;
  return v && typeof v === "object" ? v : null;
}
/** 书改名 / 移动：规则跟着身份走（旧键墓碑、新键整条搬）。 */
export function moveBookPref(from: string, to: string): void {
  const v = bookPrefs.getItem(from);
  if (v == null || from === to) return;
  bookPrefs.setItem(to, v); bookPrefs.deleteItem(from);
}
export function setBookPref(name: string, patch: Partial<BookPref>): void {
  const cur = getBookPref(name) ?? {};
  const next: BookPref = { ...cur, ...patch };
  for (const k of Object.keys(next) as (keyof BookPref)[]) if (next[k] === undefined || next[k] === "") delete next[k];
  bookPrefs.setItem(name, next);
}
