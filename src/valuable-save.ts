// 「有价值的保存」调度器 —— 纯时间策略，零 IO / 零 store / 零 DOM（从 JustReadPapers src/domain/valuable-save.ts 原样移植，家族第三个消费者）。
// created 2026-09-19 by Claude Fable 5.1（源 = JRP 2026-06-19，作者 Claude；算法根 = JRB v1 session.js scheduleWrite/flush/flushKeepalive）
// 决定「何时值得 commit 一次阅读位置」，吃掉手指 fidget / loitering，别把 OneDrive 版本史塞爆。真正落盘由注入的 commit 做。
//  - mark()           有意义改动 → 标脏 + 排防抖（每次重置 debounceMs）+ 从 firstDirty 起 ceilingMs 封顶
//  - markTrivial()    微动（同章小 frac Δ）→ 只标脏不调度；等下次 mark 或 flushKeepalive 顺带带上
//  - flush()          显式落盘（若脏）：取消防抖、commit；inFlight 防重叠；失败保脏待重试
//  - flushKeepalive() unload/hidden：同步 fire-and-forget

export interface ValuableSaveConfig {
  commit: () => Promise<void>;
  keepalive?: () => void;
  debounceMs?: number;
  ceilingMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}
export interface ValuableSave {
  mark: () => void;
  markTrivial: () => void;
  flush: () => Promise<void>;
  flushKeepalive: () => void;
  isDirty: () => boolean;
  isInFlight: () => boolean;
  dispose: () => void;
}

export function createValuableSave(cfg: ValuableSaveConfig): ValuableSave {
  const commit = cfg.commit;
  const keepalive = cfg.keepalive ?? ((): void => { void commit(); });
  const debounceMs = cfg.debounceMs ?? 10_000;
  const ceilingMs = cfg.ceilingMs ?? 30_000;
  const now = cfg.now ?? ((): number => Date.now());
  const setTimer = cfg.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const clearTimer = cfg.clearTimer ?? ((h: unknown): void => { clearTimeout(h as ReturnType<typeof setTimeout>); });

  let dirty = false;
  let firstDirtyAt = 0;
  let timer: unknown = null;
  let inFlight: Promise<void> | null = null;

  function touch(): void { if (!dirty) firstDirtyAt = now(); dirty = true; }
  function clearPending(): void { if (timer !== null) { clearTimer(timer); timer = null; } }
  function schedule(): void {
    clearPending();
    const t = now();
    const target = Math.min(t + debounceMs, firstDirtyAt + ceilingMs);
    const wait = Math.max(0, target - t);
    timer = setTimer((): void => { timer = null; void flush().catch((): void => {}); }, wait);
  }
  function mark(): void { touch(); schedule(); }
  function markTrivial(): void { touch(); }
  async function flush(): Promise<void> {
    if (inFlight) { try { await inFlight; } catch { /* 上一轮的错由上一轮抛 */ } if (!dirty) return; }
    if (!dirty) return;
    clearPending();
    dirty = false;
    const ceilingMark = firstDirtyAt;
    firstDirtyAt = 0;
    inFlight = (async (): Promise<void> => {
      try { await commit(); }
      catch (e) { if (!dirty) { dirty = true; firstDirtyAt = ceilingMark; } throw e; }
    })();
    try { await inFlight; } finally { inFlight = null; }
  }
  function flushKeepalive(): void { if (!dirty) return; clearPending(); keepalive(); }
  return { mark, markTrivial, flush, flushKeepalive, isDirty: (): boolean => dirty, isInFlight: (): boolean => inFlight !== null, dispose: clearPending };
}
