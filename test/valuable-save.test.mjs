// valuable-save 调度器（注入假钟）。created 2026-09-19 by Claude Fable 5.1（JRP 同款算法）
import { describe, it, eq, assert } from "./runner.mjs";
import { createValuableSave } from "../src/valuable-save.ts";

function clock() {
  let now = 0; const timers = [];
  return {
    now: () => now,
    setTimer: (fn, ms) => { const h = { at: now + ms, fn }; timers.push(h); return h; },
    clearTimer: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
    advance: async (ms) => { const target = now + ms; while (true) { timers.sort((a, b) => a.at - b.at); const h = timers[0]; if (!h || h.at > target) break; now = h.at; timers.shift(); h.fn(); await Promise.resolve(); await Promise.resolve(); } now = target; },
  };
}
describe("valuable-save", () => {
  it("mark 防抖 10s；持续 mark 封顶 30s 必推一次", async () => {
    const c = clock(); let commits = 0;
    const vs = createValuableSave({ commit: async () => { commits++; }, now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
    vs.mark(); await c.advance(9_000); eq(commits, 0); vs.mark(); await c.advance(9_000); eq(commits, 0);
    for (let i = 0; i < 4; i++) { vs.mark(); await c.advance(5_000); }   // 到 38s：ceiling 30s 已触发一次
    assert(commits >= 1, "封顶推了"); 
  });
  it("markTrivial 只标脏不调度；flush 落盘；失败保脏", async () => {
    const c = clock(); let fail = true, commits = 0;
    const vs = createValuableSave({ commit: async () => { if (fail) throw new Error("x"); commits++; }, now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
    vs.markTrivial(); await c.advance(60_000); eq(commits, 0); assert(vs.isDirty());
    await vs.flush().catch(() => {}); assert(vs.isDirty(), "失败保脏");
    fail = false; await vs.flush(); eq(commits, 1); assert(!vs.isDirty());
  });
});
