# 缓存策略 + 4 级数据保护落地

> [00-sync-constraints.md](00-sync-constraints.md) 定义了 4 级数据保护(Top/High/Medium/Low),
> 本 doc 讲它们在代码里怎么映射 + 实际 LRU / pin / freshness / ghost 怎么协同。

## 4 级保护 → cache.meta 字段映射

| Level | 含义 | source | pinned | 用户怎么造出来 | 淘汰规则 |
|---|---|---|---|---|---|
| **Top** | 用户上传的本地文件 | `"local"` | `true` (default) | drag-drop / file picker | **永不自动淘汰** |
| **High** | 用户显式缓存的云端书 | `"onedrive"` | `true` | 行里点 ⬇ 缓存 按钮 | **永不自动淘汰** |
| **Medium** | openBook 时自动缓存 | `"onedrive"` | `false` | 打开一本书 | LRU 可淘汰,再开再下载 |
| **Low** | 内存中只活到本次会话 | (不入 IDB) | — | 没 cache 的情况下打开 | tab 关就没 |

代码:[cache.js:set](../src/cache.js) 默认 `pinned: true`,所以本地上传 + 显式缓存自动是 Top/High。autoCache 路径在 [app.js:openBook](../src/app.js) 显式 `pinned: false`。

## ensureRoom: LRU + 钉住保护

容量满 + 要写新 blob → 先把非 pinned 项按 `lastAccessed` 升序淘汰,够腾出来就停。

```
ensureRoom(reserveBytes):
  pinned = [m for m in all if m.pinned]
  pinnedSize = sum(pinned.size)
  if pinnedSize + reserveBytes > capBytes:
    return false           # 钉住的已经撑满 + 还要放新的 → 失败,UI toast
  evictable = sort([m for m if not m.pinned], by lastAccessed asc)
  for m in evictable:
    if total + reserveBytes <= capBytes: break
    del(m.itemId)
  return true
```

**关键不变式**:`ensureRoom` 永远不淘汰 pinned。返 false 时上层决定怎么办:
- 显式 cache 按钮触发的 → toast `"缓存失败:容量不够(钉住的太多)"`
- autoCache 路径 → 静默,本次还有内存 blob 用
- 本地 upload → `alert("本地存储空间不够,先去设置调上限")` 强提示(本地副本就要丢了!)

容量上限可调:[cache.js:setCapMB](../src/cache.js),默认 500MB,最低 50MB。存在 localStorage `jrb.cacheCapBytes`。

## auto-cache: openBook 时自动 Medium 入 IDB

每次 openBook(从 Graph 下载分支)都顺带写 cache (`pinned: false`):

```js
const { blob: downloaded } = await downloadItemBlob(item.id, ...);
blob = downloaded;
cache.set(item.id, blob, {
  name: item.name,
  folderPath: currentFolder,
  eTag: item.eTag,
  source: "onedrive",
  pinned: false,                    // Medium 级,可被 LRU
  accountId: getCurrentAccountId(),
}).catch(() => {});                 // 失败静默,有内存 blob
```

效果:
- 看过的书自然进 cache,**切回上一本秒开**
- pinned:false 让显式钉住的 / 本地唯一副本永远不被它挤掉
- 容量满时 LRU 自然淘汰最久没碰的(可能是几天前看过的那本)

LRU=N 而不是 LRU=1(N 由容量决定),实际体验:看过的 5-10 本都能秒开。

## ghost (constraint #5 落地)

详见 [02-cloud-conflict-policy.md](02-cloud-conflict-policy.md)。这里只记 cache 角色:

- `remoteFound: false` 是 ghost 标记,**不删 cache**(constraint #2)
- ghost 在书架显形,有 [再上传] [改名] [也从本地删] 三个动作
- promoteGhostToLocal: rekey 成新 `local:` id + source:"local" + pendingUpload:true,触发 drain

实现:[cache.js:markGhost / promoteGhostToLocal](../src/cache.js)

## freshness (constraint #6) 触发点

| 触发点 | 范围 | 函数 |
|---|---|---|
| `openBook` 缓存命中 800ms 后 | 单本(当前书) | `silentRefreshIfStale(itemId)` |
| `window.focus` 事件 | 全部 source:"onedrive" + 当前账号 | `syncAllCachedItems()` |
| `window.online` 事件 | 同上 | `syncAllCachedItems()` |
| 登录成功 1.5s 后 | 同上 | `syncAllCachedItems()` |

`silentRefreshIfStale`:
- `getItemMeta(itemId)` 拿云端 eTag
- 跟 cache.meta.eTag 不同 → 下载新 blob,**保留 pinned 状态**,覆盖 cache
- 当前正在读这本书 → re-load viewer 在 yFraction 位置,**不弹 toast**
- 404 / 403 → `markGhost`

参数 / 实现:[app.js:silentRefreshIfStale / syncAllCachedItems](../src/app.js)

## accountId 隔离 (换号场景)

每个 `source:"onedrive"` entry 在 cache.meta 上 stamp 当前账号的 MSAL `homeAccountId`。

- 登录后 `reconcileAccountSwitch`:遍历 cache,accountId 跟当前不一样的 → `markGhost`(让用户处置:再上传到当前账号 / 删本地)
- 列表显示:活的 onedrive 项过滤 accountId 隔离;鬼**不过滤**,跨账号孤儿也看得到

老 entry 没 accountId 字段:乐观 stamp 当前(假定是当前账号的)。

实现:[app.js:reconcileAccountSwitch / cache.reconcileWithRemoteList](../src/app.js)

## "本地文件" 虚拟文件夹

source:"local" 的项 + folderPath 不一定有意义(可能是 "__local__" 占位)→ 不放在 OneDrive 文件夹树里,统一放一个虚拟 "本地文件" 文件夹(在 root 列出来)。

label 反映状态:
- 已登录 + pendingUpload>0 → "本地文件 (3 待上传 / 5 项)"
- 未登录 / 全部不 pending → "本地文件 (5 项)"

点进去看到所有 source:"local",每个行的状态 (待上传 / 本地未上传 / 本地暂缓 / 重名) 由 tag 区分,见 [06-local-upload-flow.md](06-local-upload-flow.md)。

## 清缓存 UI (constraint #2 子条款落地)

设置面板有两个按钮:
- **清空未钉住**:只删 pinned:false 的。Top/High 保留。
- **清空所有缓存**:**强 confirm**,会删本地上传的(Top 级唯一副本)→ 数据丢失警告

[app.js:clearUnpinnedButton / clearAllCacheButton](../src/app.js)
[cache.js:clearAll / clearUnpinned](../src/cache.js)

## 边界 / 踩坑

### 1. quota 超出 (浏览器全局存储限制)

`indexedDB.put` 在浏览器全局存储满时抛 `QuotaExceededError`。我们的 capBytes 是软上限(用户自己设),硬上限是浏览器配额。

当前没专门处理硬上限。极端场景:用户把 cap 设 10GB,实际浏览器只给 5GB → put 抛错 → cache.set 返 false 的路径没覆盖这种(throws,不是 false)。改进 TODO:catch QuotaExceededError → 触发 ensureRoom 再试 / 提示 / 把 cap 自动下调。

### 2. 浏览器自动清 IDB (Safari / Edge / 私密模式)

浏览器在存储压力 / 7 天未访问 / 私密模式 / "Tracking Prevention" 等情况下可能清掉 IDB。我们在 app boot 时 `navigator.storage.persist()` 申请持久化(可降低被清概率),但**没法 100% 防**。

用户经验:有一天打开发现书都没了 → 是被浏览器清了。**这就是为什么本地副本要推到 OneDrive**(constraint #4 + 本 doc Top/High 永不淘汰**只是相对 LRU**,不防浏览器全局清)。

### 3. 用 cache.set 的 caller 全责传 source / pinned / accountId

cache.set 不知道是谁在调,默认 `pinned: true`。caller(uploadFiles / downloadAndCache / autoCache / promoteGhostToLocal)必须正确传所有 meta 字段。少传 accountId 就会变"无主"(在换号场景下被乐观 stamp 当前账号,可能错)。

参数列表纪律由 [app.js 各处 cache.set 调用](../src/app.js) 维持。集中 typing 检查不存在(纯 JS)。改进 TODO:加个 cache.setOneDrive / cache.setLocal 这种语义化 wrapper。

## 测试 checklist

- ☑ 拖一个 200MB 的 PDF,cap 设 100MB → alert 存储不够
- ☑ 缓存 10 本书,显式钉住 3 本 → 满了再开新书,3 本不被淘汰
- ☑ openBook 一本不在 cache 的书 → 后台自动 cache + 下次秒开
- ☑ 设置面板"清空未钉住" → 钉住的还在,自动 cache 的没了
- ☑ A 账号 cache 一本 → 登 B 账号 → 那本变鬼 → A 重登 → 鬼复活 (un-ghost)
- ☑ 在 OneDrive 网页改某本书 → 在 app focus → 静默 pull 新版,viewer 在原位置

## 相关

- [00-sync-constraints.md](00-sync-constraints.md) #2 4 级保护原则
- [02-cloud-conflict-policy.md](02-cloud-conflict-policy.md) — ghost / freshness 完整流程
- [06-local-upload-flow.md](06-local-upload-flow.md) — 本地 upload 进 Top 级的写入路径
