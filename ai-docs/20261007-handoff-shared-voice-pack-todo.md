# Handoff 待办：JRB 换成「月读（中英增强，时长可接管）」权重包 + 改用 @internal/model-packs

> created 20261007 · by Claude Opus 5.5（在另一个 app 的 session 里做的模型包 / 共享库）· as-of 2026-10-07
> user 2026-10-07：「然后最好jrb和moonsinger只用存一份」「抽共享库同意」；推送清单（模型仓推新包 / 朗读库 0.1.21 / model-packs 0.1.0）批了「做」；「jrb写handoff todo」。
> 承接同日早些的提案 `20261007-shared-tsukuyomi-singing-model-note.md`（它的 1–3 步现在都做完了，见下）。
> **本文只是交接**：JRB 的代码一行没改，这次只新建了本文件。下面「要做的」是 JRB 宿主 session 的活。

## 已经做好的（都在 JRB 外面）

- **模型仓**：新包 `voice-tsukuyomi-chan-zhen-dur-6lang-fp16-20261007`（packId `56d81c8eb51e693e937397e2557ac3af4dff328e420b761c6e5df8b8b5b80ca6`；已推 GitHub Pages，commit e49083f，线上清单哈希核过）。
  = JRB 现在用的 `voice-tsukuyomi-chan-zhen-6lang-fp16-20261002` 的 model.onnx 加一个 `dur_override` 输入，config.json 原样。全 0 == 原包：日 / 中 / 英各一句 noise 0 逐样本相同。
  `voices/tsukuyomi-chan-zhen.json` **还没改**（见下第 3 步，必须等 JRB 收了朗读库 0.1.21）。
- **朗读库 `@internal/read-aloud` 0.1.21**（已发，GitHub release v0.1.21）：`vits.js` 模型声明了 `dur_override` 就喂全 0。用库自己的 `vits.js` 跑新旧两个包，日 / 中 / 英逐样本相同。
- **`@internal/model-packs` 0.1.0**（已发，GitHub `fangzhangmnm/internal-model-packs` release v0.1.0）：JRB 的 `src/model-packs.ts` + `src/sha256.ts` 原样搬出去（算法一字未改）；类型换成库自己的子集——朗读库的 `EmbeddedPack` 能直接传进去。
- 另一个 app（唱歌的那个）已经在用新包 + 共享库：同一个域名下，用户两个 app 都装了只下一次。

## JRB 要做的（按顺序）

> 2026-10-21 进度（Claude Fable 5.1，周账 F-29 / 分道 3）：**第 1、2 步已落地 = JRB v0.2.19**（朗读库 0.1.22 + model-packs 0.1.0；`src/model-packs.ts` / `src/sha256.ts` 删掉，红线守卫与 CLAUDE.md 跟着改，`test/model-packs.mjs` 改测库入口）。
> 同日稍后 user「小月相更新对齐同意。开干」→ **第 3、4 步也落地**：模型仓 commit 1e6e0da（voices json + index.json 的 sha256 / packs + README 两行，已推 GitHub Pages）；JRB **v0.2.21** 重新内嵌（`READ_ALOUD_PACKS` 里 20261002 包的清单换成 20261007 的；旧包在设备缓存里成了「不认识的包」，app 不碰）。第 5 步（要不要给「清理旧版音色」一个按钮）仍等 user。

1. **收朗读库 0.1.21**：在 JRB 仓根 `bash "../20261001 internal-read-aloud/scripts/pull-package.sh" 0.1.21` → 跑 JRB 测试。只多了「有 dur_override 就喂 0」这一行，对现在的包没有任何影响。
   （2026-10-07 稍后：朗读库已发 **0.1.22**（= 0.1.21 + 底层出口 `./backend/piper-plus/*`，给 MoonSinger 用），直接收 0.1.22 也行，对 JRB 没有影响。edited by Claude Opus 5.5）
2. **收 `@internal/model-packs` 0.1.0**：`bash "../20261007 internal-model-packs/scripts/pull-package.sh"`；删掉 `src/model-packs.ts`、`src/sha256.ts`；`src/read-aloud-host.ts` 的 `import { createPackStore, … } from "./model-packs.ts"` 改成 `from "@internal/model-packs"`（接口一样）。红线守卫里「src/ 唯一联网 / 唯一碰 `pwa-models` 的文件」那条要跟着改（现在指的是 `src/model-packs.ts`）。
   跟着改的还有：JRB `CLAUDE.md` 黄线区那句「发请求的是 `src/model-packs.ts`，`src/` 里唯一准联网的文件」和持久层白名单 Cache Storage `pwa-models` 那一行（改成「经 `@internal/model-packs`」）、「库不管持久化」那条里的 `src/model-packs.ts` / `src/sha256.ts`、「候选抽成 @internal/model-packs…等 user 点头」（user 10-07 已点头）；
   `test/model-packs.mjs`（无头浏览器 17 项）改成测库的入口（或留着当宿主的整链冒烟）。
3. **模型仓的音色定义换包**（`20260903 PWA Models/voices/tsukuyomi-chan-zhen.json`）：`packs` 里的 `voice-tsukuyomi-chan-zhen-6lang-fp16-20261002` 换成新包名，`packIds` 换成新 packId（上面那串）。推模型仓 = 公开发布，推之前问 user。
   具体 = 两处字符串替换（2026-10-21 核过该文件现状仍是旧包）：`"packs"` 数组里 `voice-tsukuyomi-chan-zhen-6lang-fp16-20261002` → `voice-tsukuyomi-chan-zhen-dur-6lang-fp16-20261007`；`"packIds"` 里那一行的键同样改名、值 `573d6d41…` → `56d81c8eb51e693e937397e2557ac3af4dff328e420b761c6e5df8b8b5b80ca6`。其余字段不动。
   **顺序硬要求：必须在第 1 步之后**——朗读库 0.1.20 不喂 `dur_override`，JRB 重新生成清单后会在合成时报缺输入。
4. **JRB 重新内嵌**：`node tools/gen-read-aloud-packs.mjs` → `src/read-aloud-packs.generated.ts` 指向新包；JRB 测试；真机念一段（按家规，真机由 user 定什么时候测）。
5. **旧包的缓存**（要 user 定）：已经下过旧包（packId `573d6d41…`，约 40 MB）的设备，换包后旧分片留在 `pwa-models` 里没人认领（宿主只删自己清单认得的包）。要不要在 JRB 设置里给一个「清理旧版音色」——user 决定。
6. **对用户的影响**：已装旧包的人要重下一次新包（约 40 MB）；之后和唱歌的 app 共用这一份。

## 注意

- ~~唱歌的那个 app 是私有孵化项目：往公开仓写东西时别写它的名字~~ → 2026-10-07 已公开：MoonSinger（https://github.com/fangzhangmnm/moonsinger ），名字可以写。edited by Claude Opus 5.5
- WebXiaoHeiWu `src/asr/worker.ts` 是同源的第三份字节层，以后合进 `@internal/model-packs`（没在这次做）。
