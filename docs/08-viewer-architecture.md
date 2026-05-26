# 阅读器(viewer)架构

> TXT 跟 PDF 是两个独立 viewer 模块,只共享 position 协议 `{pageIndex, yFraction}`。
> 本 doc 讲两边的内部架构 + 关键决策。

## 抽象层:position 协议

两个 viewer 都对外:

```
init(containerEl, { onPosition, onPagePeek })
load({ docId, data, position? })
restorePosition({ pageIndex, yFraction })
currentPosition() → { pageIndex, yFraction } | null
teardownCurrent()
getCurrentDocId()
```

position 含义:
- **PDF**: pageIndex = 0-based 页号, yFraction = 该页内纵向比例
- **TXT**: pageIndex = 章节序号, yFraction = 该章 DOM 内纵向比例

reading-line anchor = 25% (viewport 高度 1/4 处)。位置 = "anchor 穿过的内容"。see [03-cross-device-sync.md](03-cross-device-sync.md)。

回调:
- `onPosition`: scroll debounce 500ms 后报完整 position(用于 session.json 写盘)
- `onPagePeek`: rAF 节流,realtime 报 pageIndex(顶栏页号显示用)

## PDF viewer

[viewer-pdf.js](../src/viewer-pdf.js),基于 [pdf.js](../src/vendor/pdfjs/)。

### 懒加载 + 重试

GH Pages 冷启动偶尔 dynamic import 失败一次。Shift+F5 后正常 = 失败时机问题(SW 还没接管 / 缓存竞态 / 弱网)。

修法:
1. `initPdfViewer` 同步,只挂 DOM 引用 + scroll handler 占位(handler 内部 `if (!viewer) return` 自保护)
2. **不**加载 pdf.js 库
3. 第一次 `loadPdf` 时 `ensureViewerBuilt()` → `ensureLib()` 真正加载
4. `loadModule(rel)` 加 3 次退避重试 (300ms / 600ms / 900ms)

效果:
- 只看 TXT 的用户永远不下 4MB+ pdf.js
- pdf.js 失败一次 → 自动重试 → 大概率第二次成功
- 即使失败,只看 TXT 的体验不受影响

[viewer-pdf.js:initPdfViewer / ensureViewerBuilt / loadModule with retry](../src/viewer-pdf.js)

### cozy scale 算法

PDF 适配宽度:目标 = 容器宽 vs 7 英寸(672 CSS px,7" × 96 dpi)取小的。

```
naturalWidth = pdfPage.view[2] - view[0]  (pdf 点)
naturalCssWidth = naturalWidth × 96/72   (转 CSS px)
availCss = container.clientWidth - 滚动条预留
cap = 7 × 96 = 672
target = min(availCss, cap)
scale = target / naturalCssWidth
```

理由:7 英寸是 iPad mini / 6 寸手机的舒适页宽。再宽阅读距离需要远移动眼球,累。容器更窄 = 自适应填满。

[viewer-pdf.js:computeCozyScale](../src/viewer-pdf.js)

### per-doc zoom 偏好

用户手动 zoom 后,记 **factor** = current scale / cozy scale,不是 absolute scale。下次开同一篇:`scale = factor × 新窗口的 cozy`。

理由:同一篇 PDF 在手机 vs 桌面,cozy 不一样,但用户"喜欢比 cozy 大 X%"这个偏好是普适的。存 factor 跨窗口语义一致。

存 localStorage `jrb.pdf.zoomf:<docId>`,**设备本地**,不跨设备同步(屏幕大小决定的)。

[viewer-pdf.js:scalechanging 事件](../src/viewer-pdf.js)

### 位置恢复:reading-line 25% anchor

```
restorePosition({pageIndex, yFraction}):
  pv = viewer.getPageView(pageIndex)
  pageTop = pv.div.offsetTop
  pageH = pv.div.offsetHeight
  readingLineY = pageTop + pageH × yFraction
  scrollTop = readingLineY - container.clientHeight × 0.25
  
  # nudge 一帧:渲染可能让 page 高度变 (字体晚加载等),再校准一次
  requestAnimationFrame(...再算一遍...)
```

`isRestoring` 标志阻止 scrollHandler 在 restore 期间误报位置(否则会覆盖 session.json 里刚拉来的位置)。

[viewer-pdf.js:restorePosition](../src/viewer-pdf.js)

### 跳页 + outline

PDF 自带 outline (pdf.js `getOutline()`) 返树状结构。`jumpToDest(dest)` 内部用 linkService.goToDestination。

点击 outline 跳页 → 800ms 后 `flush()` 强推 session(明确意图,不等 debounce)。

[viewer-pdf.js:jumpToDest / getOutline](../src/viewer-pdf.js)、[app.js:buildPdfOutlineItem](../src/app.js)

## TXT viewer

[viewer-txt.js](../src/viewer-txt.js)。

### 一章一次渲染,不是无限滚

详见 [04-txt-chapter-splitting.md](04-txt-chapter-splitting.md)。理由:网文几百万字,无限滚 DOM 爆;一章一屏符合用户心智 (起点 / 番茄)。

`loadTxt({docId, text, chapters, position})`:
- 存 text + chapters 到模块内
- currentChapter = position.pageIndex
- `renderCurrentChapter()` 渲染当前章节,清空旧 DOM

### DOM 结构

```html
<div class="txt-container" data-font-family="sans">
  <div class="txt-inner">
    <div class="chapter-nav chapter-nav-top">
      <button>‹ 上一章</button>
      <div class="chapter-nav-mid">
        <div class="chapter-nav-title">第三章 风起</div>
        <div class="chapter-nav-progress">3 / 250</div>
      </div>
      <button>下一章 ›</button>
    </div>
    <section class="txt-chapter">
      <h2 class="txt-chapter-title">第三章 风起</h2>
      <div class="txt-body">正文 ... (从 bodyStart 切,不含标题行)</div>
    </section>
    <div class="chapter-nav chapter-nav-bottom"> ... </div>
  </div>
</div>
```

`.txt-body` 用 `white-space: pre-wrap` 保留原文换行。不做段落识别(原文换行 = 段落)。

### 位置恢复

简单:`scrollTop = max × yFraction`,其中 `max = scrollHeight - clientHeight`。

加一帧 nudge(字体加载完高度可能变)。

跨设备同书时,字号 / 行高 / 宽度不一样 → 实际滚到的"段落"可能跟 A 设备不严格一致。但 yFraction 在章内的"大概比例"对得上,用户能很快定位。**接受这个误差**。

[viewer-txt.js:renderCurrentChapter 末尾 isRestoring 那段](../src/viewer-txt.js)

### 章内键盘 / 手柄翻页

```
ArrowLeft / "[" / D-pad ←  → prevChapter
ArrowRight / "]" / D-pad → → nextChapter
PageDown / Space           → pageDownOrNextChapter:
                              如果 scrollTop 到底 (差 ≤4px) → nextChapter
                              否则 scrollBy 0.9 viewport
Space + Shift / PageUp     → pageUpOrPrevChapter (对称)
D-pad ↑↓                   → app.js dpadStep,4 行 quantize
```

[viewer-txt.js:onKeyDown / pageUpOrPrevChapter / pageDownOrNextChapter](../src/viewer-txt.js)、[app.js:dpadStep](../src/app.js)

### reapplyChapters (用户改切分规则后)

```
reapplyChapters(newChapters, anchorCharOffset):
  存 newChapters
  根据 anchorCharOffset (= 全文字符偏移) 找在哪一章
  yFraction = (anchor - chapter.start) / (chapter.end - chapter.start)
  loadTxt 重渲染
```

`currentCharOffset()` 把当前 {chapterIndex, yFraction} 算成全文字符偏移,作为锚。重切分后用这个锚定位新章节,体验是"用户大概站在同一段文字"。

[viewer-txt.js:reapplyChapters / currentCharOffset](../src/viewer-txt.js)

### 字号 / 行高 / 宽度 / 字体 prefs

通过 CSS 变量 (`--txt-font-size / --txt-line-height / --txt-max-width`) 设在 `.txt-container` 上,`.txt-body` / `.txt-chapter-title` 用 `var(...)`。

`data-font-family="serif|sans|mono"` 切换 font-family。

prefs 存 localStorage,**设备本地**(屏幕大小决定)。

[viewer-txt.js:applyPrefs](../src/viewer-txt.js)

## 双 viewer 切换 (app.js openBook)

```
openBook(item):
  kind = detect TXT / PDF
  if kind === "pdf":
    pdfViewerContainer.classList.remove("hidden")
    txtViewerContainer.classList.add("hidden")
  else:
    反过来
  ...拿 blob...
  if kind === "pdf":
    await loadPdf({docId, data: blob, position})
  else:
    text = decode(blob)
    chapters = splitByPreference(text, libraryPref)
    loadTxt({docId, text, chapters, position})
```

两个 viewer container 同位置,通过 .hidden class 显隐切换。

`closeCurrentBook`:teardownPdf + teardownTxt 都调一遍(便宜,内部已检查 currentPdf / chapters 是否有),两个 container 都 hidden。

[app.js:openBook / closeCurrentBook](../src/app.js)

## scroll handler 协议 (两个 viewer 一致)

```
scrollHandler:
  if isRestoring: return            # 防 restorePosition 期间误报
  if onPagePeek: rAF throttled → onPagePeek(pageIndex)  # 顶栏页号 realtime
  saveTimer = debounce 500ms → onPositionChange(currentPosition())  # session 写盘
```

两个 viewer 模式一致,差别只在 currentPosition() 的算法。

## 边界 / 踩坑

### 1. PDF 在 spread / fit-mode 切换后 position 丢失

之前 spread 切换后没 restorePosition。现在 `setSpreadMode` 在切换后 rAF 两次 + restorePosition。

(本 viewer 实际没暴露 spread mode 给 UI,精简掉了 —— 网文 / 图书场景 spread 用得少)

### 2. TXT 章节切分后跨设备 yFraction 不严格可比

字号 / 宽度差异 → 章节高度不同 → 同 yFraction 落在略不同段落。1-2 段误差。接受。

### 3. PDF 文本提取 ≠ LaTeX 源

PDF 里数学公式只存 glyph 不存源,提取出来是 "α+β" 不是 `\alpha+\beta`。这个 app 没暴露文本提取功能,JustReadPapers 有(那是论文需求)。

### 4. pdf.js 4.x getOutline 偶尔返 null

老 PDF (xref 损坏等) `currentPdf.getOutline()` 抛错或返 null。catch 兜底 → outline 按钮 hidden。

## 测试 checklist

- ☑ 拖 50MB PDF → 渲染,zoom 适配,位置恢复
- ☑ 拖 5MB TXT (10000 章) → auto-split,一章一屏,prev/next 切章秒级
- ☑ 切书 (PDF → TXT) container 显隐切换正确
- ☑ 重启 app → 自动开上次的书在原位置
- ☑ 切书后 outline 按钮显隐正确(PDF 有 outline,TXT 章节列表)
- ☑ 改 TXT 字号 → 内容立刻应用,scroll 位置近似保留 (yFraction 算法)
- ☑ 第一次开 PDF (lazy load 触发) 1-2 秒后才看到内容,期间显示 progress

## 相关

- [03-cross-device-sync.md](03-cross-device-sync.md) — position 协议跨设备同步细节
- [04-txt-chapter-splitting.md](04-txt-chapter-splitting.md) — TXT chapter 数据是怎么来的
- [07-ui-patterns.md](07-ui-patterns.md) — viewer 上层的快捷键 / 手柄 / drawer 交互
