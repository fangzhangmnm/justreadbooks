# vendor/fonts —— 内置字体（兜底）

> created 20261001 · by Claude Fable 5.1 (claude-fable-5-1)

阅读正文的黑体档用这一份。**家族公共字体**：和 WebXiaoHeiWu `vendor/fonts/` 里的是同一个文件（user 2026-09-30「以后家族项目也慢慢都迁移过去」、2026-10-01「我们的公共字体也查收一下」）。

| 文件 | 是什么 |
|---|---|
| `sans.ttf.gz` | **思源黑体 / Noto Sans SC Regular**（静态 TrueType，31,036 字形，全量不取子集）的 gzip，6.3 MB。sha256 `e29b80bf17ad17bbd07b59642a817b04075b5a9001c53f4783e42c82188d575a` |
| `OFL.txt` | 许可证全文（SIL Open Font License 1.1；版权行在文件头） |

## 出处

逐字节拷自 `../20260516 WebXiaoHeiWu/vendor/fonts/`（WXHW commit `7627efb`，v2.3.15）。上游、定字重命令、覆盖范围、「没走的路」都写在那边的 `README.md`，这里不重复（两份说明会走样）。**换字体 = 先换 WXHW 那份，再拷过来对 sha256。** 唯一出处以后要不要单独开一个共享文件夹（学图标库 / 色彩库），等 user 定。

## JRB 怎么用

- 唯一入口 `src/fonts.ts`：`loadSansFace()` 取 → 看魔数解 gzip（浏览器自带 `DecompressionStream`）→ 解析成 `FontFace`，family = `JRB Sans`。
- `styles.css --font-reading-sans` 第一位是 `"JRB Sans"`；没到之前落到后面的系统字体。
- **不挡启动**：首帧之后的空闲片里才取；只有黑体档取，宋体档不下。装进文档时正文会重排，`app.ts ensureReadingFont()` 先记章内比例、装完对回去。
- service worker 不预缓存它（运行时缓存：用过一次即离线可用；换版本后壳缓存换名 → 下次开机重取。和 WXHW 同一个家族级毛病，要治得动 service-worker，没动）。
- 宋体档没有对应的公共字体，照旧用系统宋体。韩文谚文这份字体里没有，落系统字体。

## 许可证

SIL OFL 1.1：可随软件再分发；不得单独售卖字体文件；随附版权行与许可证全文（`OFL.txt`）。设置 →「应用」栏有署名行。
