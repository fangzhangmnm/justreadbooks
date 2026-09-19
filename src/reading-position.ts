// reading-position —— 每本书的阅读位置（乙，user 2026-09-19 拍板）：synced collection，key = 路径，逐 item uat-LWW 由库承担；
// **没有全局 lastActive funnel**（v1 的跨设备跳书已删）。写盘节律 = valuable-save（10s 防抖 / 30s 封顶 / trivial-skip），防 OneDrive 版本史塞爆。
// created 2026-09-19 by Claude Fable 5.1
import { readingPos } from "./app-store.ts";
import { createValuableSave } from "./valuable-save.ts";
import { isTrivialMove, clampFrac, type Anchor } from "./chapters/index.ts";
import { POSITION_DEBOUNCE_MS, POSITION_HEARTBEAT_MS, TRIVIAL_FRAC_DELTA } from "./config.ts";
import { reportError } from "./error-badge.ts";

export interface StoredPosition { anchor: Anchor; readAt: number }

const vs = createValuableSave({
  commit: async () => { const r = await readingPos.reconcileWithRemote(); if (r.status === "error") throw (r.error instanceof Error ? r.error : new Error(String(r.error ?? r.status))); },
  keepalive: () => { void readingPos.flushLocal(); },
  debounceMs: POSITION_DEBOUNCE_MS, ceilingMs: POSITION_HEARTBEAT_MS,
});

function normalize(v: unknown): StoredPosition | null {
  const o = v as { anchor?: { chapter?: unknown; title?: unknown; frac?: unknown }; readAt?: unknown } | null;
  if (!o || typeof o !== "object" || !o.anchor || typeof o.anchor !== "object") return null;
  const a = o.anchor;
  return { anchor: { chapter: Math.max(0, Math.floor(Number(a.chapter) || 0)), title: typeof a.title === "string" ? a.title : "", frac: clampFrac(Number(a.frac)) }, readAt: Number(o.readAt) || 0 };
}
export function getPosition(name: string): StoredPosition | null { return normalize(readingPos.getItem(name)); }
/** 阅读器报位置：trivial（同章微动）只标脏不调度；非 trivial 走防抖/封顶。 */
export function notePosition(name: string, anchor: Anchor): void {
  const cur = getPosition(name);
  readingPos.setItem(name, { anchor, readAt: Date.now() } satisfies StoredPosition);
  if (isTrivialMove(cur?.anchor ?? null, anchor, TRIVIAL_FRAC_DELTA)) vs.markTrivial(); else vs.mark();
}
/** 打开一本书（哪怕没滚）：刷 readAt（最近阅读排序）；没有位置条目就建一条。 */
export function markOpened(name: string): void {
  const cur = getPosition(name);
  readingPos.setItem(name, { anchor: cur?.anchor ?? { chapter: 0, title: "", frac: 0 }, readAt: Date.now() } satisfies StoredPosition);
  vs.mark();
}
export function isUnread(name: string): boolean { return readingPos.getEntry(name) == null; }
/** 最近阅读（跨夹）：按 readAt 降序前 n 本。 */
export function recentBooks(n: number): { name: string; readAt: number }[] {
  return readingPos.entries().map((e) => ({ name: e.id, readAt: normalize(e.value)?.readAt ?? 0 })).filter((x) => x.readAt > 0).sort((a, b) => b.readAt - a.readAt).slice(0, n);
}
export function flushPosition(): Promise<void> { return vs.flush().catch((e) => { reportError(e, "log"); }); }
export function keepalivePosition(): void { vs.flushKeepalive(); }
export function positionIsDirty(): boolean { return vs.isDirty(); }
