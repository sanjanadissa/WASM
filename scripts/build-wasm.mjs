import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT_DIR = resolve(__dirname, '..');
const SRC_DIR = resolve(ROOT_DIR, 'src', 'c');
const OUT_DIR = resolve(ROOT_DIR, 'public', 'wasm');

if (!existsSync(OUT_DIR)) {
  mkdirSync(OUT_DIR, { recursive: true });
}

console.log('Building WASM image processing module with emcc...');

const sources = [
  resolve(SRC_DIR, 'transforms.c'),
  resolve(SRC_DIR, 'filters.c')
];

const outputFile = resolve(OUT_DIR, 'image_ops.js');

const args = [
  ...sources,
  '-O2',
  '-s', 'MODULARIZE=1',
  '-s', 'EXPORT_ES6=1',
  '-s', "EXPORTED_FUNCTIONS=['_flip_horizontal','_flip_vertical','_rotate_90_cw','_rotate_90_ccw','_rotate_180','_crop','_resize_bilinear','_grayscale','_invert_colors','_box_blur','_sharpen','_malloc','_free']",
  '-s', "EXPORTED_RUNTIME_METHODS=['HEAPU8','HEAP32','ccall','cwrap']",
  '-s', 'ALLOW_MEMORY_GROWTH=1',
  '-s', 'INITIAL_MEMORY=33554432',
  '-s', 'MAXIMUM_MEMORY=536870912',
  '-s', "ENVIRONMENT='web'",
  '--no-entry',
  '-o', outputFile
];

// On Windows, emcc is often a cmd/bat wrapper (emcc.bat)
const command = 'emcc';

const result = spawnSync(command, args, {
  stdio: 'inherit',
  shell: true,
  cwd: ROOT_DIR
});

if (result.error) {
  console.error('\n[Error running emcc]:', result.error.message);
  console.error('Make sure Emscripten SDK is installed and activated in this terminal:');
  console.error(process.platform === 'win32' ? '  emsdk_env.bat' : '  source ./emsdk_env.sh');
  process.exit(1);
}

if (result.status !== 0) {
  console.error(`\n[Build failed with exit code ${result.status}]`);
  process.exit(result.status ?? 1);
}

console.log('\n[WASM Build Succeeded]');
console.log(`Outputs in: ${OUT_DIR}`);
