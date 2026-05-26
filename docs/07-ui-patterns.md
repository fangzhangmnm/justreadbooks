# UI 模式 + 交互决策

> 记录本 app 选用的 UI / UX 模式 + 人类设计决策 + 走过的弯路。
> 不是"UI 教科书",是"我们具体怎么做了 + 为什么"。

## Zen 模式顶栏

阅读时整个顶栏 `opacity: 0.6`,鼠标 hover / focus 时回 1.0。

```css
.top-bar {
  opacity: 0.6;
  transition: opacity 180ms ease;
}
.top-bar:hover, .top-bar:focus-within { opacity: 1; }
```

**不用 `display: none`** 的理由:手机 / 触屏 hover 不可靠,完全隐藏就摸不到了。opacity 0.6 既"淡出视线"又"够点得到"。

汉堡按钮、目录按钮在淡的顶栏上,看得见但不抢戏。"扼杀选择困难症"原则(jumpscare 启动)+ 这个 zen 顶栏组合 = 用户打开就直接读书,不被 UI 元素干扰。

[styles.css:.top-bar opacity 规则](../src/styles.css)

## 抽屉 mutex (openPanel state)

书架 / 目录 / 设置 三个 panel 互斥。同时只能开一个。

```js
let openPanel = null;  // "books" | "outline" | "settings" | null

function closeAllPanels() { /* hide 三个 + backdrop */ }
function openBooksDrawer() { closeAllPanels(); 然后打开 books }
function togglePanel(name) {
  if (openPanel === name) closeAllPanels();
  else if (name === "books") openBooksDrawer();
  ...
}
```

三个都从**左**滑出,同侧同宽 (360px),滑动方向一致。设置面板早期是从右滑出宽 420px,后来统一改左,跟兄弟项目 (JustReadPapers) 一致。

[app.js:openPanel + togglePanel](../src/app.js)、[styles.css:.drawer / .settings-panel](../src/styles.css)

## 设置入口在书架抽屉底部

顶栏**没有**设置按钮(早期版本有,后来撤掉)。

入口路径:汉堡 → 书架抽屉 → 抽屉底部 `[⚙ 设置] [💾 缓存 X MB] [🌙 跟随系统]` 一排。

理由:zen 顶栏只放阅读时**频繁用**的(目录、当前书标题、同步状态)。设置是低频操作,放二级菜单合理。

跟 sibling apps (JustReadPapers / BackgroundRadio) 同款 drawer-foot 模式。

键盘 `S` / 手柄 Start 仍直接打开设置,不强制走两级。

## 登录入口也在设置里

设置面板第一段是 "OneDrive 账户" section。早期版本登录按钮在书架抽屉的 auth-row(顶部),撤了 —— 书架不需要时刻显示账号状态,设置面板才是。

也强调:**登录是可选的**(constraint #1 zero-account first-class)。不登录的用户不应该被反复提醒"你没登录哦"。设置里有就够了。

## 行级 busy 锁 (async 期间防误操作)

[app.js:withRowBusy](../src/app.js):

```js
async function withRowBusy(itemId, fn) {
  setRowBusy(itemId, true);
  try { return await fn(); }
  finally { setRowBusy(itemId, false); }
}

function setRowBusy(itemId, busy) {
  const row = docList.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`);
  if (row) row.classList.toggle("busy", !!busy);
}
```

CSS:
```css
.doc-row.busy { opacity: 0.55; pointer-events: none; }
.doc-row.busy::after { content: "处理中…"; ... 右上角角标 ... }
```

**关键设计**:`pointer-events: none` 在 `.doc-row` 上不阻碍外层 docList 的滚轮事件(冒泡到父),所以用户还能滚动到别的行。但点击 / hover 这一行没反应,防止重复点。

包了 12 个 row 动作:trash / restore / purge / cache / uncache / pin / ghostReupload / ghostDelete / deleteLocal / uploadNow / deferUpload / reuploadGhost。每个都是 `await withRowBusy(item.id, async () => { ... })` 套一层。

**为什么不用全局 modal "处理中…" overlay**:遮罩太重,而且别的行还能读 / 滚 / 操作 → 行级锁更精细。

## 抽屉级 button.disabled

drawer-level 操作(`emptyAllTrash` / `createNewFolder` / `uploadFiles`)直接 set `button.disabled = true`,finally 解锁。`uploadFiles` 还有 `uploadInFlight` 单飞守卫,二次点 toast "上一批还在传"。

[app.js 各处对应位置](../src/app.js)

## 滚动条主题色

`.viewer-container::-webkit-scrollbar` + `.doc-list / .outline-list / .settings-body::-webkit-scrollbar` 都用 `var(--accent-strong)` 做 thumb,`var(--bg-1)` 做 track。日金 + 夜金主题自动适配。

之前漏给 outline-list / settings-body 加,后来补 (在 v9 周围)。

[styles.css 各 scrollbar 规则](../src/styles.css)

## 网文短行 (起点 / 番茄 风格)

TXT 阅读区默认 `maxWidth: 440px`,字号 19px,行高 1.9 → 约 22 字 / 行。

理由:起点 / 番茄 / 七猫等手机阅读 app 默认 16-22 字 / 行,网文作者训练出来的节奏(短段落 + 对话独占行)在这个宽度下才不别扭。早期版本默认 720px (论文风格),被用户嫌"太宽不像网文 app"。

用户可在设置里调宽 (480-1200px 自由),但默认就是 440px。

`min(calc(100vw - 32px), var(--txt-max-width))` 让小屏自然变窄,不强制 440px(手机 375px 屏就用全屏)。

[viewer-txt.js:DEFAULTS / applyPrefs](../src/viewer-txt.js)

## 字体选择 (用户偏好里特别强调)

默认 sans (PingFang SC / 微软雅黑 / 思源黑体 / Noto Sans CJK SC fallback)。

**不用楷体**(用户明确说过不喜欢)。也不像幼圆那么可爱。就是普通的无衬线中文字体。

衬线 (serif) 是次选(思源宋体 / Songti SC)。等宽 (mono) 也有,实际用得少。

[styles.css:--font-reading-sans / serif / mono](../src/styles.css)

## 主题:象牙白金 / 黑金 / 跟随系统

[styles.css:.root 三套 CSS 变量](../src/styles.css)。`[data-theme="day|night|auto"]` 控制。`@media (prefers-color-scheme: dark)` 让 `auto` 时跟随系统。

**防 FOUC**:HTML head 里 inline 一段 script,在 styles.css 加载前就把 `localStorage["jrb.theme"]` 取出 set 到 `<html data-theme>`,避免白屏一闪。

设置面板 + drawer-foot 都能切。drawer-foot 是循环 (auto → day → night → auto)。

## 键盘快捷键

```
B   切换书架
O   切换目录(本书章节)
S   切换设置
Esc 关任何打开的 panel
```

阅读区:
- ↑ / ↓ / PageUp / PageDown / Space 浏览器原生 + viewer-txt 拦截 PageUp/Down/Space 实现"翻到顶 / 底就跨章"
- ← / → / [ / ] 上一章 / 下一章 (TXT)

要求:输入框聚焦时不抢键(避免在改名时按 B 把书架切了)。`isReadingInputFocused()` 判断。

[app.js: keydown handler](../src/app.js)、[viewer-txt.js:onKeyDown](../src/viewer-txt.js)

## 手柄支持 (Xbox / Quest / DualShock standard mapping)

D-pad:
- 上 (12) / 下 (13):**每按一次 4 行**(用 line-height × 4 quantize 避免顶上切半行)。边沿触发不连发,按多快都不会跳过头
- 左 (14) / 右 (15):上一章 / 下一章 (TXT) 或 一屏 (PDF)。边沿触发

按钮:
- Select (8) / View → 切换目录
- Start (9) / Menu → 切换书架
- Home (16) / Guide → 也切换书架 (备用,有些控制器才有)

实现细节:
- `gamepadconnected` 事件触发才开始 rAF poll,没插手柄 = 0 CPU
- 抽屉打开 / 输入框聚焦 / 没在读书 时不抢
- `pendingFullSync` / `prevPressed` 这类 state 在 `gamepadState` 对象里

[app.js:pollGamepad / dpadStep](../src/app.js)

### D-pad 滚动量演变

早期 16px / 帧持续滚 → 用户反馈"按一下感觉过头" → 改成边沿触发每按 1/3 屏 → 用户觉得依然不准 → 改成 5 行 quantize → 用户最终定 **4 行**。

quantize 算法:从 `.txt-body` 的 offsetTop 起,每 `lineHeight` 一格,目标 scrollTop 四舍五入到最近格子。这样反复按上 + 按下不会漂半行。

[app.js:dpadStep](../src/app.js)

## 顶栏 sync 状态文字

```
[菜单] [目录] 当前书标题 ............ 页号 · 同步状态
```

同步状态变体:
- "就绪" / "已同步 HH:MM"  默认
- "同步中…" (蓝)
- "未同步" (橙)
- "同步失败 · 重试中" (红)
- "本地模式" 没登录
- "离线" 登录但断网

`tickSyncStatus` 每 500ms 检查 session 状态,自动 settle 文案。transient 提示("已改名"/"已缓存"...) 也走同一槽 1.8s 后回到 settled 文案。

[app.js:setSyncStatus / tickSyncStatus](../src/app.js)

## 进度条 + 拖拽 overlay

- 文件下载进度:fixed 在顶栏下沿,2px 高金色条
- drag-drop overlay:全屏半透明 + 中央 "松手即上传" 卡。`pointer-events: none` 让 drop / dragover 事件落到 surface,不被 overlay 吃掉

[index.html:#progressBar / #dropOverlay](../index.html)、[styles.css](../src/styles.css)

## idle overlay

30min 没操作 → 显示蒙层 "已闲置一段时间,点击同步云端最新版"。点了就触发 `applyRemoteUpdate`。

逻辑:`["mousemove", "keydown", "wheel", "touchstart", "scroll"]` 重置 30min timer。

跟 silent auto-pull on focus 互补:focus 是用户主动切回 tab 时,idle 是用户被动离开很久才回来时。两个都触发 sync。

[app.js:resetIdle](../src/app.js)

## breadcrumb 路径

OneDrive 子文件夹导航:`书架 › 小说 › 网游`。每段是 button,点 navigateTo(path)。最后一段是 span (当前位置,不可点)。

特殊节点:`__local__` 渲染为 "本地文件" span。

[app.js:renderBreadcrumb](../src/app.js)

## 测试 checklist

- ☑ Tab 切到别处再切回,opacity 不卡半透明状态
- ☑ 三个 panel 互斥,B/O/S 快捷键切换
- ☑ 长按 / 重复点 row action,只触发一次 graph call
- ☑ 移动端拖文件,drag overlay 出现 + 松手上传
- ☑ 手柄 D-pad ↑↓ 单按 4 行,左右切章,Select 开目录,Start 开书架
- ☑ 输入框聚焦时按 B 不切书架
- ☑ 主题切换无 FOUC
- ☑ 大字号 (28px) 时 line-height quantize 仍准

## 相关

- [04-txt-chapter-splitting.md](04-txt-chapter-splitting.md) — 22 字 / 行的源头
- [08-viewer-architecture.md](08-viewer-architecture.md) — viewer 内的滚动 / 章节切换实现
- [01-pwa-hot-update.md](01-pwa-hot-update.md) — toast 更新提示 UI
