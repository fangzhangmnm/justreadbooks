// 端到端同步测试的「假云」浏览器侧桥（只进测试 bundle，不进产品）。created 2026-09-29 by Claude Fable 5.1
//   产品的 app-store.ts 里唯一被替换的一行 = `createOneDriveProvider(...)` → `createBridgeProvider()`；store 库、本地 IndexedDB、编辑器、书模式全是真的。
//   云端调用经 window.__e2eCloud（Playwright exposeFunction）转到 node 侧同一个 `@internal/store/testing` 的内存云盘——两个浏览器上下文 = 两台设备，共用一朵云。
import type { CloudProvider, CloudItem } from "@internal/store";
import { noteAuthFailure } from "./cloud-watch.ts";

let bridgeSignedIn: () => boolean = () => true;
const gateCfgHang = (): boolean => !!(window as unknown as { __e2eGate?: { hangCloud?: boolean } }).__e2eGate?.hangCloud;
type Wire = { __b64: string } | { __u: true } | null | string | number | boolean | Wire[] | { [k: string]: Wire };
const b64 = (u8: Uint8Array): string => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string): Uint8Array => { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
async function enc(v: unknown): Promise<Wire> {
  if (v === undefined) return { __u: true };
  if (v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v as Wire;
  if (v instanceof Blob) return { __b64: b64(new Uint8Array(await v.arrayBuffer())) };
  if (v instanceof Uint8Array) return { __b64: b64(v) };
  if (v instanceof ArrayBuffer) return { __b64: b64(new Uint8Array(v)) };
  if (Array.isArray(v)) return Promise.all(v.map(enc));
  const o: { [k: string]: Wire } = {};
  for (const [k, x] of Object.entries(v as object)) o[k] = await enc(x);
  return o;
}
function dec(v: Wire): unknown {
  if (v == null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(dec);
  if ("__u" in v) return undefined;
  if ("__b64" in v && typeof v.__b64 === "string") return unb64(v.__b64);
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) o[k] = dec(x as Wire);
  return o;
}
async function call(op: string, ...args: unknown[]): Promise<unknown> {
  const w = window as unknown as { __e2eCloud?: (op: string, json: string) => Promise<string>; __e2eOffline?: boolean };
  if (!bridgeSignedIn()) throw new Error("Not signed in");   // 同真 provider：没登录 = getToken 就抛，一个请求都发不出去
  { const c = window as unknown as { __e2eCalls?: string[] }; (c.__e2eCalls ??= []).push(`${op} ${typeof args[0] === "string" ? args[0] : ""}`); }   // 闸门场景看「发起了多少请求」（挂起的也算）
  if (gateCfgHang()) await new Promise<void>((res) => { const t = setInterval(() => { if (!gateCfgHang()) { clearInterval(t); res(); } }, 50); });
  if (!w.__e2eCloud) throw new Error("e2e bridge missing");
  if (w.__e2eOffline) { const e = new Error("e2e offline") as Error & { name: string }; e.name = "CloudNetworkError"; throw e; }
  const res = JSON.parse(await w.__e2eCloud(op, JSON.stringify(await enc(args)))) as { ok?: Wire; err?: { message: string; status?: number; name?: string } };
  if (res.err) { const e = new Error(res.err.message) as Error & { status?: number }; if (res.err.status != null) e.status = res.err.status; if (res.err.name) e.name = res.err.name; throw e; }
  return dec(res.ok ?? null);
}
const blobOf = (u: unknown): Blob => new Blob([u as Uint8Array]);

// 常驻条的测试开关（2026-11-03，家族工单 D）。全部从 localStorage `e2eGate` 读初值（JSON）、之后写 window.__e2eGate 改：
//   probing: initAuth 回「有账号、在后台探测」（= 真 app 没登录但有家的样子）；renew: 静默续签怎么回 ok / interaction / network / hang；
//   hangCloud: 云调用挂起；auth 的调用次数记在 window.__e2eAuthCalls（「离线继续」后要是零）。
interface E2eGate { probing?: boolean; renew?: "ok" | "interaction" | "network" | "hang"; hangCloud?: boolean; net?: boolean }
const gateCfg = (): E2eGate => { const w = window as unknown as { __e2eGate?: E2eGate }; if (!w.__e2eGate) { try { w.__e2eGate = JSON.parse(localStorage.getItem("e2eGate") ?? "{}") as E2eGate; } catch { w.__e2eGate = {}; } } return w.__e2eGate!; };
if (localStorage.getItem("e2eGate") != null) Object.defineProperty(navigator, "onLine", { configurable: true, get: () => gateCfg().net !== false });
/** 和库 auth.js _logSilentFailure 同一行格式（对着库钉住的是 test/cloud-watch.test.mjs）；走库给 app 的同一个 reportError 口子。 */
const failLine = (code: string, name: string) => `[auth] silent token renewal failed (retry-silent): name=${name} code=${code} sub= msg=e2e`;

export function createBridgeProvider(): { provider: CloudProvider; auth: unknown } {
  const account = { username: "e2e@example.com", name: "e2e", homeAccountId: "e2e" };
  let signedIn = (() => { try { return localStorage.getItem("e2eStartSignedOut") !== "1"; } catch { return true; } })();   // 测试台：登出态启动（模拟页面被回收后重开、静默续登还没回来）
  bridgeSignedIn = () => signedIn;
  const subs = new Set<(st: unknown) => void>();
  const state = (reason?: string) => ({ signedIn, account: signedIn ? account : null, reason });
  const emit = (reason: string) => { for (const cb of subs) cb(state(reason)); };
  const auth = {
    isAuthConfigured: () => true,
    initAuth: async () => (!signedIn && gateCfg().probing ? { ...state("init"), probing: true } : state("init")),
    signIn: async () => { signedIn = true; emit("signIn"); },
    signOut: async () => { signedIn = false; emit("signOut"); },
    getToken: async () => "e2e-token",
    isSignedIn: () => signedIn,
    getActiveAccount: () => (signedIn ? account : null),
    retrySilentSignIn: async () => {
      const w = window as unknown as { __e2eAuthCalls?: number };
      w.__e2eAuthCalls = (w.__e2eAuthCalls ?? 0) + 1;
      if (signedIn) return true;
      const how = gateCfg().renew;
      if (how === "hang") return new Promise<boolean>(() => {});
      if (how === "ok") { signedIn = true; emit("silent"); return true; }
      noteAuthFailure(how === "network" ? failLine("network_error", "BrowserAuthError") : failLine("interaction_required", "InteractionRequiredAuthError"));   // 库走 reportError → store-ui → 这里；那段接线 test/cloud-watch.test.mjs 对着源码守
      return false;
    },
    onAuthChanged: (cb: (st: unknown) => void) => { subs.add(cb); return () => subs.delete(cb); },
    getAuthState: () => state(),
  };
  (window as unknown as { __e2eExpire?: () => void }).__e2eExpire = () => { signedIn = false; emit("expired"); };   // 会话中途令牌过期（库 getToken 里的那一路）
  (window as unknown as { __e2eAuth?: unknown }).__e2eAuth = auth;   // 测试台手动登录 / 登出
  const provider = {
    list: (folder?: string) => call("list", folder) as Promise<CloudItem[]>,
    getItemByPath: (path: string) => call("getItemByPath", path) as Promise<CloudItem | null>,
    getApprootRef: () => call("getApprootRef") as Promise<string>,
    download: async (ref: string) => blobOf(await call("download", ref)),
    downloadRange: async (ref: string, offset: number, length: number) => (await call("downloadRange", ref, offset, length)) as Uint8Array,
    upload: (path: string, blob: unknown, opts?: unknown) => call("upload", path, blob, opts) as Promise<CloudItem>,
    ensureFolder: (path: string) => call("ensureFolder", path) as Promise<string>,
    delete: (ref: string, eTag?: string) => call("delete", ref, eTag) as Promise<void>,
    deleteEmptyFolder: (path: string) => call("deleteEmptyFolder", path),
    move: (ref: string, target: string, opts?: unknown) => call("move", ref, target, opts) as Promise<CloudItem>,
    copy: (ref: string, target: string, newName: string) => call("copy", ref, target, newName) as Promise<CloudItem>,
    rename: (ref: string, newName: string, eTag?: string | null) => call("rename", ref, newName, eTag) as Promise<CloudItem>,
    onAuthChanged: (cb: (ev: { signedIn: boolean; reason?: string }) => void) => { const f = (st: unknown) => cb(st as { signedIn: boolean; reason?: string }); subs.add(f); return () => subs.delete(f); },
  } as unknown as CloudProvider;
  return { provider, auth };
}
