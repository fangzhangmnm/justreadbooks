// src/format/migrate/ —— JRB 的格式版本纪律：每个子结构自己的拍子 + 升级代码全住本文件夹（家族规矩 = 家族根
//   `ai-docs/20261021-format-version-discipline.md`；user 2026-10-21「版本纪律能做成 catsup moonsinger 一样不同 component 有自己的拍子，
//   然后有一个专门的代码文件夹放升级代码吗？这个变成全家的版本纪律」「三级语义 同意」；形状抄 WXHW `src/project/migrate/`（minor / patch 那一半的家族参考实现）→ CatsUp `src/format/migrate/`）。
// created 2026-10-21 by Claude Fable 5.1（user 同日「然后2动」）
//
// 子结构（component）= JRB 写到云端的两份 collection 里**每一条**条目的 JSON（书本身是 .txt，没有自有格式）：
//   · readingPosition：`.jrb/reading-position.json` 的条目 `{ anchor: { chapter, title, frac }, readAt }`（key = 书的身份）
//   · bookPref：`.jrb/book-prefs.json` 的条目 `{ regexId?, regexCustom?, encoding?, header? }`
// 拍子 = major.minor.patch 三个整数，互不联动；写入器只写当前拍（FORMAT），读取器按拍决定认不认、怎么认：
//   · major 比本版大 = 不可兼容 / 重大安全问题 → 拒认（FormatTooNewError）：这条不读、**也不写回**（不降级不猜）；别的条目照常。
//   · minor 比本版大 = 缺功能 / 行为变化 → 能读能改能存：不认识的键原样带回（splitExtra / compose 的 extra 袋），告诉用户一次（verdict "newer-minor"）。
//   · patch 比本版大 = 可以无脑降 → 静默（verdict "newer-patch"）。
//   · 比本版小：major 小 = 走 STEPS 链式升级（纯函数，一步 +1）；minor / patch 小 = 缺的当默认，不用代码。
//   · 同 major 内只加不改；删字段 = 保留读、停止写；真要删 = major +1 + 一条 STEP + 冻结样本。
// 物理形状：整数键 `version` 当 major（两份 collection 从没写过 version，缺 = 1 —— 已发出去的 0.1.x / 0.2.x 读者读它们只认 anchor / readAt 等已知键、
//   写回时会把三个拍子键和 extra 一起丢掉 = 退回 1.0.0 无拍，语义相同），再加两个可选整数键 `minor` / `patch`（缺 = 0）。不改成字符串。
// 改格式 = ① FORMAT 里对应子结构 +1 ② major 变了就在 STEPS 登记一条 ③ test/fixtures/format/<子结构>/v<拍>.json 冻结一份本版写出的样本
//   ④ KNOWN_FIELDS 表 ⑤ CLAUDE.md 记一笔。少一样守卫红（test/format-migrate.test.mjs）。

export type Component = "readingPosition" | "bookPref";
export interface Stamp { major: number; minor: number; patch: number }

/** 本版写出的拍子（SSoT）。两份都是 1.0.0 = 2026-09-19 现代化起的形状，2026-10-21 起才带拍。 */
export const FORMAT: Readonly<Record<Component, Readonly<Stamp>>> = {
  readingPosition: { major: 1, minor: 0, patch: 0 },
  bookPref: { major: 1, minor: 0, patch: 0 },
};
/** 缺 `version` 时当几：两份都从没写过 version = 1。 */
export const MISSING_MAJOR: Readonly<Record<Component, number>> = { readingPosition: 1, bookPref: 1 };
/** 本版能读的最老 major。 */
export const MIN_MAJOR: Readonly<Record<Component, number>> = { readingPosition: 1, bookPref: 1 };
/** 本版认识的键（拍子三键之外）。读取器把它们之外的键装进 extra 袋原样带回；写入器先铺 extra 再铺已知键（已知键永远赢）。 */
export const KNOWN_FIELDS: Readonly<Record<Component, readonly string[]>> = {
  readingPosition: ["anchor", "readAt"],
  bookPref: ["regexId", "regexCustom", "encoding", "header"],
};
export const STAMP_KEYS: readonly string[] = ["version", "minor", "patch"];

export type Step = (json: Record<string, unknown>) => Record<string, unknown>;
/** STEPS[子结构][major] = 把 major 升到 major+1 的纯函数（必须把 version 写成 major+1）。今天空表：两份都只有 1。 */
export const STEPS: Readonly<Partial<Record<Component, Readonly<Record<number, Step>>>>> = {};

export class FormatTooNewError extends Error {
  readonly component: Component;
  readonly fileStamp: Stamp;
  readonly appStamp: Stamp;
  constructor(component: Component, fileStamp: Stamp, appStamp: Stamp) {   // 不用参数属性：node strip-types 不支持
    super(`${component} format ${fmt(fileStamp)} is newer than this app (${fmt(appStamp)}); refusing to read or write this entry (never downgrade or guess)`);
    this.name = "FormatTooNewError"; this.component = component; this.fileStamp = fileStamp; this.appStamp = appStamp;
  }
}
export class FormatTooOldError extends Error {
  readonly component: Component;
  readonly fileStamp: Stamp;
  constructor(component: Component, fileStamp: Stamp, minMajor: number) {
    super(`${component} format ${fmt(fileStamp)} is older than this app reads (min major ${minMajor})`);
    this.name = "FormatTooOldError"; this.component = component; this.fileStamp = fileStamp;
  }
}

export const fmt = (s: Stamp): string => `${s.major}.${s.minor}.${s.patch}`;
const nat = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** 读一条 JSON 的拍子：version = major（缺 → MISSING_MAJOR）；minor / patch 缺或非法 = 0。 */
export function readStamp(c: Component, json: unknown): Stamp {
  const o = isObj(json) ? json : {};
  return { major: nat(o.version) ?? MISSING_MAJOR[c], minor: nat(o.minor) ?? 0, patch: nat(o.patch) ?? 0 };
}

/** 同 major 下文件拍 vs 本版拍。too-new（major 大）不在这里——它走异常。 */
export type Verdict = "same" | "older" | "newer-minor" | "newer-patch";
export function compareStamp(file: Stamp, mine: Stamp): Verdict {
  if (file.minor > mine.minor) return "newer-minor";
  if (file.minor < mine.minor) return "older";
  if (file.patch > mine.patch) return "newer-patch";
  if (file.patch < mine.patch) return "older";
  return "same";
}

/** 把一条 JSON 升到本版 major，并给出判决。major 比本版大 → FormatTooNewError；比 MIN_MAJOR 小 → FormatTooOldError；
 *  中间每一步都要有 STEP，缺了 = 纪律破，响亮抛。steps 可注入（测试）。 */
export function migrate(c: Component, json: Record<string, unknown>, steps: typeof STEPS = STEPS): { json: Record<string, unknown>; stamp: Stamp; verdict: Verdict } {
  const stamp = readStamp(c, json);
  const mine = FORMAT[c];
  if (stamp.major > mine.major) throw new FormatTooNewError(c, stamp, mine);
  if (stamp.major < MIN_MAJOR[c]) throw new FormatTooOldError(c, stamp, MIN_MAJOR[c]);
  let cur = json, v = stamp.major;
  while (v < mine.major) {
    const step = steps[c]?.[v];
    if (!step) throw new Error(`migrate: no step registered for ${c} v${v} → v${v + 1} (format discipline violated: every major bump needs a STEP)`);
    cur = step(cur); v++;
    if (cur.version !== v) throw new Error(`migrate: step ${c} v${v - 1}→v${v} did not set version`);
  }
  return { json: cur, stamp, verdict: v !== stamp.major ? "older" : compareStamp(stamp, mine) };
}

/** 直通：已知键 / 其余键分开。拍子三键既不算已知也不进 extra（拍子永远是自己的，写回时由 compose 重打）。 */
export function splitExtra(c: Component, json: Record<string, unknown>): { known: Record<string, unknown>; extra: Record<string, unknown> } {
  const known: Record<string, unknown> = {}, extra: Record<string, unknown> = {};
  const K = KNOWN_FIELDS[c];
  for (const [k, v] of Object.entries(json)) { if (STAMP_KEYS.includes(k)) continue; (K.includes(k) ? known : extra)[k] = v; }
  return { known, extra };
}
/** 写入器用：先铺 extra、再铺已知键（已知键永远赢）、最后本版的拍子。 */
export function compose(c: Component, extra: Record<string, unknown>, known: Record<string, unknown>): Record<string, unknown> {
  const s = FORMAT[c];
  return { ...extra, ...known, version: s.major, minor: s.minor, patch: s.patch };
}
