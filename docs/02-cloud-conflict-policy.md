# 云端冲突策略 + cache.meta 状态机

> [00-sync-constraints.md](00-sync-constraints.md) 的约束 1-8 是跨项目共通的;
> **冲突解决策略**因每个 app "用户是否在 app 内编辑内容" 不同而不同。
> 本文档记本 app 的选择,以及为什么和 sibling 不一样。

## sibling apps 对比

| App | 用户在 app 内改内容? | 冲突策略 |
|---|---|---|
| webxiaoheiwu | ✅ 笔记应用 | dirty-tracking;412 If-Match 冲突 → 把本地 dirty 当 sibling 存到云端,然后远端 reload 进当前 doc。**两份版本都保留** |
| RealHome | ❌ artist 在 Blender 导出 glb | etag 不一致 → 直接 re-fetch 盖本地 cache |
| **JustReadBooks** | ❌ **纯阅读器** | **etag 不一致 → 静默 auto-pull;本地副本直接被云端新版盖** |

理由:阅读器内永远不写,所以本地 cache 100% 等于"上次从云端下来的 bytes"。云端有更新 = 用户主动改的。0 数据丢失风险,不用 toast 问。

## cache.meta 一个 entry 的完整状态机

```
source: "local"         (用户本地上传,云端没这个 itemId)
  ├─ uploadCollision:true   "重名" 冲突,阻止 drain push,等用户本地改名
  └─ uploadCollision:false  "待上传",drain 推到 OneDrive
                            ↓ push 成功 rekey →

source: "onedrive"      (有对应 OneDrive itemId,记录了 accountId 表示属于哪个账号)
  ├─ remoteFound:true 
  │   ├─ eTag 一致      fresh,啥也不做
  │   └─ eTag 不一致    silentRefreshIfStale 静默 pull (constraint #6)
  └─ remoteFound:false  "云端找不到" 鬼态,触发原因有三:
                          1. 用户在 OneDrive 网页删了
                          2. 用户挪到另一文件夹 (下次列那文件夹 → 自动 un-ghost)
                          3. 换号了 accountId 不匹配 → reconcileAccountSwitch 标鬼
                        用户在书架 ghost 行有三个动作:
                          - 改名 (改 meta.name,不动云端)
                          - 再上传 (promoteGhostToLocal → drain push 到当前账号)
                          - 也从本地删 (cache.del,彻底清掉)
```

### 重要不变式

- **进鬼可逆**: list 再看到该 itemId → 自动 un-ghost + 更新 folderPath
- **源进保留**: source:"local" 不会变成 ghost (它根本没"云端身份");ghost 也不会"自己"变成 source:"local",必须用户点 [再上传]
- **改名只动本地**: cache.meta.name 写;不调 Graph PATCH (除非是活的 onedrive 项)
- **eTag 是 freshness 判断的唯一信号**: 没 eTag 不做 silentRefresh

### 鬼语义稍微滥用 — 接受

鬼当前承担 3 个不同物理场景(云端删 / 云端挪 / 换号)。功能上动作一致(再上传/改名/删),所以共享一个 flag 没问题。UI 文案做中性化("云端找不到",不写"被删了")。

## 模块 API

### silentRefreshIfStale(itemId)
- 检查 source:"onedrive" + remoteFound:true 项的 eTag 是否跟云端一致
- 一致 → 跳过
- 不一致 → 下载新 blob,覆盖 cache,**保留 pinned 状态**;如果用户正在读这本书 → 重 load viewer 在当前 position (yFraction 保留,极端情况下 TXT 章节切分变了 pageIndex 会漂,接受)
- 404/403 → `cache.markGhost(itemId)`,不删 cache,UI surface 让用户处置
- 别账号的项 (accountId 不匹配) → 跳过 (留给 reconcileAccountSwitch 处理)

### syncAllCachedItems()
- 遍历所有 cache.meta 里 source:"onedrive" + remoteFound:true 的项,每个跑 silentRefreshIfStale
- 顺序执行(本地用户场景 cache 一般 < 50 项)
- 触发点:focus / online / signin 后 1.5s

### reconcileAccountSwitch()
- 登录成功后立刻跑
- cache.meta 里 source:"onedrive" + accountId 跟当前账号不一样的 → markGhost
- accountId 未 stamp 的(老数据)留给 reconcileWithRemoteList 在下次列文件夹时乐观打上

### cache.reconcileWithRemoteList(items, folderPath, currentAccountId)
- 每次 listChildren 后调
- 更新已知 items 的 name / eTag / folderPath
- accountId 没 stamp 的 → 乐观打上 currentAccountId
- un-ghost: list 里看到 itemId 就清 remoteFound:false
- ghost: cache 里在该 folderPath 的当前账号项不在 list 里 → markGhost
- **空 list 安全网**: list 返回 [] 但 cache 里这文件夹本来有 N 项 → 不批量鬼

## Accountless 体验(纯本地模式)

**核心前提**: app 在没登录 OneDrive 时一样能用。`hasEverSignedIn()` 决定是否尝试 silent auth — 从未登过 → 完全跳过 MSAL,纯本地路径。

### 每个流程怎么 work:

| 流程 | accountless 表现 |
|---|---|
| 启动 | jumpscareLocal 读 localStorage session backup,直接打开上次的书。`isAuthConfigured()` true 但 `hasEverSignedIn()` false → 跳过 silent auth,直接进本地路径 |
| 上传 | `uploadFiles` 先入 cache (source:"local")。`isSignedIn()` false → 跳过 OneDrive push 分支,留 source:"local" pinned:true,显示 "本地" tag |
| 打开本地书 | `cache.getBlob` 命中,载入 viewer,position 从 session 来 |
| 阅读位置存盘 | session.js 的 scheduleWrite 检测 `isAuthConfigured() && hasEverSignedIn()` (实际是 isAuthConfigured 短路) → 直接写 localStorage,不调 Graph |
| 章节切分偏好 | library.js 也走 localStorage 备份,不上 Graph |
| Freshness | `silentRefreshIfStale` / `syncAllCachedItems` / `drainPendingUploads` 第一行都是 `if (!isSignedIn()) return`,自动跳过 |
| 鬼 | 不在书架显形(merging 在 `if (isSignedIn())` 块内)。已经存在的鬼 entry 留在 IDB,占空间但不打扰用户。下次登录后 surface |
| 缓存设置面板 | 完全可用 (上限调整 / 清未钉住 / 清全部) |
| 字号 / 行高 / 主题 / 章节正则 | localStorage,本地完全可用 |
| PDF / TXT viewer | 完全离线 (pdf.js + cmaps + standard_fonts 都 vendor 在 repo) |
| 键盘 / 手柄快捷键 | 跟有账号一样 |

### 累计场景

- **从来没登过 → 上传一堆本地书 → 一直读**:
  全程不碰 MSAL。书都是 source:"local" + pinned:true,永远不被淘汰 (constraint #2)。
- **本地用了几个月后第一次登录**:
  `reconcileAccountSwitch` 检测到 accountId 全部未 stamp,什么都不做。`drainPendingUploads` 把所有 source:"local" 推到当前账号,**rekey 成 source:"onedrive"**。本地副本无丢失;新账号现在有完整副本。理想流程。
- **不同账号交替使用**:
  账号 1 上传 + push 后,登出。登录账号 2。先前的 onedrive entries (accountId=1) 被 `reconcileAccountSwitch` 标鬼。书架显示为 "云端找不到",用户可以 [改名再上传] (把内容带到账号 2) 或 [也从本地删]。
- **离线 → 上传 → 重新上线**:
  上传到 cache (source:"local")。重新上线 / focus 触发 `drainPendingUploads`,先 list 当前账号目标文件夹 → 预检名字冲突 → 没冲突就 push;有冲突就标 uploadCollision,用户改名后再 drain。

### accountless 不支持的

- ❌ 跨设备同步阅读位置 (session.json 是云端的)
- ❌ ghost 在 UI 看见 / 处置 (要登录才 surface)
- 这两件事都需要 OneDrive,本质上无解;UI 不强推用户登录,只是设置面板有 [登录] 按钮可选

## 跟 #7 collision 的关系

#7 collision 处理 "**本地** 等待上传 + 云端已有同名" 的情况:
- 阻止 push,标 uploadCollision
- 用户本地改名后清 flag + 重试 drain

跟 #6 freshness / ghost 完全不同语义,两个流并行。**但**鬼可以 promote 到 source:"local" 后走 #7 流程(等于 "再上传,撞名,改名,再传")。
