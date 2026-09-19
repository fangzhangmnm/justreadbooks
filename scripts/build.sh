#!/usr/bin/env bash
# scripts/build.sh —— src/app.ts → dist/jrb-<hash>.mjs；in-place 改 index.html 引新 hash。created 2026-09-19 by Claude Fable 5.1（抄 WXHW 2.0 build.sh）
# （bundle 名 jrb-；service-worker.js 的 install regex 必须跟它一致。）
# 用法：编辑 src/ → bash scripts/build.sh → git commit && git push origin main（main→/dev/；prod 分支另说，硬规则 #5）
set -euo pipefail
cd "$(dirname "$0")/.."

ENTRY="./src/app.ts"
OUT_DIR="./dist"
ESBUILD_VER="0.24.0"
ESBUILD="./tools/esbuild/esbuild"

if [ ! -x "$ESBUILD" ]; then
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)   plat="linux-x64" ;;
    Linux-aarch64)  plat="linux-arm64" ;;
    Darwin-arm64)   plat="darwin-arm64" ;;
    Darwin-x86_64)  plat="darwin-x64" ;;
    *) echo "[build] unknown platform $(uname -s)-$(uname -m); vendor esbuild into $ESBUILD by hand" >&2; exit 1 ;;
  esac
  # 兄弟仓已有同版 esbuild 就直接拷（断网也能建）；否则从 npm registry 取
  SIB="../20260516 WebXiaoHeiWu/tools/esbuild/esbuild"
  mkdir -p tools/esbuild
  if [ -x "$SIB" ] && "$SIB" --version 2>/dev/null | grep -q "^$ESBUILD_VER"; then
    cp "$SIB" "$ESBUILD"; chmod +x "$ESBUILD"; echo "[build] esbuild copied from WXHW"
  else
    echo "[build] fetching esbuild $plat-$ESBUILD_VER…"
    TMP=$(mktemp -d)
    curl -sL "https://registry.npmjs.org/@esbuild/${plat}/-/${plat}-${ESBUILD_VER}.tgz" | tar -xz -C "$TMP"
    mv "$TMP/package/bin/esbuild" "$ESBUILD"; chmod +x "$ESBUILD"; rm -rf "$TMP"
  fi
fi

# 0. 类型门（tsc --noEmit 是构建前置硬门；esbuild 只 strip 不检查）
TSC="./node_modules/.bin/tsc"
if [ -x "$TSC" ]; then
  echo "[build] tsc --noEmit…"
  "$TSC" --noEmit -p tsconfig.json || { echo "[build] ✗ type check failed — build blocked" >&2; exit 1; }
  echo "[build] ✓ types ok"
else
  echo "[build] ⚠ tsc not installed (npm install) — skipping type check" >&2
fi

# 0.5 接缝 lint（红线封口的真守卫）：
#   ① @internal/store 值级 import 只准 src/app-store.ts；@internal/encryption 只准 src/encryption.ts；别处 `import type`。
#   ② 禁 deep import 包内部（exports 门牌之外）与旧 baked 路径。
echo "[build] seam lint…"
HITS=$(grep -rnE "(from|import)[[:space:]]*\(?[[:space:]]*['\"]@internal/store['\"]" src --include='*.ts' | grep -v "^src/app-store.ts" | grep -v "import type" || true)
if [ -n "$HITS" ]; then echo "[build] ✗ value-level @internal/store import outside src/app-store.ts:" >&2; echo "$HITS" >&2; exit 1; fi
HITS=$(grep -rnE "(from|import)[[:space:]]*\(?[[:space:]]*['\"]@internal/encryption['\"]" src --include='*.ts' | grep -v "^src/encryption.ts" | grep -v "import type" || true)
if [ -n "$HITS" ]; then echo "[build] ✗ value-level @internal/encryption import outside src/encryption.ts:" >&2; echo "$HITS" >&2; exit 1; fi
HITS=$(grep -rnE "(from|import)[[:space:]]*\(?[[:space:]]*['\"](@internal/(store|encryption|gallery|workbench-elements)/[^'\"]+|(\.{1,2}/)+store/[^'\"]*)['\"]" src test --include='*.ts' --include='*.mjs' | grep -vE "@internal/store/testing['\"]|@internal/gallery/gallery.css|@internal/workbench-elements/workbench-elements.css" || true)
if [ -n "$HITS" ]; then echo "[build] ✗ deep import into package internals / legacy baked store path:" >&2; echo "$HITS" >&2; exit 1; fi
#   ③ 读者纪律：既有书永不改写——`.save(` 只准出现在上传模块 src/books.ts（uploadBook，mode:"new"）。
HITS=$(grep -rnE "\.save\(" src --include='*.ts' | grep -v "^src/books.ts" || true)
if [ -n "$HITS" ]; then echo "[build] ✗ file.save() outside src/books.ts (reader never rewrites a book):" >&2; echo "$HITS" >&2; exit 1; fi
echo "[build] ✓ seams clean"

# 0.6 图标 sprite 内联对账 + 裸中文扫描（用户可见文案全走 i18n SSoT）
python3 tools/inline-sprites.py --check || { echo "[build] ✗ icon sprite not inlined — run: python3 tools/inline-sprites.py" >&2; exit 1; }
if [ -x "./node_modules/.bin/tsc" ]; then
  RAW=$(node tools/hunt-raw-cjk.mjs 2>/dev/null || true)
  if [ -n "$RAW" ]; then echo "[build] ✗ raw CJK string literals outside i18n SSoT:" >&2; echo "$RAW" >&2; exit 1; fi
  echo "[build] ✓ no raw CJK literals"
fi

mkdir -p "$OUT_DIR"
TMP_OUT="$OUT_DIR/jrb-tmp.mjs"

# 1. esbuild bundle
"$ESBUILD" "$ENTRY" --bundle --format=esm --target=es2020 --minify --sourcemap=linked --tree-shaking=true --outfile="$TMP_OUT"

# 2. content hash → 文件名
HASH=$(sha256sum "$TMP_OUT" | awk '{print substr($1, 1, 12)}')
OUT="$OUT_DIR/jrb-$HASH.mjs"
mv "$TMP_OUT" "$OUT"
mv "$TMP_OUT.map" "$OUT.map"
sed -i "s|sourceMappingURL=$(basename "$TMP_OUT").map|sourceMappingURL=jrb-$HASH.mjs.map|" "$OUT"
find "$OUT_DIR" -maxdepth 1 -name 'jrb-*.mjs' -not -name "jrb-$HASH.mjs" -delete
find "$OUT_DIR" -maxdepth 1 -name 'jrb-*.mjs.map' -not -name "jrb-$HASH.mjs.map" -delete

# 3. index.html 指向新 hash
sed -i -E "s|src=\"\./dist/jrb-[a-z0-9-]+\.mjs\"|src=\"./dist/jrb-$HASH.mjs\"|" index.html
grep -q "jrb-$HASH.mjs" index.html || { echo "[build] ✗ index.html bundle reference not updated" >&2; exit 1; }

echo "[build] $OUT ($(stat -c%s "$OUT") bytes, hash=$HASH)"
