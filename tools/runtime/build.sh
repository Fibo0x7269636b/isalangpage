#!/usr/bin/env bash
# Builds the Isalang C runtime (../isalang/runtime) as an Emscripten module for the Lab.
# Objects emitted by isac.wasm are instantiated separately and import isac_rt_*
# from this module (see src/lab/engine/wasm-object.js).
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
ISALANG_SRC=${ISALANG_SRC:-$ROOT/../isalang}
EMSDK_ROOT=${EMSDK_ROOT:-$ROOT/build-wasm/toolchain/emsdk}
OUT=${OUT:-$ROOT/public/isac}
export EM_CONFIG="$EMSDK_ROOT/.emscripten"
source "$EMSDK_ROOT/emsdk_env.sh" >/dev/null 2>&1

HEADER="$ISALANG_SRC/runtime/include/isac_runtime.h"
# Every public entry point except the pthread-backed ones (single-threaded build).
EXPORTS=$(grep -oE '\bisac_rt_[A-Za-z0-9_]+\s*\(' "$HEADER" | sed -E 's/\s*\($//' | sort -u \
  | grep -v '^isac_rt_thread_' | sed 's/^/_/' | paste -sd, -)
EXPORTS="$EXPORTS,_isac_rt_test_allocations,_isac_rt_test_frees,_malloc,_free,_fflush"

mkdir -p "$OUT"
emcc "$ISALANG_SRC/runtime/src/isac_runtime.c" "$ISALANG_SRC/runtime/src/isac_allocator_libc.c" \
  -I "$ISALANG_SRC/runtime/include" -DISAC_RT_TESTING -O2 \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createIsacRuntime \
  -sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=16777216 \
  -sMAXIMUM_MEMORY=1073741824 -sSTACK_SIZE=1048576 \
  -sEXIT_RUNTIME=0 -sINVOKE_RUN=0 --no-entry -sFILESYSTEM=1 -sFORCE_FILESYSTEM=1 \
  "-sEXPORTED_FUNCTIONS=$EXPORTS" \
  "-sEXPORTED_RUNTIME_METHODS=FS,HEAPU8,wasmMemory,stringToUTF8,lengthBytesUTF8" \
  -o "$OUT/isac-runtime.mjs"
echo "runtime exports: $(echo "$EXPORTS" | tr ',' '\n' | wc -l)"
ls -l "$OUT"/isac-runtime.*
