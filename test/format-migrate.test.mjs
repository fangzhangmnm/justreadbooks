// 格式版本纪律守卫（家族根 ai-docs/20261021-format-version-discipline.md §3）：表 / STEPS / 冻结样本三样齐；老样本能开；读 → 写 → 再读语义无损 + 未知键直通；
// 拒认更新的 major；minor 更新只报不拦；本版写出的键集合 ⊆ 已知键 ∪ 拍子键 ∪ extra。created 2026-10-21 by Claude Fable 5.1
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it, assert, eq } from "./runner.mjs";
import { FORMAT, MIN_MAJOR, STEPS, KNOWN_FIELDS, STAMP_KEYS, readStamp, compareStamp, migrate, splitExtra, compose, fmt, FormatTooNewError } from "../src/format/migrate/index.ts";

const COMPONENTS = Object.keys(FORMAT);
const deq = (a, b, msg) => eq(JSON.stringify(a), JSON.stringify(b), msg);   // runner 的 eq 是 ===，对象比 JSON 文本
const DIR = { readingPosition: "test/fixtures/format/reading-position", bookPref: "test/fixtures/format/book-prefs" };
const roundTrip = (c, json) => { const m = migrate(c, json); const { known, extra } = splitExtra(c, m.json); return { m, known, extra, out: compose(c, extra, known) }; };

describe("format · 拍子", () => {
  it("缺 version = 1.0.0；minor / patch 缺或非法 = 0；三键都读", () => {
    for (const c of COMPONENTS) {
      deq(readStamp(c, {}), { major: 1, minor: 0, patch: 0 });
      deq(readStamp(c, { version: 1, minor: "2", patch: -1 }), { major: 1, minor: 0, patch: 0 });
      deq(readStamp(c, { version: 3, minor: 2, patch: 1 }), { major: 3, minor: 2, patch: 1 });
    }
  });
  it("同 major 判决：same / older / newer-minor / newer-patch", () => {
    const mine = { major: 1, minor: 1, patch: 1 };
    eq(compareStamp({ major: 1, minor: 1, patch: 1 }, mine), "same");
    eq(compareStamp({ major: 1, minor: 0, patch: 9 }, mine), "older");
    eq(compareStamp({ major: 1, minor: 2, patch: 0 }, mine), "newer-minor");
    eq(compareStamp({ major: 1, minor: 1, patch: 2 }, mine), "newer-patch");
  });
  it("major 比本版大 → FormatTooNewError（不降级不猜）；STEPS 覆盖 MIN_MAJOR…本版-1 的每一步", () => {
    for (const c of COMPONENTS) {
      let threw = null; try { migrate(c, { version: FORMAT[c].major + 1 }); } catch (e) { threw = e; }
      assert(threw instanceof FormatTooNewError, `${c}: expected FormatTooNewError`);
      for (let v = MIN_MAJOR[c]; v < FORMAT[c].major; v++) assert(typeof STEPS[c]?.[v] === "function", `${c}: no STEP for v${v} → v${v + 1}`);
    }
  });
});

describe("format · 直通与写回", () => {
  it("未知键原样带回；已知键永远赢；文件里的拍子不进 extra、写回时重打本版的拍", () => {
    const file = { version: 1, minor: 7, patch: 3, anchor: { chapter: 2, title: "x", frac: 0.1 }, readAt: 5, mood: "sleepy", nested: { a: 1 } };
    const { m, extra, out } = roundTrip("readingPosition", file);
    eq(m.verdict, "newer-minor");
    deq(extra, { mood: "sleepy", nested: { a: 1 } });
    eq(out.version, 1); eq(out.minor, FORMAT.readingPosition.minor); eq(out.patch, FORMAT.readingPosition.patch);
    eq(out.mood, "sleepy"); deq(out.anchor, file.anchor);
    const clobber = compose("readingPosition", { readAt: 999, mood: "x" }, { anchor: file.anchor, readAt: 5 });
    eq(clobber.readAt, 5, "known key must win over extra");
  });
  it("本版写出的键集合 ⊆ 已知键 ∪ 拍子键 ∪ extra", () => {
    for (const c of COMPONENTS) {
      const out = compose(c, { zzz: 1 }, Object.fromEntries(KNOWN_FIELDS[c].map((k) => [k, "v"])));
      const allowed = new Set([...KNOWN_FIELDS[c], ...STAMP_KEYS, "zzz"]);
      for (const k of Object.keys(out)) assert(allowed.has(k), `${c}: unexpected key ${k}`);
      for (const k of STAMP_KEYS) assert(k in out, `${c}: stamp key ${k} missing`);
    }
  });
});

describe("format · 冻结样本", () => {
  it("每个子结构都有本版拍的样本 v<拍>.json（改了 FORMAT 就要冻结一份新的）", () => {
    for (const c of COMPONENTS) assert(existsSync(join(DIR[c], `v${fmt(FORMAT[c])}.json`)), `${c}: missing fixture v${fmt(FORMAT[c])}.json`);
  });
  it("所有样本能开（含无拍的老条目）；读 → 写 → 再读已知键语义无损、extra 原样", () => {
    for (const c of COMPONENTS) {
      for (const f of readdirSync(DIR[c]).filter((x) => x.endsWith(".json"))) {
        const json = JSON.parse(readFileSync(join(DIR[c], f), "utf8"));
        const a = roundTrip(c, json);
        assert(a.m.verdict === "same" || a.m.verdict === "older", `${c}/${f}: verdict ${a.m.verdict}`);
        const b = roundTrip(c, a.out);
        deq(b.known, a.known, `${c}/${f}: known fields changed across a round trip`);
        deq(b.extra, a.extra, `${c}/${f}: extra changed across a round trip`);
        deq(readStamp(c, a.out), FORMAT[c], `${c}/${f}: written stamp must be the app's`);
      }
    }
  });
});
