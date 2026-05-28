# 跨设备阅读同步

> 用户在 A 设备读《诡秘之主》到第 137 章 50% 处,合上 → 在 B 设备打开 → **应该立即看到 137 章 50%**,不是上次 B 看过的别的位置 / 别的书。
>
> 这是产品承诺。本 doc 讲怎么做到的。

## 范围:什么同步,什么不同步

| 项目 | 同步? | 存哪 |
|---|---|---|
| 当前在看哪本书 (`lastActive`) | ✅ | `approot/session.json` |
| 每本书的阅读位置 `{pageIndex, yFraction}` | ✅ | `approot/session.json` |
| 章节切分偏好 (chapterRegexId / custom / encoding) | ✅ | `approot/library.json` |
| 本地缓存的书 (PDF/TXT blob) | ❌ | IndexedDB,纯设备本地 |
| 字号 / 行高 / 阅读宽度 / 字体 / PDF zoom | ❌ | localStorage,**设备属性**,不应跨设备 |
| 主题(日/夜/跟随系统) | ❌ | localStorage,设备/眼睛属性 |
| 缓存上限 (MB) | ❌ | localStorage,设备存储容量决定 |

**核心理念**: 跨设备同步**"我读到哪了"**,**不**同步"我喜欢用什么字号看",因为屏幕大小、眼睛、阅读距离都设备相关。

## 位置坐标:`{pageIndex, yFraction}`

不是像素,不是字符偏移 —— 是**文档坐标**。

- **PDF**:`pageIndex` = 页号 (0-based),`yFraction` ∈ [0, 1] 是该页内的纵向比例
- **TXT**:`pageIndex` = 章节序号 (0-based),`yFraction` ∈ [0, 1] 是该章 DOM 内的纵向比例

为什么这么选:
- PDF 同一篇文档在不同设备 (手机 vs 桌面) zoom 不同,viewport 像素不可比。文档坐标对所有 zoom 都成立。
- TXT 在不同设备字号、行高、屏幕宽度都不同,但**章节序号是稳定的** (前提是章节切分规则没变,见 [04-txt-chapter-splitting.md](04-txt-chapter-splitting.md))。yFraction 是 DOM 内的比例,字号差异不大时近似可比。

**阅读线锚点 (reading-line anchor)**:viewport 高度的 25% 处。位置 = "这条线穿过的内容"。恢复时把那一行内容滚到 25% 处。25% 而不是 0 (顶部) 因为顶部内容用户已经读过,25% 落在"用户当前的眼睛"上。

参数:[config.js:READING_LINE_ANCHOR](../src/config.js)

## session.json schema

```json
{
  "lastActive": "01ABCXYZ..."        // OneDrive itemId 或 "local:xxx"
                                      // 用户当前在读的书
  "docs": {
    "01ABCXYZ...": {
      "position": { "pageIndex": 137, "yFraction": 0.5 },
      "kind": "txt",                  // "pdf" | "txt"
      "addedAt": 1716544800000        // 第一次开这本书的时间
    },
    "local:abc.xyz": { ... }
  }
}
```

设计选择:
- **不**存文件名、文件路径 → 用户改名 / 挪目录不需要同步 session
- **不**存阅读偏好(字号等) → 设备属性
- doc key = itemId(云端) 或 `local:xxx`(本地,见 [06-local-upload-flow.md](06-local-upload-flow.md))

## 写盘节流:debounce + ceiling + trivial-skip

**问题**:每次滚动都触发 Graph PUT → OneDrive 版本历史塞爆 + 限流 + 电池开销 + 网络浪费。

**解法**:三层 throttle。

### 1. trivial-skip(微动忽略)

跟上次成功推到 OneDrive 的位置比:
- 同页 (`pageIndex` 相等) **且** `|yFraction Δ| < 阈值` → **不调度 PUT**,只更新内存
- 标 `dirty=true`,等 `flushKeepalive`(关页 / 切后台)时顺手带上

阈值:
- PDF: 0.5 (页内一半)
- TXT: 0.05 (章节内 5%) — TXT 一章可能很长,0.5 太大

参数:[config.js:TRIVIAL_POSITION_Y_DELTA / TRIVIAL_POSITION_Y_DELTA_TXT](../src/config.js)

### 2. debounce(空闲后写)

非 trivial 改动 → 重置 10s 倒计时。期满 → PUT。中间又改 → 重置。

### 3. ceiling(封顶强推)

从第一次 dirty 起,**30s 封顶**。一直滚也保证 30s 内推一次,不让 dirty 堆到无限。

参数:[config.js:POSITION_DEBOUNCE_MS / POSITION_HEARTBEAT_MS](../src/config.js)

### 4. lastActive 立即推

切书 (`setLastActive`) → `scheduleWrite(0)` 立刻 PUT,不等 debounce。
理由:其它设备能马上同步到"我在读这本"。

实现:[session.js:setPosition / scheduleWrite](../src/session.js)

## merge 策略:**按时间戳** per-field LWW

**演化历史**:早期用"remote 当 base + local 活跃 doc 覆盖" — 假设 local 总比 remote 新。
**这是错的**:老设备离线 2 天后上线,local 是**旧的**;它的"活跃 doc"用陈旧 position
覆盖 remote 的新 position → 用户在 B 设备的进度丢。

现行方案:**每条 position / lastActive 各带一个时间戳**,merge 时按时间戳分胜负。

### Schema 新字段

```json
{
  "lastActive": "01ABC",
  "lastActiveAt": 1716544800000,         // ← 新
  "docs": {
    "01ABC": {
      "position": { "pageIndex": 200, "yFraction": 0.5 },
      "positionAt": 1716544800000,        // ← 新
      "lastReadAt": 1716544800500,        // ← 新 (最近一次打开)
      "kind": "txt",
      "addedAt": 1716000000000
    }
  }
}
```

- `positionAt`: 每次 `setPosition` 自动打戳
- `lastActiveAt`: `setLastActive` 自动打戳
- `lastReadAt`: `markDocRead` 在 openBook 时打,用于"最近阅读" list 排序

老 schema 缺这些字段 → 算 0(永远输给有时间戳的新写入)。

### mergeByTimestamp 算法

```
mergeByTimestamp(local, remote):
  for id in (local.docs ∪ remote.docs):
    if only local has it: out[id] = local.doc
    elif only remote has it: out[id] = remote.doc
    else:                  # 双边都有
      winner = positionAt 大的那边
      out[id] = {...loser, ...winner}   # winner 字段覆盖
      out[id].addedAt = min(both)        # 最早加入时间
      out[id].lastReadAt = max(both)     # 最近读时间
  
  lastActive:
    use the side with larger lastActiveAt
```

**关键不变式**:更新的(更大的 timestamp) 永远赢。**老设备的陈旧 position 不会
覆盖新进度**。

两处地方调:
1. `mergeRemoteAndRetry` (412 冲突时,跟之前的语义一样,只是改了算法)
2. `initSession` (新场景,见下)

### 触发场景 1: 412 If-Match 冲突

跟原来一样:A 写完 v2,B 拿 v1 写 → 412 → re-fetch remote + mergeByTimestamp + retry。

如果再 412 → 标 dirty,下轮重试。

### 触发场景 2 (新): initSession backup ⨁ remote

之前的 bug:登录后 `initSession` 拿到 remote 就 **overwrite** state(直接 = remote)。
但 backup 里可能有更新的进度(用户刚在本地模式读过,登录前还没 push)→ **丢**。

修法:`initSession` 也调用 mergeByTimestamp:

```
initSession():
  hydrate state from localStorage backup
  if !signed in: return (本地路径)
  read remote
  if both: state = mergeByTimestamp(backup, remote)
           if merged != remote: schedule push  # 把 backup 里的新进度推上去
  elif only remote: state = remote
  elif only backup: push backup to cloud (远端是空)
  else: 写空 session.json
```

实现:[session.js:mergeByTimestamp / initSession / mergeRemoteAndRetry](../src/session.js)

## localStorage backup(离线兜底)

每次 mutation 同步写 `localStorage["jrb.session.backup"]`(JSON.stringify 后)。`flushKeepalive` 也写。

为什么:**冷启动 + 离线**时(关掉 wifi 重开 app),Graph 拉不到 session。但 localStorage backup 还在 → 立刻能 hydrate state → 立刻能开上次的书。

`initSession` 顺序:
1. 先 hydrate localStorage backup(若有)→ state 立刻可用
2. 再试 Graph readApprootJson → 若成功,**overwrite** state(云端是 SSOT)
3. 若 Graph 失败(离线 / 限流 / 网络)→ 静默,留着 backup hydrate 的 state 继续用

`library.json` 同样套路。

实现:[session.js:initSession + writeLocalBackup](../src/session.js)

## 启动序列 ("jumpscare"):立刻回到上次的书

抄自 JustReadPapers 的"扼杀选择困难症"模式。**核心**:打开 app = 直接看上次那一页。**不**让用户先挑书。

```
main():
  1. 同步:initPdfViewer(只挂 DOM 引用,pdf.js 库懒加载) + initTxtViewer
  2. await Promise.allSettled([initSession(), initLibrary()])
       initSession 内部:hydrate localStorage backup → 试 Graph → reconcile state
  3. jumpscareLocal():
       lastId = state.lastActive
       if cache.getMeta(lastId) 命中 → **立刻** openBook,viewer 出来
  4. 决定是否尝试自动登录(constraint #1 + hasEverSignedIn)
  5. 后台 initAuth (silent probe) → 登成 → 后台 reconcileOnFocus 静默 pull session
       → 如果远端 lastActive 跟本地不一样 → 静默切书 (见下)
```

性能特性:
- 第 3 步是**同步路径**(IDB 读 + viewer 渲染),典型 < 200ms。用户感觉"瞬开"
- 第 4-5 步全异步,**不挡 UI**
- 离线 / 没登过 / 没缓存 → 还是该有的状态,不会卡

实现:[app.js:main / jumpscareLocal](../src/app.js)

## focus 静默 auto-pull(本 doc 最关键的部分)

用户在 A 设备读到 137 章 → 关掉 → 拿起 B 设备 → 打开 app 触发 `focus` 事件。

```
reconcileOnFocus():
  if not signed in: return
  folderItemsCache.clear()                  # 列表可能也变了
  changed = await checkRemoteChanged()       # eTag 比对 session.json
  if changed:
    await applyRemoteUpdate()                # 静默 apply,不弹 toast
  syncAllCachedItems()                       # constraint #6 freshness 顺便扫

applyRemoteUpdate():
  await reloadFromRemote()                   # pull session.json,state 已是新的
  if state.lastActive !== currentDocId:
    item = cache.getMeta(lastActive) || await getItemMeta(lastActive)
    await openBook(item)                     # 静默切书
  else:
    # 同书,位置变了 (B 也在读同一本但翻页了) → 静默 restorePosition
```

为什么**静默**而不弹 toast:
- 我们这边只读(constraint #4 + [02-cloud-conflict-policy.md](02-cloud-conflict-policy.md))。本地没"用户编辑"要保护。
- 弹 toast 说 "云端有更新 [同步]" → 用户必须主动点 → **同时显示着旧书 1 秒+**。用户的本能反应"我打开的是旧的吗?"。distracting。
- 直接切到云端最新 → 0 干扰,符合用户预期"我刚在另一台看的应该出现"。

参数:`reconcileOnFocus` 由 `window.focus` 事件触发 + main 完成后 1 秒延迟 fire 一次。

实现:[app.js:reconcileOnFocus / applyRemoteUpdate](../src/app.js)

## flushKeepalive: 关页前最后一次推

用户关 tab / 切后台 / iPhone home button → 触发 `beforeunload` / `pagehide` / `visibilitychange→hidden`:

```js
fetch(..., { keepalive: true })   // 不 await,浏览器保证发出去
```

`keepalive: true` 让浏览器在 tab 关后仍然完成请求。

trivial-skip 攒下来的"内存里 dirty 但没推的位置"在这里被 flush。**保证用户合上 app 那一刻的位置一定会被发出去**(即使 ceiling 还没到 30s)。

实现:[session.js:flushKeepalive](../src/session.js)

## 边界 / 踩坑

### 1. lastActive 跨设备指向"local:xxx"

A 设备上传本地文件,push 还没成功 → session.lastActive = `local:xxx`。同步到 B → B 不认识这个 ID。

处理:`applyRemoteUpdate` 先看 cache(B 上没这个 local: id),再降级 Graph(`getItemMeta("local:xxx")` → 404,catch 忽略)。结果:B 静默保留当前书,不切。等 A push 成功后 session 里的 `local:xxx` 被 `migrateSessionDocId` 改成真 itemId,下次同步 B 才能切。

### 2. 章节切分变了,pageIndex 跑偏

A 在云端 library.json 改了 `chapterRegexId`(从"第N章"换"###")→ B 同步过来,新切分下章节数变了。

老的 `pageIndex` 落在新切分下可能指错章。yFraction 还相对正确(章节内比例)。

接受这个代价。constraint #6 在 [02-cloud-conflict-policy.md](02-cloud-conflict-policy.md) 有说明。极端情况下用户跳一下重新定位,人机协同。

### 3. 同时双开

两台设备同时阅读同一本书 → setPosition 互相 412 → merge 后只有"最后一个 ceiling 推上去的"赢。视觉上看是"对方的位置突然把我跳过去"。

频率极低(双开同一本书是边缘场景),不专门处理。靠 merge 兜底,不丢数据。

### 4. (历史 bug,已修)localStorage backup 比远端新被 overwrite

老代码:initSession 单方面用 remote overwrite backup hydrate 的 state → backup 里
没 flush 的新进度丢。修法:initSession 现在用 `mergeByTimestamp` 双向合并,
backup 比 remote 新的字段会被保留 + 推回云。详见上面 "触发场景 2"。

### 5. 时钟漂移影响时间戳 merge

不同设备的本地时钟可能差几秒到几分钟。极端场景:A 设备时钟超前 1 小时,A 写 position
时 positionAt 比真实 1 小时后才写的 B 还大 → B 推 412 → merge → A 的"陈旧"
position 反而赢。

接受这个风险:正常用户场景下时钟漂移在分钟级以下,本 app 的 debounce ceiling 是
30s,跨设备 merge 频率不会高到放大时钟问题。

需要更稳的话:用 Graph 的 `lastModifiedDateTime` 服务器时间当 ground truth,
不依赖本地 Date.now()。**没做**(复杂度高,收益不成比例)。

## 测试 checklist

- ☑ 设备 A 翻一章 → 等 11s 看 OneDrive 网页里 session.json 是否更新
- ☑ 设备 B 打开 app → 自动跳到 A 的最后位置(秒级,不弹 toast)
- ☑ A B 都开 → A 翻 → 关 A → 焦点切到 B → B 自动跳
- ☑ 离线状态拖一本书读到一半 → 上线 → 等 ceiling 之后 OneDrive 出现 session.json
- ☑ 飞行模式打开 app → 仍能开上次的书(localStorage backup)
- ☑ A 切书 X → Y,500ms 内关掉 → B 打开应该看到 Y

## 相关

- [00-sync-constraints.md](00-sync-constraints.md) — cross-project 设计准则
- [02-cloud-conflict-policy.md](02-cloud-conflict-policy.md) — 为什么静默 pull,不弹 toast
- [05-cache-strategy.md](05-cache-strategy.md) — IDB 缓存,纯设备本地不同步
- [06-local-upload-flow.md](06-local-upload-flow.md) — `local:xxx` ID 是什么,push 后 rekey
