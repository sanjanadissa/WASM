/*
 * wasm-bridge.js — Clean async wrapper around the raw WASM module.
 *
 * PURPOSE:
 *   This module hides all the ugly _malloc / _free / HEAPU8 details
 *   from the rest of the application.  The UI code just calls e.g.
 *     const result = await bridge.flipHorizontal(imageData);
 *   and gets back a new ImageData object.
 *
 * HOW DATA CROSSES THE JS ↔ WASM BOUNDARY:
 *
 *   JavaScript and WebAssembly share a single ArrayBuffer called
 *   "linear memory".  When JS calls _malloc(n), the WASM allocator
 *   returns an integer offset (a "pointer") into this buffer.
 *
 *   To pass pixel data TO WASM:
 *     1. Call _malloc to get a pointer.
 *     2. Use Module.HEAPU8.set(data, ptr) to copy bytes into WASM
 *        memory at that offset.
 *
 *   To read pixel data FROM WASM:
 *     1. After the C function writes its output at outPtr, create a
 *        JS typed array view: new Uint8ClampedArray(
 *            Module.HEAPU8.buffer, outPtr, length)
 *     2. This is a VIEW — it aliases the same ArrayBuffer.  You must
 *        copy it out (via .slice() or new Uint8ClampedArray(view))
 *        before freeing the pointer, because _free might invalidate it.
 *
 *   MEMORY GROWTH HAZARD:
 *     When ALLOW_MEMORY_GROWTH=1, any _malloc call might grow the
 *     underlying ArrayBuffer.  This DETACHES all existing typed array
 *     views (HEAPU8 etc.).  After each _malloc, we must re-read
 *     Module.HEAPU8 from the module object — don't cache it in a local
 *     variable.
 */

/** @type {any} */
let Module = null;

/**
 * Initialize the WASM module.  Must be called once before any
 * image operations.
 *
 * Emscripten was compiled with MODULARIZE=1 and EXPORT_ES6=1,
 * which means the .js loader exports a factory function.  Calling
 * it returns a Promise that resolves when the .wasm binary has been
 * fetched, compiled, and instantiated.
 */
export async function initWasm() {
  // Fetch the Emscripten loader script as text and instantiate it via Blob URL.
  // This cleanly avoids Vite's [plugin:vite:import-analysis] restriction which disallows
  // directly importing JavaScript files located inside the /public directory.
  const response = await fetch('/wasm/image_ops.js');
  if (!response.ok) {
    throw new Error(
      `Failed to fetch /wasm/image_ops.js (${response.status} ${response.statusText}). ` +
      `Ensure you compiled the WebAssembly module with 'npm run build:wasm'.`
    );
  }

  const scriptText = await response.text();
  const blob = new Blob([scriptText], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);

  let factory;
  try {
    const moduleExports = await import(/* @vite-ignore */ blobUrl);
    factory = moduleExports.default || moduleExports;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }

  if (typeof factory !== 'function') {
    throw new Error('WASM loader did not export a module factory function.');
  }

  Module = await factory({
    locateFile: (path) => `/wasm/${path}`,
    print: (text) => console.log('[WASM]', text),
    printErr: (text) => console.error('[WASM]', text),
  });

  console.log('WASM module initialized successfully');
}

/**
 * Check if the module is ready.
 */
export function isReady() {
  return Module !== null;
}

/* ═══════════════════════════════════════════════════════════════════
 * HELPER:  allocate WASM memory, copy pixels in, run a C function,
 * copy pixels out, free memory.
 *
 * This is the heart of the JS ↔ WASM bridge.  Every public function
 * below delegates to this helper.
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * @typedef {Object} WasmOpResult
 * @property {ImageData} imageData - The resulting ImageData
 * @property {number} elapsed - Time taken in milliseconds
 */

/**
 * Run a same-size operation (output is same width×height as input).
 *
 * @param {ImageData} imageData - Source image data from a canvas
 * @param {string} funcName - Name of the C function (e.g. '_flip_horizontal')
 * @param {number[]} extraArgs - Additional arguments after (in, out, w, h)
 * @returns {WasmOpResult}
 */
function runSameSize(imageData, funcName, extraArgs = []) {
  const { width, height } = imageData;
  const byteLen = width * height * 4;

  const t0 = performance.now();

  /*
   * Step 1: Allocate input and output buffers in WASM linear memory.
   *
   * _malloc returns a byte offset ("pointer") into the WASM heap.
   * We allocate separately because the C function reads from `in`
   * and writes to `out` — they must not overlap.
   */
  const inPtr  = Module._malloc(byteLen);
  const outPtr = Module._malloc(byteLen);

  /*
   * MEMORY GROWTH NOTE:
   * After _malloc, the underlying ArrayBuffer may have been replaced
   * (grown).  We must access Module.HEAPU8 AFTER all allocations,
   * never cache it before _malloc.
   */

  /*
   * Step 2: Copy pixel data from JS into WASM memory.
   *
   * Module.HEAPU8 is a Uint8Array view of the entire WASM linear
   * memory.  The .set() method copies our pixel bytes at the offset
   * given by inPtr.
   */
  Module.HEAPU8.set(imageData.data, inPtr);

  /*
   * Step 3: Call the C function.
   *
   * Module.ccall invokes a C function by name.  We pass:
   *   - function name (without the leading underscore)
   *   - return type ('number' or null)
   *   - array of argument types
   *   - array of argument values
   *
   * Alternatively, we could use Module['_funcName'](args...) directly,
   * since we exported these functions.  ccall is slightly safer because
   * it handles type conversions.
   *
   * Here we call the raw exported function directly for speed.
   */
  Module['_' + funcName](inPtr, outPtr, width, height, ...extraArgs);

  /*
   * Step 4: Read the result back from WASM memory.
   *
   * We create a typed array view into WASM memory at outPtr, then
   * COPY it with .slice() because the view would be invalidated
   * as soon as we _free the pointer.
   */
  const resultPixels = new Uint8ClampedArray(
    Module.HEAPU8.buffer, outPtr, byteLen
  ).slice();

  /*
   * Step 5: Free both buffers.
   *
   * We must free what we malloc'd to avoid leaking WASM memory.
   */
  Module._free(inPtr);
  Module._free(outPtr);

  const elapsed = performance.now() - t0;

  return {
    imageData: new ImageData(resultPixels, width, height),
    elapsed
  };
}

/**
 * Run an operation that changes the image dimensions.
 * Uses a ResultInfo struct (2 × int32) to read back the new width/height.
 *
 * @param {ImageData} imageData
 * @param {string} funcName
 * @param {number} outW - Expected output width (for allocation)
 * @param {number} outH - Expected output height (for allocation)
 * @param {function} buildArgs - Function(inPtr, outPtr, infoPtr) → argument array
 * @returns {WasmOpResult}
 */
function runResizing(imageData, funcName, outW, outH, buildArgs) {
  const { width, height } = imageData;
  const inBytes  = width * height * 4;
  const outBytes = outW * outH * 4;

  const t0 = performance.now();

  const inPtr   = Module._malloc(inBytes);
  const outPtr  = Module._malloc(outBytes);

  /*
   * Allocate 8 bytes for the ResultInfo struct.
   * This is a tiny block of WASM memory where the C function will
   * write two int32 values: [newWidth, newHeight].
   *
   * In C, the struct is:
   *   typedef struct { int32_t width; int32_t height; } ResultInfo;
   *
   * In JS, we read them from HEAP32 (Int32Array view of WASM memory):
   *   newW = Module.HEAP32[infoPtr >> 2]       // first int32
   *   newH = Module.HEAP32[(infoPtr >> 2) + 1] // second int32
   *
   * The ">> 2" converts a byte offset to an int32 index, because
   * HEAP32 is indexed in units of 4 bytes.
   */
  const infoPtr = Module._malloc(8);

  // Re-read HEAPU8 after all allocations (memory may have grown)
  Module.HEAPU8.set(imageData.data, inPtr);

  // Call the C function with the argument list built by the caller
  const args = buildArgs(inPtr, outPtr, infoPtr);
  Module['_' + funcName](...args);

  /*
   * Read the new dimensions from the ResultInfo struct.
   * HEAP32 is an Int32Array view — each element is 4 bytes.
   */
  const newWidth  = Module.HEAP32[infoPtr >> 2];
  const newHeight = Module.HEAP32[(infoPtr >> 2) + 1];

  const actualOutBytes = newWidth * newHeight * 4;
  const resultPixels = new Uint8ClampedArray(
    Module.HEAPU8.buffer, outPtr, actualOutBytes
  ).slice();

  Module._free(inPtr);
  Module._free(outPtr);
  Module._free(infoPtr);

  const elapsed = performance.now() - t0;

  return {
    imageData: new ImageData(resultPixels, newWidth, newHeight),
    elapsed
  };
}

/**
 * Run a filter that needs a temporary scratch buffer (blur, sharpen).
 */
function runWithTemp(imageData, funcName, extraArgs = []) {
  const { width, height } = imageData;
  const byteLen = width * height * 4;

  const t0 = performance.now();

  const inPtr  = Module._malloc(byteLen);
  const outPtr = Module._malloc(byteLen);
  const tmpPtr = Module._malloc(byteLen); // scratch buffer for the C code

  Module.HEAPU8.set(imageData.data, inPtr);

  Module['_' + funcName](inPtr, outPtr, tmpPtr, width, height, ...extraArgs);

  const resultPixels = new Uint8ClampedArray(
    Module.HEAPU8.buffer, outPtr, byteLen
  ).slice();

  Module._free(inPtr);
  Module._free(outPtr);
  Module._free(tmpPtr);

  const elapsed = performance.now() - t0;

  return {
    imageData: new ImageData(resultPixels, width, height),
    elapsed
  };
}

/* ═══════════════════════════════════════════════════════════════════
 * PUBLIC API — clean, async-friendly functions
 *
 * Each function takes an ImageData and returns { imageData, elapsed }.
 * The calling code doesn't need to know about pointers, _malloc, etc.
 * ═══════════════════════════════════════════════════════════════════ */

/* ── Transforms ─────────────────────────────────────────────────── */

export function flipHorizontal(imageData) {
  return runSameSize(imageData, 'flip_horizontal');
}

export function flipVertical(imageData) {
  return runSameSize(imageData, 'flip_vertical');
}

export function rotate90CW(imageData) {
  const { width, height } = imageData;
  // After 90° CW rotation, output is height × width
  return runResizing(imageData, 'rotate_90_cw', height, width,
    (inPtr, outPtr, infoPtr) => [inPtr, outPtr, width, height, infoPtr]
  );
}

export function rotate90CCW(imageData) {
  const { width, height } = imageData;
  return runResizing(imageData, 'rotate_90_ccw', height, width,
    (inPtr, outPtr, infoPtr) => [inPtr, outPtr, width, height, infoPtr]
  );
}

export function rotate180(imageData) {
  return runSameSize(imageData, 'rotate_180');
}

export function cropImage(imageData, cx, cy, cw, ch) {
  return runResizing(imageData, 'crop', cw, ch,
    (inPtr, outPtr, infoPtr) => [
      inPtr, outPtr, imageData.width, imageData.height,
      cx, cy, cw, ch, infoPtr
    ]
  );
}

export function resizeBilinear(imageData, newW, newH) {
  return runResizing(imageData, 'resize_bilinear', newW, newH,
    (inPtr, outPtr, infoPtr) => [
      inPtr, outPtr, imageData.width, imageData.height,
      newW, newH, infoPtr
    ]
  );
}

/* ── Filters ────────────────────────────────────────────────────── */

export function applyGrayscale(imageData) {
  return runSameSize(imageData, 'grayscale');
}

export function applyInvert(imageData) {
  return runSameSize(imageData, 'invert_colors');
}

export function applyBlur(imageData, radius) {
  return runWithTemp(imageData, 'box_blur', [radius]);
}

export function applySharpen(imageData, strength) {
  return runWithTemp(imageData, 'sharpen', [strength]);
}
