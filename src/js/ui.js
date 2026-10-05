/*
 * ui.js — Toolbar, filter bar, sliders, dialogs, and all DOM event wiring.
 *
 * This module creates and manages all the UI chrome around the canvas:
 *   - Top toolbar (tools, zoom, undo/redo, export)
 *   - Bottom filter bar
 *   - Slider modals for blur/sharpen/resize
 *   - File open (picker + drag-and-drop)
 *   - Status bar (dimensions + timing)
 *   - Loading overlay
 */

import * as bridge from './wasm-bridge.js';
import * as state from './editor-state.js';
import * as view from './canvas-view.js';

/* ═══════════════════════════════════════════════════════════════════
 * SVG ICONS (inline, no external dependencies)
 * ═══════════════════════════════════════════════════════════════════ */

const ICONS = {
  cursor: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="m13 13 6 6"/></svg>`,

  hand: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v0"/><path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 13"/></svg>`,

  fitScreen: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`,

  rotate: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`,

  crop: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>`,

  flipH: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><line x1="12" y1="1" x2="12" y2="23"/></svg>`,

  flipV: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3"/><path d="M3 16v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><line x1="1" y1="12" x2="23" y2="12"/></svg>`,

  undo: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>`,

  redo: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>`,

  open: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,

  download: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,

  grayscale: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20" fill="currentColor" opacity="0.3"/></svg>`,

  invert: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 0 0 20" fill="currentColor"/></svg>`,

  blur: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7" opacity="0.4"/><circle cx="12" cy="12" r="10" opacity="0.2"/></svg>`,

  sharpen: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,2 22,22 2,22"/></svg>`,

  resize: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15,3 21,3 21,9"/><polyline points="9,21 3,21 3,15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`,

  check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20,6 9,17 4,12"/></svg>`,

  x: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,

  zoomIn: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`,

  zoomOut: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`,
};


/* ═══════════════════════════════════════════════════════════════════
 * STATE
 * ═══════════════════════════════════════════════════════════════════ */

let isProcessing = false;

/* ═══════════════════════════════════════════════════════════════════
 * INITIALIZATION
 * ═══════════════════════════════════════════════════════════════════ */

export function initUI() {
  setupToolbar();
  setupFilterBar();
  setupFileHandling();
  setupKeyboardShortcuts();
  setupStatusBar();

  // Undo/redo state tracking
  state.onHistoryChange(({ canUndo, canRedo }) => {
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    if (btnUndo) {
      btnUndo.classList.toggle('disabled', !canUndo);
      btnUndo.disabled = !canUndo;
    }
    if (btnRedo) {
      btnRedo.classList.toggle('disabled', !canRedo);
      btnRedo.disabled = !canRedo;
    }
  });

  // Zoom display
  view.onZoomChange((z) => {
    document.getElementById('zoom-value').textContent = `${Math.round(z * 100)}%`;
  });
}

/* ═══════════════════════════════════════════════════════════════════
 * TOOLBAR (actions, tools, zoom, undo/redo, export)
 * ═══════════════════════════════════════════════════════════════════ */

let currentActiveFilter = null;

export function setActiveFilter(filterName) {
  currentActiveFilter = filterName || null;
  const filterBtns = {
    grayscale: document.getElementById('btn-grayscale'),
    invert: document.getElementById('btn-invert'),
    blur: document.getElementById('btn-blur'),
    sharpen: document.getElementById('btn-sharpen'),
  };

  for (const [key, btn] of Object.entries(filterBtns)) {
    if (!btn) continue;
    const isActive = key === currentActiveFilter;
    btn.classList.toggle('active', isActive);
    btn.classList.toggle('selected', isActive);
  }
}

function performUndo() {
  const img = state.undo();
  if (img) {
    view.updateImage(img);
    const meta = state.getCurrentMeta();
    setActiveFilter(meta?.filter || null);
    updateStatus();
  }
}

function performRedo() {
  const img = state.redo();
  if (img) {
    view.updateImage(img);
    const meta = state.getCurrentMeta();
    setActiveFilter(meta?.filter || null);
    updateStatus();
  }
}

function setupToolbar() {
  // Open
  document.getElementById('btn-open').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });

  // Tool buttons
  document.getElementById('btn-select').addEventListener('click', () => setActiveTool('select'));
  document.getElementById('btn-hand').addEventListener('click', () => setActiveTool('hand'));

  // Fit to screen
  document.getElementById('btn-fit').addEventListener('click', () => view.fitToScreen());

  // Rotate menu
  document.getElementById('btn-rotate').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu('rotate-menu');
  });

  // Rotate actions
  document.getElementById('action-rotate-cw').addEventListener('click', () => {
    closeMenus();
    runOp(() => bridge.rotate90CW(view.getImageData()));
  });
  document.getElementById('action-rotate-ccw').addEventListener('click', () => {
    closeMenus();
    runOp(() => bridge.rotate90CCW(view.getImageData()));
  });
  document.getElementById('action-rotate-180').addEventListener('click', () => {
    closeMenus();
    runOp(() => bridge.rotate180(view.getImageData()));
  });
  document.getElementById('action-flip-h').addEventListener('click', () => {
    closeMenus();
    runOp(() => bridge.flipHorizontal(view.getImageData()));
  });
  document.getElementById('action-flip-v').addEventListener('click', () => {
    closeMenus();
    runOp(() => bridge.flipVertical(view.getImageData()));
  });

  // Crop tool
  document.getElementById('btn-crop').addEventListener('click', () => {
    setActiveTool('crop');
  });

  // Crop apply/cancel bar
  view.onCrop((rect) => {
    showCropActions(rect);
  });

  // Zoom controls
  document.getElementById('btn-zoom-in').addEventListener('click', () => view.zoomIn());
  document.getElementById('btn-zoom-out').addEventListener('click', () => view.zoomOut());
  document.getElementById('zoom-value').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu('zoom-menu');
  });

  // Zoom presets
  document.querySelectorAll('.zoom-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = parseFloat(btn.dataset.zoom);
      if (btn.dataset.zoom === 'fit') {
        view.fitToScreen();
      } else {
        view.setZoom(val);
        view.fitToScreen(); // reset pan
        view.setZoom(val);
      }
      closeMenus();
    });
  });

  // Undo / Redo
  document.getElementById('btn-undo').addEventListener('click', (e) => {
    e.stopPropagation();
    performUndo();
  });

  document.getElementById('btn-redo').addEventListener('click', (e) => {
    e.stopPropagation();
    performRedo();
  });

  // Export
  document.getElementById('btn-export').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu('export-menu');
  });

  document.getElementById('export-png').addEventListener('click', (e) => {
    e.stopPropagation();
    exportImage('png');
    closeMenus();
  });
  document.getElementById('export-jpeg').addEventListener('click', (e) => {
    e.stopPropagation();
    exportImage('jpeg');
    closeMenus();
  });

  // Resize button
  document.getElementById('btn-resize').addEventListener('click', () => {
    showResizeDialog();
  });

  // Close menus on outside click (protect both .toolbar-btn and .btn-export)
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.toolbar-menu') && !e.target.closest('.toolbar-btn') && !e.target.closest('.btn-export')) {
      closeMenus();
    }
  });
}

function setActiveTool(tool) {
  view.setTool(tool);
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
  hideCropActions();
}

function toggleMenu(menuId) {
  const menu = document.getElementById(menuId);
  const isVisible = menu.classList.contains('visible');
  closeMenus();
  if (!isVisible) {
    menu.classList.add('visible');
  }
}

function closeMenus() {
  document.querySelectorAll('.toolbar-menu').forEach(m => m.classList.remove('visible'));
}

/* ═══════════════════════════════════════════════════════════════════
 * CROP ACTIONS BAR
 * ═══════════════════════════════════════════════════════════════════ */

function showCropActions(rect) {
  const bar = document.getElementById('crop-actions');
  bar.classList.add('visible');

  // Apply crop
  const applyBtn = document.getElementById('crop-apply');
  const cancelBtn = document.getElementById('crop-cancel');

  // Remove old listeners
  const newApply = applyBtn.cloneNode(true);
  const newCancel = cancelBtn.cloneNode(true);
  applyBtn.replaceWith(newApply);
  cancelBtn.replaceWith(newCancel);

  newApply.addEventListener('click', () => {
    const cropR = view.getCropRect();
    if (cropR && cropR.w > 0 && cropR.h > 0) {
      runOp(() => bridge.cropImage(
        view.getImageData(), cropR.x, cropR.y, cropR.w, cropR.h
      ));
    }
    hideCropActions();
    setActiveTool('select');
  });

  newCancel.addEventListener('click', () => {
    view.clearCrop();
    hideCropActions();
    setActiveTool('select');
  });
}

function hideCropActions() {
  document.getElementById('crop-actions').classList.remove('visible');
}

/* ═══════════════════════════════════════════════════════════════════
 * FILTER BAR (bottom bar)
 * ═══════════════════════════════════════════════════════════════════ */

function setupFilterBar() {
  // Grayscale
  document.getElementById('btn-grayscale').addEventListener('click', () => {
    runOp(() => bridge.applyGrayscale(view.getImageData()), { filter: 'grayscale' });
  });

  // Invert
  document.getElementById('btn-invert').addEventListener('click', () => {
    runOp(() => bridge.applyInvert(view.getImageData()), { filter: 'invert' });
  });

  // Blur — show slider
  document.getElementById('btn-blur').addEventListener('click', () => {
    showSliderDialog('Blur Radius', 1, 50, 5, 1, (val) => {
      runOp(() => bridge.applyBlur(view.getImageData(), val), { filter: 'blur' });
    });
  });

  // Sharpen — show slider
  document.getElementById('btn-sharpen').addEventListener('click', () => {
    showSliderDialog('Sharpen Strength', 0.1, 10, 1.5, 0.1, (val) => {
      runOp(() => bridge.applySharpen(view.getImageData(), val), { filter: 'sharpen' });
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════
 * SLIDER / RESIZE DIALOGS
 * ═══════════════════════════════════════════════════════════════════ */

function showSliderDialog(label, min, max, defaultVal, step, onApply) {
  const overlay = document.getElementById('dialog-overlay');
  const dialog = document.getElementById('slider-dialog');
  const title = dialog.querySelector('.dialog-title');
  const slider = dialog.querySelector('.dialog-slider');
  const valueDisplay = dialog.querySelector('.dialog-value');
  const applyBtn = dialog.querySelector('.dialog-apply');
  const cancelBtn = dialog.querySelector('.dialog-cancel');

  title.textContent = label;
  slider.min = min;
  slider.max = max;
  slider.step = step;
  slider.value = defaultVal;
  valueDisplay.textContent = defaultVal;

  slider.oninput = () => {
    valueDisplay.textContent = parseFloat(slider.value).toFixed(
      step < 1 ? 1 : 0
    );
  };

  overlay.classList.add('visible');
  dialog.classList.add('visible');

  const close = () => {
    overlay.classList.remove('visible');
    dialog.classList.remove('visible');
  };

  // Clone buttons to remove old listeners
  const newApply = applyBtn.cloneNode(true);
  const newCancel = cancelBtn.cloneNode(true);
  applyBtn.replaceWith(newApply);
  cancelBtn.replaceWith(newCancel);

  newApply.addEventListener('click', () => {
    close();
    onApply(parseFloat(slider.value));
  });

  newCancel.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  }, { once: true });
}

function showResizeDialog() {
  const dims = view.getImageDimensions();
  if (!dims) return;

  const overlay = document.getElementById('dialog-overlay');
  const dialog = document.getElementById('resize-dialog');

  const widthInput = document.getElementById('resize-width');
  const heightInput = document.getElementById('resize-height');
  const lockAspect = document.getElementById('resize-lock-aspect');
  const applyBtn = dialog.querySelector('.dialog-apply');
  const cancelBtn = dialog.querySelector('.dialog-cancel');

  widthInput.value = dims.width;
  heightInput.value = dims.height;
  lockAspect.checked = true;

  const aspect = dims.width / dims.height;

  widthInput.oninput = () => {
    if (lockAspect.checked) {
      heightInput.value = Math.round(parseInt(widthInput.value) / aspect) || 1;
    }
  };
  heightInput.oninput = () => {
    if (lockAspect.checked) {
      widthInput.value = Math.round(parseInt(heightInput.value) * aspect) || 1;
    }
  };

  overlay.classList.add('visible');
  dialog.classList.add('visible');

  const close = () => {
    overlay.classList.remove('visible');
    dialog.classList.remove('visible');
  };

  const newApply = applyBtn.cloneNode(true);
  const newCancel = cancelBtn.cloneNode(true);
  applyBtn.replaceWith(newApply);
  cancelBtn.replaceWith(newCancel);

  newApply.addEventListener('click', () => {
    const newW = parseInt(widthInput.value) || dims.width;
    const newH = parseInt(heightInput.value) || dims.height;
    close();
    runOp(() => bridge.resizeBilinear(view.getImageData(), newW, newH));
  });

  newCancel.addEventListener('click', close);
}

/* ═══════════════════════════════════════════════════════════════════
 * FILE HANDLING (open + drag-and-drop)
 * ═══════════════════════════════════════════════════════════════════ */

function setupFileHandling() {
  const fileInput = document.getElementById('file-input');
  const dropZone = document.getElementById('canvas-area');

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadImageFile(file);
    fileInput.value = ''; // reset so same file can be re-opened
  });

  // Drag and drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');

    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      loadImageFile(file);
    }
  });
}

function loadImageFile(file) {
  showLoading('Loading image…');

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      // Draw onto a temporary canvas to get ImageData
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = img.width;
      tmpCanvas.height = img.height;
      const tmpCtx = tmpCanvas.getContext('2d');
      tmpCtx.drawImage(img, 0, 0);
      const imageData = tmpCtx.getImageData(0, 0, img.width, img.height);

      // Set the image and push initial state
      state.clearHistory();
      state.pushState(imageData, { filter: null });
      setActiveFilter(null);
      view.setImage(imageData);

      updateStatus();
      hideLoading();

      // Show the toolbar and filter bar
      document.getElementById('toolbar').classList.add('has-image');
      document.getElementById('filter-bar').classList.add('has-image');
      document.getElementById('status-bar').classList.add('has-image');
    };
    img.onerror = () => {
      hideLoading();
      alert('Failed to load image. Please try a different file.');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/* ═══════════════════════════════════════════════════════════════════
 * OPERATION RUNNER
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Run a WASM operation with loading state and error handling.
 * @param {function} opFn - Function that returns { imageData, elapsed }
 */
async function runOp(opFn, meta = {}) {
  const current = view.getImageData();
  if (isProcessing || !current) return;

  isProcessing = true;
  showLoading('Processing…');

  // Use requestAnimationFrame to let the loading UI appear before
  // the synchronous WASM call blocks the main thread
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  try {
    const result = opFn();
    if (result && result.imageData) {
      view.updateImage(result.imageData);
      state.pushState(result.imageData, meta);
      if (meta && 'filter' in meta) {
        setActiveFilter(meta.filter);
      }
      updateStatus(result.elapsed);
    }
  } catch (err) {
    console.error('WASM operation failed:', err);
    alert('Operation failed: ' + err.message);
  } finally {
    isProcessing = false;
    hideLoading();
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * EXPORT
 * ═══════════════════════════════════════════════════════════════════ */

function exportImage(format) {
  const currentImage = view.getImageData();
  if (!currentImage) {
    alert('Please open or edit an image first.');
    return;
  }

  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const ext = format === 'jpeg' ? 'jpg' : 'png';

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = currentImage.width;
  exportCanvas.height = currentImage.height;
  const exportCtx = exportCanvas.getContext('2d');
  exportCtx.putImageData(currentImage, 0, 0);

  // Modern browsers: export via toBlob for reliability with large images
  if (exportCanvas.toBlob) {
    exportCanvas.toBlob((blob) => {
      if (!blob) {
        // Fallback to data URL
        triggerDownload(exportCanvas.toDataURL(mimeType, 0.95), `edited-image.${ext}`);
        return;
      }
      const url = URL.createObjectURL(blob);
      triggerDownload(url, `edited-image.${ext}`);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, mimeType, 0.95);
  } else {
    triggerDownload(exportCanvas.toDataURL(mimeType, 0.95), `edited-image.${ext}`);
  }
}

function triggerDownload(href, filename) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = href;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/* ═══════════════════════════════════════════════════════════════════
 * STATUS BAR
 * ═══════════════════════════════════════════════════════════════════ */

let lastElapsed = 0;

function setupStatusBar() {
  updateStatus();
}

function updateStatus(elapsed) {
  if (elapsed !== undefined) lastElapsed = elapsed;

  const dims = view.getImageDimensions();
  const dimEl = document.getElementById('status-dimensions');
  const timeEl = document.getElementById('status-time');

  if (dims) {
    dimEl.textContent = `${dims.width} × ${dims.height} px`;
    timeEl.textContent = lastElapsed > 0
      ? `Last op: ${lastElapsed.toFixed(1)} ms`
      : '';
  } else {
    dimEl.textContent = '';
    timeEl.textContent = '';
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * LOADING STATE
 * ═══════════════════════════════════════════════════════════════════ */

function showLoading(msg) {
  const el = document.getElementById('loading-overlay');
  el.querySelector('.loading-text').textContent = msg || 'Processing…';
  el.classList.add('visible');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('visible');
}

/* ═══════════════════════════════════════════════════════════════════
 * KEYBOARD SHORTCUTS
 * ═══════════════════════════════════════════════════════════════════ */

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Don't intercept when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (ctrl && key === 'z' && !e.shiftKey) {
      e.preventDefault();
      performUndo();
    } else if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) {
      e.preventDefault();
      performRedo();
    } else if (ctrl && key === 'o') {
      e.preventDefault();
      document.getElementById('file-input').click();
    } else if (key === 'v') {
      setActiveTool('select');
    } else if (key === 'h') {
      setActiveTool('hand');
    } else if (key === 'c') {
      setActiveTool('crop');
    } else if (key === '0') {
      view.fitToScreen();
    } else if (key === '1' && !ctrl) {
      view.setZoomTo100();
    } else if (e.key === '=' || e.key === '+') {
      view.zoomIn();
    } else if (e.key === '-') {
      view.zoomOut();
    } else if (e.key === 'Escape') {
      view.clearCrop();
      hideCropActions();
      closeMenus();
      setActiveTool('select');
    }
  });
}
