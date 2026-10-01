# Wishlist：读英文时的实词高亮

> created 20261001 · by Claude Fable 5.1 · as-of JRB 分支 `v0.2-read-aloud`（0.2.0 + 朗读进行中）
> 出处：user 2026-10-01（PWAProjects 的朗读 session）「一个新的脑洞，和jrb，jrp有关，能帮我顺便记账吗」「myllama reborn, jrb jrp都记账」。
> **只是 wishlist，没经 user 拍板做不做、怎么做。** 正本在全局账本：`~/jupyter/20260813 MyLlamaReborn/20260913 记账 Wishlist 与 Research Ideas/` 的 wishlist **W-195** + research-ideas **R-086**；这里是给 JRB 侧 agent 的就地指路牌。JRP 那份 = `../20260518 JustReadPapers/docs/20261001-content-word-overlay-wishlist.md`。

## user 原话

- 「jrb读英文的时候可以实词高亮，然后需要想一个weight/stakes判断器。甚至可以看小模型topic分类器的attention看哪里」
- 「所以其实扫读的关键在于抓高weight实词。这么说再加一个，英语，只是你用词频或者别的方法把高weight 实词给变成背景不透明度highlight出来，看能不能到中文的效率」（同一晚在 Claude 网页版说的，user 贴进了会话）

## 是什么

读英文书时，正文里的实词按「权重」上一层背景色，权重越高越不透明；功能词不动。目的 = 扫读时眼睛直接落在高权重的词上（user 的类比：读日文 / 中文时眼睛抓的是汉字）。

没定的：权重怎么算（user 点了三个候选：词频、「别的方法」、小模型 topic 分类器的 attention）、分几档、开关放哪、只对英文还是也对日文。

## JRB 这边我看到的事实

- 正文是一整个文本节点。朗读（0.2.1）刚用 CSS Custom Highlight 在文本节点上画「正在读的句子」，不改 DOM（`src/reader/txt.ts markReading`）。Custom Highlight 可以同时登记多个名字、各自一套样式——「几档不透明度」= 几个名字，同一条路。
- 一章几千个词，每个实词一个 Range：数量级没试过，要量。
- JRB 现在不跑任何模型。权重可以在装订时算好随书带（W-191 日文词典的同一个思路），也可以在阅读器里查一张词频表；哪种都没试。

## 相关

- 朗读库 `@internal/read-aloud` 的分句是纯函数、按字符偏移说话；将来要按词切英文，偏移口径可以对齐。
- 旧账：R-044（用语言模型的逐词 surprisal 找「猜不到的实词」）、W-192（实词频序）。
