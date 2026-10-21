// 还原出厂设置（家族 CLAUDE.md「命名与共享规矩」2½：全家一个语义、放开发者菜单、二次确认护栏、不硬拦——user 2026-10-21「全家swipe的语义统一，然后full swipe应该有
//   二次确定护栏，而且是开发者菜单里面」；形状抄 WXHW src/factory-reset.ts）。created 2026-10-21 by Claude Fable 5.1
//
// 范围 = 这台设备上本 app 的全部足迹：store 命名空间（IDB `jrb.*`，含 store 2.2.0 的 `.staging` 分库 + 同前缀全部 localStorage 键——库内 typed-consent 口子 wipeAppNamespace）
//   + device-kv 键（`justreadbooks-<guid>:*`：偏好 / 上次那本 / 黑匣子 / 朗读偏好）+ gallery-registry 库（`justreadbooks-<guid>.gallery-registry`，gallery 0.8.7 起归宿主命名）
//   + 本 app 的壳缓存（`jrb-` 前缀）+ 注销管着当前页面的那一个 SW → reload 成新装。
// **不碰**：云端（正本在 OneDrive；还原出厂 ≠ 删书）；Cache Storage `pwa-models`（家族共享的语音包，设置 →「朗读」里逐包删）；兄弟 app 的任何东西（同域名下只动自己前缀）。
// 护栏两步、不硬拦（家规：app 不许硬拦，上限 = 警告可取消）：① 说明 sheet——有 N 本书只在本机会一起删、不造逃生副本（可取消）；② 逐字确认（库内再比一次）。
// 持久层白名单：本文件允许 indexedDB.deleteDatabase（只删 gallery-registry 那一个库；test/redline-guard ALLOW_IDB 登记）。
import { wipeAppNamespace, scanAppNamespace, disposeStore, requireStore } from "./app-store.ts";
import { deviceKvWipeAll, deviceKvCount } from "./device-kv.ts";
import { openConfirmSheet, openInputSheet } from "./sheets.ts";
import { t } from "./i18n/index.ts";
import { reportError } from "./error-badge.ts";
import { APP_ID, GALLERY_REGISTRY_DB } from "./config.ts";

const BLOCKED_TIMEOUT_MS = 2000;
function deleteDbOrBlocked(name: string): Promise<"deleted" | "blocked"> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: "deleted" | "blocked") => { if (!settled) { settled = true; resolve(r); } };
    const timer = setTimeout(() => done("blocked"), BLOCKED_TIMEOUT_MS);
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => { clearTimeout(timer); done("deleted"); };
      req.onerror = () => { clearTimeout(timer); done("blocked"); };
    } catch { clearTimeout(timer); done("deleted"); }   // 没有 indexedDB 的环境：没东西可删
  });
}

export interface FactoryResetDeps {
  setStatus: (msg: string, opts?: { error?: boolean }) => void;
  /** wipe 前收口：关掉正在读的书（阅读器停、位置不再写），之后 store 就 dispose 了。 */
  beforeWipe: () => Promise<void>;
  /** 只注销管着当前页面的 SW + 只删 `jrb-` 前缀的缓存（pwa-shell 的那一步，不 reload）。 */
  clearOwnShell: () => Promise<void>;
}

/** 还原出厂主流程（设置 →「开发者」→「还原出厂设置…」）。全程 in-app sheet。 */
export async function runFactoryReset(d: FactoryResetDeps): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) { d.setStatus(t("fr.needOnline"), { error: true }); return; }   // 清壳后 reload 要联网，不然白屏
  const unsynced = await requireStore().files.dirty.count().catch((e) => { reportError(e, "log"); return 0; });
  const intro = unsynced > 0 ? t("fr.introMsgUnsynced", { n: unsynced }) : t("fr.introMsg");
  if (!(await openConfirmSheet(t("fr.title"), intro, { danger: true, okLabel: t("fr.continue") }))) return;
  const phrase = t("fr.consentPhrase");
  const typed = await openInputSheet(t("fr.title"), { placeholder: phrase, message: t("fr.consentPrompt", { phrase }), okLabel: t("fr.title") });
  if (typed == null) return;
  if (typed.trim() !== phrase) { d.setStatus(t("fr.mismatch"), { error: true }); return; }   // 库内还会再比一次；先挡省一次 dispose
  try {
    await d.beforeWipe();
    await disposeStore();
    const storeReport = await wipeAppNamespace({ appId: APP_ID, consent: { expected: phrase, typed: typed.trim() } });
    const registry = await deleteDbOrBlocked(GALLERY_REGISTRY_DB);
    const lsRemoved = deviceKvWipeAll();
    try { await d.clearOwnShell(); } catch (e) { reportError(e, "log"); }
    const scan = await scanAppNamespace(APP_ID);
    const blocked = storeReport.blockedDatabases.length + (registry === "blocked" ? 1 : 0);
    if (blocked > 0) {
      await openConfirmSheet(t("fr.title"), t("fr.blocked", { n: blocked }));
      location.reload();   // store 已 dispose，页面只能重来；wipe 幂等，关掉其他标签页后再跑一次
      return;
    }
    const residue = scan.databases.length + scan.localStorageKeys + deviceKvCount();
    const db = storeReport.deletedDatabases.length + (registry === "deleted" ? 1 : 0), ls = storeReport.localStorageKeysRemoved + lsRemoved;
    d.setStatus(residue === 0 ? t("fr.doneClean", { db, ls }) : t("fr.residue", { n: residue }));
    setTimeout(() => location.reload(), 1200);   // 出厂态重启（内存单例归零的唯一诚实方式）
  } catch (e) {
    if ((e as { name?: string } | null)?.name === "WipeConsentError") { d.setStatus(t("fr.mismatch"), { error: true }); return; }
    reportError(e instanceof Error ? e : new Error(String(e)));
    setTimeout(() => location.reload(), 1500);   // store 可能已 dispose，留在页面上只会一路 StoreDisposedError
  }
}
