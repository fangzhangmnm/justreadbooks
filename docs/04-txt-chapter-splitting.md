# TXT 章节切分 + 编码 + 阅读视图

> 网络小说一个 .txt 几百万字几千章。**不切章节就没法读**(无法跨设备同步位置、目录、章节翻页)。
> 本 doc 讲怎么切、怎么呈现。

## 为什么切而不是滚

设计选择:**一章一屏,prev/next 按钮**。不是无限滚轮。

理由:
- 网文标准交互 (起点 / 番茄 / 七猫):"下一章 →" 按钮,用户已经习惯
- 一章一次性渲染,DOM 小(典型章节 2000-5000 字),滚动平滑
- 整本一次性渲染 → 100 万字 DOM → 内存爆 / 滚动卡 / 锁屏黑屏
- 切章后,跨设备 `pageIndex` (= chapter index) 是稳定的可比量

参数 + 实现:[viewer-txt.js](../src/viewer-txt.js)

## 内建切分规则 (BUILTIN_CHAPTER_REGEXES)

[config.js](../src/config.js) 里按优先级排:

```js
{ id: "md",       re: "^(#+)[ \\t]+(.+)$",            label: "Markdown 多级 (# / ## / ###)" }
{ id: "md1"~"md4" re: "^# (.+)$" 等,                 单独某一级 (兼容老 library)
{ id: "zh-chap",  re: ".*第[零一...]+章.*$",           "第N章 ..."
{ id: "zh-hui",   re: ".*第[...]+回.*$",               "第N回"
{ id: "zh-jie",   re: ".*第[...]+节.*$",               "第N节"
{ id: "zh-juan",  re: ".*第[...]+卷.*$",               "第N卷"
{ id: "zh-pian",  re: ".*第[...]+篇.*$",               "第N篇"
{ id: "zh-spec",  re: "(楔子|序章|序言|引子|前言|尾声|后记|番外|外传|终章).*$"
{ id: "en-chap",  re: "Chapter\\s+[0-9IVXLC]+.*$"
```

放第一位的 `md` 让 markdown 多级文档优先被认出(单一级别没用,markdown 多级目录的书会被卡在某一级)。

## auto-detect: 选谁?

```
autoSplit(text):
  for def in BUILTIN_CHAPTER_REGEXES:
    matches = tryRegex(text, def.re)
    if len(matches) >= MIN_AUTO_CHAPTER_HITS:  # 默认 3
      return matchesToChapters(text, matches)
  return [{title: "全文", start: 0, end: text.length}]   # 都不匹配,整本一章
```

第一个匹配 ≥3 次的规则胜出。3 太小会让噪音匹配赢(比如正文里出现"第一节如何如何"),太大会漏短书(只有 2 章的)。3 是经验值。

用户在设置里可以手动选规则或写自定义正则,覆盖 auto。优先级 `chapterRegexCustom > chapterRegexId > auto`。

实现:[chapter-split.js:autoSplit / splitByPreference](../src/chapter-split.js)

## 标题提取 + 多级 level:capture group 数量约定

`tryRegex` 看正则的 capture group 数量推语义:

| group 数量 | 例正则 | 标题取自 | level |
|---|---|---|---|
| 0 个 | `^.*第N章.*$` | `m[0]` 整段 ("第三章 风起") | 无 |
| 1 个 | `^### (.+)$` | `m[1]` (不带 `###`) | 无 |
| 2 个 | `^(#+)[ \t]+(.+)$` | `m[2]` | `m[1].length` (cap 6) |

**关键点**:用 group 数量当 schema,**不**在 UI 配置里加 level 字段。用户写自定义正则也能用同套约定 ——「写 2 个 group 我就知道你想要分级」。

实现:[chapter-split.js:tryRegex](../src/chapter-split.js)

## 标题不放正文里

旧 bug:章节切分后,正文 slice 是从 match.index 开始,**包含**标题行 → 渲染时既有 H2 又有正文里的"### 第一章" → 重复显示。

修法:tryRegex 记 `titleLineEnd`(第一个换行符位置),`matchesToChapters` 算 `bodyStart = titleLineEnd 之后跳过 leading 空白`。viewer 渲染:H2 用 chapter.title,正文用 `text.slice(bodyStart, end)`。

边界:第一章前面如果有非空文本 → 前置一个 `(开头)` 章节,`bodyStart = 0`,`hasTitleInText = false`(防止 viewer 误以为这章有标题行要剥)。

实现:[chapter-split.js:matchesToChapters](../src/chapter-split.js) + [viewer-txt.js:renderCurrentChapter](../src/viewer-txt.js)

## 目录 (outline) 树化 + 默认折叠

多级 markdown 文档示例:

```
# 第一部
  ## 第一章
  ## 第二章
    ### 节一
  ## 第三章
# 第二部
  ## 第四章
```

目录 UI:
- 树状缩进,每级 14px (跟 PDF outline 一致)
- **默认折叠**:打开时只看到顶层 (`# 第一部`、`# 第二部`),点 `▸` 展开
- 没分级的文档(纯`第N章`)走平铺路径,不折叠

折叠算法:用栈 build:扫描扁平 chapters,maintain "祖先栈"。新节点 level ≥ 栈顶时 pop,然后挂到当前栈顶下,push 自己。线性时间。

实现:[app.js:buildChapterTree / buildTxtOutlineItem](../src/app.js)

## 编码探测 (constraint: 网络小说常见 GB2312/GBK/Big5)

老网文 .txt 经常是非 UTF-8 编码。直接 `TextDecoder("utf-8")` 解 GB2312 → 全是"锟斤拷"。

策略 (抄 webxiaoheiwu):

```
1. 看 BOM:
   EF BB BF      → UTF-8 with BOM
   FF FE         → UTF-16 LE
   FE FF         → UTF-16 BE
2. TextDecoder("utf-8", {fatal:true}) — 不抛 = 是 UTF-8
3. TextDecoder("gb18030", {fatal:true}) — covers GB2312 / GBK / GB18030 全家
4. TextDecoder("big5", {fatal:true}) — 老繁体
5. 兜底:lossy UTF-8 (TextDecoder 默认行为,坏字符变 �)
```

实现:[encoding.js:decodeBytes](../src/encoding.js)

### 上传时转码

本地 drag-drop 一个 GB18030 .txt → app 探测到非 UTF-8 → **本地转 UTF-8 后**再上传 OneDrive。这样:
- 其它设备拿到 UTF-8,不用各自再 detect
- OneDrive 网页预览能正确显示

**但**:**OneDrive 上已有的非 UTF-8 文件不主动改**。只下载时按上面顺序探测。理由:用户可能有自己的存档习惯,不该 app 替他改。

实现:[app.js:uploadFiles 中转码分支](../src/app.js)

记录探测到的 encoding 在 library.json 的 `books[itemId].encoding`,UI 偶尔显示用。

## per-book 偏好持久化

library.json:

```json
{
  "books": {
    "01ABCXYZ...": {
      "chapterRegexId": "md",      // 内建规则 id
      "chapterRegexCustom": null,  // 或者用户自定义正则字符串
      "encoding": "gb18030"        // 解码记录
    }
  }
}
```

跨设备同步(constraint #4 ish,library.json 跟 session.json 同模型),让用户在 A 设备调好了切分规则,B 设备自动用同样规则切。

实现:[session.js:getBookMeta / setBookMeta / flushLibrary](../src/session.js)

## TXT viewer 渲染:一章一次

```
loadTxt(text, chapters, position):
  text + chapters 存到模块状态
  currentChapter = position.pageIndex
  renderCurrentChapter()
  
renderCurrentChapter():
  container.innerHTML = ""
  + top chapter-nav (上一章按钮 + 标题 + N/M 进度)
  + <h2 class="txt-chapter-title">标题</h2>
  + <div class="txt-body">正文 (text.slice(bodyStart, end))</div>
  + bottom chapter-nav
  滚到 yFraction × scrollHeight 处
  isRestoring=true 短暂保护防 scrollHandler 误报
```

切章 (goToChapter / prev / next):重新 renderCurrentChapter,默认 yFraction=0(从顶看新章)。

position 上报:`scroll` 事件 debounce 500ms → 算当前 yFraction → 调 `onPositionChange` → app.js 调 session.setPosition。

实现:[viewer-txt.js](../src/viewer-txt.js)

## 阅读宽度 / 字号 / 行高 / 字体

设备本地(localStorage,**不跨设备**)。

defaults:
- fontSize: 19px
- lineHeight: 1.9
- maxWidth: 440px (约 22 字 / 行,起点 / 番茄 风格,见 [07-ui-patterns.md](07-ui-patterns.md))
- fontFamily: sans (PingFang / 微软雅黑 / 思源黑体, 不是楷体)

[viewer-txt.js:DEFAULTS](../src/viewer-txt.js)

## 测试 checklist

- ☑ 拖一本只有 `第N章` 的 .txt 进来 → auto 选 `zh-chap` → 一章一屏
- ☑ 拖一本 markdown 多级 `# / ## / ###` → auto 选 `md` → 目录树形折叠
- ☑ 拖一本 GB18030 编码 .txt → 不乱码 + 上传到 OneDrive 是 UTF-8
- ☑ 设置面板里换切分规则 → "应用并重切" → outline 重建,yFraction 保留章内位置
- ☑ 设备 A 改 chapterRegexId → 设备 B 同步后用新规则切
- ☑ 极长章节(50k 字)滚动顺畅 (只渲染一章)

## 相关

- [03-cross-device-sync.md](03-cross-device-sync.md) — pageIndex (= chapter index) 是跨设备稳定可比量
- [07-ui-patterns.md](07-ui-patterns.md) — 22 字 / 行的视觉理由
