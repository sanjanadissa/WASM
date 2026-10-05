# WASM Image Editor

A browser-based image editor where **all image processing runs in WebAssembly** (compiled from C with Emscripten) and the UI is built with vanilla JavaScript + Vite.

![Architecture](https://img.shields.io/badge/C-WebAssembly-blueviolet) ![Frontend](https://img.shields.io/badge/JS-Vanilla-yellow) ![Build](https://img.shields.io/badge/Bundler-Vite-purple)

## Features

### Image Operations (all in C/WASM)
- **Transforms**: Flip horizontal/vertical, Rotate 90°CW/CCW/180°, Crop, Resize (bilinear)
- **Filters**: Grayscale (luminance-weighted), Invert, Box Blur (adjustable radius), Sharpen (adjustable strength)

### UI
- Open images via file picker or drag-and-drop
- Canvas with zoom (mouse wheel, presets), pan (hand tool), and fit-to-screen
- Crop tool with visual overlay
- Undo/Redo (20-step history)
- Export as PNG or JPEG
- Status bar showing image dimensions and WASM operation timing
- Keyboard shortcuts (V, H, C, Ctrl+Z, Ctrl+Y, +/-, 0, 1)
- Responsive design (desktop + tablet)

---

## Prerequisites

### 1. Node.js (v18+ recommended)

**Windows:**
```powershell
# Download from https://nodejs.org (LTS version)
# Or use winget:
winget install OpenJS.NodeJS.LTS
# Verify:
node --version   # Should be >= 18
npm --version
```

**macOS:**
```bash
# Using Homebrew:
brew install node
# Verify:
node --version
npm --version
```

**Linux (Ubuntu/Debian):**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
npm --version
```

### 2. Emscripten SDK (emsdk)

The Emscripten compiler toolchain compiles C/C++ code to WebAssembly.

**All platforms — clone and install:**
```bash
# Clone the emsdk repository
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk

# Install the latest version
./emsdk install latest
./emsdk activate latest
```

**Activate for your current terminal session:**

**Linux/macOS:**
```bash
source ./emsdk_env.sh
```

**Windows (CMD):**
```cmd
emsdk_env.bat
```

**Windows (PowerShell):**
```powershell
.\emsdk_env.ps1
# If you get a script execution policy error:
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\emsdk_env.ps1
```

**Verify installation:**
```bash
emcc --version
# Should show something like: emcc (Emscripten gcc/clang-like replacement...) 3.x.x
```

> **Tip**: Add the emsdk activation to your shell profile (~/.bashrc, ~/.zshrc) so you don't have to run it every time.

---

## Build & Run

### Step 1: Install npm dependencies
```bash
cd image-editor-wasm
npm install
```

### Step 2: Build the WASM module

**Linux/macOS:**
```bash
chmod +x build-wasm.sh
./build-wasm.sh
```

**Windows (CMD):**
```cmd
build-wasm.bat
```

**Windows (PowerShell):**
```powershell
cmd /c build-wasm.bat
```

This runs `emcc` with these flags (each explained):

| Flag | Purpose |
|------|---------|
| `-O2` | Optimization level 2 (fast output, reasonable compile time) |
| `-s MODULARIZE=1` | Wraps output in a factory function (we call it to init) |
| `-s EXPORT_ES6=1` | Generates an ES6 module (`export default`) for Vite |
| `-s EXPORTED_FUNCTIONS=[...]` | C functions exposed to JS (plus `_malloc`, `_free`) |
| `-s EXPORTED_RUNTIME_METHODS=[...]` | JS helpers: `HEAPU8`, `HEAP32`, `ccall`, `cwrap` |
| `-s ALLOW_MEMORY_GROWTH=1` | Lets WASM memory expand for large images |
| `-s INITIAL_MEMORY=33554432` | Start with 32 MB |
| `-s MAXIMUM_MEMORY=536870912` | Cap at 512 MB |
| `-s ENVIRONMENT='web'` | Browser-only (smaller output) |
| `--no-entry` | No `main()` — this is a library |

Output: `public/wasm/image_ops.js` + `public/wasm/image_ops.wasm`

### Step 3: Start the dev server
```bash
npm run dev
```
Opens `http://localhost:3000` in your browser.

### Step 4: Production build (optional)
```bash
npm run build
npm run preview    # Preview the production build locally
```

---

## Project Structure

```
image-editor-wasm/
├── package.json          # npm config, scripts
├── vite.config.js        # Vite dev server & build config
├── index.html            # Main HTML (toolbar, canvas, dialogs)
├── build-wasm.sh         # Linux/macOS WASM build script
├── build-wasm.bat        # Windows WASM build script
├── src/
│   ├── c/
│   │   ├── image_ops.h   # Shared header (API + memory contract docs)
│   │   ├── transforms.c  # Flip, rotate, crop, resize
│   │   └── filters.c     # Grayscale, invert, blur, sharpen
│   ├── js/
│   │   ├── main.js        # Entry point (boot, WASM init)
│   │   ├── wasm-bridge.js # JS↔WASM bridge (malloc/copy/free wrapper)
│   │   ├── editor-state.js# Undo/redo history manager
│   │   ├── canvas-view.js # Canvas rendering, zoom, pan, crop overlay
│   │   └── ui.js          # Toolbar, filter bar, dialogs, events
│   └── styles/
│       └── main.css       # All styles (glossy light UI)
├── public/
│   └── wasm/              # Compiled WASM output (generated)
│       ├── image_ops.js
│       └── image_ops.wasm
└── README.md
```

---

## Troubleshooting

### `emcc: command not found`
You haven't activated the Emscripten environment in your current terminal:
```bash
# Linux/macOS
source /path/to/emsdk/emsdk_env.sh

# Windows
/path/to/emsdk/emsdk_env.bat
```

### WASM MIME type error (`incorrect response MIME type`)
The browser requires `.wasm` files to be served as `application/wasm`. Vite handles this automatically. If you're using a different server (e.g., nginx), add:
```
types { application/wasm wasm; }
```

### CORS or module loading errors
Make sure you're accessing the app via `http://localhost:3000`, NOT by opening the HTML file directly (`file://...`). ES modules require a proper HTTP server.

### `HEAPU8 undefined` or `Module.HEAPU8 is not a function`
This means the WASM module hasn't finished initializing. The bridge module awaits initialization, so this shouldn't happen. If it does:
- Make sure `await initWasm()` completes before calling any operations
- Check the browser console for WASM loading errors

### `memory access out of bounds` or detached ArrayBuffer
This can happen when WASM memory grows (via `ALLOW_MEMORY_GROWTH`). After any `_malloc` call, existing typed array views (`HEAPU8`, `HEAP32`) are invalidated. The fix:
- Always access `Module.HEAPU8` (not a cached copy) after every `_malloc`
- The wasm-bridge.js module already handles this correctly

### Build succeeds but nothing shows
1. Check the browser console for errors
2. Make sure `public/wasm/image_ops.js` and `.wasm` exist
3. Try a hard refresh (Ctrl+Shift+R)

---

## How Data Flows Between JS and WASM

Here's the step-by-step journey of pixel data when you click "Grayscale":

```
1. UI click → ui.js calls bridge.applyGrayscale(imageData)

2. wasm-bridge.js:
   a. Measures time with performance.now()
   b. Calls Module._malloc(width × height × 4) → gets inPtr (byte offset)
   c. Calls Module._malloc(width × height × 4) → gets outPtr
   d. ⚠️ Re-reads Module.HEAPU8 (memory may have grown!)
   e. Module.HEAPU8.set(imageData.data, inPtr) — copies pixels INTO WASM

3. wasm-bridge.js calls Module._grayscale(inPtr, outPtr, width, height)
   → This enters WebAssembly land!

4. C code (filters.c):
   - Reads RGBA pixels from in[0..byteLen]
   - Computes luminance for each pixel
   - Writes grayscale RGBA to out[0..byteLen]

5. Back in JS (wasm-bridge.js):
   a. Creates a Uint8ClampedArray view at outPtr
   b. .slice() copies the data OUT of WASM memory (into JS)
   c. Calls Module._free(inPtr) and Module._free(outPtr)
   d. Wraps result in new ImageData(pixels, width, height)

6. ui.js receives the ImageData, draws it on the canvas, pushes
   to undo history, updates the status bar with timing info.
```

### Key insight: WASM memory is just a big ArrayBuffer
WebAssembly's "linear memory" is a single `ArrayBuffer`. Pointers from `_malloc` are byte offsets into this buffer. `HEAPU8` is a `Uint8Array` view of the same buffer, and `HEAP32` is an `Int32Array` view. That's why we divide byte offsets by 4 (`>> 2`) when reading `HEAP32`.

---

## Ideas for What to Add Next

1. **WASM SIMD (Single Instruction, Multiple Data)**
   Emscripten supports SIMD intrinsics that process 4 pixels at once. Add `-msimd128` to the build flags and use `wasm_v128_t` types. Can give 2-4× speedup on supported browsers.

2. **Web Workers for non-blocking processing**
   Currently the WASM calls block the main thread. Move the WASM module into a Web Worker and communicate via `postMessage`. Use `SharedArrayBuffer` + `Atomics` for zero-copy, or `transferable` ImageData for simple cases.

3. **More filters: sepia, brightness/contrast, hue shift, edge detection**
   These are all simple pixel-wise operations. Edge detection (Sobel) is a great way to practice convolution kernels in C.

4. **Layers and compositing**
   Implement alpha compositing in C (Porter-Duff operators). Let users stack multiple images and blend them. Good practice for more complex memory management.

5. **WASM Component Model / Interface Types**
   The emerging WASM Component Model (WIT) will eventually replace the manual malloc/copy/free dance with higher-level data passing. Watch the [Component Model proposal](https://github.com/WebAssembly/component-model) for progress.

---

## License

MIT — do whatever you want with it.

Project File Structure
image-editor-wasm/
├── index.html                  # Main UI structure and semantic markup
├── package.json                # Project dependencies and npm scripts
├── vite.config.js              # Vite server configuration & COOP/COEP headers
├── build-wasm.sh               # Bash compilation script (Linux / macOS / WSL)
├── build-wasm.bat              # Batch compilation script (Windows CMD)
├── scripts/
│   └── build-wasm.mjs          # Cross-platform Node.js build runner
├── public/
│   └── wasm/                   # Output destination for compiled WASM artifacts
│       ├── image_ops.js        # (Generated) Emscripten ES6 module loader
│       └── image_ops.wasm      # (Generated) Compiled WebAssembly binary
├── src/
│   ├── c/                      # C source files (all image processing)
│   │   ├── image_ops.h         # Function declarations, types, export macros
│   │   ├── transforms.c        # Flips, rotations, crop, bilinear resize
│   │   └── filters.c           # Grayscale, invert, box blur, sharpen
│   ├── js/                     # Vanilla ES Module frontend
│   │   ├── main.js             # Application bootstrap & initialization
│   │   ├── wasm-bridge.js      # JS <-> WASM memory management & function wrapping
│   │   ├── editor-state.js     # State store & undo/redo history management
│   │   ├── canvas-view.js      # Zoom, pan, viewport rendering & crop overlay
│   │   └── ui.js               # Event handlers, toolbar bindings, dialogs
│   └── styles/
│       └── main.css            # Dark mode UI, toolbars, status bar, modals
└── README.md                   # Complete documentation and reference guide


Key Concept: How Data & Memory Cross the JS ↔ WASM Boundary
WebAssembly executes in a sandboxed linear memory space represented in JavaScript as a single expandable WebAssembly.Memory buffer (ArrayBuffer). C pointers are simply integer byte offsets into this buffer.

+-------------------------------------------------------------------------+
| JavaScript Environment                                                  |
|                                                                         |
|  canvas.getImageData() -> Uint8ClampedArray (RGBA bytes in JS heap)     |
|                                                                         |
|   1. _malloc(n) --------------------+ (allocate memory)                 |
|   2. Module.HEAPU8.set(data, inPtr) | (copy bytes into WASM heap)       |
|                                     v                                   |
|   +-----------------------------------------------------------------+   |
|   | WASM Linear Memory (Module.HEAPU8.buffer)                       |   |
|   |                                                                 |   |
|   |  Offset: inPtr                    Offset: outPtr                |   |
|   |  +--------------------------+     +--------------------------+  |   |
|   |  | Input RGBA Pixels        | --> | Output RGBA Pixels       |  |   |
|   |  +--------------------------+     +--------------------------+  |   |
|   |         ^                                      |                |   |
|   +---------|--------------------------------------|----------------+   |
|             |                                      |                    |
|             +--- C function processes pixels ------+                    |
|                  (e.g., _box_blur(in, out, ...))                        |
|                                                                         |
|   3. view = new Uint8ClampedArray(HEAPU8.buffer, outPtr, n)             |
|   4. copiedData = new Uint8ClampedArray(view)   (copy back to JS heap)  |
|   5. _free(inPtr); _free(outPtr);              (prevent memory leaks)   |
|   6. putImageData(new ImageData(copiedData))                            |
+-------------------------------------------------------------------------+

## Passing Data to WASM
Call _malloc(byteLength) to reserve an allocation in WASM memory, returning inPtr.
Copy pixels from JS into WASM using Module.HEAPU8.set(sourceUint8Array, inPtr).
## Executing Operations
Call the C function passing inPtr, outPtr, width, height, and operation parameters.
## Retrieving Data from WASM
Instantiate a temporary view: new Uint8ClampedArray(Module.HEAPU8.buffer, outPtr, outLength).
Copy the view into an independent buffer before freeing: new Uint8ClampedArray(view).
## Freeing Memory
Explicitly call _free(inPtr) and _free(outPtr) to prevent WASM heap exhaustion.
## Memory Growth Hazard:
With ALLOW_MEMORY_GROWTH=1, allocations expanding the memory buffer will detach existing ArrayBuffer views. 

wasm-bridge.js
 accesses Module.HEAPU8 directly after each allocation to always reference the active buffer.

 Step-by-Step Instructions: Install, Build, and Run
Step 1: Install Node.js
Ensure Node.js (v18 or higher) is installed:

Windows: winget install OpenJS.NodeJS.LTS or download from nodejs.org.
Verify in your terminal:
powershell
node --version
npm --version
Step 2: Install and Activate Emscripten SDK (emsdk)
If Emscripten is not yet installed:

powershell
# 1. Clone emsdk
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
# 2. Install and activate the latest toolchain
./emsdk install latest
./emsdk activate latest
# 3. Activate environment variables for the current terminal session
# On Windows PowerShell:
.\emsdk_env.ps1
# On Windows CMD:
emsdk_env.bat
# On Linux / macOS / WSL:
source ./emsdk_env.sh
Verify emcc is accessible:

powershell
emcc --version
Step 3: Install Project Dependencies
In the 

image-editor-wasm
 folder:

powershell
cd c:\Users\Asus\OneDrive\Desktop\CODIMITE\WASM\image-editor-wasm
npm install
Step 4: Compile the C Code to WebAssembly
Run any of the build commands (with your emsdk environment active):

Using npm:
powershell
npm run build:wasm
Or directly using the Windows batch script:
cmd
build-wasm.bat
Or on Linux/macOS/Git Bash:
bash
chmod +x build-wasm.sh
./build-wasm.sh
This outputs:



public/wasm/image_ops.js
 (ES6 module loader)
public/wasm/image_ops.wasm (Compiled WebAssembly binary)
Step 5: Start the Development Server
powershell
npm run dev
Open your browser to http://localhost:3000 to interact with the WASM image editor.