// cloud-watch.ts —— 读书的「网盘连没连上」：只挂常驻条，不闸。created 2026-11-03 by Claude Opus 5.5（家族工单 E；设计稿 = 家族根 ai-docs/20261103-cloud-gate-design.md，周账 F-100）
//   Fable 11-03 裁定「读书不闸，只挂常驻条」：读书不改写书（三等资源），唯一会脏的是阅读位置（四等游标，允许合并），闸门要护的东西不存在；
//   user 2026-09-19「我不想开书时转很久」（计划 §2 前提 0「永不为此转圈」）。做法 = 开机 / 醒来悄悄续签 + 问一次云端，核不上就只挂「离线」条，回线自动收。
//   写作 app（小黑屋 src/cloud-gate.ts）的闸门是另一回事：那边要护正在写的字。这里没有罩、没有闸、没有逃生钮——从来不挡人。
//   边界：这个文件不碰界面、不碰存储、不碰库：纯状态机，依赖全注入（单元测试 test/cloud-watch.test.mjs 直接跑）；条的界面在 offline-bar.ts。
//   「离线」只活在内存（设计稿 §3）。有家 = 这台设备的 MSAL 里有账号（d.hasHome）；从没登录 / 主动登出的人没有条（§2）。
import { CLOUD_CHECK_TIMEOUT_MS } from "./config.ts";

export type OffReason = "expired" | "offline" | "noResponse";
export type BarView = { kind: "hidden" } | { kind: "offline"; reason: OffReason } | { kind: "syncing" };

// ── 全 app 共用的「现在该不该碰网盘」（app-store 的 isOnline、books / 书架 / 云钮都读这一处）──
let _off = false;
const _subs = new Set<() => void>();
export function isCloudOff(): boolean { return _off; }
export function rawOnline(): boolean { return typeof navigator === "undefined" || navigator.onLine !== false; }
/** 浏览器说有网 ∧ 这边没判成「连不上」。原来散在各处的 `navigator.onLine` 云端判断都换成它。 */
export function cloudOnline(): boolean { return rawOnline() && !_off; }
function setOff(on: boolean): void {
  if (_off === on) return;
  _off = on;
  for (const f of _subs) f();
}
export function onCloudOffChange(f: () => void): () => void { _subs.add(f); return () => { _subs.delete(f); }; }

// ── 续签失败的原因码（§1 / §5）：库把每次静默续签失败写成一行日志（@internal/store base/providers/auth.js _logSilentFailure，level "log"），store-ui.reportError 把这行递到这里。
//   行格式被 test/cloud-watch.test.mjs 对着库的 dist 钉住：库改了格式 = 红。
const AUTH_LINE = /^\[auth\] silent token renewal failed \(([^)]*)\): name=(\S*) code=(\S*) sub=(\S*)/;
const NEEDS_INTERACTION = /^(interaction_required|login_required|consent_required|no_tokens_found|invalid_grant|bad_token|refresh_token_expired|token_refresh_required|no_account_error)$/;
export interface AuthFailure { where: string; name: string; code: string; sub: string; reason: OffReason }
export function parseAuthFailure(message: string): AuthFailure | null {
  const m = AUTH_LINE.exec(message);
  if (!m) return null;
  const [, where = "", name = "", code = "", sub = ""] = m;
  const expired = name === "InteractionRequiredAuthError" || NEEDS_INTERACTION.test(code) || NEEDS_INTERACTION.test(sub);
  return { where, name, code, sub, reason: expired ? "expired" : "noResponse" };
}
let _lastFailure: AuthFailure | null = null;
export function noteAuthFailure(message: string): AuthFailure | null {
  const f = parseAuthFailure(message);
  if (f) _lastFailure = f;
  return f;
}

export interface CloudWatchDeps {
  hasHome(): boolean;
  signedIn(): boolean;
  /** 静默续签一次。 */
  renew(): Promise<boolean>;
  /** 问云端一次；回库的终态串（"cloud-error" = 没问成）。 */
  check(): Promise<string | undefined>;
  /** 连上之后补一轮。 */
  catchUp(): Promise<void>;
  show(view: BarView): void;
  note(line: string): void;
  now?(): number;
  timeoutMs?: number;
}
export interface CloudWatch {
  /** 悄悄核一次（开机 / 醒来 / 回线 / 点条）。同时只跑一趟；永不抛、永不挡人。 */
  check(trigger: string): Promise<void>;
  /** 断网了：不等下一趟，条马上挂上。 */
  netLost(): void;
  authChanged(signedIn: boolean, reason?: string): void;
  reason(): OffReason | null;
}

export function createCloudWatch(d: CloudWatchDeps): CloudWatch {
  const timeoutMs = d.timeoutMs ?? CLOUD_CHECK_TIMEOUT_MS;
  const now = d.now ?? (() => Date.now());
  let reason: OffReason | null = null;
  let inFlight: Promise<void> | null = null;

  function goOff(r: OffReason, why: string): void {
    if (!d.hasHome()) return;
    reason = r;
    d.note(`cloud off: reason=${r} (${why})`);
    setOff(true);
    d.show({ kind: "offline", reason: r });
  }
  async function recover(trigger: string): Promise<void> {
    const was = _off;
    reason = null;
    setOff(false);
    if (!was) return;
    d.note(`cloud back (${trigger}) → catching up`);
    d.show({ kind: "syncing" });
    try { await d.catchUp(); } catch (e) { d.note(`catch-up threw: ${String((e as Error)?.message ?? e)}`); }
    d.show({ kind: "hidden" });
  }
  /** 续签 + 问云端。 */
  async function verify(trigger: string): Promise<"ok" | OffReason> {
    if (!d.signedIn()) {
      _lastFailure = null;
      const t0 = now();
      let ok = false;
      try { ok = await d.renew(); } catch (e) { d.note(`silent renew threw (${trigger}): ${String((e as Error)?.message ?? e)}`); }
      const f = _lastFailure as AuthFailure | null;
      d.note(`silent renew (${trigger}): ${ok ? "ok" : "failed"} elapsed=${now() - t0}ms${f ? ` name=${f.name} code=${f.code} sub=${f.sub}` : ""}`);   // §1 / §7⑧：黑匣子里有每次的结果和原因码
      if (!ok) return !rawOnline() ? "offline" : (f?.reason ?? "expired");   // 没日志又没成 = 库手里没账号可续（不是网的事）
    }
    const status = await d.check();
    d.note(`cloud check (${trigger}): ${String(status ?? "skipped")}`);
    return status === "cloud-error" ? (rawOnline() ? "noResponse" : "offline") : "ok";
  }
  async function run(trigger: string): Promise<void> {
    if (!d.hasHome()) return;   // §2 没挂库：什么都不发生
    if (!rawOnline()) { goOff("offline", trigger); return; }   // 没网：一条请求都不发、不等超时
    const work = verify(trigger).catch((e): OffReason => { d.note(`verify threw: ${String((e as Error)?.message ?? e)}`); return "noResponse"; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((res) => { timer = setTimeout(() => res("timeout"), timeoutMs); });
    const r = await Promise.race([work, timedOut]);   // §4：每一趟都和硬超时赛跑
    clearTimeout(timer);
    if (r === "ok") { await recover(trigger); return; }
    if (r !== "timeout") { goOff(r, trigger); return; }
    goOff("noResponse", `${trigger}: no answer in ${timeoutMs}ms`);
    void work.then((late) => { if (late === "ok" && _off) void recover(`${trigger} (late)`); });   // 迟到的好消息：条自己收
  }
  return {
    check: (trigger) => (inFlight ??= run(trigger).finally(() => { inFlight = null; })),
    netLost: () => { if (d.hasHome() && !rawOnline()) goOff("offline", "went offline"); },
    authChanged: (signedIn, why) => {
      if (signedIn) { if (_off) void (inFlight ??= run("signed in").finally(() => { inFlight = null; })); return; }
      if (why === "signOut") { reason = null; setOff(false); d.show({ kind: "hidden" }); return; }   // 主动登出 = 没有家了
      if (why === "expired") goOff("expired", "token expired mid-session");   // 不弹东西，条上说实话
    },
    reason: () => reason,
  };
}
