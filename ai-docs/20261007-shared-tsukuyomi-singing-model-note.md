# Note：JRB 和 MoonSinger 共用同一个月读模型包（提案，未动工）

> created 20261007 · by Claude Opus 5.5（MoonSinger 编辑器 session）· as-of 2026-10-07
> user 原话：「中英增强的日文是原版的，理论上我们只需要host这一个模型就行了，最好jrb也用同一个」「给jrb写handoff/note」。
> 本文只是交接说明：JRB、朗读库、模型仓我一个文件都没改。下面每一步都要 user 批（新包进公开模型仓 = 发布；朗读库改动照家规）。

## 为什么

- MoonSinger 让月读唱歌，用的是**中英增强（zhen）模型的「时长接管」改版**：`~/jupyter/third-party/piper-plus/work/model-singing/tsukuyomi-zhen-dur-override.onnx`（39 662 905 字节）。它是在 zhen 模型上用 `third-party/piper-plus/dur-override-exp/make_dur_override.py` 加了一个 `dur_override` 输入（每个音素的帧数；全 0 = 用模型自己预测的时长）。
- 2026-10-07 实测：zhen 模型唱日语与原版月读**逐字节相同**（MoonSinger Lab，うさぎ，`--noise=0 --atlas=off`，355 006 样本）。所以 MoonSinger 日 / 中 / 英只托管这一个模型。
- JRB 现在朗读用的是 zhen 的普通版：包 `voice-tsukuyomi-chan-zhen-6lang-fp16-20261002`（packId `573d6d41…`，见 `src/read-aloud-packs.generated.ts`）。
- 如果 JRB 改用时长接管版（全 0 时等于原模型），两个 app 在家族共享缓存 `pwa-models` 里就**共用同一个约 40 MB 的包**：用户两个 app 都装了，只下载一次。

## 要做的事（顺序）

1. **验 zhen 这一对**：「时长接管全 0 == zhen 原模型」逐样本相同。10-05 只验过原版那一对（`dur-override-exp/verify-dur-override.mjs`：原版 vs 原版时长接管，noise 0 → IDENTICAL）；zhen 这一对照同样方法补一遍。不相同就停，回报 user。
2. **朗读库小补丁**：`20261001 internal-read-aloud/backend/piper-plus/vits.js` 目前只在模型声明 `preset` 时喂 `preset`（第 90 行），**不喂 `dur_override`**——直接换模型会缺输入报错。补丁：模型声明了 `dur_override` 就喂全 0 的 `float32 [1, n]`（照 `piper-node.mjs` 的 `run()` 写法）。版本照家规默认 patch。
3. **新包进模型仓**（`20260903 PWA Models`，`tools/pack.py`）：包只增不改不删，所以是新包名，例如 `voice-tsukuyomi-chan-zhen-durov-6lang-fp16-<定稿日>`；许可证快照、出处、「遵守语料条款」的传递声明照旧带上；app 钉 manifest 的 sha256。
4. **JRB 换包**：音色清单指向新包；旧包留在仓里（家规第 5 条：只增不删）。已装旧包的用户要重下一次约 40 MB——什么时候换由 user 定。
5. **MoonSinger**：上 gh dev 时从同一个包加载（现在开发期是 `dev-assets/` 软链检疫桶）。

## 风险 / 没核的

- zhen 这一对的「全 0 == 原模型」没验（第 1 步）。
- 时长接管版比普通版大约 1 万字节（图改动），推理速度没测过差别。
- 朗读库加补丁后，旧模型（没有 `dur_override` 输入）照旧什么都不喂，行为不变——补丁要带这条测试。

## 补充（2026-10-07，来自当时在 JRB 干活的「opus weekly code audit」session，Claude Opus 5.5 转记）

- JRB 的「本地模型」（`useLocalModel`：把 .onnx + .json 当 override 交给库）走的也是同一个 piper-plus 后端——user 在 JRB 里拖 zhen 时长接管版试，补丁位置同样只有 `vits.js` 这一处。
- 朗读库是 `@internal/read-aloud`：改它按家规先 escalate，patch 级可做。
