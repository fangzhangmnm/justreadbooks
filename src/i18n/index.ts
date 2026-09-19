// i18n 运行时 —— t()（具名插值）+ 当前语言 + setLang（reload 制）+ data-i18n 启动填充。
// created 2026-09-03 by Claude Fable 5.1（WXHW）· 2026-09-19 拷入 JRB by Claude Fable 5.1（抄 WXHW：两语、语言住 device-kv）。
// SSoT = ./strings.ts。**默认中文**（产品是中文网文阅读器，UI 中文；en 是毕业级 SSoT 的第二语，设置里可切）。

import { S, type Lang } from "./strings.ts";
import { deviceKvGet, deviceKvSet } from "../device-kv.ts";

export type { Lang } from "./strings.ts";
export type Key = keyof typeof S;

export const LANGS: Lang[] = ["zh", "en"];
export const LANG_NAME: Record<Lang, string> = { zh: "中文", en: "English" };

const KV_LANG = "lang";
const validLang = (v: unknown): Lang | null => (typeof v === "string" && LANGS.includes(v as Lang) ? v as Lang : null);

let _lang: Lang | null = null;
/** 当前语言：device-kv 里选过的 → 否则 zh（不跟系统：中文写作 app）。惰性解析后锁死（reload 制）。 */
export function lang(): Lang { return (_lang ??= validLang(deviceKvGet(KV_LANG)) ?? "zh"); }

export function t(key: Key, params?: Record<string, string | number>): string {
  const e = S[key] as Record<string, string | undefined> | undefined;
  if (!e) { console.warn("[i18n] missing key:", key); return String(key); }
  const raw: string = e[lang()] ?? e["zh"] ?? String(key);
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_m, k: string) => (k in params ? String(params[k]) : `{${k}}`));
}

export function setLang(l: Lang): void {
  if (!LANGS.includes(l) || l === lang()) return;
  deviceKvSet(KV_LANG, l);
  location.reload();
}

/** data-i18n 桥：静态 index.html 一次性填充（textContent / title / aria-label / placeholder）。不碰元素子节点（图标 <svg> 保留）。 */
export function localizeDom(root: ParentNode = document): void {
  const k = (s: string | undefined) => s as Key;
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    if (!el.dataset.i18n) return;
    setLocalizedText(el, t(k(el.dataset.i18n)));
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => { if (el.dataset.i18nTitle) el.title = t(k(el.dataset.i18nTitle)); });
  root.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((el) => { if (el.dataset.i18nAria) el.setAttribute("aria-label", t(k(el.dataset.i18nAria))); });
  root.querySelectorAll<HTMLInputElement>("[data-i18n-ph]").forEach((el) => { if (el.dataset.i18nPh) el.placeholder = t(k(el.dataset.i18nPh)); });
}

export function setLocalizedText(el: HTMLElement, s: string): void {
  if (el.children.length === 0) { el.textContent = s; return; }
  const texts = Array.from(el.childNodes).filter((n): n is Text => n.nodeType === 3);
  const target = texts.find((n) => (n.textContent ?? "").trim() !== "");
  if (!target) { el.appendChild(document.createTextNode(s)); return; }
  target.textContent = s;
  for (const n of texts) if (n !== target && (n.textContent ?? "").trim() !== "") n.remove();
}

export function initI18n(): void {
  document.documentElement.lang = lang() === "zh" ? "zh-CN" : "en";
  localizeDom();
}
