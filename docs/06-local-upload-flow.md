# 本地上传 + 推云 + 冲突处理

> [00-sync-constraints.md](00-sync-constraints.md) #4 (upload semantics) + #7 (collision) 的代码落地。
> 核心:**consent 不外推** — 用户拖文件时的登录状态决定后续行为。

## 状态字段(cache.meta 子集)

source:"local" 的 entry 有这些 flag 协同:

| 字段 | 含义 |
|---|---|
| `source: "local"` | 标识 "本地文件 / 没对应 OneDrive itemId" |
| `pinned: true` | 默认 true,**永不自动淘汰**(constraint #2,本地是唯一副本) |
| `pendingUpload: true/false` | drain 是否会推这条。看 [constraint #4 状态判定](#状态判定) |
| `uploadCollision: true/false` | drain 上次试推时云端有同名 → 阻止 push,等用户改名 |
| `uploadDeferred: true` | 用户显式 [暂不上传],不再 auto-retry,但保留本地副本 |
| `folderPath: "__local__"` | 占位值,表示"暂时只在本地,不在 OneDrive 文件夹树" |

实现 + 写入:[cache.js](../src/cache.js) 各 setXxx API。

## 状态判定 (constraint #4 consent scope principle)

`pendingUpload` 是不是 true 取决于**用户做出 upload 行为那一刻**的状态:

### 拖文件那一刻

```js
// uploadFiles:
const ok = await cache.set(localId, storedBlob, {
  source: "local",
  pinned: true,
  pendingUpload: isSignedIn(),  // ← 关键
  ...
});
```

- **登录时拖**:`pendingUpload: true` (隐式 consent: "登录的目的就是同步")
- **未登录时拖**:`pendingUpload: false` (consent 只覆盖 "在 app 里用此文件",**不**覆盖 "推到未来才连的云")

后果:
- 登录时拖 → 立刻试推 → 成功就 rekey 成 source:"onedrive";网失败留 pendingUpload:true,下次 drain 重试
- 未登录时拖 → 静默留本地 → 后续登录**不会**自动推。用户想推必须在行里点 [上传到云端]

理由:[00-sync-constraints.md](00-sync-constraints.md) 的 Consent scope principle —— consent 不外推。

### 第一次登录的 cross-state exception

```js
// main() 处:
const wasFirstTimeSignIn = !hasEverSignedIn();
rememberEverSignedIn();
if (wasFirstTimeSignIn) {
  cache.markAllLocalAsPending();  // 一次性
}
```

- `jrb.everSignedIn` localStorage 标记
- false → true 这一刻**且只此一刻** auto-promote 所有 source:"local" 为 pendingUpload:true
- 理由:"从未登过 → 现在登" = 用户首次开通云能力,可以合理推断包含"已有本地文件"

之后再登录 (包括换号) 不会再 auto-promote。

实现:[cache.js:markAllLocalAsPending](../src/cache.js)、[app.js:main 中的 hasEverSignedIn 检查](../src/app.js)

### 用户在 collision 里点 [暂不上传]

```js
// deferUpload(item):
await cache.setUploadDeferred(item.id);
// 内部: pendingUpload = false, uploadDeferred = true, uploadCollision = false
```

效果:
- 不再被 drain 选中(因为 pendingUpload:false)
- tag 显示 "本地(已暂缓)"
- 用户后续点 [上传到云端] → setPendingUpload(true) + 清 uploadDeferred → 重新进 drain 队列

实现:[cache.js:setUploadDeferred](../src/cache.js)、[app.js:deferUpload / uploadNow](../src/app.js)

## drain: 把 pendingUpload 推到云端

`drainPendingUploads()` 触发点:
- 登录成功 1.5s 后
- `online` 事件(网恢复)
- 本地改名后立刻
- 用户点 [上传到云端] 后

单飞守卫 `pendingUploadDraining`,避免并发。

```
drainPendingUploads():
  pending = listPendingUploads()         # filter source:"local" + pendingUpload:true
  
  # 预检 collision:一次性 list 当前账号根 (或子文件夹),做名字 set
  # constraint #7: 同名时 surface,不默默 rename
  rootList = await listChildren(BOOKS_FOLDER)
  existingNames = new Set(rootList.map(i => i.name))
  
  for m in pending:
    safeName = sanitize(m.name)
    if existingNames.has(safeName):
      setUploadCollision(m.itemId, true)  # 标 collision,UI 显示 "重名" tag
      continue
    try:
      item = uploadFileToApproot(path, blob, contentType, { conflictBehavior: "fail" })
      rekeyLocalToOnedrive(m.itemId, item.id, {...})  # local:xxx → 真 itemId
      migrateSessionDocId(m.itemId, item.id)          # session.docs 也搬
    except 409:
      # race: 列表后到 PUT 之间云端新增了同名 → 标 collision
      setUploadCollision(m.itemId, true)
    except network error:
      # 留 pendingUpload:true 不动,下次 drain 再试
```

`conflictBehavior: "fail"`(不 rename):**违反 constraint #7 的反面教材**就是 OneDrive 默认会自动给 "foo 1.txt" "foo 2.txt" 这类后缀,导致云端涌出重名副本(constraint #8 反对的)。要 surface 给用户处理。

实现:[app.js:drainPendingUploads](../src/app.js)、[graph.js:uploadFileToApproot 的 conflictBehavior 参数](../src/graph.js)

## collision 处理路径

```
collision 形成 (setUploadCollision):
   ↓
UI tag = "重名"  + 行 actions = [改名 ✎] [暂不上传 ⊖] [删除 ✕]
   ↓
用户选项:
  A. 改名 → cache.renameLocal 改 meta.name + 清 uploadCollision → drain 自动重试
  B. 暂不上传 → setUploadDeferred → tag 变 "本地(已暂缓)" → 不 auto-retry
  C. 删除 → cache.del + forgetDoc → 没了
```

cache.renameLocal 也支持 ghost (source:"onedrive" + remoteFound:false),那是 promoteGhostToLocal 之前的"先改名,再 promote"路径,见 [02-cloud-conflict-policy.md](02-cloud-conflict-policy.md)。

实现:[cache.js:renameLocal / setUploadDeferred / setPendingUpload](../src/cache.js)

## rekey: source:"local" → source:"onedrive"

push 成功后:
```js
await cache.rekeyLocalToOnedrive(localId, item.id, {
  name: item.name,
  folderPath: currentFolder,  // 真实云端文件夹路径
  eTag: item.eTag,
});
```

内部:
- 同事务把 blob 从 `local:xxx` key 搬到真 itemId key
- meta 改 source:"onedrive",清 pendingUpload / uploadCollision / uploadDeferred,加 eTag、accountId
- 删旧 local:xxx 项

**关键**:同事务 (`tx.objectStore.put + delete`) —— 防止中途崩了 blob 重复 / 双方都没的状态。

`migrateSessionDocId(localId, newId)` 把 session.docs 里的 position / kind / addedAt 搬到新 ID,session.lastActive 也跟着改。

实现:[cache.js:rekeyLocalToOnedrive](../src/cache.js)、[app.js:migrateSessionDocId](../src/app.js)

## tag UI 矩阵

行 tag 由 (isLocal, isPendingUpload, isCollision, isDeferred, isSignedIn) 决定:

| 状态 | tag |
|---|---|
| local + pendingUpload + collision | "重名" (橙) |
| local + pendingUpload (无 collision) | "待上传" |
| local + 已登录 + !pendingUpload + isDeferred | "本地(已暂缓)" |
| local + 已登录 + !pendingUpload + !isDeferred | "本地(未上传)" |
| local + 未登录 | "本地" |
| onedrive + ghost | "云端找不到" |

[app.js:tag 优先级判断](../src/app.js) 第一段。

## 行 actions 矩阵 (source:"local" 情况)

| 当前 flags | actions |
|---|---|
| 登录 + !pendingUpload | [上传到云端 ⬆] [改名 ✎] [删除 ✕] |
| pendingUpload + !collision | [改名 ✎] [暂不上传 ⊖] [删除 ✕] |
| pendingUpload + collision | [改名 ✎] [暂不上传 ⊖] [删除 ✕] (同上,但 tag 不同) |
| 未登录 (任何情况) | [改名 ✎] [删除 ✕] (没账号可推) |

行级 busy 锁:see [07-ui-patterns.md](07-ui-patterns.md)。

## 边界 / 踩坑

### 1. local:xxx 在 session.json 里被跨设备同步,B 设备看不到对应文件

A 上传一本 (local:abc),还没 push 就关掉。session.lastActive = "local:abc" 推到云端 (会推吗?如果 A 已 ceiling flush 是会的)。B 拉到 session 后试着开 local:abc → cache 里没 → graph.getItemMeta 404。

handler ([applyRemoteUpdate](../src/app.js)) catch 404 → 不切书,留在 B 当前书。等 A 上线 push 成功后 session 里的 ID 被 rekey → 下次同步 B 看到真 ID,能开。

### 2. drain 跑的同时用户操作

例:drain 正在推 file1,用户点 file2 的 [改名]。
- file1 的 push 不受影响(同事务,不被中途打断)
- file2 cache.meta 在主线程更新,等 drain 转到 file2 时拿到最新 name → 不会推错名字

如果用户点的是 file1 本身的 [暂不上传] →
- drain 当前 await 在 uploadFileToApproot 上
- 用户点击改变 cache.meta.pendingUpload=false
- 但 drain 这一轮已经过了 listPendingUploads 取 snapshot,**仍然会完成 file1 的推**
- 推完 rekey,source 变 onedrive,defer 标记已无意义

**这个不算 bug** —— 用户点 [暂不上传] 那一瞬间网络已经在传,数据已经在去云端的路上。让它完成符合"减少数据丢失"的优先级。

### 3. 第一次登录 auto-promote 跟换号 markGhost 的顺序

main() 里:
```
1. rememberEverSignedIn()
2. wasFirstTimeSignIn ? markAllLocalAsPending() : skip
3. reconcileAccountSwitch()  # ghost foreign accountId
4. drainPendingUploads (1.5s 后)
```

`reconcileAccountSwitch` 只动 source:"onedrive",不影响刚 markAllLocalAsPending 出来的 source:"local"。互不干扰。

如果是首次登录 → markAllLocalAsPending + 没换号(没历史 onedrive 项) → drain 推所有本地。是 first-time auto-promote 想要的行为。

## 测试 checklist

- ☑ 未登录拖 1 个 .txt → 显示 "本地",不试推
- ☑ 未登录拖完 → 第一次登录 → 自动推到云端
- ☑ 已登录拖 → 直接推,行从 "待上传" 短暂闪过 → 变云端项
- ☑ 已登录拖 + 云端有同名 → tag "重名",push 阻止
- ☑ "重名" 行点 [改名 ✎] → 改完自动重试推 → 成功
- ☑ "重名" 行点 [暂不上传] → tag "本地(已暂缓)"
- ☑ "本地(已暂缓)" 行点 [上传到云端] → 重新推
- ☑ 离线状态登录 + 拖一本 → pendingUpload:true 但 push 失败 → 上线后自动推
- ☑ 鬼态行 [再上传] → 转成 local:xxx → drain 推到当前账号

## 相关

- [00-sync-constraints.md](00-sync-constraints.md) #4 + Consent scope principle + #7 collision
- [02-cloud-conflict-policy.md](02-cloud-conflict-policy.md) — 鬼可以经 promoteGhostToLocal 进入本流程
- [05-cache-strategy.md](05-cache-strategy.md) — pinned:true 让本地副本永不被 LRU 淘汰
