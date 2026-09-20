// 目录 view 纯函数测试（flattenOutline / windowRange / parentMap；node 直跑）。created 2026-09-20 by Claude Fable 5.1
import { describe, it, eq as eqRaw, assert } from "./runner.mjs";
const eq = (a, b, msg) => eqRaw(JSON.stringify(a), JSON.stringify(b), msg);   // runner 的 eq 是 !==，数组/对象走 JSON
import { tree } from "../src/chapters/index.ts";
import { flattenOutline, windowRange, parentMap } from "../src/chapters-view.ts";

// 装订书形状：# 篇 → ## 卡；外加一段散章（无 level）
const ch = (title, level) => ({ title, start: 0, bodyStart: 0, end: 0, ...(level ? { level } : {}) });
const bound = [ch("篇一", 1), ch("E1v3", 2), ch("原文", 2), ch("篇二", 1), ch("E1v3", 2), ch("篇三", 1)];
const idx = (rows) => rows.map((r) => r.index);

describe("chapters-view · flattenOutline", () => {
  it("默认全展开：组头 + 叶子按深度", () => {
    const rows = flattenOutline(tree(bound), new Set(), null);
    eq(idx(rows), [0, 1, 2, 3, 4, 5]);
    eq(rows.map((r) => r.depth), [0, 1, 1, 0, 1, 0]);
    eq(rows.map((r) => r.group), [true, false, false, true, false, false]);   // 篇三无子 → 不是组
    eq(rows.map((r) => r.groupIndex), [-1, 0, 0, -1, 3, -1]);
  });
  it("折叠篇一：只藏它的子节，组头留着且标 collapsed", () => {
    const rows = flattenOutline(tree(bound), new Set([0]), null);
    eq(idx(rows), [0, 3, 4, 5]);
    eq(rows[0].collapsed, true); eq(rows[1].collapsed, false);
  });
  it("搜索无视折叠：命中叶子带祖先组头；不命中的组整组消失", () => {
    const rows = flattenOutline(tree(bound), new Set([0, 3]), (n) => n.index === 2);
    eq(idx(rows), [0, 2]);
    eq(rows[0].collapsed, false);
  });
  it("搜索命中组头本身：组头留、子节不带", () => {
    eq(idx(flattenOutline(tree(bound), new Set(), (n) => n.index === 3)), [3]);
  });
  it("扁平网文（无 level）：全是顶层叶子，五位数不炸", () => {
    const flat = Array.from({ length: 20000 }, (_, i) => ch(`第${i + 1}章`));
    const t0 = performance.now();
    const rows = flattenOutline(tree(flat), new Set(), null);
    eq(rows.length, 20000); eq(rows.every((r) => !r.group && r.depth === 0 && r.groupIndex === -1), true);
    assert(performance.now() - t0 < 200, "flatten 2 万章应 <200ms");
  });
});

describe("chapters-view · windowRange", () => {
  it("视口窗 = 可见行 ± overscan，两端夹住", () => {
    eq(windowRange(1000, 44, 0, 600, 20), { start: 0, end: 34 });          // ceil(600/44)=14 + 20
    eq(windowRange(1000, 44, 4400, 600, 20), { start: 80, end: 134 });     // floor(100)-20 .. ceil(113.6)+20
    eq(windowRange(1000, 44, 43900, 600, 20), { start: 977, end: 1000 });
    eq(windowRange(0, 44, 0, 600, 20), { start: 0, end: 0 });
  });
});

describe("chapters-view · parentMap", () => {
  it("每节点的父组头；顶层 = -1", () => {
    const m = parentMap(tree(bound));
    eq([...m.entries()], [[0, -1], [1, 0], [2, 0], [3, -1], [4, 3], [5, -1]]);
  });
});
