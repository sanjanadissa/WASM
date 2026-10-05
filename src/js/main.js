/*
 * main.js — Application entry point.
 *
 * Checks for WebAssembly support, initializes the WASM module,
 * sets up the canvas view, and boots the UI.
 */

import { initWasm, isReady } from './wasm-bridge.js';
import { initCanvasView } from './canvas-view.js';
import { initUI } from './ui.js';
import '../styles/main.css';

async function boot() {
  // ── Check WebAssembly support ──────────────────────────────────
  if (typeof WebAssembly === 'undefined') {
    document.getElementById('app').innerHTML = `
      <div class="wasm-error">
        <h2>WebAssembly Not Supported</h2>
        <p>Your browser doesn't support WebAssembly, which is required
           for this image editor's processing engine.</p>
        <p>Please use a modern browser like Chrome, Firefox, Safari, or Edge.</p>
      </div>
    `;
    return;
  }

  // ── Show boot loading ──────────────────────────────────────────
  const loadingEl = document.getElementById('boot-loading');
  if (loadingEl) loadingEl.classList.add('visible');

  try {
    // ── Initialize WASM module ─────────────────────────────────
    await initWasm();

    // ── Initialize canvas ──────────────────────────────────────
    const canvas = document.getElementById('editor-canvas');
    initCanvasView(canvas);

    // ── Initialize UI ──────────────────────────────────────────
    initUI();

    console.log('Image editor initialized successfully');
  } catch (err) {
    console.error('Failed to initialize:', err);
    document.getElementById('app').innerHTML = `
      <div class="wasm-error">
        <h2>Initialization Failed</h2>
        <p>Could not load the WebAssembly module. This usually means
           the WASM file wasn't found or the server isn't configured
           correctly.</p>
        <p class="error-detail">${err.message}</p>
        <p>Make sure you've built the WASM module (see README.md) and
           that the dev server is running.</p>
      </div>
    `;
  } finally {
    if (loadingEl) loadingEl.classList.remove('visible');
  }
}

// Start the app
boot();
