// 切章深模块测试（纯函数，node 直跑）。created 2026-09-19 by Claude Fable 5.1
import { describe, it, eq, assert } from "./runner.mjs";
import { split, autoSplit, splitByCustom, tree, resolveAnchor, isTrivialMove, diff, statusHeader, snippet } from "../src/chapters/index.ts";

const zh = (n) => Array.from({ length: n }, (_, i) => `第${i + 1}章 标题${i + 1}\n正文${i + 1}\n\n`).join("");
// 蒸馏卡装订格式（handoff §1）：状态头 + `# N 篇名` + `## E1v3` / `## 原文`
const bind = (filled) => `2026-09-17 装订 《X》 作者 · 3 篇 · E1v3 ${filled}/3 已出\n` +
  [1, 2, 3].map((i) => `# ${i} 篇名${i}\n## E1v3\n${i <= filled ? "卡片内容".repeat(20) : "（E1v3 未出）"}\n## 原文\n原文${i}\n`).join("");

describe("chapters · split", () => {
  it("网文「第N章」自动命中（≥3）", () => {
    const { chapters, chosen } = autoSplit(zh(5));
    eq(chosen, "zh-chap"); eq(chapters.length, 5); eq(chapters[0].title, "第1章 标题1"); eq(chapters[4].end, zh(5).length);
  });
  it("只有 2 个命中 → 整本一章（synthetic whole，标题空串）", () => {
    const { chapters, chosen } = autoSplit(zh(2));
    eq(chosen, null); eq(chapters.length, 1); eq(chapters[0].synthetic, "whole"); eq(chapters[0].title, "");
  });
  it("Markdown 多级：level 来自 # 个数；单行状态头不成章（开书直进第 1 篇）", () => {
    const { chapters, chosen } = split(bind(3), null);
    eq(chosen, "md"); assert(!chapters[0].synthetic, "状态头一行不当 head 章");
    eq(chapters[0].title, "1 篇名1"); eq(chapters[0].level, 1); eq(chapters[1].title, "E1v3"); eq(chapters[1].level, 2);
    eq(chapters.length, 3 * 3);
  });
  it("多行前言才成 head 合成章", () => {
    const { chapters } = split("前言第一行\n前言第二行\n\n" + zh(3), null);
    eq(chapters[0].synthetic, "head"); eq(chapters.length, 4);
    const { chapters: c2 } = split("只有一行书名\n" + zh(3), null);
    eq(c2.length, 3); assert(!c2[0].synthetic);
  });
  it("bodyStart 跳过标题行与空行；区间首尾相接覆盖整本", () => {
    const text = zh(4); const { chapters } = autoSplit(text);
    for (let i = 0; i < chapters.length; i++) {
      assert(text.slice(chapters[i].bodyStart).startsWith(`正文${i + 1}`), `bodyStart ${i}`);
      if (i > 0) eq(chapters[i].start, chapters[i - 1].end, "首尾相接");
    }
  });
  it("偏好优先：regexId 指定「第N回」在「第N章」书上切不出 → 整本一章（不偷偷退回 auto）", () => {
    const { chapters, chosen } = split(zh(5), { regexId: "zh-hui" });
    eq(chosen, "zh-hui"); eq(chapters.length, 1);
  });
  it("自定义正则坏了 → onError 报出并退回下一级", () => {
    let err = null;
    const { chosen } = split(zh(5), { regexCustom: "(" }, (e) => { err = e; });
    assert(err instanceof Error, "报了错"); eq(chosen, "zh-chap");
  });
  it("splitByCustom 一个 capture group = 标题", () => {
    const { chapters } = splitByCustom("== 甲 ==\n啊\n== 乙 ==\n哦\n== 丙 ==\n呃\n", "^== (.+) ==$");
    eq(chapters.map((c) => c.title).join("|"), "甲|乙|丙");
  });
  it("statusHeader = 第一行；snippet 压空白", () => {
    eq(statusHeader(bind(1)), "2026-09-17 装订 《X》 作者 · 3 篇 · E1v3 1/3 已出");
    eq(statusHeader("\n\n"), null);
    eq(statusHeader("x".repeat(200), 10).length, 10);
    const { chapters } = autoSplit(zh(3)); eq(snippet(zh(3), chapters[0]), "正文1");
  });
});

describe("chapters · tree", () => {
  it("多级嵌套：## 挂在前一个 # 下；head 合成章在根", () => {
    const { chapters } = split(bind(3), null);
    const nodes = tree(chapters);
    eq(nodes.length, 3, "3 篇"); eq(nodes[0].children.length, 2); eq(nodes[0].children[0].title, "E1v3");
  });
  it("无 level 扁平", () => { eq(tree(autoSplit(zh(4)).chapters).length, 4); });
});

describe("chapters · anchor（覆盖友好：标题命中 > 序号）", () => {
  it("同名覆盖只补齐占位（序号不变）→ 标题命中原序号", () => {
    const a = { chapter: 1, title: "E1v3", frac: 0.4 };
    eq(resolveAnchor(a, split(bind(3), null).chapters), 1);
  });
  it("前面插了一章 → 按标题找回", () => {
    const old = split(zh(5), null).chapters;
    const a = { chapter: 3, title: old[3].title, frac: 0.5 };
    const inserted = "第0章 楔子\n引\n\n" + zh(5);
    const nu = split(inserted, null).chapters;
    eq(nu.length, 6); eq(resolveAnchor(a, nu), 4); eq(nu[4].title, "第4章 标题4");
  });
  it("标题消失 → clamp 序号；合成章（空标题）只按序号", () => {
    eq(resolveAnchor({ chapter: 9, title: "没有的章", frac: 0 }, split(zh(3), null).chapters), 2);
    eq(resolveAnchor({ chapter: 0, title: "", frac: 0 }, split(bind(1), null).chapters), 0);
    eq(resolveAnchor({ chapter: 1, title: "", frac: 0 }, []), 0);
  });
  it("trivial：同章比例微动 <0.05", () => {
    const a = { chapter: 1, title: "x", frac: 0.30 };
    assert(isTrivialMove(a, { ...a, frac: 0.34 }, 0.05)); assert(!isTrivialMove(a, { ...a, frac: 0.36 }, 0.05));
    assert(!isTrivialMove(a, { ...a, chapter: 2 }, 0.05)); assert(!isTrivialMove(null, a, 0.05));
  });
});

describe("chapters · diff（活书 chip）", () => {
  it("补齐占位：当前章（E1v3 未出→有内容）currentChanged=true、+0 章、序号不变", () => {
    const o = bind(1), n = bind(2);
    const oc = split(o, null).chapters, nc = split(n, null).chapters;
    const cur = 4;   // 第 2 篇的 E1v3（1篇0, E1v3 1, 原文2, 2篇3, E1v3 4）
    eq(oc[cur].title, "E1v3");
    const d = diff(o, oc, n, nc, cur);
    eq(d.addedChapters, 0); eq(d.currentChanged, true); eq(d.currentIndexInNew, 4);
  });
  it("末尾追加章：+N 章、当前章没变", () => {
    const o = zh(5), n = zh(8);
    const d = diff(o, split(o, null).chapters, n, split(n, null).chapters, 2);
    eq(d.addedChapters, 3); eq(d.currentChanged, false); eq(d.currentIndexInNew, 2);
  });
  it("章数减少不报负数", () => {
    const o = zh(8), n = zh(5);
    eq(diff(o, split(o, null).chapters, n, split(n, null).chapters, 1).addedChapters, 0);
  });
});
