// 朗读接缝：`@internal/read-aloud` 的唯一值级 import（scripts/build.sh 与 test/redline-guard 守）。created 2026-10-01 by Claude Fable 5.1
// user 2026-10-01「设置分栏 公共字体 逐句朗读 亮屏连续 做」「记得模块化不要bloatware」。评估 = 家族根 ai-docs/20261001-read-aloud-shared-lib-assessment.md。
//
// 这里只有接线：库管「分句 / 合成 / 播放 / 读到哪一句」，阅读器管「点在哪个字 / 标出正在读的句子 / 滚过去」，本文件把两头连起来并画控制条和设置栏。
//   · 逐句：朗读态下轻点一句 = 只读那一句。
//   · 亮屏连读：▶ = 从标着的那一句（没有就从屏幕上第一句）一路往下读，章末自动翻章，屏幕常亮。锁屏 / 切后台 = 暂停（这一版不承诺后台播放）。
//   · 不 bloat：没进过朗读、没展开过设置里的「朗读」栏 = worker / 引擎 / 语音包一个字节都不动（引擎门面是懒的）。
//   · 语音包来源 = 家族模型仓（config.ts READ_ALOUD_MODEL_SOURCE，设置里可改成任何镜像，或从本机文件导入）；字节到手逐片对内嵌清单的 sha256。
import { createReadAloud, createSpeechEngine, createWebAudioSink, detectLang, splitSentences, type ReadAloud, type SpeechEngine, type EmbeddedPack, type PackProgress, type SentenceSpan } from "@internal/read-aloud";
import { READ_ALOUD_PACKS } from "./read-aloud-packs.generated.ts";
import { READ_ALOUD_MODEL_SOURCE, READ_ALOUD_ENGINE_DIR, READ_ALOUD_SPEEDS } from "./config.ts";
import { deviceKvGetJson, deviceKvSetJson } from "./device-kv.ts";
import { t } from "./i18n/index.ts";
import { humanSize } from "@internal/gallery";
import type { TxtReader } from "./reader/txt.ts";

const KV = "read-aloud";
interface Prefs { pack?: string; voice?: number; speed?: number; source?: string }
/** 引擎里空闲这么久就关 worker 归还内存（WASM 堆只涨不缩）。 */
const DISPOSE_AFTER_MS = 120_000;

export interface ReadAloudHostDeps {
  reader: TxtReader;
  status: (text: string, opts?: { error?: boolean }) => void;
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
  debugState(): { active: boolean; state: string; marked: SentenceSpan | null; continuous: boolean };
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function initReadAloudHost(deps: ReadAloudHostDeps): ReadAloudHost {
  let packs: Record<string, EmbeddedPack> = READ_ALOUD_PACKS;
  let engine: SpeechEngine | null = null;
  let ra: ReadAloud | null = null;
  const sink = createWebAudioSink();
  let on = false, continuous = false, advancing = false, loadingVoice = false;
  let marked: SentenceSpan | null = null;
  let disposeTimer: ReturnType<typeof setTimeout> | null = null;
  let wake: { release(): Promise<void> } | null = null;
  const busyPacks = new Map<string, string>();   // slug → 进度文案（下载 / 导入中）

  const prefs = (): Prefs => deviceKvGetJson<Prefs>(KV, {});
  const setPrefs = (patch: Partial<Prefs>) => deviceKvSetJson(KV, { ...prefs(), ...patch });
  const slugs = () => Object.keys(packs);
  const currentSlug = (): string | null => { const p = prefs().pack; return p && packs[p] ? p : slugs()[0] ?? null; };
  const packMeta = (slug: string) => { const m = packs[slug]!.manifest; const ec = m.engineConfig as { voices?: { id: number; name: string }[]; langs?: string[] }; return { m, voices: ec.voices ?? [{ id: 0, name: "1" }], langs: ec.langs ?? m.lang }; };
  const source = () => (prefs().source ?? "").trim() || READ_ALOUD_MODEL_SOURCE;
  const speed = () => { const s = prefs().speed; return typeof s === "number" && READ_ALOUD_SPEEDS.includes(s) ? s : 1; };
  const voice = (slug: string) => { const v = prefs().voice, vs = packMeta(slug).voices; return typeof v === "number" && vs.some((x) => x.id === v) ? v : vs[0]!.id; };

  function eng(): SpeechEngine {
    if (!engine) {
      const url = document.querySelector<HTMLMetaElement>('meta[name="read-aloud-worker"]')?.content;
      if (!url) throw new Error("read-aloud worker url missing (<meta name=read-aloud-worker>)");
      engine = createSpeechEngine({ workerUrl: url, engineBase: READ_ALOUD_ENGINE_DIR, packs });
    }
    return engine;
  }
  function reader_(): ReadAloud {
    if (!ra) {
      ra = createReadAloud({ engine: { synth: (text, o) => eng().synth(text, o) }, sink });
      ra.on("sentence", (span) => { marked = span; deps.reader.markReading(span); deps.reader.revealSpan(span); });
      ra.on("state", () => { renderBar(); void syncWake(); });
      ra.on("end", () => {
        if (!on || !continuous) return;
        advancing = true; const moved = deps.nextChapter(); advancing = false;
        if (moved) { marked = null; void read(0, false); } else { continuous = false; renderBar(); void syncWake(); }
      });
      ra.on("error", (e) => { deps.logError(e); deps.status(t("ra.error"), { error: true }); renderBar(); });
    }
    return ra;
  }

  // ── 控制条 ──
  const bar = $("raBar"), playBtn = $("raPlay"), playIcon = document.getElementById("raPlayIcon"), statusEl = $("raStatus");
  function renderBar(): void {
    const st = ra?.state() ?? "idle";
    const going = st === "playing" || st === "loading";
    playIcon?.setAttribute("href", going ? "#pause" : "#play");
    const label = going ? t("ra.pause") : t("ra.play");
    playBtn.setAttribute("aria-label", label); playBtn.title = label;
    statusEl.textContent = loadingVoice ? t("ra.loadingVoice") : st === "loading" ? t("ra.synth") : "";
  }
  async function syncWake(): Promise<void> {
    const st = ra?.state() ?? "idle";
    const want = on && continuous && (st === "playing" || st === "loading") && document.visibilityState === "visible";
    if (want && !wake) {
      try { wake = (await (navigator as unknown as { wakeLock?: { request(k: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock?.request("screen")) ?? null; } catch { wake = null; }
    } else if (!want && wake) { const w = wake; wake = null; void w.release().catch(() => { /* ignore */ }); }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { wake = null; if (ra?.state() === "playing") ra.pause(); }   // 进后台：系统会收走常亮锁、挂起喇叭——明着停在「暂停」，回来由用户点继续
    else void syncWake();
  });

  async function ensureLoaded(slug: string): Promise<void> {
    if (eng().loaded() === slug) return;
    loadingVoice = true; renderBar();
    try { await eng().load(slug); } finally { loadingVoice = false; renderBar(); }
  }
  async function read(from: number, once: boolean): Promise<void> {
    const slug = currentSlug(); if (!slug || !on) return;
    let text = deps.reader.bodyText();
    // 这一章没有能读的句子（只有标题的空章）：逐句 = 什么都不做；连读 = 直接翻到下一章，翻到头就停
    while (!splitSentences(text).length) {
      if (once) return;
      advancing = true; const moved = deps.nextChapter(); advancing = false;
      if (!moved) { continuous = false; renderBar(); void syncWake(); return; }
      marked = null; from = 0; text = deps.reader.bodyText();
    }
    const lang = detectLang(text);
    if (!packMeta(slug).langs.includes(lang)) { deps.status(t("ra.langUnsupported"), { error: true }); return; }
    try { await ensureLoaded(slug); } catch (e) { deps.logError(e); deps.status(t("ra.error"), { error: true }); return; }
    if (!on || deps.reader.bodyText() !== text) return;   // 等引擎的工夫里退出了 / 翻章了
    continuous = !once;
    reader_().start(text, from, { once, lang, voice: voice(slug), speed: speed() });
    void syncWake();
  }
  function stopReading(): void { continuous = false; ra?.stop(); marked = null; deps.reader.markReading(null); void syncWake(); renderBar(); }

  async function enter(): Promise<void> {
    if (!deps.hasBook()) return;
    const slug = currentSlug();
    if (!slug) { deps.status(t("ra.noPacks")); return; }
    let ready = false;
    try { ready = (await eng().status(slug)).ready; } catch (e) { deps.logError(e); }
    if (!ready) { deps.status(t("ra.needPack")); deps.openSettings(); return; }
    if (disposeTimer) { clearTimeout(disposeTimer); disposeTimer = null; }
    on = true; document.body.dataset.readAloud = "1"; bar.hidden = false; renderBar();
    void ensureLoaded(slug).catch((e) => { deps.logError(e); deps.status(t("ra.error"), { error: true }); });
  }
  function exit(): void {
    if (!on) return;
    stopReading();
    on = false; delete document.body.dataset.readAloud; bar.hidden = true;
    if (disposeTimer) clearTimeout(disposeTimer);
    disposeTimer = setTimeout(() => { disposeTimer = null; if (!on) { engine?.dispose(); sink.close(); } }, DISPOSE_AFTER_MS);
  }

  $("raClose").addEventListener("click", exit);
  playBtn.addEventListener("click", () => {
    sink.unlock();
    const r = reader_();
    switch (r.state()) {
      case "playing": r.pause(); break;
      case "paused": r.resume(); break;
      case "loading": stopReading(); break;
      default: void read(marked ? marked.start : deps.reader.firstVisibleOffset(), false);
    }
  });
  const step = (delta: 1 | -1) => { sink.unlock(); if (marked && ra && ra.sentences().length) { ra.skip(delta); void syncWake(); } else void read(deps.reader.firstVisibleOffset(), true); };
  $("raPrev").addEventListener("click", () => step(-1));
  $("raNext").addEventListener("click", () => step(1));

  // ── 设置里的「朗读」栏 ──
  const packsEl = $("raPacks"), speedSel = $<HTMLSelectElement>("raSpeedSelect"), voiceRow = $("raVoiceRow"), voiceSel = $<HTMLSelectElement>("raVoiceSelect");
  const sourceInput = $<HTMLInputElement>("raSourceInput"), importInput = $<HTMLInputElement>("raImportInput"), section = $<HTMLDetailsElement>("secReadAloud");
  const mb = (p: PackProgress) => t("ra.progress", { done: humanSize(p.done), total: humanSize(p.total) });
  async function packAction(slug: string, kind: "download" | "import", files?: File[]): Promise<void> {
    if (busyPacks.has(slug)) return;
    busyPacks.set(slug, t("ra.starting")); renderPacks();
    const onProgress = (p: PackProgress) => { busyPacks.set(slug, mb(p)); const el = packsEl.querySelector<HTMLElement>(`[data-pack="${CSS.escape(slug)}"] .ra-pack-state`); if (el) el.textContent = busyPacks.get(slug)!; };
    try {
      if (kind === "download") await eng().download(slug, source(), onProgress); else await eng().importFiles(slug, files ?? [], onProgress);
      deps.status(t("ra.packReady"));
    } catch (e) { deps.logError(e); deps.status(t("ra.packFailed", { msg: e instanceof Error ? e.message : String(e) }), { error: true }); }
    finally { busyPacks.delete(slug); renderPacks(); }
  }
  let importTarget: string | null = null;
  importInput.addEventListener("change", () => { const files = Array.from(importInput.files ?? []); importInput.value = ""; if (importTarget && files.length) void packAction(importTarget, "import", files); });
  function renderPacks(): void {
    packsEl.textContent = "";
    if (!slugs().length) { const n = document.createElement("div"); n.className = "setting-note"; n.textContent = t("ra.noPacks"); packsEl.appendChild(n); return; }
    for (const slug of slugs()) {
      const { m } = packMeta(slug);
      const box = document.createElement("div"); box.className = "ra-pack"; box.dataset.pack = slug;
      const head = document.createElement("div"); head.className = "ra-pack-head";
      const name = document.createElement("span"); name.className = "ra-pack-name"; name.textContent = `${m.name} · ${humanSize(m.totalBytes)}`;
      const state = document.createElement("span"); state.className = "ra-pack-state";
      head.append(name, state);
      const row = document.createElement("div"); row.className = "ra-pack-actions";
      const mk = (label: string, fn: () => void) => { const b = document.createElement("button"); b.type = "button"; b.className = "auth-action"; b.textContent = label; b.addEventListener("click", fn); return b; };
      const busy = busyPacks.get(slug);
      const known = engine?.isKnownReady(slug);
      state.textContent = busy ?? (known === undefined ? "" : known ? t("ra.ready") : t("ra.notDownloaded"));
      if (!busy) {
        if (known !== true) {
          row.appendChild(mk(t("ra.download"), () => void packAction(slug, "download")));
          row.appendChild(mk(t("ra.import"), () => { importTarget = slug; importInput.click(); }));
        } else row.appendChild(mk(t("ra.delete"), () => void (async () => {
          if (!(await deps.confirm(t("ra.deleteTitle"), t("ra.deleteMsg", { name: m.name })))) return;
          if (on) exit();
          try { await eng().delete(slug); } catch (e) { deps.logError(e); }
          renderPacks();
        })()));
      }
      const credit = document.createElement("div"); credit.className = "setting-note"; credit.textContent = [m.license.attribution, m.notes].filter(Boolean).join("\n");
      box.append(head, row, credit);
      packsEl.appendChild(box);
    }
  }
  async function refreshStatuses(): Promise<void> {
    for (const slug of slugs()) { try { await eng().status(slug); } catch (e) { deps.logError(e); } }
    renderPacks();
  }
  function renderSettings(): void {
    speedSel.value = String(speed());
    sourceInput.value = prefs().source ?? ""; sourceInput.placeholder = READ_ALOUD_MODEL_SOURCE;
    const slug = currentSlug();
    const vs = slug ? packMeta(slug).voices : [];
    voiceRow.hidden = vs.length <= 1;
    if (vs.length > 1 && slug) { voiceSel.textContent = ""; for (const v of vs) { const o = document.createElement("option"); o.value = String(v.id); o.textContent = v.name; voiceSel.appendChild(o); } voiceSel.value = String(voice(slug)); }
    renderPacks();
    if (section.open) void refreshStatuses();   // 只有展开过这一栏才去问引擎（问 = 起 worker）
  }
  section.addEventListener("toggle", () => { if (section.open) void refreshStatuses(); });
  speedSel.addEventListener("change", () => { setPrefs({ speed: Number(speedSel.value) }); if (on) stopReading(); });
  voiceSel.addEventListener("change", () => { setPrefs({ voice: Number(voiceSel.value) }); if (on) stopReading(); });
  sourceInput.addEventListener("change", () => setPrefs({ source: sourceInput.value.trim() || undefined }));

  return {
    available: () => slugs().length > 0,
    active: () => on,
    toggle() { if (on) { exit(); return; } sink.unlock(); void enter(); },
    exit,
    tapAt(x, y) {
      if (!on) return false;
      const off = deps.reader.offsetAt(x, y);
      if (off == null) return false;
      sink.unlock(); void read(off, true);
      return true;
    },
    contentChanged() { if (advancing) return; if (ra && ra.state() !== "idle") stopReading(); else { marked = null; } },
    renderSettings,
    debugInstall(p, e) { packs = p; engine = e; ra = null; },
    debugState: () => ({ active: on, state: ra?.state() ?? "idle", marked, continuous }),
  };
}
