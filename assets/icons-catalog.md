# 本 app 的图标

48 icons · 提取自家族图标库 `../20260708 SVG Icons/icons.svg` · 由 `extract-icons.py` 生成，别手改。

用法：把 sprite 整段内联到 `<body>` 顶部，然后按 id 引用；
⚠ sprite 根自带的隐藏样式（1×1 + `opacity:0`）别换成 `display:none`——
不渲染的子树里 `<mask>`/`<clipPath>` 不生效，靠遮罩留白的图标会静默糊掉；
颜色跟随 CSS `color`（全部 `currentColor`）：

```html
<!-- 内联 icons.svg -->
<svg width="24" height="24"><use href="#copy"/></svg>
```

> 👁 **待过目**（AI 自画、未经人类审阅，`data-review="pending"`）：`bookshelf`、`book`、`forward`、`chevron-left`、`chevron-right`、`settings`、`help`
> 见库 `index.html` 的「待过目」栏；过目后进库/打回归库 session。


## edit

| name | 说明 |
|------|------|
| `copy` | 两个文件叠放 |

## file

| name | 说明 |
|------|------|
| `bookshelf` 👁待过目 | 书库入口:两本直立的书共边 + 一本斜靠(倾 16°,顶角贴在直立书的上沿)；每本一道书脊标签线(直立两本错开高度)；不画书架线；与 gallery(图片堆叠)分工=书库 vs 图库。cairosvg 渲 160/20/16px 比过 12 个候选(三本各自独立外框 16px 缝糊、三本等高共边像三扇窗、阶梯共框+书架线)后 user 选定【WebXiaoHeiWu 顶栏最左「书库」钮 + 侧栏顶部「书库」入口（v2.1.8 起替换借用的 gallery）；2026-09-10 fable 自画未过目，user 原话「你那个是图库，画一个几个并列在一起的书看看？」→「use 6 two lean but add the bar in each book like 3 three tabs」→「用6d」】 |
| `folder` | 文件夹:左边 tab + 矩形主体 |
| `folder-open` | 打开的文件夹:背板止于盖顶 T 接,不再互相压线 |
| `file` | 文档:单张纸+折角(copy/paste/clear-canvas 共用母题) |
| `book` 👁待过目 | 书:合上的书侧视——左脊直立、封面与书页在右、脊底一道弧连回封面(与 file 单张纸同族体量,不画文字)【WebXiaoHeiWu 书库工程卡片占位图（无缩略图时,替代名字首字）；2026-09-10 fable 自画未过目】 |
| `trash-can` | 垃圾桶:桶身收口(feather 是直筒);与 fluent(圆提手/更低)、heroicons(弧形透视)亦不同 — own |
| `restore-trash` | 同上但盖只掀 -16° |
| `clear-trash` | 清空回收站:桶身改虚线表示已空 |
| `rename` | 重命名:文字光标+铅笔 |
| `image` | 从图片新建:相框+山+太阳 |
| `new` | 新建:纯加号(等长十字线) |

## hierarchy

| name | 说明 |
|------|------|
| `move-to-folder` | 移入文件夹(定 2 号):小 folder + 弧箭头, 箭头头部在 folder 内 · 尾巴在外 |
| `create-folder` | 加号做成右下角徽标 |
| `lock` | 锁:体 13x11+锁梁抬高(腿3.5),整体居中 |
| `unlock` | 开锁:同 lock 体型+锁梁弹开 |

## common

| name | 说明 |
|------|------|
| `back` | 返回:左向整箭头(带杆;裸 chevron-left 曾因小尺寸渲染差被 sunset) |
| `forward` 👁待过目 | 前进:back 的精确镜像(右向整箭头带杆;与 chevron-right 裸 chevron 分工)【WebXiaoHeiWu 侧栏页头「回退」右邻的「前进」钮（回退之后再回去）；2026-09-10 fable 自画未过目】 |
| `x` | 叉 |
| `check` | 勾 |
| `chevron-left` 👁待过目 | ‹ 小尺寸优化裸 chevron:描边 2.4、臂短(14px chip 用)；库里带杆的 back 是另一语义【WeebPaint 参考窗多图时窗底翻页 chip；fable 自画未过目】 |
| `chevron-right` 👁待过目 | › chevron-left 的精确镜像【WeebPaint 参考窗翻页 chip；fable 自画未过目】 |
| `chevron-down` | 下移:竖线 + 底端 ∨ 箭头 |
| `chevron-up` | 上移:竖线 + 顶端 ∧ 箭头 |

## cloud

| name | 说明 |
|------|------|
| `cloud` | 云 |
| `cloud-synced` | 云+勾 |
| `cloud-upload` | 云+上传箭头 (云形统一为 feather 的) |
| `cloud-download` | 云+下载箭头:cloud-upload 的精确上下镜像(箭头绕 y=14 翻转); WeebPaint gallery 同步徽章 newer-on-cloud, 12px 用量 (甲方 20260825 拍板候选 1 号) |
| `cloud-conflict` | 云+感叹号(2.4 描边整体收在云内不破轮廓, 点半径=描边半宽; 与 cloud-pending 问号云成对但云为实线); WeebPaint gallery 同步徽章 conflict, 12px 用量 (甲方 20260825 拍板候选 5 号=大号收内) |
| `cloud-pending` | 待判定:虚线云 + 云内问号(加粗 2.4, 遮罩描边留白与云脱开;问号下点的半径=描边半宽) |
| `cloud-unavailable` | — |
| `cloud-busy-base` | 云端忙 静态件:云轮廓中心挖圆洞, 与 cloud-busy-spinner 叠放合成一个资产 |
| `cloud-busy-spinner` | 云端忙 旋转件:弧+箭头, 圆心正在 (12,12) 所以 CSS rotate 原地转不甩 |
| `download` | 下载 |
| `upload` | 上传 |
| `unload-local-cache` | 卸载本地副本:database(=本地) + 斜删除线(mask 留 gap)【非垃圾桶, 云端仍保留】 |
| `local-cache` | 本地缓存副本:database(=本地已缓存, 与 unload-local-cache 同形去掉删除线) |
| `refresh` | 刷新:顺时针 3/4 圆 + 箭头(从 12 点绕到 9 点, 箭头尖在右上) |
| `sign-out` | 退出登录:门框+向外箭头(通用 logout 图元) |

## viewport

| name | 说明 |
|------|------|
| `grid` | 网格:直角外框 1.2 与内网格线同宽(20260725 甲方定稿; 原 rx1.6 圆角粗框版退役), 内部 4x4 细网格 |

## ui

| name | 说明 |
|------|------|
| `menu` | 汉堡菜单:三条等长横线(y=7/12/17) |
| `database` | — |
| `more` | 溢出菜单:横向三点(原 ⋯ 字符跨平台字形不一) |
| `wrench` | 扳手:斜置组合扳手轮廓(feather:wrench 衍生), 20260724 候选 1 号入库 |
| `settings` 👁待过目 | 设置:齿轮=内圆+外圆+8 根短齿(圆帽)；家族里 sliders 是「调整」别撞【WebXiaoHeiWu 抽屉底栏「设置」入口；fable 自画未过目】 |
| `theme` | 主题日月同辉:细月牙(大圆挖近等大圆) + 八芒太阳嵌在缺口里, 光芒是与太阳脱开的短线。日月直径比 1.00, 分离角 -30°, 分离距离 1.05 倍月半径;太阳用遮罩描边留白从月牙上抠出白边 |
| `keyboard` | 键盘:圆点加大收紧+空格上移不压框(与 shortcut 不同语义) |
| `help` 👁待过目 | 帮助:圆 + 路径画的问号(不用 text)【WeebPaint ☰ 设置菜单「帮助」= in-app 说明书入口；fable 自画未过目】 |
