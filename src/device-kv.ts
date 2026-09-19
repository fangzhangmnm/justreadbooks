// device-kv —— device 层唯一 localStorage 入口（抄 WXHW / WeebPaint src/device-kv.ts）。created 2026-09-19 by Claude Fable 5.1
//
// 纪律：**全 app 禁裸 localStorage**（红线守卫测试 test/redline-guard.test.mjs 守着）——device 层标量一律经本器官。
//   住这里的：阅读偏好（字号/行高/字体/行宽档：跟屏幕走）、theme、lang、lastOpen（本机上次那本 = 首帧秒开指针）、gallery-folder、last-scene、diag-log。
//   **不住这里的**：每本书的阅读位置（乙：synced collection）、切章规则（collection）。
// localStorage 不可用（隐私模式/配额）→ try/catch 降级纯内存（本 session 内一致，不跨刷新）。
// key 前缀带 GUID 命名空间（同 origin 兄弟 PWA 共桶防撞；永不碰非自己前缀的键——v1 的 jrb.* 键留孤儿）。

const PREFIX = "justreadbooks-2f8a41c7b9d3e650:";

const _mem = new Map<string, string>();
function _ls(): Storage | null {
  try {
    const ls = globalThis.localStorage;
    ls.getItem(PREFIX + "__probe");
    return ls;
  } catch { return null; }
}

export function deviceKvGet(key: string): string | null {
  const k = PREFIX + key;
  const ls = _ls();
  if (ls) { try { return ls.getItem(k); } catch { /* fall through to memory */ } }
  return _mem.get(k) ?? null;
}

/** v=null 删键。写失败（配额/隐私模式中途翻脸）→ 落内存层，绝不 throw（device 层是便利不是红线）。 */
export function deviceKvSet(key: string, v: string | null): void {
  const k = PREFIX + key;
  const ls = _ls();
  if (ls) {
    try {
      if (v == null) ls.removeItem(k); else ls.setItem(k, v);
      _mem.delete(k);
      return;
    } catch { /* fall through to memory */ }
  }
  if (v == null) _mem.delete(k); else _mem.set(k, v);
}

export function deviceKvGetJson<T>(key: string, fallback: T): T {
  const raw = deviceKvGet(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
export function deviceKvSetJson(key: string, v: unknown): void {
  deviceKvSet(key, v == null ? null : JSON.stringify(v));
}
