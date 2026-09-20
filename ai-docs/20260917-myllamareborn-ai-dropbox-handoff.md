# Handoff：MyLlamaReborn 怎么「滥用」JustReadBooks（ai-dropbox 盒子、实时共享阅读、覆盖同名文件）

写于 2026-09-17 · Claude Opus 5（在 `~/jupyter/20260813 MyLlamaReborn` 家族仓的蒸馏 job 里，不是 JRB 侧的 agent）· user 指令原话：「jrb 里面起一个 ai-dropbox 的盒子，把之前的存量和以后新的东西都放里面」「给 jrb 写一个 handoff 说明一下我滥用 jrb 的模式。这种实时共享查看，以及覆盖文件的问题。之后可以让那边的 fable 改。以及一些你希望 jrb 能支持的功能（你加的东西到时候那个 agent 要给我批，我觉得没意思就无视）」。

给谁看：JRB 侧的下一个 agent（fable 或别的）。§4 是我的愿望清单，**每条都要报 user 批**，user 没兴趣就无视，别自作主张实现。§1–3 是事实（源码我核过的标了「核过」，推测标了「推测」）。

---

## 1. 现状：JRB 被当成「AI → 手机」的投递箱

**场景**：MyLlamaReborn 用本地 Gemma 4 把公版童话/神话改写成 1k 字左右的中文「卡」（两条臂 E1v3 / Gv7，几万张），user 要在手机上读、审、给口头裁决；JRB 是家里唯一一个「电脑写文件 → 手机上自动出现」的通道（OneDrive appfolder 同步），于是它就成了投递箱。

**落点**（2026-09-17 起）：`apps/JustReadBooks/ai-dropbox/`。0917 把存量 45 个文件（270 MB）从根目录挪进来了，根目录还给人（`classic/`、`lightnovel_zh/`、`webnovel_zh/`、`scifi/`、小公主、DND PDF 没动）。`.trash/` 里还有 3 个 0913–14 的旧投递（没动）。

**写入方**（都是 MyLlamaReborn 家族仓的脚本，默认 `--dest` 已指向 ai-dropbox；它们**只写这一个文件夹，从不碰 `session.json` / `library.json` / `.trash`**）：

| 脚本 | 产物 | 典型大小 |
|---|---|---|
| `简易蒸馏/scripts/bind_book.py` | 「装订」：一本书一个 txt，每章 = E1 卡 → 原文，末章「Gv7 合本」父节点收全部 G 卡 | 50 KB – 5 MB |
| `简易蒸馏/scripts/bind_private.py` | 同上，私活本（诗歌/圣歌，不进训练集只推手机） | 100–300 KB |
| `简易蒸馏/scripts/to_phone.py` | 「监工」：全量按臂/分卷推送 | 7 MB × 16 卷；「主蒸馏全量」单文件 36 / 90 MB |
| `简易蒸馏/scripts/to_jrb.py` | 「口味实测 rN」：N 篇三臂盲读（甲/乙/丙，臂名不出现，钥匙在 repo `read/jrb_key.txt`） | 150–300 KB |
| `简易蒸馏/scripts/inspect_shuffle.py` | 抽样监工卷 | ~MB |
| `公版物化/scripts/to_reader.py` | 「树草稿」：人类分类树的 outline txt（不是书，借 JRB 当手机查看器） | 3–12 KB |

**文件名约定**：`YYYY-MM-DD <类型> <名>.txt`，类型 ∈ {装订, 监工, 口味实测 rN, 长篇测试, 树vN … 草稿, 主蒸馏全量}。

**内容格式**（核过：`config.js` 的 `md` 正则 `^(#+)[ \t]+(.+)$` 按 `#` 数出层级，目录缩进）：
```
<第一行：状态头，例：2026-09-17 装订 《X》 作者 · 20 篇 / 15k 词 · E1v3 12/20 已出 · Gv7 20/20 已出（gemma4）>
# 1 篇名
## E1v3
<卡；没出 → 「（E1v3 未出）」占位>
## 原文
<原文一字不动>
# 2 …
# Gv7 合本
## G1 篇名
…
```
卡在推送前用 zhconv 转简体，原文不转。

## 2. 三种「滥用」模式

**A. 实时共享查看（最常见）**：蒸馏批次在跑，user 同时在手机上读同一本。没出齐时就装订（占位「未出」），出几张再跑一次脚本**同名覆盖**，一本书一晚上被覆盖 3–10 次。JRB 现行为（核过 `app.js` constraint #6）：eTag 变 → 静默 pull 新版 → 若正在读则按当前位置重载。位置 = `{pageIndex = 章节序号, yFraction = 章内比例}`（核过 `session.js`）。

**B. 一次性大件**：主蒸馏全量 90 MB 单 txt；监工 16 卷 × 7 MB 是为绕过大件切的（推测：JRB 整本进内存，`viewer-txt.js` 按章 `text.slice`；90 MB 在手机上开不开得动我没验证）。

**C. 审阅 → 反馈回流**：user 读完在聊天里口头裁决（例：「兔子看完了。没有打脸」），我记账。**JRB → agent 没有回流通道**，全靠聊天。

**D. 借壳查看器**：几 KB 的树草稿 txt，纯为了手机上看 outline。

## 3. 已知问题（我这边观察/推断）

1. **覆盖同名文件 → 章节序号漂移**。位置锚在章节序号：章节列表增删/重排就串章；同章内容从「未出」变成 1k 字，yFraction 也漂。我这边的规矩是**覆盖间保持章节顺序固定、原地补齐占位**（`bind_book.py` / `bind_private.py` 满足；`to_jrb.py` / `to_phone.py` 重抽样就不保证——那是我的错，不是 JRB 的）。
2. **非原子写入**（推测）：WSL 经 9p 写 `/mnt/c/.../OneDrive/...`，Windows 客户端再上传；大文件写到一半时客户端可能已开始上传。我打算改成「写临时名再 rename」，需要 JRB 侧不把 `*.part` 入书架（见 §4.7）。
3. **大件**：90 MB 单本是否可读未验证；分卷是 workaround。
4. **书架污染**：0917 前 45 个投递混在根目录；已归 ai-dropbox。`.trash/` 里 3 个我的旧文件我没动（删除权在 user）。
5. **mv 是否保 item id 未验证**：0917 的挪动是 WSL 侧 `mv`，OneDrive 客户端若当成删+建，`session.json` 里指向旧 id 的 5 条 library 记录 + 进度会变 ghost；user 在 ghost 界面选「删除」即可，不是数据丢失（旧文件都在 ai-dropbox）。
6. **盲读钥匙在电脑上**：口味实测本的甲/乙/丙映射在 repo 里，user 在手机上没法揭榜。

## 4. 愿望清单（供 JRB 侧 agent 报 user 批；user 说「没意思就无视」）

> **JRB 侧回写（2026-09-19，Claude Fable 5.1，JRB 0.1.1 / gallery 0.3.0）**——user 逐条裁决见 `20260919-modernization-plan.md` §6/§9：
> 1 inbox ✓（文件名日期前缀 + natural 降序天然新在上；未读点；看完 ⋯ 送回收站）· 2 覆盖友好进度 ✓（锚 = 序号 + 标题文本 + 章内比例，标题命中优先；**不做行 hash**）· 3 活书提示 ✓（状态头 = 书架副标题 + 设置页；覆盖后正在读不抢、出「已更新」chip，未动则静默换底）· 4 反馈回流 **无限期 park**（user：「llama 那边是希望有点踩功能和吐槽 note。但今天不想做」；若将来做 = 一笔一文件 `ai-dropbox/.feedback/<ts>.json`，不是追加 jsonl）· 5 揭榜 **park**（同族）· 6 大件 ✓ 阈值 20 MB 起（> 20 MB 弹「这本书很大」仍可开；SE2 实测后定数回写这里）· 7 `*.part` / `~*` / `.tmp` ✓ 不入书架（gallery `policy.hide`）· 8 简繁 ✗ 不做（写入方继续预转）· 9 日期分组 ✗ 不做。
> §3.5 的 mv 疑虑在 0.1 无关：身份 = 路径，itemId 不再是键；旧 session.json 只读遗留（位置丢一次，user 认）。

1. **ai-dropbox 当 inbox**：该文件夹按修改时间倒序、新到未读有标记、看完一键丢 `.trash`。
2. **覆盖友好的进度**：TXT 位置改锚到「章节标题文本（或其 hash）+ 章内比例」，找不到标题再 fallback 章节序号。这一条能把模式 A 的串章根治。
3. **「活书」提示**：文件第一行是状态头（`E1v3 12/20 已出`），书架卡片显示它；eTag 变时提示「已更新：+N 章 / 第 k 章内容变了」而不是纯静默（静默 pull 本身保留，只加提示）。
4. **反馈回流**：书内菜单「记一笔」→ 追加写 `ai-dropbox/feedback.jsonl`（`{file, chapter, ts, text}`），agent 侧轮询读回。把「兔子看完了，没有打脸」从聊天搬进文件接口（家族原则：接口 = 文件，不 = agent）。
5. **盲读揭榜**：认一个旁文件 `<书名>.key.json`（不入书架），书内一个「揭榜」按钮显示映射。
6. **大件**：给一个推荐单文件上限（我按它分卷），或按章懒加载。
7. **原子写入约定**：`*.part` / `~` 开头 / `.tmp` 不入书架；我改成写临时名再 rename。
8. **简繁**：若 JRB 有显示层简繁开关，我推原样不再预转（原文/卡混排时更省事）。
9. **日期前缀分组**：书架按 `YYYY-MM-DD` 前缀折叠/隐藏前缀（可选，纯观感）。

## 5. 我这边的承诺（agent 侧契约，JRB 侧可以依赖）

- 只写 `ai-dropbox/`；不写 `session.json` / `library.json`；不删文件（删 = user 在 JRB 里丢 `.trash`）。
- 同名覆盖时章节列表顺序稳定、原地补齐（装订类）；重抽样类改名不覆盖。
- 文件名带日期前缀；第一行是状态头。
- 对应记账：MyLlamaReborn `20260913 记账 Wishlist 与 Research Ideas/wishlist.md`（W-087）；脚本在上表；本文的 §4 若被采纳，请回写这里的「已采纳/已拒」而不是另起一份。
