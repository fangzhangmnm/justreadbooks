# sherpa-onnx WebAssembly（自编，vendored）

> created 2026-09-03 by Claude Fable 5.1

- 源：k2-fsa/sherpa-onnx **v1.13.7**（Apache-2.0，`LICENSE` 同目录）；onnxruntime wasm static lib **1.27.1**（MIT，csukuangfj/onnxruntime-libs）。
- 工具链：emsdk **4.0.23**（sherpa 钉的版本，别换）。构建 = 仓库自带 `build-wasm-simd-web.sh`（本地把 `wasm/wasm-common.cmake` 的 `INITIAL_MEMORY` 从 512MB 改成 **64MB**，靠 `ALLOW_MEMORY_GROWTH` 按需长——Quest 上少预留、也让堆大小暴露真实用量）（`wasm/web` 目标：`MODULARIZE` + `EXPORT_NAME=SherpaOnnx` + 导出 `FS`，**不烤模型进 .data**，模型运行时 `FS.writeFile` 进 MEMFS）。
- 构建现场：`~/jupyter/third-party/sherpa-onnx-wasm/`（检疫桶：emsdk + 源码 + 模型原包 + build log）。
- 产物：`sherpa-onnx-wasm-web.js`（emscripten 胶水，SIMD、单线程、无 pthreads → 不需要 COOP/COEP）、`sherpa-onnx-wasm-web.wasm`（15 MB，含 TTS/说话人分离等全家桶——**生产前要裁**：关 `SHERPA_ONNX_ENABLE_TTS` 等重编）、`sherpa-onnx-asr.js`（sherpa 的 JS 包装：`createOnlineRecognizer(Module, cfg)` / `new OfflineRecognizer(cfg, Module)`，原样拷自 `wasm/asr/`）。
- 生成物勿手改；升级 = 重跑构建后整目录覆盖。

---

> JustReadBooks copy, 2026-10-06 by Claude Fable 5.1: `sherpa-onnx-wasm-web.{js,wasm}` + `LICENSE` copied byte-for-byte from WebXiaoHeiWu `vendor/sherpa-onnx-wasm/` (same build, TTS compiled in); `sherpa-onnx-tts.js` = upstream sherpa-onnx v1.13.7 `wasm/tts/sherpa-onnx-tts.js` unmodified (the `@internal/read-aloud` sherpa backend needs it next to the glue). Used only by the read-aloud sherpa worker (`engineBase`); not precached by the service worker — fetched the first time a sherpa voice is loaded.
