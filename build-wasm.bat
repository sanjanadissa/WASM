@echo off
REM ═══════════════════════════════════════════════════════════════════
REM build-wasm.bat — Compile C image operations to WebAssembly (Windows)
REM
REM Usage:  build-wasm.bat
REM Requires: Emscripten SDK (emcc) in PATH
REM   Run "emsdk_env.bat" from your emsdk directory first!
REM ═══════════════════════════════════════════════════════════════════

echo Building WASM image processing module...

REM ── Check emcc is available ─────────────────────────────────────
where emcc >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: emcc not found!
    echo Make sure the Emscripten SDK is installed and activated:
    echo   cd emsdk ^&^& emsdk_env.bat
    exit /b 1
)

REM ── Paths ───────────────────────────────────────────────────────
set SCRIPT_DIR=%~dp0
set SRC_DIR=%SCRIPT_DIR%src\c
set OUT_DIR=%SCRIPT_DIR%public\wasm

REM Create output directory
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

REM ── Emscripten compilation ──────────────────────────────────────
REM
REM See build-wasm.sh for detailed flag explanations.
REM This is the exact same command, just formatted for Windows CMD.
REM

emcc "%SRC_DIR%\transforms.c" "%SRC_DIR%\filters.c" ^
  -O2 ^
  -s MODULARIZE=1 ^
  -s EXPORT_ES6=1 ^
  -s "EXPORTED_FUNCTIONS=['_flip_horizontal','_flip_vertical','_rotate_90_cw','_rotate_90_ccw','_rotate_180','_crop','_resize_bilinear','_grayscale','_invert_colors','_box_blur','_sharpen','_malloc','_free']" ^
  -s "EXPORTED_RUNTIME_METHODS=['HEAPU8','HEAP32','ccall','cwrap']" ^
  -s ALLOW_MEMORY_GROWTH=1 ^
  -s INITIAL_MEMORY=33554432 ^
  -s MAXIMUM_MEMORY=536870912 ^
  -s ENVIRONMENT='web' ^
  --no-entry ^
  -o "%OUT_DIR%\image_ops.js"

if %errorlevel% neq 0 (
    echo BUILD FAILED!
    exit /b 1
)

echo.
echo Build successful!
echo Output files:
echo   %OUT_DIR%\image_ops.js   (Emscripten loader)
echo   %OUT_DIR%\image_ops.wasm (WebAssembly binary)
dir "%OUT_DIR%\image_ops.*"
