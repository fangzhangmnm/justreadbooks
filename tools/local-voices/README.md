# 本机导入音色（import-only）

> created 2026-10-06 by Claude Fable 5.1

许可证不许家族再分发、但 user 想在 app 里用的音色放这里：`voices/<id>.json`（音色定义，形状同模型仓）+ `packs/<slug>/manifest.json`（清单原样，分片字节**不进仓、不上模型仓**，在检疫桶 `~/jupyter/third-party/sherpa-onnx-wasm/tts-probe/packs-local/`）。
`tools/gen-read-aloud-packs.mjs` 把它们和模型仓的音色一起内嵌，并列进 `READ_ALOUD_IMPORT_ONLY`：界面上**没有下载钮**，只有「从本机文件导入」，分片照样逐片对 manifest 的 sha256。

- `piper-xiao-ya`：rhasspy Piper `zh_CN-xiao_ya-medium`（int8），数据集标贝 BZNSYP 非商用 → 只准本机导入（user 2026-10-06「小雅能 vendor 吗，或者本地导入也行，我想测试一下真实的长文本」）。引擎 = sherpa-onnx（app vendor 的 WASM）。
