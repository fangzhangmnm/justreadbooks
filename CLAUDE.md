# JustReadBooks（家族总规则见上级 CLAUDE.md）

网文/轻小说阅读器（txt+pdf，章节解析，markdown 标题不显 `###`）。UI 中文。行宽偏好：轻小说式窄行（16-22 字/行的节奏），需保留两档配置。

- 数据：书在 OneDrive 子文件夹组织；`session.json` 管跨端"哪本书+读到哪"；per-book 进度 + 最近列表。
- 云姿态：本端永远只读 → **永远自动 pull**；进度合并用编辑时间单调（"last win 太不安全了"的发源地）；ghost 态给用户两个选择（重传/删除）；阻塞式同步屏必须有显式取消/离线 fallback。
- 垃圾桶等待操作必须 busy-lock（本项目踩过的坑）；gamepad 十字键 + 量化行滚动（4 行）是 Quest 场景。
