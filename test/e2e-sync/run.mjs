// 读书的端到端同步测试：常驻条（家族设计稿 ai-docs/20261103-cloud-gate-design.md；Fable 11-03 裁定「读书不闸，只挂常驻条」）+ 改名「旧的怎么办」。created 2026-11-03 by Claude Opus 5.5（家族工单 E；照小黑屋 test/e2e-sync/run.mjs）
//   用法：npm run e2e:sync [场景名子串]。真 app + 真 store 库 + 真 IndexedDB；只有云是内存假云。不进 npm test（要起无头浏览器）。
//   和写作 app 的差别：不罩、不闸（user 2026-09-19「我不想开书时转很久」），这里验的是「照读、核不上只挂条、回线自动收」。
import { buildBundle, startServer, createWorld, makeChecker } from "./harness.mjs";

const only = process.argv[2] ?? "";
const { check, failed } = makeChecker();

await buildBundle();
const server = await startServer();

const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

const GATE_OVERLAY_WATCH = () => {
  window.__gateTimes = [];
  document.addEventListener("readystatechange", () => {
    if (document.readyState !== "interactive") return;
    const g = document.getElementById("gateSheet"); if (!g) return;
    let up = !g.classList.contains("hidden");
    new MutationObserver(() => { const now = !g.classList.contains("hidden"); if (now !== up) { up = now; window.__gateTimes.push({ up: now, t: performance.now(), title: document.getElementById("gateTitle").textContent }); } }).observe(g, { attributes: true, attributeFilter: ["class"] });
  });
};
const BOOK = "第一本.txt", BODY = "第一章\n这是本机这一本的正文。\n".repeat(30);
/** 一台设备传好一本书、记住它，然后按 cfg 重开。 */
async function seedThenReopen(w, tag, cfg, signedOut) {
  const D = await w.device(tag);
  await D.ctx.addInitScript(GATE_OVERLAY_WATCH);
  await D.boot(server.url);
  const name = await D.upload(BOOK, BODY);
  if (!name) throw new Error("seed: book did not open");
  if (!(await w.cloudText(name))) throw new Error("seed: book did not reach the cloud");
  await D.setGate(cfg, signedOut);
  await D.bootRaw(server.url);
  return { D, name };
}
const waitOff = (D, timeout = 15000) => D.page.waitForFunction(() => window.__jrb.isCloudOff() && !document.getElementById("offlineBar").classList.contains("hidden"), null, { timeout });
const waitOn = (D, timeout = 8000) => D.page.waitForFunction(() => !window.__jrb.isCloudOff() && document.getElementById("offlineBar").classList.contains("hidden"), null, { timeout });
const waitBook = (D) => D.page.waitForFunction(() => !!window.__jrb.book(), null, { timeout: 8000 });
const waitBar = (D, re, timeout = 8000) => D.page.waitForFunction((src) => new RegExp(src).test(document.querySelector("#offlineBar .offline-bar-text").textContent ?? "") && !document.getElementById("offlineBar").classList.contains("hidden"), re.source, { timeout });
const calls = (D) => D.eval(() => window.__e2eCalls?.length ?? 0);
const newCalls = async (D, from) => (await D.eval(() => window.__e2eCalls ?? [])).slice(from);
const diagText = (D) => D.page.evaluate(async () => { await new Promise((r) => setTimeout(r, 350)); const k = Object.keys(localStorage).find((x) => x.endsWith("diag-log")); return k ? localStorage.getItem(k) : ""; });
/** 回前台，假装离开了 3 分钟。 */
const comeBackLater = async (D) => { await D.hide(); await D.wait(100); await D.eval(() => { if (!window.__realNow) { window.__realNow = Date.now; Date.now = () => window.__realNow() + (window.__skew ?? 0); } window.__skew = (window.__skew ?? 0) + 3 * 60 * 1000; }); await D.show(); };

scenario("常驻条 ① 没挂库：开机 / 醒来什么都没有", async (w) => {
  const D = await w.device("A");
  await D.ctx.addInitScript(GATE_OVERLAY_WATCH);
  await D.page.goto(server.url); await D.setGate({}, true);
  await D.boot(server.url);
  let v = await D.view();
  check("没有条", v.bar === null && !v.off, JSON.stringify(v));
  check("没去续签", v.authCalls === 0, String(v.authCalls));
  await comeBackLater(D); await D.wait(300);
  v = await D.view();
  check("醒来也没有", v.bar === null && !v.off, JSON.stringify(v));
  check("页面零报错", D.errors.length === 0, D.errors.join(" ; "));
  await D.close();
});

scenario("常驻条 ② 登录好 + 云端没动：什么都没有，确实问了云端", async (w) => {
  const D = await w.device("A");
  await D.ctx.addInitScript(GATE_OVERLAY_WATCH);
  await D.boot(server.url);
  const name = await D.upload(BOOK, BODY);
  await D.setGate({}, false);
  await D.bootRaw(server.url); await waitBook(D); await D.wait(1000);
  check("开的是上次那本", (await D.eval(() => window.__jrb.book()?.name)) === name);
  const v = await D.view();
  check("没有条、在线", v.bar === null && !v.off && v.online, JSON.stringify(v));
  const asked = await D.eval(() => (window.__e2eCalls ?? []).filter((c) => /reading-position/.test(c)).length);
  check("问了云端", asked > 0, String(asked));
  check("页面零报错", D.errors.length === 0, D.errors.join(" ; "));
  await D.close();
});

scenario("常驻条 ③ 续签失败：不弹面、书照常摆着，条上说登录过期；之后零请求；回线续签成功 → 条收掉", async (w) => {
  const { D, name } = await seedThenReopen(w, "A", { probing: true, renew: "interaction" }, true);
  await waitOff(D);
  await waitBook(D);
  let v = await D.view();
  check("书照常摆着", (await D.eval(() => window.__jrb.book()?.name)) === name);
  check("条说实话：离线 + 登录过期 + 能重新登录", v.bar === "离线 · 登录过期了 · 重新登录" && v.reason === "expired", JSON.stringify(v));
  check("读书不闸：从头到尾没有闸门的面", !(await D.eval(() => window.__gateTimes.some((x) => /网盘没连上|核对/.test(x.title)))) && !v.gateUp, JSON.stringify(await D.eval(() => window.__gateTimes)));
  const before = await calls(D);
  await D.hide(); await D.wait(200); await D.show(); await D.wait(600);
  check("之后没有新的云端请求", (await newCalls(D, before)).length === 0, (await newCalls(D, before)).join(","));
  await D.patchGate({ renew: "ok" });
  await D.eval(() => window.dispatchEvent(new Event("online")));
  await waitOn(D);
  v = await D.view();
  check("回线续签成功：条收掉、回到在线", v.bar === null && v.online === true, JSON.stringify(v));
  check("页面零报错", D.errors.length === 0, D.errors.join(" ; "));
  await D.close();
});

scenario("常驻条 ③b 「离线」不进任何存储：重开又走一遍", async (w) => {
  const { D } = await seedThenReopen(w, "A", { probing: true, renew: "interaction" }, true);
  await waitOff(D);
  check("离线了", !(await D.eval(() => window.__jrb.cloudOnline())));
  check("localStorage 里没有这个记忆", !(await D.eval(() => JSON.stringify(Object.entries(localStorage)).includes("cloudOff"))));
  await D.patchGate({ renew: "ok" });
  await D.setGate({ probing: true, renew: "ok" }, true);
  await D.bootRaw(server.url);
  await waitBook(D); await D.wait(1500);
  const v = await D.view();
  check("重开、这次续签成了：没有条（没记着上次离线）", v.bar === null && v.online === true, JSON.stringify(v));
  await D.close();
});

scenario("常驻条 ③c 点条重新登录：取消不动；去登录 → 条收掉", async (w) => {
  const { D } = await seedThenReopen(w, "A", { probing: true, renew: "interaction" }, true);
  await waitOff(D);
  await D.page.click("#offlineBar");
  await D.page.waitForFunction(() => !document.getElementById("sheet").classList.contains("hidden"), null, { timeout: 5000 });
  await D.page.keyboard.press("Escape"); await D.wait(300);
  let v = await D.view();
  check("取消：条还在", v.off && v.bar != null, JSON.stringify(v));
  await D.page.click("#offlineBar");
  await D.page.waitForFunction(() => !document.getElementById("sheet").classList.contains("hidden"), null, { timeout: 5000 });
  await D.eval(() => { const bs = [...document.querySelectorAll("#sheetChoices button")]; (bs.find((x) => x.classList.contains("primary")) ?? bs[0]).click(); });
  await waitOn(D);
  v = await D.view();
  check("登录好了：条收掉、在线", v.bar === null && v.online, JSON.stringify(v));
  check("页面零报错", D.errors.length === 0, D.errors.join(" ; "));
  await D.close();
});

scenario("常驻条 ③d 没网时传的书：条上数得到；点条 = 书架「要处理的」", async (w) => {
  const { D } = await seedThenReopen(w, "A", { net: false, probing: true, renew: "ok" }, true);
  await waitOff(D);
  await D.upload("离线传的.txt", "第一章\n离线传的这本。\n".repeat(5));
  await waitBar(D, /还有 1 份没传上去/);
  check("条显示 1 份", true);
  await D.page.click("#offlineBar");
  await D.page.waitForFunction(() => window.__jrb.gallery.isOpen(), null, { timeout: 5000 });
  await D.wait(500);
  const seen = await D.eval(() => document.body.innerText);
  check("书架开了，列着没同步好的那本", seen.includes("离线传的"), seen.slice(0, 200));
  check("页面零报错", D.errors.length === 0, D.errors.join(" ; "));
  await D.close();
});

scenario("常驻条 ④ 没网：直接挂条，不等超时、不续签；网回来自己收", async (w) => {
  const { D } = await seedThenReopen(w, "A", { probing: true, renew: "ok", net: false }, true);
  const t0 = Date.now();
  await waitOff(D, 4000);
  console.log(`  开页到挂条 ${Date.now() - t0} ms`);
  let v = await D.view();
  check("条 = 离线", v.bar === "离线" && v.reason === "offline", JSON.stringify(v));
  check("没去续签", v.authCalls === 0, String(v.authCalls));
  await waitBook(D);
  check("书照常摆着", !!(await D.eval(() => window.__jrb.book()?.name)));
  await D.net(true);
  await waitOn(D);
  v = await D.view();
  check("网回来了：自己核完收掉", v.bar === null && v.online, JSON.stringify(v));
  check("页面零报错", D.errors.length === 0, D.errors.join(" ; "));
  await D.close();
});

scenario("常驻条 ⑤ 云端慢：书秒开、不挡人；8 s 挂条；云端回了自己收", async (w) => {
  const { D } = await seedThenReopen(w, "A", { probing: true, renew: "ok", hangCloud: true }, true);
  const t0 = Date.now();
  await waitBook(D);
  console.log(`  开页到书摆好 ${Date.now() - t0} ms（云端挂着）`);
  check("云端挂着也秒开书（永不为此转圈）", Date.now() - t0 < 4000, String(Date.now() - t0));
  check("这时候没有条、没有面", (await D.view()).bar === null && !(await D.view()).gateUp, JSON.stringify(await D.view()));
  await waitOff(D, 12000);
  const dt = Date.now() - t0;
  console.log(`  开页到挂条 ${dt} ms`);
  check("不超过 11 s", dt < 11000, String(dt));
  check("是 8 s 的硬超时到点挂的（黑匣子）", /no answer in 8000ms/.test(await diagText(D)));
  let v = await D.view();
  check("条 = 离线（网盘没回应）", v.bar === "离线" && v.reason === "noResponse", JSON.stringify(v));
  await D.patchGate({ hangCloud: false });
  await waitOn(D, 8000);
  v = await D.view();
  check("云端回了：不用人点，自己收", v.bar === null && v.online, JSON.stringify(v));
  check("页面零报错", D.errors.length === 0, D.errors.join(" ; "));
  await D.close();
});

scenario("常驻条 ⑥ 中途过期 / 断网：条马上挂；醒来再核", async (w) => {
  const D = await w.device("A");
  await D.boot(server.url);
  await D.upload(BOOK, BODY);
  await D.setGate({}, false);
  await D.bootRaw(server.url); await waitBook(D); await D.wait(500);
  await D.patchGate({ renew: "interaction" });
  await D.eval(() => window.__e2eExpire()); await D.wait(100);
  let v = await D.view();
  check("中途过期：条上说实话、不弹面", v.bar === "离线 · 登录过期了 · 重新登录" && !v.gateUp, JSON.stringify(v));
  await D.net(false); await D.wait(100);
  const authBefore = (await D.view()).authCalls;
  await comeBackLater(D); await D.wait(400);
  v = await D.view();
  check("没网醒来：条还在、不去续签", v.off && v.bar != null && v.authCalls === authBefore, JSON.stringify(v));
  await D.net(true); await D.wait(400);
  v = await D.view();
  check("回线但续签没成：条还在、不弹面", v.off && v.bar != null && !v.gateUp, JSON.stringify(v));
  await D.patchGate({ renew: "ok" });
  await comeBackLater(D);
  await waitOn(D, 5000);
  v = await D.view();
  check("醒来续签成了：条收掉", v.bar === null && v.online, JSON.stringify(v));
  check("页面零报错", D.errors.length === 0, D.errors.join(" ; "));
  await D.close();
});

scenario("常驻条 ⑧ 黑匣子：每次续签的结果和原因码都记着", async (w) => {
  const { D } = await seedThenReopen(w, "A", { probing: true, renew: "interaction" }, true);
  await waitOff(D);
  const fail = await diagText(D);
  check("失败：结果 + 耗时 + 原因码", /silent renew \(boot\): failed elapsed=\d+ms name=InteractionRequiredAuthError code=interaction_required/.test(fail), fail.slice(-400));
  check("init 也记（有没有家）", /init: signedIn=false probing=true home=true/.test(fail), fail.slice(-400));
  check("挂条的原因", /cloud off: reason=expired/.test(fail), fail.slice(-300));
  await D.close();
  const { D: E } = await seedThenReopen(w, "B", { probing: true, renew: "ok" }, true);
  await E.wait(1200);
  const ok = await diagText(E);
  check("成功也记", /silent renew \(boot\): ok elapsed=\d+ms/.test(ok), ok.slice(-400));
  await E.close();
});

for (const [answer, re, expect] of [
  ["取消", /取消/, { renamed: false, oldInCloud: true, newInCloud: false, status: /这次没动/ }],
  ["留着旧的", /留着旧的/, { renamed: true, oldInCloud: true, newInCloud: true, status: null }],
  ["搬走旧的", /搬走旧的/, { renamed: true, oldInCloud: false, newInCloud: true, status: null }],
]) scenario(`改名撞上分叉 → 问「旧的怎么办」→ ${answer}`, async (w) => {
  const A = await w.device("A"), B = await w.device("B");
  await A.boot(server.url);
  const name = await A.upload(BOOK, "第一章\n原文。\n");
  await B.boot(server.url); await B.wait(500);
  await B.eval((n) => window.__jrb.openBook(n), name); await B.wait(800);
  // 读者 app 不改写书：这里直接走库造出「这台有没传上去的改动 + 云端被别的设备动过」（读者能撞上的真实形状 = 文件被外部写入方改了 + 本机有离线补传）
  await w.provider.upload(name, new Blob(["第一章\nA改了。\n"]), {});
  await B.eval((n) => window.__jrb.store().file(n, { mode: "existing" }).save(new TextEncoder().encode("第一章\nB也改了。\n"), { tryPush: false }), name); await B.wait(300);
  const cloudBefore = await w.cloudText(name);
  const renaming = B.eval((n) => window.__jrb.renameBook(n, "新名字"), name);
  const labels = await B.resolveGate(re);
  check("面上三个答案都在（搬走 / 留着 / 取消）", /搬走旧的/.test(labels.join()) && /留着旧的/.test(labels.join()) && /取消/.test(labels.join()), labels.join(" | "));
  const r = await renaming; await B.wait(800);
  console.log(`  结果：${JSON.stringify(r)}`);
  if (expect.renamed) check("身份换成新名字", r.ok && /新名字/.test(r.name), JSON.stringify(r));
  else check("身份没动、回执 = 取消（不算失败）", !r.ok && r.cancelled === true, JSON.stringify(r));
  if (answer === "留着旧的") check("回执里写着是人选的留着", r.oldKeptByUser === true, JSON.stringify(r));
  check(expect.oldInCloud ? "云端旧名那份还在、字节没动" : "云端旧名那份不在原地了（搬走 = 进回收站）", expect.oldInCloud ? (await w.cloudText(name)) === cloudBefore : (await w.cloudText(name)) == null, String(await w.cloudText(name)));
  const cloudNames = (await w.cloudList("")).map((i) => i.name);
  check(expect.newInCloud ? "新名字传上去了" : "云端没有多出新名字", cloudNames.some((n) => /新名字/.test(n)) === expect.newInCloud, cloudNames.join(","));
  check("页面零报错", [...A.errors, ...B.errors].length === 0, [...A.errors, ...B.errors].join(" ; "));
  await A.close(); await B.close();
});

for (const s of scenarios) {
  if (only && !s.name.includes(only)) continue;
  console.log(`\n── ${s.name}`);
  const w = await createWorld();
  try { await Promise.race([s.fn(w), new Promise((_, rej) => setTimeout(() => rej(new Error("scenario timed out (60s)")), 60000))]); }
  catch (e) { check(`场景跑完`, false, String(e?.message ?? e)); }
  finally { await w.close().catch(() => {}); }
}
server.close();
console.log(`\n${failed() ? "✗" : "✓"} ${failed()} failed`);
process.exit(failed() ? 1 : 0);
