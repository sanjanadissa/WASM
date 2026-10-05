#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# build-wasm.sh — Compile C image operations to WebAssembly
#
# Usage:  ./build-wasm.sh
# Requires: Emscripten SDK (emcc) in PATH
# ══════════════════════════════════════════════════════════════════════

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Building WASM image processing module...${NC}"

# ── Check emcc is available ─────────────────────────────────────────
if ! command -v emcc &> /dev/null; then
    echo -e "${RED}Error: emcc not found!${NC}"
    echo "Make sure the Emscripten SDK is installed and activated:"
    echo "  cd emsdk && source ./emsdk_env.sh"
    exit 1
fi

echo "Using emcc: $(emcc --version | head -1)"

# ── Paths ───────────────────────────────────────────────────────────
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SRC_DIR="${SCRIPT_DIR}/src/c"
OUT_DIR="${SCRIPT_DIR}/public/wasm"

# Create output directory
mkdir -p "${OUT_DIR}"

# ── Source files ────────────────────────────────────────────────────
SOURCES="${SRC_DIR}/transforms.c ${SRC_DIR}/filters.c"

# ── Emscripten compilation ──────────────────────────────────────────
#
# FLAGS EXPLAINED:
#
# -O2
#   Optimization level 2.  Good balance of speed and compile time.
#   -O3 is slightly faster but takes longer to compile.
#
# -s MODULARIZE=1
#   Wraps the output in a module factory function instead of
#   immediately executing.  This lets us control when and how
#   the WASM module is instantiated from JavaScript.
#
# -s EXPORT_ES6=1
#   Makes the generated .js file an ES6 module (export default)
#   instead of a CommonJS module.  Required for Vite/ESM imports.
#
# -s EXPORTED_FUNCTIONS=[...]
#   Lists the C functions to expose to JavaScript.  Each must be
#   prefixed with '_'.  We also export _malloc and _free so JS
#   can allocate/deallocate memory in the WASM heap.
#
# -s EXPORTED_RUNTIME_METHODS=[...]
#   Exports Emscripten runtime helpers.  HEAPU8 and HEAP32 are
#   typed array views into WASM linear memory.  ccall/cwrap are
#   convenience wrappers for calling C functions from JS.
#
# -s ALLOW_MEMORY_GROWTH=1
#   Lets the WASM memory grow beyond its initial size.  Without
#   this, _malloc will fail for large images.  IMPORTANT: when
#   memory grows, ALL typed array views (HEAPU8 etc.) are
#   DETACHED and must be re-read from the Module object.
#
# -s INITIAL_MEMORY=33554432
#   Start with 32 MB of memory.  This is enough for most images
#   without needing immediate growth.  32 MB = 32 * 1024 * 1024.
#
# -s MAXIMUM_MEMORY=536870912
#   Cap at 512 MB.  Prevents runaway allocation on huge images.
#
# -s ENVIRONMENT='web'
#   We only run in the browser, not Node.js.  This produces
#   smaller output by removing Node-specific code.
#
# --no-entry
#   We have no main() function — this is a library, not a program.
#

emcc ${SOURCES} \
  -O2 \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s "EXPORTED_FUNCTIONS=['_flip_horizontal','_flip_vertical','_rotate_90_cw','_rotate_90_ccw','_rotate_180','_crop','_resize_bilinear','_grayscale','_invert_colors','_box_blur','_sharpen','_malloc','_free']" \
  -s "EXPORTED_RUNTIME_METHODS=['HEAPU8','HEAP32','ccall','cwrap']" \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=33554432 \
  -s MAXIMUM_MEMORY=536870912 \
  -s ENVIRONMENT='web' \
  --no-entry \
  -o "${OUT_DIR}/image_ops.js"

echo -e "${GREEN}✓ Build successful!${NC}"
echo "Output files:"
echo "  ${OUT_DIR}/image_ops.js   (Emscripten loader)"
echo "  ${OUT_DIR}/image_ops.wasm (WebAssembly binary)"
ls -lh "${OUT_DIR}/image_ops.js" "${OUT_DIR}/image_ops.wasm"
