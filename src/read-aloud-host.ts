// 朗读接缝：`@internal/read-aloud` 的唯一值级 import（scripts/build.sh 与 test/redline-guard 守）。created 2026-10-01 by Claude Fable 5.1
// user 2026-10-01「设置分栏 公共字体 逐句朗读 亮屏连续 做」「记得模块化不要bloatware」。评估 = 家族根 ai-docs/20261001-read-aloud-shared-lib-assessment.md。
//
// 这里只有接线：库管「分句 / 合成 / 播放 / 读到哪一句」，阅读器管「点在哪个字 / 标出正在读的句子 / 滚过去」，本文件把两头连起来并画控制条和设置栏。
//   · 逐句：朗读态下轻点一句 = 只读那一句。
//   · 亮屏连读：▶ = 从标着的那一句（没有就从屏幕上第一句）一路往下读，章末自动翻章，屏幕常亮。锁屏 / 切后台 = 暂停（这一版不承诺后台播放）。
//   · 不 bloat：没进过朗读、没展开过设置里的「朗读」栏 = worker / 引擎 / 语音包一个字节都不动（引擎门面是懒的）。
//   · 语音包来源 = 家族模型仓（config.ts READ_ALOUD_MODEL_SOURCE，设置里可改成任何镜像，或从本机文件导入）；字节到手逐片对内嵌清单的 sha256。
//   · 一个音色 = 几个小包（权重 / 运行时 / 每种语言的词典；库的 VoiceDef）。界面只说「音色」；只把这一章的语言装进引擎（日语前端固定占 160 MB 内存）。
//   · 音色的署名和使用条款（上游要求必须让用户看到的原文）显示在设置的「朗读」栏里，正文字号，不翻译。
import { createReadAloud, createSpeechEngine, createWebAudioSink, detectLang, splitSentences, voiceLangs, voicePacks, type ReadAloud, type SpeechEngine, type SpeechLang, type EmbeddedPack, type VoiceDef, type PackProgress, type SentenceSpan } from "@internal/read-aloud";
import { READ_ALOUD_VOICES, READ_ALOUD_PACKS } from "./read-aloud-packs.generated.ts";
import { READ_ALOUD_MODEL_SOURCE, READ_ALOUD_SPEEDS } from "./config.ts";
import { deviceKvGetJson, deviceKvSetJson } from "./device-kv.ts";
import { t, type Key } from "./i18n/index.ts";
import { humanSize } from "@internal/gallery";
import type { TxtReader } from "./reader/txt.ts";

const KV = "read-aloud";
/** have = 这台设备上有能用的音色（上次问引擎时的结论）。朗读是可选的：没装音色的人顶栏上看不到喇叭钮，入口只在设置 →「朗读」。
 *  记在偏好里是为了启动时不用为了问这一句去起 worker。 */
interface Prefs { voice?: string; speaker?: number; speed?: number; source?: string; have?: boolean }
/** 随 app 内嵌的音色目录。 */
export interface ReadAloudCatalog { voices: Record<string, VoiceDef>; packs: Record<string, EmbeddedPack> }
/** 每个音色给用户的一句实话（哪种语言是本行、哪种是凑合）：按音色 id 查，没有就不显示。 */
const VOICE_NOTE: Record<string, Key> = { "tsukuyomi-chan": "ra.voiceNote.tsukuyomi-chan" };
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
  /** available() 的答案变了（装上 / 删掉了音色）：宿主重画顶栏。 */
  availabilityChanged: () => void;
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
  debugState(): { active: boolean; state: string; marked: SentenceSpan | null; continuous: boolean };
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function initReadAloudHost(deps: ReadAloudHostDeps): ReadAloudHost {
  let catalog: ReadAloudCatalog = { voices: READ_ALOUD_VOICES, packs: READ_ALOUD_PACKS };
  let engine: SpeechEngine | null = null;
  let ra: ReadAloud | null = null;
  const sink = createWebAudioSink();
  let on = false, continuous = false, advancing = false, loadingVoice = false;
  let marked: SentenceSpan | null = null;
  let disposeTimer: ReturnType<typeof setTimeout> | null = null;
  let wake: { release(): Promise<void> } | null = null;
  const busyVoices = new Map<string, string>();   // 音色 id → 进度文案（下载 / 导入中）

  const prefs = (): Prefs => deviceKvGetJson<Prefs>(KV, {});
  const setPrefs = (patch: Partial<Prefs>) => deviceKvSetJson(KV, { ...prefs(), ...patch });
  const voiceIds = () => Object.keys(catalog.voices);
  const currentVoice = (): string | null => { const v = prefs().voice; return typeof v === "string" && catalog.voices[v] ? v : voiceIds()[0] ?? null; };
  const def = (id: string) => catalog.voices[id]!;
  const speakers = (id: string) => def(id).speakers ?? [{ id: 0, name: def(id).name }];
  const totalBytes = (id: string) => voicePacks(def(id)).reduce((a, slug) => a + (catalog.packs[slug]?.manifest.totalBytes ?? 0), 0);
  const source = () => (prefs().source ?? "").trim() || READ_ALOUD_MODEL_SOURCE;
  const speed = () => { const s = prefs().speed; return typeof s === "number" && READ_ALOUD_SPEEDS.includes(s) ? s : 1; };
  const speaker = (id: string) => { const v = prefs().speaker, vs = speakers(id); return typeof v === "number" && vs.some((x) => x.id === v) ? v : vs[0]!.id; };

  function eng(): SpeechEngine {
    if (!engine) {
      const url = document.querySelector<HTMLMetaElement>('meta[name="read-aloud-worker-piper-plus"]')?.content;
      if (!url) throw new Error("read-aloud worker url missing (<meta name=read-aloud-worker-piper-plus>)");
      engine = createSpeechEngine({ workers: { "piper-plus": { url, type: "module" } }, voices: catalog.voices, packs: catalog.packs });
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

  /** 念 lang 要装进引擎的语言：日语正文里夹的拉丁字母走英语前端，所以日语 + 英语（英语包在才带）。 */
  function langsFor(id: string, lang: SpeechLang): SpeechLang[] {
    return lang === "ja" && eng().isKnownReady(id, "en") ? ["ja", "en"] : [lang];
  }
  async function ensureLoaded(id: string, lang: SpeechLang): Promise<void> {
    const cur = eng().loaded();
    if (cur?.voice === id && cur.langs.includes(lang)) return;
    loadingVoice = true; renderBar();
    try { await eng().load(id, { langs: langsFor(id, lang) }); } finally { loadingVoice = false; renderBar(); }
  }
  async function read(from: number, once: boolean): Promise<void> {
    const id = currentVoice(); if (!id || !on) return;
    let text = deps.reader.bodyText();
    // 这一章没有能读的句子（只有标题的空章）：逐句 = 什么都不做；连读 = 直接翻到下一章，翻到头就停
    while (!splitSentences(text).length) {
      if (once) return;
      advancing = true; const moved = deps.nextChapter(); advancing = false;
      if (!moved) { continuous = false; renderBar(); void syncWake(); return; }
      marked = null; from = 0; text = deps.reader.bodyText();
    }
    const lang = detectLang(text);
    if (!voiceLangs(def(id)).includes(lang)) { deps.status(t("ra.langUnsupported"), { error: true }); return; }
    if (eng().isKnownReady(id, lang) === false) { deps.status(t("ra.langNotDownloaded")); deps.openSettings(); return; }
    try { await ensureLoaded(id, lang); } catch (e) { deps.logError(e); deps.status(t("ra.error"), { error: true }); return; }
    if (!on || deps.reader.bodyText() !== text) return;   // 等引擎的工夫里退出了 / 翻章了
    continuous = !once;
    reader_().start(text, from, { once, lang, speaker: speaker(id), speed: speed() });
    void syncWake();
  }
  function stopReading(): void { continuous = false; ra?.stop(); marked = null; deps.reader.markReading(null); void syncWake(); renderBar(); }

  async function enter(): Promise<void> {
    if (!deps.hasBook()) return;
    const id = currentVoice();
    if (!id) { deps.status(t("ra.noPacks")); return; }
    let usable = false;
    try { usable = (await eng().status(id)).langs.length > 0; } catch (e) { deps.logError(e); }
    if (!usable) { deps.status(t("ra.needPack")); deps.openSettings(); return; }   // 记着有、其实没了（浏览器清了缓存 / 兄弟 app 删了共用的包）：带去设置，那里会把账记对
    noteHave(true);
    if (disposeTimer) { clearTimeout(disposeTimer); disposeTimer = null; }
    on = true; document.body.dataset.readAloud = "1"; bar.hidden = false; renderBar();
    // 进来就先把这一章的语言装上（点第一句时不用等）；这一章的语言没下 / 不会念 → 等用户点了再如实说
    const lang = detectLang(deps.reader.bodyText());
    if (eng().isKnownReady(id, lang)) void ensureLoaded(id, lang).catch((e) => { deps.logError(e); deps.status(t("ra.error"), { error: true }); });
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
  const speakerRow = $("raSpeakerRow"), speakerSel = $<HTMLSelectElement>("raSpeakerSelect");
  const sourceInput = $<HTMLInputElement>("raSourceInput"), importInput = $<HTMLInputElement>("raImportInput"), section = $<HTMLDetailsElement>("secReadAloud");
  const mb = (p: PackProgress) => t("ra.progress", { done: humanSize(p.done), total: humanSize(p.total) });
  const langName = (l: SpeechLang) => t(`ra.lang.${l}`);
  async function voiceAction(id: string, kind: "download" | "import", files?: File[]): Promise<void> {
    if (busyVoices.has(id)) return;
    busyVoices.set(id, t("ra.starting")); renderPacks();
    const onProgress = (p: PackProgress) => { busyVoices.set(id, mb(p)); const el = packsEl.querySelector<HTMLElement>(`[data-voice="${CSS.escape(id)}"] .ra-pack-state`); if (el) el.textContent = busyVoices.get(id)!; };
    try {
      const st = kind === "download" ? await eng().download(id, source(), { onProgress }) : await eng().importFiles(id, files ?? [], onProgress);
      deps.status(st.ready ? t("ra.packReady") : t("ra.packPartial", { langs: st.langs.map(langName).join(" / ") || t("ra.none") }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      deps.logError(e); deps.status(msg === "no-matching-file" ? t("ra.importNoMatch") : t("ra.packFailed", { msg }), { error: true });
    }
    finally { busyVoices.delete(id); await refreshStatuses(); }
  }
  let importTarget: string | null = null;
  importInput.addEventListener("change", () => { const files = Array.from(importInput.files ?? []); importInput.value = ""; if (importTarget && files.length) void voiceAction(importTarget, "import", files); });
  const statuses = new Map<string, { ready: boolean; langs: SpeechLang[]; bytesCached: number }>();
  function renderPacks(): void {
    packsEl.textContent = "";
    if (!voiceIds().length) { const n = document.createElement("div"); n.className = "setting-note"; n.textContent = t("ra.noPacks"); packsEl.appendChild(n); return; }
    for (const id of voiceIds()) {
      const d = def(id);
      const box = document.createElement("div"); box.className = "ra-pack"; box.dataset.voice = id;
      const head = document.createElement("div"); head.className = "ra-pack-head";
      const name = document.createElement("span"); name.className = "ra-pack-name"; name.textContent = `${d.name} · ${voiceLangs(d).map(langName).join(" / ")} · ${humanSize(totalBytes(id))}`;
      const state = document.createElement("span"); state.className = "ra-pack-state";
      head.append(name, state);
      const row = document.createElement("div"); row.className = "ra-pack-actions";
      const mk = (label: string, fn: () => void) => { const b = document.createElement("button"); b.type = "button"; b.className = "auth-action"; b.textContent = label; b.addEventListener("click", fn); return b; };
      const busy = busyVoices.get(id), st = statuses.get(id);
      state.textContent = busy ?? (!st ? "" : st.ready ? t("ra.ready") : st.langs.length ? t("ra.partial", { langs: st.langs.map(langName).join(" / ") }) : t("ra.notDownloaded"));
      if (!busy) {
        if (!st || !st.ready) {
          row.appendChild(mk(t("ra.download"), () => void voiceAction(id, "download")));
          row.appendChild(mk(t("ra.import"), () => { importTarget = id; importInput.click(); }));
        }
        if (st && st.bytesCached > 0) row.appendChild(mk(t("ra.delete"), () => void (async () => {
          if (!(await deps.confirm(t("ra.deleteTitle"), t("ra.deleteMsg", { name: d.name })))) return;
          if (on) exit();
          try { await eng().delete(id); } catch (e) { deps.logError(e); }
          await refreshStatuses();
        })()));
      }
      box.append(head, row);
      // 署名 + 使用条款：上游要求的原文，正文字号、不翻译；只加一行说明这是什么
      if (d.credit || d.terms) {
        const lead = document.createElement("div"); lead.className = "setting-note"; lead.textContent = t("ra.creditLead");
        const credit = document.createElement("div"); credit.className = "ra-credit"; credit.lang = "ja";
        credit.textContent = [d.credit, d.terms].filter(Boolean).join("\n\n");
        box.append(lead, credit);
      }
      const noteKey = VOICE_NOTE[id];
      const more = [noteKey ? t(noteKey) : "", ...(d.attribution ?? [])].filter(Boolean).join("\n");
      if (more) { const n = document.createElement("div"); n.className = "setting-note"; n.textContent = more; box.appendChild(n); }
      packsEl.appendChild(box);
    }
  }
  /** 记下「这台设备上有没有能用的音色」；变了就让宿主重画顶栏。 */
  function noteHave(have: boolean): void { if ((prefs().have === true) !== have) { setPrefs({ have }); deps.availabilityChanged(); } }
  async function refreshStatuses(): Promise<void> {
    let asked = 0;
    for (const id of voiceIds()) { try { const st = await eng().status(id); statuses.set(id, { ready: st.ready, langs: st.langs, bytesCached: st.bytesCached }); asked++; } catch (e) { deps.logError(e); } }
    if (asked === voiceIds().length) noteHave([...statuses.values()].some((st) => st.langs.length > 0));
    renderPacks();
  }
  function fill(sel: HTMLSelectElement, items: { value: string; label: string }[], value: string): void {
    sel.textContent = "";
    for (const it of items) { const o = document.createElement("option"); o.value = it.value; o.textContent = it.label; sel.appendChild(o); }
    sel.value = value;
  }
  function renderSettings(): void {
    speedSel.value = String(speed());
    sourceInput.value = prefs().source ?? ""; sourceInput.placeholder = READ_ALOUD_MODEL_SOURCE;
    const id = currentVoice();
    voiceRow.hidden = voiceIds().length <= 1;
    if (voiceIds().length > 1 && id) fill(voiceSel, voiceIds().map((v) => ({ value: v, label: def(v).name })), id);
    const sp = id ? speakers(id) : [];
    speakerRow.hidden = sp.length <= 1;
    if (sp.length > 1 && id) fill(speakerSel, sp.map((x) => ({ value: String(x.id), label: x.name })), String(speaker(id)));
    renderPacks();
    if (section.open) void refreshStatuses();   // 只有展开过这一栏才去问引擎（问 = 起 worker）
  }
  section.addEventListener("toggle", () => { if (section.open) void refreshStatuses(); });
  speedSel.addEventListener("change", () => { setPrefs({ speed: Number(speedSel.value) }); if (on) stopReading(); });
  voiceSel.addEventListener("change", () => { setPrefs({ voice: voiceSel.value, speaker: undefined }); if (on) exit(); renderSettings(); });
  speakerSel.addEventListener("change", () => { setPrefs({ speaker: Number(speakerSel.value) }); if (on) stopReading(); });
  sourceInput.addEventListener("change", () => setPrefs({ source: sourceInput.value.trim() || undefined }));

  return {
    available: () => voiceIds().length > 0 && prefs().have === true,
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
    debugInstall(c, e) { engine?.dispose(); catalog = c; engine = e ?? null; ra = null; statuses.clear(); noteHave(false); },
    debugState: () => ({ active: on, state: ra?.state() ?? "idle", marked, continuous }),
  };
}
