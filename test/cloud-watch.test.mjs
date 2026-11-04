// 读书的「网盘连没连上」（家族设计稿 ai-docs/20261103-cloud-gate-design.md；Fable 11-03 裁定「读书不闸，只挂常驻条」）：状态机 + 结构守卫。created 2026-11-03 by Claude Opus 5.5（家族工单 E）
//   真 app 的整条链在 test/e2e-sync/run.mjs。
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, assert, eq } from "./runner.mjs";
import { S } from "../src/i18n/strings.ts";
import { createCloudWatch, cloudOnline, isCloudOff, noteAuthFailure, parseAuthFailure, rawOnline } from "../src/cloud-watch.ts";

let net = true;
Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, get: () => net });
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function make(over = {}) {
  const calls = { views: [], renew: 0, check: 0, catchUp: 0 };
  let signed = over.signed ?? false;
  const watch = createCloudWatch({
    timeoutMs: over.timeoutMs ?? 30, note: () => {},
    hasHome: () => over.home ?? true,
    signedIn: () => signed,
    renew: over.renew ?? (async () => { calls.renew++; signed = true; return true; }),
    check: over.check ?? (async () => { calls.check++; return "asked"; }),
    catchUp: async () => { calls.catchUp++; },
    show: (v) => { calls.views.push(v.kind === "offline" ? `offline:${v.reason}` : v.kind); },
  });
  return { watch, calls, setSigned: (v) => { signed = v; } };
}
async function reset() { net = true; const { watch } = make({ signed: true }); watch.authChanged(false, "signOut"); await tick(); }

describe("常驻条 · 什么时候挂", () => {
  it("没有家：什么都不发生", async () => {
    const t = make({ home: false });
    await t.watch.check("boot");
    t.watch.netLost(); t.watch.authChanged(false, "expired");
    eq(t.calls.views.length, 0); eq(t.calls.renew, 0); eq(t.calls.check, 0); assert(!isCloudOff());
  });
  it("登录好 + 问得到云端：不挂条，也不重复补", async () => {
    const t = make({ signed: true });
    await t.watch.check("boot");
    eq(t.calls.views.length, 0); eq(t.calls.check, 1); eq(t.calls.renew, 0); eq(t.calls.catchUp, 0); assert(cloudOnline());
  });
  it("续签成功 → 问云端 → 不挂条", async () => {
    const t = make();
    await t.watch.check("boot");
    eq(t.calls.renew, 1); eq(t.calls.check, 1); eq(t.calls.views.length, 0);
  });
  it("没网：直接挂条，不续签、不等超时", async () => {
    net = false;
    const t = make();
    await t.watch.check("boot");
    eq(t.calls.views.join(), "offline:offline"); eq(t.calls.renew, 0); eq(t.calls.check, 0); assert(isCloudOff());
    await reset();
  });
  it("续签要交互 = 登录过期；撞网络错 = 网盘没回应；问不到云端 = 网盘没回应", async () => {
    const a = make({ renew: async () => { noteAuthFailure("[auth] silent token renewal failed (retry-silent): name=InteractionRequiredAuthError code=login_required sub= msg=x"); return false; } });
    await a.watch.check("boot"); eq(a.calls.views.at(-1), "offline:expired"); eq(a.calls.check, 0, "没续签上就别问云端");
    await reset();
    const b = make({ renew: async () => { noteAuthFailure("[auth] silent token renewal failed (retry-silent): name=BrowserAuthError code=network_error sub= msg=x"); return false; } });
    await b.watch.check("boot"); eq(b.calls.views.at(-1), "offline:noResponse");
    await reset();
    const c = make({ signed: true, check: async () => "cloud-error" });
    await c.watch.check("boot"); eq(c.calls.views.at(-1), "offline:noResponse");
    await reset();
  });
  it("上一趟的原因不串到这一趟", async () => {
    noteAuthFailure("[auth] silent token renewal failed (retry-silent): name=BrowserAuthError code=network_error sub= msg=x");
    const t = make({ renew: async () => false });
    await t.watch.check("boot");
    eq(t.calls.views.at(-1), "offline:expired", "这一趟没日志 = 库手里没账号可续");
    await reset();
  });
  it("问云端挂起 / 续签挂起：到点挂条（永不卡）", async () => {
    const a = make({ signed: true, check: () => new Promise(() => {}) });
    await a.watch.check("boot"); eq(a.calls.views.at(-1), "offline:noResponse");
    await reset();
    const b = make({ renew: () => new Promise(() => {}) });
    await b.watch.check("boot"); eq(b.calls.views.at(-1), "offline:noResponse");
    await reset();
  });
  it("断网事件：马上挂；令牌过期的广播：条上说实话", async () => {
    const t = make({ signed: true });
    net = false; t.watch.netLost();
    eq(t.calls.views.at(-1), "offline:offline");
    await reset();
    const u = make({ signed: true });
    u.watch.authChanged(false, "expired");
    eq(u.calls.views.at(-1), "offline:expired");
    await reset();
  });
});

describe("常驻条 · 回来自动收", () => {
  it("核上了：放开离线 → 补一轮 → 条收掉", async () => {
    let ok = false; const t = make({ renew: async () => ok });
    await t.watch.check("boot");
    assert(isCloudOff());
    ok = true;
    await t.watch.check("online");
    assert(!isCloudOff()); assert(cloudOnline()); eq(t.calls.catchUp, 1); eq(t.calls.views.slice(-2).join(), "syncing,hidden");
    await reset();
  });
  it("核不上：条还在", async () => {
    const t = make({ renew: async () => false });
    await t.watch.check("boot");
    await t.watch.check("online");
    assert(isCloudOff()); eq(t.calls.catchUp, 0);
    await reset();
  });
  it("迟到的好消息：到点挂了条，云端后来回了 = 自己收", async () => {
    let answer; const t = make({ signed: true, check: () => new Promise((r) => { answer = r; }) });
    await t.watch.check("boot");
    assert(isCloudOff());
    answer("asked"); await tick(); await tick();
    assert(!isCloudOff()); eq(t.calls.catchUp, 1); eq(t.calls.views.at(-1), "hidden");
    await reset();
  });
  it("登录好了（点条去登录回来 / 别的路）：条挂着就核一次", async () => {
    const t = make({ renew: async () => false });
    await t.watch.check("boot");
    t.setSigned(true);
    t.watch.authChanged(true, "silent"); await tick(); await tick();
    assert(!isCloudOff()); eq(t.calls.catchUp, 1);
    await reset();
  });
  it("主动登出：条和离线都收掉", async () => {
    const t = make({ renew: async () => false });
    await t.watch.check("boot");
    t.watch.authChanged(false, "signOut");
    assert(!isCloudOff()); eq(t.calls.views.at(-1), "hidden");
  });
  it("同时只跑一趟", async () => {
    const t = make({ signed: true });
    await Promise.all([t.watch.check("a"), t.watch.check("b")]);
    eq(t.calls.check, 1);
  });
  it("原因码：表里没有的错不当「过期」", () => {
    eq(parseAuthFailure("[auth] silent token renewal failed (boot-probe): name=BrowserAuthError code=monitor_window_timeout sub= msg=t").reason, "noResponse");
    eq(parseAuthFailure("别的日志"), null);
    assert(rawOnline());
  });
});

describe("结构守卫", () => {
  const read = (p) => readFileSync(p, "utf8");
  const src = read("src/cloud-watch.ts"), bar = read("src/offline-bar.ts"), app = read("src/app.ts"), appStore = read("src/app-store.ts"), storeUi = read("src/store-ui.ts");
  function* walk(dir) { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) yield* walk(p); else yield p; } }

  it("读书不闸：条和状态机不碰任何面（Fable 11-03；user 2026-09-19「我不想开书时转很久」）", () => {
    for (const [n, s] of [["cloud-watch.ts", src], ["offline-bar.ts", bar]]) assert(!/lockSyncGate|openChoiceSheet|openConfirmSheet|sheets\.ts/.test(s.replace(/\/\/[^\n]*/g, "")), `${n} 不许弹面`);
  });
  it("boot() 自己不 await 云端；每一趟都和硬超时赛跑", () => {
    assert(/Promise\.race\(\[work, timedOut\]\)/.test(src));
    const m = /^async function boot\(\): Promise<void> \{\n([\s\S]*?)^\}/m.exec(app);
    assert(m, "找得到 boot()");
    for (const l of m[1].split("\n").filter((x) => /^ {2}\S/.test(x))) assert(!/await\s+(auth\.|afterSignIn|resumeSync|refreshCurrentBook|reconcileCollections|watch\.)/.test(l), `boot() 不许等云端：${l.slice(0, 80)}`);
    assert(/void watch\.check\("boot"\);/.test(app));
  });
  it("有家才动：run() 第一句看 hasHome，有家 = MSAL 有账号（不新增存储）", () => {
    assert(/async function run\(trigger: string\): Promise<void> \{\n\s*if \(!d\.hasHome\(\)\) return;/.test(src));
    assert(/homeKnown = st\.signedIn \|\| !!\(st as \{ probing\?: boolean \}\)\.probing;/.test(app));
  });
  it("文案：两语都有、不写失败 / 错误、没有指挥句", () => {
    for (const k of ["offline.bar", "offline.barZero", "offline.barExpired", "offline.barSyncing", "offline.reconnect"]) {
      assert(S[k]?.zh && S[k]?.en, `缺 ${k}`);
      assert(!/失败|错误|请检查|请先|请/.test(S[k].zh), `${k}：${S[k].zh}`);
      assert(!/fail|error|please|check your|make sure/i.test(S[k].en), `${k}：${S[k].en}`);
    }
  });
  it("「离线」不落盘：两个文件不碰任何存储，全仓没有写它的地方", () => {
    for (const [n, s] of [["cloud-watch.ts", src], ["offline-bar.ts", bar]]) assert(!/device-kv|deviceKv|localStorage|sessionStorage|indexedDB|app-store|prefs\b/.test(s.replace(/\/\/[^\n]*/g, "")), `${n} 不许碰存储`);
    for (const p of walk("src")) if (/\.ts$/.test(p)) assert(!/(deviceKvSet\w*|setItem)\([^)\n]*(isCloudOff|cloudOff|_off)/.test(read(p)), `${p} 把离线写进存储了`);
  });
  it("接线：库的 isOnline = cloudOnline；云端判断不再散在 navigator.onLine", () => {
    assert(/isOnline: cloudOnline,/.test(appStore));
    assert(/const od = createOneDriveProvider\([^\n]*\);/.test(appStore), "e2e 测试台靠这一行换假云");
    const allowed = new Set(["src/cloud-watch.ts", "src/factory-reset.ts"]);
    for (const p of walk("src")) { if (!/\.ts$/.test(p) || allowed.has(p.replaceAll("\\", "/"))) continue; assert(!/navigator\.onLine/.test(read(p).replace(/\/\/[^\n]*/g, "")), `${p} 还在直接看 navigator.onLine`); }
  });
  it("接线：续签失败的原因码经 store-ui.reportError 进来；行格式对着库的 dist 钉住", () => {
    assert(/noteAuthFailure\(String\(/.test(storeUi));
    const dist = "node_modules/@internal/store/dist/base/providers/auth.js";
    assert(existsSync(dist));
    const auth = read(dist);
    assert(auth.includes("`[auth] silent token renewal failed (${where}): name=${String(err?.name ?? \"?\")} code=${String(err?.errorCode ?? \"?\")} sub=${String(err?.subError ?? \"\")} msg="), "库改了日志格式 = 这里红");
    assert(/reportStoreError\(new Error\(lines\.join\("\\n"\)\), "log"\)/.test(auth));
  });
});
