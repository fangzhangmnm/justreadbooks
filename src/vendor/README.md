# vendor/

第三方 JS 库整包 vendor 进来,**不走 CDN**。

理由:
- 旅馆网 / 飞机网 / 公司限速代理 拉不动 CDN 时,app 仍然能用
- Edge 的 "Tracking Prevention" 会拦截某些跨域 storage 访问(对 SW 缓存跨源 CDN 资源尤其不友好)
- PWA 主屏冷启动时网络不一定立刻有

体积代价 ≈ 4.4 MB,可以接受。

## 子目录

### `pdfjs/`

[`pdfjs-dist@4.10.38`](https://www.npmjs.com/package/pdfjs-dist),Mozilla 的 PDF 渲染器。

| 文件 | 说明 |
|---|---|
| `pdf.mjs` | 主库 ESM (用 `pdf.min.mjs` 重命名) |
| `pdf.worker.mjs` | Worker 入口 (用 `pdf.worker.min.mjs` 重命名) |
| `web/pdf_viewer.mjs` | 高层 viewer 组件 (PDFViewer / EventBus / LinkService) |
| `web/pdf_viewer.css` | viewer 样式 |
| `web/images/` | viewer UI 用到的小图标 |
| `cmaps/` | 中日韩 PDF 字符映射表 (.bcmap),非 ASCII PDF 必需 |
| `standard_fonts/` | PDF 标准字体替代品 (Foxit + Liberation),PDF 没嵌字体时用 |

代码里通过 `import.meta.url` 拼相对路径加载,参见 [src/viewer-pdf.js](../viewer-pdf.js)。

### `msal/`

[`@azure/msal-browser@3.27.0`](https://www.npmjs.com/package/@azure/msal-browser),Microsoft 登录库。

| 文件 | 说明 |
|---|---|
| `msal-browser.min.js` | 全部 |

通过 `<script src="...">` 注入,参见 [src/auth.js](../auth.js)。

## 更新流程

1. 改 [src/config.js](../config.js) 顶部的 `PDFJS_VERSION` / MSAL 版本注释(如有)
2. `curl -sL https://registry.npmjs.org/<pkg>/-/<pkg>-<ver>.tgz -o /tmp/x.tgz`
3. 解压 + 把对应文件 cp 进来 (略过 sourcemap `.map` 和 `.d.ts` 类型声明)
4. 用 `.min.mjs` / `.min.js` 重命名成 `.mjs` / `.js` (省 bundling 体积,debug 时回退源版本)
5. 更新 [service-worker.js](../../service-worker.js) 的 `PRECACHE_URLS` + bump `CACHE_VERSION`
6. 本地跑 `python3 -m http.server` 验一遍 PDF + 登录都还行
7. commit + push

## 为什么不用 jsdelivr / unpkg?

参见 [docs/01-pwa-hot-update.md](../../docs/01-pwa-hot-update.md):跨源 CDN 在 PWA SW + Edge 隐私保护下偶尔抓不到,导致离线模式打不开 PDF / 登不上。整包 vendor 同源,SW 一次 precache 完一劳永逸。
