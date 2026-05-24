// Microsoft Entra (Azure AD) 登录 via MSAL.js.
//
// MSAL 从 CDN 懒加载,SW 不缓存跨源 (login.microsoftonline.com / graph)。
// 缓存账号 + silent probe = 同 origin 下其它 app(如 webxiaoheiwu / justreadpapers)
// 在 localStorage 里有 account 不代表本 app 已被授权,要 silent acquire 本 app 的 SCOPES 才算。
// 失败 → 暴露 probedAccount 给 UI,提示用户主动登录。

import { CLIENT_ID, AUTHORITY, SCOPES } from "./config.js";

// 当 CLIENT_ID 还是占位符 (没配 Azure) → 纯本地模式,不要去碰 MSAL CDN
// (避免旅馆网 / 离线 / 飞机模式下 boot 卡在加载 MSAL)
export function isAuthConfigured() {
  return typeof CLIENT_ID === "string"
    && CLIENT_ID.length > 0
    && !CLIENT_ID.startsWith("REPLACE_ME");
}

// MSAL 整包 vendor 到 src/vendor/msal/。本地路径,无 CDN 依赖。
const MSAL_URL = new URL("./vendor/msal/msal-browser.min.js", import.meta.url).href;

let msalLoadPromise = null;
let pca = null;
let activeAccount = null;
let initPromise = null;

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = url;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${url}`));
    document.head.appendChild(s);
  });
}

// GH Pages 冷启动偶尔会一次拉不下,加退避重试
async function loadScriptWithRetry(url, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { await loadScript(url); return; }
    catch (e) {
      lastErr = e;
      console.warn(`script ${url} 第 ${i + 1}/${attempts} 次加载失败`);
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw new Error(`script 加载失败 ${url}: ${lastErr?.message}`);
}

function loadMsal() {
  if (window.msal) return Promise.resolve(window.msal);
  if (msalLoadPromise) return msalLoadPromise;
  msalLoadPromise = (async () => {
    await loadScriptWithRetry(MSAL_URL);
    if (window.msal) return window.msal;
    msalLoadPromise = null;
    throw new Error("MSAL 加载完但 window.msal 没出现");
  })().catch((e) => { msalLoadPromise = null; throw e; });
  return msalLoadPromise;
}

export async function initAuth() {
  if (!isAuthConfigured()) {
    return { signedIn: false, account: null, notConfigured: true };
  }
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const msal = await loadMsal();
    pca = new msal.PublicClientApplication({
      auth: {
        clientId: CLIENT_ID,
        authority: AUTHORITY,
        redirectUri: location.origin + location.pathname,
        postLogoutRedirectUri: location.origin + location.pathname,
      },
      cache: {
        cacheLocation: "localStorage",
        storeAuthStateInCookie: false,
      },
    });
    await pca.initialize();

    let response = null;
    try {
      response = await pca.handleRedirectPromise();
    } catch (e) {
      console.warn("handleRedirectPromise failed:", e);
    }

    if (response?.account) {
      pca.setActiveAccount(response.account);
      activeAccount = response.account;
      return { signedIn: true, account: activeAccount };
    }

    const cached = pca.getAllAccounts();
    if (cached.length === 0) {
      return { signedIn: false, account: null };
    }

    try {
      await pca.acquireTokenSilent({ scopes: SCOPES, account: cached[0] });
      pca.setActiveAccount(cached[0]);
      activeAccount = cached[0];
      return { signedIn: true, account: activeAccount };
    } catch (_) {
      return { signedIn: false, account: null, probedAccount: cached[0] };
    }
  })().catch((e) => {
    initPromise = null;
    throw e;
  });
  return initPromise;
}

export async function signIn() {
  if (!pca) await initAuth();
  return pca.loginRedirect({ scopes: SCOPES });
}

export async function signOut() {
  if (!pca || !activeAccount) return;
  const account = activeAccount;
  activeAccount = null;
  // 只清本 app 的 local cache,不 logoutRedirect —— 避免把用户在 Outlook 等地的 session 一起踢掉
  try {
    await pca.clearCache({ account });
  } catch (e) {
    console.warn("clearCache failed:", e);
  }
  try { pca.setActiveAccount(null); } catch (_) {}
}

export async function getToken() {
  if (!pca || !activeAccount) throw new Error("尚未登录");
  try {
    const result = await pca.acquireTokenSilent({
      scopes: SCOPES,
      account: activeAccount,
    });
    return result.accessToken;
  } catch (e) {
    await pca.acquireTokenRedirect({ scopes: SCOPES });
    throw e;
  }
}

export function getActiveAccount() {
  return activeAccount;
}

export function isSignedIn() {
  return !!activeAccount;
}
