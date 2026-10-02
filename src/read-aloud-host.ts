// 朗读接缝：`@internal/read-aloud` 的唯一值级 import（scripts/build.sh 与 test/redline-guard 守）。created 2026-10-01 by Claude Fable 5.1
// user 2026-10-01「设置分栏 公共字体 逐句朗读 亮屏连续 做」「记得模块化不要bloatware」。评估 = 家族根 ai-docs/20261001-read-aloud-shared-lib-assessment.md。
//
// 这里只有接线：库管「分句 / 合成 / 播放 / 读到哪一句」，阅读器管「点在哪个字 / 标出正在读的句子 / 滚过去」，本文件把两头连起来并画控制条和设置栏。
//   · 朗读模式在设置 →「朗读」，三档（user 2026-10-01「朗读模式不是有三种吗 关 连续 逐句 逐句是用来语言学习的」）：不是「关」且装了音色，顶栏才有喇叭钮。
//   · 逐句（学语言用）：朗读态下轻点一句 = 只念那一句；上一句 / 下一句各念一句；播放键 = 重念标着的这一句。
//   · 连续：轻点一句 = 从那一句一路往下念（正在念的时候点 = 跳过去接着念；user「全文一定要有跳转到某一行的功能」），章末自动翻章，屏幕常亮；
//     播放键 = 从标着的那一句（没有就从屏幕上第一句）开始 / 暂停 / 继续。锁屏 / 切后台 = 暂停（这一版不承诺后台播放）。
//   · 不 bloat：没进过朗读、没展开过设置里的「朗读」栏 = worker / 引擎 / 语音包一个字节都不动（引擎门面是懒的）。
//   · 语音包来源 = 家族模型仓（config.ts READ_ALOUD_MODEL_SOURCE，设置里可改成任何镜像，或从本机文件导入）；字节到手逐片对内嵌清单的 sha256。
//   · 一个音色 = 几个小包（权重 / 运行时 / 每种语言的词典；库的 VoiceDef）。界面只说「音色」；只把这一章的语言装进引擎（日语前端固定占 160 MB 内存）。
//   · 音色的署名和使用条款（上游要求必须让用户看到的原文）显示在设置的「朗读」栏里：当前选中音色的那一份，可展开的栏，正文字号，不翻译。
import { createReadAloud, createSpeechEngine, createWebAudioSink, langsIn, splitSentences, voiceLangs, voicePacks, type ReadAloud, type SpeechEngine, type SpeechLang, type EmbeddedPack, type VoiceDef, type PackProgress, type SentenceSpan } from "@internal/read-aloud";
import { READ_ALOUD_VOICES, READ_ALOUD_PACKS } from "./read-aloud-packs.generated.ts";
import { READ_ALOUD_MODEL_SOURCE, READ_ALOUD_SPEEDS } from "./config.ts";
import { deviceKvGetJson, deviceKvSetJson } from "./device-kv.ts";
import { t, type Key } from "./i18n/index.ts";
import { humanSize } from "@internal/gallery";
import type { TxtReader } from "./reader/txt.ts";

const KV = "read-aloud";
/** have = 这台设备上有能用的音色（上次问引擎时的结论）。朗读是可选的：没装音色的人顶栏上看不到喇叭钮，入口只在设置 →「朗读」。
 *  记在偏好里是为了启动时不用为了问这一句去起 worker。
 *  mode = 设置里的朗读模式；没设过 = 逐句（这个功能是语言学习逼出来的）。关 = 音色留着，喇叭钮收起。 */
interface Prefs { voice?: string; speaker?: number; speed?: number; source?: string; have?: boolean; mode?: Mode; steady?: boolean; steadiness?: number; whole?: boolean }
/** 朗读模式（user 2026-10-01「朗读模式不是有三种吗 关 连续 逐句 逐句是用来语言学习的」）。 */
type Mode = "off" | "continuous" | "sentence";
const MODES: readonly Mode[] = ["off", "continuous", "sentence"];
/** 随 app 内嵌的音色目录。 */
export interface ReadAloudCatalog { voices: Record<string, VoiceDef>; packs: Record<string, EmbeddedPack> }
/** 每个音色给用户的一句实话（哪种语言是本行、哪种是凑合）：按音色 id 查，没有就不显示。 */
const VOICE_NOTE: Record<string, Key> = { "tsukuyomi-chan-zhen": "ra.voiceNote.tsukuyomi-chan-zhen" };
/** 连续模式自动翻章后，开念下一章之前停这么久（1 倍速时；库里同段句间 600、跨段 900）。 */
const CHAPTER_GAP_MS = 1200;
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
  /** 拖到页面上的文件里，朗读的本地模型要的那几个（.onnx；同一把里有 .onnx 或已经在用本地模型时，连同 .json 配置）。 */
  modelFiles(files: File[]): File[];
  /** 换上本地模型（只在这次打开有效，不上传不保存）。 */
  useLocalModel(files: File[]): void;
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
  let on = false, continuous = false, advancing = false, loadingVoice = false, chapterGap = false;
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
  const mode = (): Mode => { const m = prefs().mode; return m && MODES.includes(m) ? m : "sentence"; };
  // 念法滑块 0.2.12 收起（user 2026-10-02「念法slider可以sunset了，保持原样」）：一律原样（库的 steadiness 不传 = 0）；偏好里存过的 steadiness / steady 不再读。
  const speed = () => { const s = prefs().speed; return typeof s === "number" && READ_ALOUD_SPEEDS.includes(s) ? s : 1; };
  /** 整句合成（库 0.1.13；user 2026-10-02「加一个整句合成的选项，默认开，可以开关」）：没设过 = 开。 */
  const whole = () => prefs().whole !== false;
  // 本地模型（user 2026-10-02「加一个本地上传的模型，这样我们改权重可以拖到网页上测试，而不用动远端」）：只在内存里，这次打开有效；
  // 装引擎时作为 override 交给库（model.onnx + 可选 config.json），音色的词典和运行时照旧用包里的。
  let local: { model: File; config: File | null } | null = null;
  let loadedTag = "";   // 引擎里现在装的是哪个本地模型（"" = 音色自己的）
  // 预设（库 0.1.15 的家族约定；user 2026-10-02「输入就是一个用户键盘输入的signed int，然后模型随便解释」）：只在内存里，这次打开有效；
  // 空着 = 模型的默认（库 0.1.18：config.json 的 preset_default，按每一段的语言取）。输入框 + 上下箭头只在当前装着的模型认预设时露出来。
  let preset: number | undefined;
  // 本地模型加上之后「这次能不能念」（库 0.1.18：.onnx + .json 顶替了整个权重包，就不用官方权重；user 2026-10-02「没有下载官方模型的时候，
  // 本地模型加载了还是没法启用语音」）。偏好里的 have 仍只代表官方音色（本地模型不跨打开）。
  let localUsable = false;
  const localNames = (): string[] => (local ? ["model.onnx", ...(local.config ? ["config.json"] : [])] : []);
  /** 问引擎能念哪些语言：用着本地模型就带上它顶替的文件名。 */
  const statusOf = (id: string) => eng().status(id, local ? { override: localNames() } : undefined);
  const fileTag = (f: File | null) => (f ? `${f.name}:${f.size}:${f.lastModified}` : "");
  const localTag = () => (local ? `${fileTag(local.model)}|${fileTag(local.config)}` : "");
  /** 装引擎失败时给用户的话：用着本地模型就说本地模型的事（音素表对不上 / 装不上），不笼统地说「出错了」。 */
  const loadErrorText = (e: unknown): string => {
    const msg = e instanceof Error ? e.message : String(e);
    if (!local) return t("ra.error");
    return /^override-mismatch/.test(msg) ? t("ra.localMismatch") : t("ra.localFailed", { msg: msg.slice(0, 160) });
  };
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
      // cancelPending 也要转过去：控制器作废句子时扔掉排着的合成（库 0.1.19；user 2026-10-02「ipad上调多了preset会不出声」）
      ra = createReadAloud({ engine: { synth: (text, o) => eng().synth(text, o), cancelPending: () => engine?.cancelPending?.() }, sink });
      ra.on("sentence", (span) => { marked = span; deps.reader.markReading(span); deps.reader.revealSpan(span); });
      ra.on("state", () => { renderBar(); void syncWake(); });
      ra.on("end", () => {
        if (!on || !continuous) return;
        advancing = true; const moved = deps.nextChapter(); advancing = false;
        if (!moved) { continuous = false; renderBar(); void syncWake(); return; }
        // 翻到下一章：留一口气再念（章与章之间不该比段与段之间还赶）。这口气里点了别的 / 停了 / 退出了 = 作废（readSeq）。
        marked = null;
        const my = ++readSeq; chapterGap = true; renderBar();
        setTimeout(() => { if (my !== readSeq) return; chapterGap = false; if (on && continuous) void read(0, false); else renderBar(); }, CHAPTER_GAP_MS / speed());   // 停顿跟着语速等比例缩（库里句间、小句间的停顿也是）
      });
      ra.on("error", (e) => { deps.logError(e); deps.status(t("ra.error"), { error: true }); renderBar(); });
    }
    return ra;
  }

  // ── 控制条 ──
  const speedSel = $("raSpeed") as HTMLSelectElement;
  for (const s of READ_ALOUD_SPEEDS) speedSel.add(new Option(`${s}×`, String(s)));
  const bar = $("raBar"), playBtn = $("raPlay"), playIcon = document.getElementById("raPlayIcon"), statusEl = $("raStatus");
  const presetInput = $<HTMLInputElement>("raPreset"), presetDial = $("raPresetDial");
  /** 十进制或 0x 十六进制的带符号整数；空 = undefined（默认）；不是 = null。 */
  const parsePreset = (s: string): number | null | undefined => {
    const x = s.trim(); if (!x) return undefined;
    const m = /^([+-]?)(0x[0-9a-f]+|\d+)$/i.exec(x); if (!m) return null;
    const v = (m[1] === "-" ? -1 : 1) * (/^0x/i.test(m[2]!) ? parseInt(m[2]!.slice(2), 16) : parseInt(m[2]!, 10));
    return Number.isSafeInteger(v) && Math.abs(v) <= 2147483647 ? v : null;
  };
  function setPreset(v: number | undefined): void {
    preset = v; presetInput.value = v === undefined ? "" : String(v);
    if (on && marked && ra && ra.state() !== "idle") { sink.unlock(); void read(marked.start, mode() === "sentence"); }   // 这一句按新预设重念
  }
  presetInput.addEventListener("change", () => {
    const v = parsePreset(presetInput.value);
    if (v === null) { deps.status(t("ra.presetInvalid"), { error: true }); presetInput.value = preset === undefined ? "" : String(preset); return; }
    setPreset(v);
  });
  // 上下箭头（user 2026-10-02「preset能加一个上下箭头的小dial吗」）：加一 / 减一；空着（默认）时从 0 起算
  $("raPresetUp").addEventListener("click", () => setPreset((preset ?? 0) + 1));
  $("raPresetDown").addEventListener("click", () => setPreset((preset ?? 0) - 1));
  presetInput.addEventListener("keydown", (e) => { if (e.key === "Enter") presetInput.blur(); });   // 回车 = 生效（change 在失焦时发）
  function renderBar(): void {
    const st = ra?.state() ?? "idle";
    const going = st === "playing" || st === "loading" || chapterGap;
    playIcon?.setAttribute("href", going ? "#pause" : "#play");
    const label = going ? t("ra.pause") : t("ra.play");
    playBtn.setAttribute("aria-label", label); playBtn.title = label;
    statusEl.textContent = loadingVoice ? t("ra.loadingVoice") : st === "loading" ? t("ra.synth") : local ? t("ra.localBadge") : "";
    presetDial.hidden = engine?.loaded()?.preset !== true;   // 模型认预设才露
    speedSel.value = String(speed());
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
  /**
   * 这一章要装哪几种语言（每句自己判语言，库 0.1.11；user 2026-10-01「每句话路由不同的前端」）：库的 langsIn 说这一章里出现了
   * 哪几种（中文书里夹的日文句子、中文里的英文词都算）。**缺一种都不念、明说缺哪种**，不拿别的语言凑合
   * （user「主语言替代朗读（日文会念不准）不要这样，这是静默退化」「不过设置里面全下载可以，就这样」）。
   * 返回 { need: 这一章出现的, unsupported: 这个音色不会念的, missing: 会念但这台设备上没下载的 }。
   */
  function langsForChapter(id: string, text: string): { need: SpeechLang[]; unsupported: SpeechLang[]; missing: SpeechLang[] } {
    const need = langsIn(text), can = voiceLangs(def(id));
    return { need, unsupported: need.filter((l) => !can.includes(l)), missing: need.filter((l) => can.includes(l) && eng().isKnownReady(id, l) === false) };
  }
  const langList = (ls: SpeechLang[]) => ls.map(langName).join(" / ");
  async function ensureLoaded(id: string, langs: SpeechLang[]): Promise<void> {
    const cur = eng().loaded(), tag = localTag();
    if (cur?.voice === id && loadedTag === tag && langs.every((l) => cur.langs.includes(l))) return;
    loadingVoice = true; renderBar();
    const override = local ? { "model.onnx": local.model, ...(local.config ? { "config.json": local.config } : {}) } : undefined;
    try { await eng().load(id, { langs, ...(override ? { override } : {}) }); loadedTag = tag; }
    catch (e) { loadedTag = ""; throw e; }
    finally { loadingVoice = false; renderBar(); }
  }
  /** 只认最后一次：点得快、引擎还在装的时候，先发的那几次在等引擎，回来发现自己不是最新的就作废（新点的优先）。 */
  let readSeq = 0;
  async function read(from: number, once: boolean): Promise<void> {
    const my = ++readSeq; chapterGap = false;
    const id = currentVoice(); if (!id || !on) return;
    let text = deps.reader.bodyText();
    // 这一章没有能读的句子（只有标题的空章）：逐句 = 什么都不做；连读 = 直接翻到下一章，翻到头就停
    while (!splitSentences(text).length) {
      if (once) return;
      advancing = true; const moved = deps.nextChapter(); advancing = false;
      if (!moved) { continuous = false; renderBar(); void syncWake(); return; }
      marked = null; from = 0; text = deps.reader.bodyText();
    }
    if (local) { try { await statusOf(id); } catch (e) { deps.logError(e); } }   // 用着本地模型：按「加上本地模型」重算能念哪些语言
    if (my !== readSeq) return;
    const { need, unsupported, missing } = langsForChapter(id, text);
    if (unsupported.length) { deps.status(t("ra.langUnsupported", { langs: langList(unsupported) }), { error: true }); return; }
    if (missing.length) { deps.status(t("ra.langNotDownloaded", { langs: langList(missing) })); deps.openSettings(); return; }
    try { await ensureLoaded(id, need); } catch (e) { if (my !== readSeq || cancelled(e)) return; deps.logError(e); deps.status(loadErrorText(e), { error: true }); return; }
    if (my !== readSeq || !on || deps.reader.bodyText() !== text) return;   // 等引擎的工夫里又点了别的 / 退出了 / 翻章了
    continuous = !once;
    reader_().start(text, from, { once, langs: need, speaker: speaker(id), speed: speed(), whole: whole(), preset });   // 不给 lang = 每句自己判
    void syncWake();
  }
  function stopReading(): void { readSeq++; chapterGap = false; continuous = false; ra?.stop(); marked = null; deps.reader.markReading(null); void syncWake(); renderBar(); }
  /**
   * 换了模型（本地模型换上 / 移除、换音色；user 2026-10-02「更换模型之后之前模型的缓存可以去掉了」）：控制器里合成好的句子是旧模型念的，
   * 连控制器一起扔掉（否则再点念过的句子播的还是旧模型）；引擎里装着的旧模型也放掉——关 worker 是归还 WASM 堆的唯一办法，下一次念时装新的。
   */
  function modelChanged(): void {
    stopReading();
    ra = null;
    engine?.dispose(); loadedTag = "";
    renderBar();
  }
  /** 换模型时被作废的装载（worker 关了）不算出错。 */
  const cancelled = (e: unknown) => /read-aloud engine disposed|switched to a voice of another engine/.test(e instanceof Error ? e.message : String(e));

  async function enter(): Promise<void> {
    if (!deps.hasBook()) return;
    const id = currentVoice();
    if (!id) { deps.status(t("ra.noPacks")); return; }
    let usable = false;
    try { usable = (await statusOf(id)).langs.length > 0; } catch (e) { deps.logError(e); }
    if (local) localUsable = usable;
    if (!usable) { deps.status(t("ra.needPack")); deps.openSettings(); return; }   // 记着有、其实没了（浏览器清了缓存 / 兄弟 app 删了共用的包）：带去设置，那里会把账记对
    if (!local) noteHave(true);
    if (disposeTimer) { clearTimeout(disposeTimer); disposeTimer = null; }
    on = true; document.body.dataset.readAloud = "1"; bar.hidden = false; renderBar();
    // 进来就先把这一章的语言装上（点第一句时不用等）；这一章的语言没下 / 不会念 → 等用户点了再如实说
    const ch = langsForChapter(id, deps.reader.bodyText());
    if (!ch.unsupported.length && !ch.missing.length) void ensureLoaded(id, ch.need).catch((e) => { if (cancelled(e)) return; deps.logError(e); deps.status(loadErrorText(e), { error: true }); });
  }
  /** 两分钟没在朗读态就关 worker、放掉喇叭（归还内存）。 */
  function armDispose(): void {
    if (disposeTimer) clearTimeout(disposeTimer);
    disposeTimer = setTimeout(() => { disposeTimer = null; if (!on) { engine?.dispose(); sink.close(); } }, DISPOSE_AFTER_MS);
  }
  function exit(): void {
    if (!on) return;
    stopReading();
    sink.close();   // 退出 = 一定没声了（喇叭自己掐掉正在响的那一段；user 2026-10-01「退出书的时候应该stop语音」）
    on = false; delete document.body.dataset.readAloud; bar.hidden = true;
    armDispose();
  }
  /**
   * 备引擎：只在用户这次有动作的时候做（user 2026-10-01「不要自动静默弄100MB，而是用户有意图才弄」——点喇叭、把朗读模式调开、点播放）。
   * 开书、启动都不碰它。备好之后两分钟没进朗读态就放掉。
   */
  function prewarm(): void {
    const id = currentVoice(); if (!id || !deps.hasBook()) return;
    const ch = langsForChapter(id, deps.reader.bodyText());
    if (ch.unsupported.length || ch.missing.length) return;
    void ensureLoaded(id, ch.need).catch((e) => { if (!cancelled(e)) deps.logError(e); });
    if (!on) armDispose();
  }
  $("raClose").addEventListener("click", exit);
  playBtn.addEventListener("click", () => {
    sink.unlock();
    const r = reader_();
    switch (r.state()) {
      case "playing": r.pause(); break;
      case "paused": r.resume(); break;
      case "loading": stopReading(); break;
      default: void read(marked ? marked.start : deps.reader.firstVisibleOffset(), mode() === "sentence");
    }
  });
  /** 上一句 / 下一句：逐句模式念那一句就停；连续模式从那一句接着往下念。 */
  const step = (delta: 1 | -1) => {
    sink.unlock();
    const once = mode() === "sentence";
    const spans = ra?.sentences() ?? [], cur = ra?.current();
    if (marked && cur && spans.length) void read(spans[Math.min(spans.length - 1, Math.max(0, cur.index + delta))]!.start, once);
    else void read(deps.reader.firstVisibleOffset(), once);
  };
  // 语速在胶囊里（user 2026-10-01「调速度放在语音控制的那个胶囊里面」→「那么再加0.5，然后做成下拉行吗」）：下拉选一档；正在念 / 暂停着 = 从标着的这一句按新速度重念
  speedSel.addEventListener("change", () => {
    const v = Number(speedSel.value);
    setPrefs({ speed: READ_ALOUD_SPEEDS.includes(v) ? v : 1 });
    renderBar();
    if (marked && ra && ra.state() !== "idle") { sink.unlock(); void read(marked.start, mode() === "sentence"); }
  });
  $("raPrev").addEventListener("click", () => step(-1));
  $("raNext").addEventListener("click", () => step(1));

  // ── 设置里的「朗读」栏 ──
  const packsEl = $("raPacks"), voiceRow = $("raVoiceRow"), voiceSel = $<HTMLSelectElement>("raVoiceSelect");
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
      const noteKey = VOICE_NOTE[id];
      const more = [noteKey ? t(noteKey) : "", ...(d.attribution ?? [])].filter(Boolean).join("\n");
      if (more) { const n = document.createElement("div"); n.className = "setting-note"; n.textContent = more; box.appendChild(n); }
      packsEl.appendChild(box);
    }
    renderTerms();
  }
  // 署名 + 使用条款（user 2026-10-01「使用规矩能不能做成下拉展开的，然后选了语音包展示相应的」）：只放**当前选中音色**的那一份，
  // 一个可展开的栏，标题常驻带音色名；上游要求的原文，正文字号、不翻译。
  // 上游条款要「显眼处、字号够」：所以这台设备还没装这个音色时默认展开（下载前看得到），装了之后默认收起；用户自己点过就听用户的。
  let termsOpen: boolean | null = null;   // null = 还没点过，按上面的默认
  function renderTerms(): void {
    const id = currentVoice(); if (!id) return;
    const d = def(id);
    if (!d.credit && !d.terms) return;
    const installed = (statuses.get(id)?.langs.length ?? 0) > 0;
    const box = document.createElement("details"); box.className = "ra-terms"; box.id = "raTerms";
    box.open = termsOpen ?? !installed;
    const sum = document.createElement("summary"); sum.textContent = t("ra.termsSummary", { name: d.name });
    sum.addEventListener("click", () => { termsOpen = !box.open; });   // click 先于 toggle：此刻 open 还是旧值
    const lead = document.createElement("div"); lead.className = "setting-note"; lead.textContent = t("ra.creditLead");
    const credit = document.createElement("div"); credit.className = "ra-credit"; credit.lang = "ja";
    credit.textContent = [d.credit, d.terms].filter(Boolean).join("\n\n");
    box.append(sum, lead, credit);
    packsEl.appendChild(box);
  }
  /** 记下「这台设备上有没有能用的音色」；变了就让宿主重画顶栏。 */
  function noteHave(have: boolean): void { if ((prefs().have === true) !== have) { setPrefs({ have }); deps.availabilityChanged(); } renderMode(); }
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
  // 整句合成（默认开）：换了 = 正在念 / 暂停着的这一句按新做法重念
  const wholeSel = $<HTMLSelectElement>("raWholeSelect");
  wholeSel.addEventListener("change", () => {
    setPrefs({ whole: wholeSel.value !== "off" });
    if (on && marked && ra && ra.state() !== "idle") { sink.unlock(); void read(marked.start, mode() === "sentence"); }
  });
  // 本地模型：选择文件 / 拖到页面上（app.ts 的 drop 分流过来）；移除 = 换回音色自己的。换了就停下正在念的，下一次念时重新装引擎。
  const localName = $("raLocalName"), localRemove = $("raLocalRemove"), localInput = $<HTMLInputElement>("raLocalInput");
  function renderLocal(): void {
    localName.textContent = local ? `${local.model.name}（${humanSize(local.model.size)}）${local.config ? ` + ${local.config.name}` : ""}` : t("ra.localNone");
    localRemove.hidden = !local;
  }
  function modelFiles(files: File[]): File[] {
    const onnx = files.filter((f) => /\.onnx$/i.test(f.name));
    const json = onnx.length || local ? files.filter((f) => /\.json$/i.test(f.name)) : [];
    return [...onnx, ...json];
  }
  function useLocalModel(files: File[]): void {
    const onnx = files.find((f) => /\.onnx$/i.test(f.name)), json = files.find((f) => /\.json$/i.test(f.name)) ?? null;
    if (!onnx && !local) { deps.status(t("ra.localNeedOnnx"), { error: true }); return; }
    local = onnx ? { model: onnx, config: json } : { model: local!.model, config: json ?? local!.config };   // 只给 .json = 换配置、模型不变
    modelChanged();
    renderLocal(); renderBar(); void recheckLocal();
    deps.status(t("ra.localSet", { name: local.model.name + (local.config ? ` + ${local.config.name}` : "") }));
  }
  /** 换上 / 移除本地模型后：问一次「加上它能不能念」，顶栏的喇叭钮和朗读模式跟着变。 */
  async function recheckLocal(): Promise<void> {
    const id = currentVoice();
    let ok = false;
    if (local && id) { try { ok = (await statusOf(id)).langs.length > 0; } catch (e) { deps.logError(e); } }
    if (ok !== localUsable) { localUsable = ok; deps.availabilityChanged(); }
    renderMode();
  }
  $("raLocalPick").addEventListener("click", () => localInput.click());
  localInput.addEventListener("change", () => { const fs = Array.from(localInput.files ?? []); localInput.value = ""; if (fs.length) useLocalModel(fs); });
  localRemove.addEventListener("click", () => {
    if (!local) return;
    local = null;
    modelChanged();
    renderLocal(); renderBar(); void recheckLocal(); deps.status(t("ra.localRemoved"));
  });
  const modeSel = $<HTMLSelectElement>("raModeSelect");
  function renderMode(): void {
    const have = voiceIds().length > 0 && prefs().have === true;
    modeSel.disabled = !(have || local);   // 没装音色（也没有本地模型）开不了：先在下面下载
    modeSel.value = have || local ? mode() : "off";
  }
  modeSel.addEventListener("change", () => {
    const m = MODES.includes(modeSel.value as Mode) ? (modeSel.value as Mode) : "off";
    setPrefs({ mode: m });
    if (on) { if (m === "off") exit(); else stopReading(); }   // 换了念法：正在念的先停
    else if (m !== "off") prewarm();   // 把朗读模式调开 = 有意图：后台先把引擎备上
    deps.availabilityChanged();
  });
  function renderSettings(): void {
    renderMode();
    wholeSel.value = whole() ? "on" : "off";
    renderLocal();
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
  voiceSel.addEventListener("change", () => { setPrefs({ voice: voiceSel.value, speaker: undefined }); termsOpen = null; if (on) exit(); modelChanged(); renderSettings(); });
  speakerSel.addEventListener("change", () => { setPrefs({ speaker: Number(speakerSel.value) }); if (on) stopReading(); });
  sourceInput.addEventListener("change", () => setPrefs({ source: sourceInput.value.trim() || undefined }));

  return {
    available: () => voiceIds().length > 0 && (prefs().have === true || localUsable) && mode() !== "off",
    active: () => on,
    toggle() { if (on) { exit(); return; } sink.unlock(); void enter(); },
    exit,
    tapAt(x, y) {
      if (!on) return false;
      const off = deps.reader.offsetAt(x, y);
      if (off == null) return false;
      sink.unlock();
      void read(off, mode() === "sentence");   // 逐句：只念这一句；连续：从这一句一路往下念（正在念 = 跳过去）
      return true;
    },
    contentChanged() { if (advancing) return; if (ra && ra.state() !== "idle") stopReading(); else { marked = null; } },
    renderSettings,
    modelFiles,
    useLocalModel,
    debugInstall(c, e) { engine?.dispose(); catalog = c; engine = e ?? null; ra = null; statuses.clear(); termsOpen = null; noteHave(false); },
    debugState: () => ({ active: on, state: ra?.state() ?? "idle", marked, continuous }),
  };
}
