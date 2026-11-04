// offline-bar.ts —— 读书的常驻条（index.html #offlineBar）。created 2026-11-03 by Claude Opus 5.5（家族工单 E；Fable 裁定「读书不闸，只挂常驻条」）
//   只有一件事：说现在离线、为什么，点了做这一行字说的那件事。不弹面、不挡书。
import { t } from "./i18n/index.ts";
import { reportError } from "./error-badge.ts";
import type { BarView } from "./cloud-watch.ts";

const REFRESH_MS = 3000;   // 离线时传进来的书会变多：条开着才数（库里是一次标量读）

export interface OfflineBarDeps {
  dirtyCount: () => Promise<number>;
  /** 点「重新登录」那种。 */
  signIn: () => void;
  /** 有没传上去的：图库「要处理的」列表（gallery 0.8.8）。 */
  openList: () => void;
  /** 什么都不缺：再核一次。 */
  retry: () => void;
}
export function createOfflineBar(o: OfflineBarDeps): (view: BarView) => void {
  const bar = document.getElementById("offlineBar") as HTMLButtonElement;
  const text = bar.querySelector(".offline-bar-text") as HTMLElement;
  let view: BarView = { kind: "hidden" };
  let count = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  async function paint(): Promise<void> {
    if (view.kind !== "offline") return;
    if (view.reason === "expired") { text.textContent = t("offline.barExpired"); return; }
    count = await o.dirtyCount().catch((e) => { reportError(e, "log"); return 0; });
    if (view.kind !== "offline") return;   // 数的时候网回来了
    text.textContent = count > 0 ? t("offline.bar", { n: count }) : t("offline.barZero");
  }
  bar.addEventListener("click", () => {
    if (view.kind !== "offline") return;
    if (view.reason === "expired") o.signIn();
    else if (count > 0) o.openList();
    else o.retry();
  });
  return (next) => {
    view = next; count = 0;
    if (timer) { clearInterval(timer); timer = null; }
    bar.classList.toggle("hidden", next.kind === "hidden");
    bar.dataset.state = next.kind;
    if (next.kind === "syncing") text.textContent = t("offline.barSyncing");
    else if (next.kind === "offline") { void paint(); timer = setInterval(() => { void paint(); }, REFRESH_MS); }
  };
}
