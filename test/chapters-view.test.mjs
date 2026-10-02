// 目录 view 纯函数测试（flattenOutline / windowRange / parentMap；node 直跑）。created 2026-09-20 by Claude Fable 5.1
import { describe, it, eq as eqRaw, assert } from "./runner.mjs";
const eq = (a, b, msg) => eqRaw(JSON.stringify(a), JSON.stringify(b), msg);   // runner 的 eq 是 !==，数组/对象走 JSON
import { tree } from "../src/chapters/index.ts";
import { flattenOutline, windowRange, outlineDepth, parentMap } from "../src/chapters-view.ts";

// 装订书形状：# 篇 → ## 卡；外加一段散章（无 level）
const ch = (title, level) => ({ title, start: 0, bodyStart: 0, end: 0, ...(level ? { level } : {}) });
const bound = [ch("篇一", 1), ch("E1v3", 2), ch("原文", 2), ch("篇二", 1), ch("E1v3", 2), ch("篇三", 1)];
const idx = (rows) => rows.map((r) => r.index);

describe("chapters-view · flattenOutline", () => {
  it("不限级数（默认参数）= 全展开：组头 + 叶子按深度", () => {
    const rows = flattenOutline(tree(bound), null);
    eq(idx(rows), [0, 1, 2, 3, 4, 5]);
    eq(rows.map((r) => r.depth), [0, 1, 1, 0, 1, 0]);
    eq(rows.map((r) => r.group), [true, false, false, true, false, false]);   // 篇三无子 → 不是组
    eq(rows.map((r) => r.groupIndex), [-1, 0, 0, -1, 3, -1]);
  });
  it("搜索：命中叶子带祖先组头；不命中的组整组消失", () => {
    eq(idx(flattenOutline(tree(bound), (n) => n.index === 2)), [0, 2]);
  });
  it("搜索命中组头本身：组头留、子节不带", () => {
    eq(idx(flattenOutline(tree(bound), (n) => n.index === 3)), [3]);
  });
  it("扁平网文（无 level）：全是顶层叶子，五位数不炸", () => {
    const flat = Array.from({ length: 20000 }, (_, i) => ch(`第${i + 1}章`));
    const t0 = performance.now();
    const rows = flattenOutline(tree(flat), null);
    eq(rows.length, 20000); eq(rows.every((r) => !r.group && r.depth === 0 && r.groupIndex === -1), true);
    assert(performance.now() - t0 < 200, "flatten 2 万章应 <200ms");
  });
});

describe("chapters-view · 展开到几级 + 每组的小三角（2026-10-01）", () => {
  const folded = (rows) => rows.map((r) => r.folded);
  it("展开到 1 级：只剩最上一级，收起的组头标底下几章", () => {
    const rows = flattenOutline(tree(bound), null, 1);
    eq(idx(rows), [0, 3, 5]); eq(folded(rows), [2, 1, 0]);
  });
  it("单独点开一组（在 1 级上）/ 单独收起一组（在全部上）", () => {
    eq(idx(flattenOutline(tree(bound), null, 1, new Map([[0, true]]))), [0, 1, 2, 3, 5]);
    const r = flattenOutline(tree(bound), null, Infinity, new Map([[3, false]]));
    eq(idx(r), [0, 1, 2, 3, 5]); eq(folded(r), [0, 0, 0, 1, 0]);
  });
  it("三级的书：展开到 2 级 = 第三级收进第二级；藏起来的章数算整棵子树", () => {
    const deep = [ch("馆", 1), ch("作品", 2), ch("段1", 3), ch("段2", 3), ch("作品B", 2), ch("段3", 3), ch("馆二", 1)];
    eq(outlineDepth(tree(deep)), 3);
    eq(idx(flattenOutline(tree(deep), null, 2)), [0, 1, 4, 6]);
    eq(folded(flattenOutline(tree(deep), null, 1)), [5, 0]);
    eq(Array.from(parentMap(tree(deep), deep.length)), [-1, 0, 1, 1, 0, 4, -1]);
  });
  it("搜索时不看级数和单独收起：命中的连祖先组头都摊开", () => {
    eq(idx(flattenOutline(tree(bound), (n) => n.index === 2, 1, new Map([[0, false]]))), [0, 2]);
    eq(folded(flattenOutline(tree(bound), (n) => n.index === 2, 1)), [0, 0]);
  });
  it("扁平的书：1 级，没有可收起的组", () => {
    eq(outlineDepth(tree([ch("第1章"), ch("第2章")])), 1);
    eq(outlineDepth(tree(bound)), 2);
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
