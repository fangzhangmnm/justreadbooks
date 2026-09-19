#!/usr/bin/env bash
# gen-api —— 全仓 API 头文件树（.h ritual，家族 2026-08-03 立）：api/ = tsc 生成的 .d.ts 纯签名树，供人类参考。生成物勿手改。
set -e
cd "$(dirname "$0")/.."
rm -rf api
npx tsc -p tsconfig.json --declaration --emitDeclarationOnly --noEmit false --outDir api
echo "[gen-api] → api/ ($(find api -name '*.d.ts' | wc -l) .d.ts)"
