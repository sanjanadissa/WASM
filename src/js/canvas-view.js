/*
 * canvas-view.js — Canvas rendering with zoom, pan, and crop overlay.
 *
 * Manages the main <canvas> element.  Handles:
 *   - Drawing the current image centered with zoom and pan offsets
 *   - Zoom in/out with controls and mouse wheel
 *   - Pan with the hand tool (click-and-drag)
 *   - Crop rectangle overlay (click-and-drag to define, then apply)
 *   - Fit-to-screen calculation
 */

/** @type {HTMLCanvasElement} */
let canvas;
/** @type {CanvasRenderingContext2D} */
let ctx;

/** The current image being displayed */
let currentImage = null;

/** Zoom and pan state */
let zoom = 1;
let panX = 0;
let panY = 0;

/** Active tool: 'select' | 'hand' | 'crop' */
let activeTool = 'select';

/** Crop rectangle (in image-space pixels) */
let cropRect = null;
let isCropping = false;
let cropStart = { x: 0, y: 0 };

/** Pan drag state */
let isPanning = false;
let panStartMouse = { x: 0, y: 0 };
let panStartOffset = { x: 0, y: 0 };

/** Callback for when a crop is finalized */
let onCropCallback = null;

/** Callback for when the zoom value changes (to update UI) */
let onZoomChangeCallback = null;

const ZOOM_LEVELS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5];

/**
 * Initialize the canvas view.
 * @param {HTMLCanvasElement} canvasEl
 */
export function initCanvasView(canvasEl) {
  canvas = canvasEl;
  ctx = canvas.getContext('2d');

  // Make the canvas fill its container
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Mouse events for pan and crop
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', onMouseUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  // Touch events for mobile
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd);
}

/**
 * Resize canvas to match its CSS size (handles HiDPI).
 */
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}

/**
 * Set the image to display and reset the view.
 * @param {ImageData} imageData
 */
export function setImage(imageData) {
  currentImage = imageData;
  cropRect = null;
  fitToScreen();
}

/**
 * Update the displayed image without resetting zoom/pan.
 * @param {ImageData} imageData
 */
export function updateImage(imageData) {
  currentImage = imageData;
  cropRect = null;
  render();
}

/**
 * Get the current image as ImageData.
 * @returns {ImageData|null}
 */
export function getImageData() {
  return currentImage;
}

/**
 * Get the image dimensions.
 */
export function getImageDimensions() {
  if (!currentImage) return null;
  return { width: currentImage.width, height: currentImage.height };
}

/* ═══════════════════════════════════════════════════════════════════
 * RENDERING
 * ═══════════════════════════════════════════════════════════════════ */

function render() {
  if (!ctx) return;

  const cw = canvas.getBoundingClientRect().width;
  const ch = canvas.getBoundingClientRect().height;

  // Clear the canvas with a transparent background
  ctx.clearRect(0, 0, cw, ch);

  if (!currentImage) {
    drawEmptyState(cw, ch);
    return;
  }

  const iw = currentImage.width;
  const ih = currentImage.height;

  // Calculate the position of the image on the canvas
  const scaledW = iw * zoom;
  const scaledH = ih * zoom;
  const x = (cw - scaledW) / 2 + panX;
  const y = (ch - scaledH) / 2 + panY;

  // Draw soft shadow behind the image
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.12)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#fff';
  ctx.fillRect(x, y, scaledW, scaledH);
  ctx.restore();

  // Draw the image
  // We need to put the ImageData onto a temporary canvas, then
  // drawImage with scaling (ImageData can't be drawn scaled directly)
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = iw;
  tmpCanvas.height = ih;
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCtx.putImageData(currentImage, 0, 0);

  ctx.drawImage(tmpCanvas, x, y, scaledW, scaledH);

  // Draw crop overlay if active
  if (cropRect && activeTool === 'crop') {
    drawCropOverlay(x, y, scaledW, scaledH);
  }
}

function drawEmptyState(cw, ch) {
  ctx.save();
  ctx.fillStyle = '#9ca3af';
  ctx.font = '16px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Open an image to start editing', cw / 2, ch / 2 - 12);
  ctx.font = '13px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#b0b5c0';
  ctx.fillText('Drag & drop or click the open button', cw / 2, ch / 2 + 16);
  ctx.restore();
}

function drawCropOverlay(imgX, imgY, imgW, imgH) {
  if (!cropRect) return;

  const { x, y, w, h } = cropRect;

  // Convert image-space crop rect to screen-space
  const sx = imgX + x * zoom;
  const sy = imgY + y * zoom;
  const sw = w * zoom;
  const sh = h * zoom;

  // Darken outside the crop area
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';

  const cw = canvas.getBoundingClientRect().width;
  const ch = canvas.getBoundingClientRect().height;

  // Top
  ctx.fillRect(0, 0, cw, sy);
  // Bottom
  ctx.fillRect(0, sy + sh, cw, ch - sy - sh);
  // Left
  ctx.fillRect(0, sy, sx, sh);
  // Right
  ctx.fillRect(sx + sw, sy, cw - sx - sw, sh);

  // Crop border
  ctx.strokeStyle = '#5b3df5';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 3]);
  ctx.strokeRect(sx, sy, sw, sh);

  // Corner handles
  ctx.setLineDash([]);
  ctx.fillStyle = '#5b3df5';
  const hs = 6; // handle size
  const corners = [
    [sx, sy], [sx + sw, sy],
    [sx, sy + sh], [sx + sw, sy + sh]
  ];
  for (const [cx, cy] of corners) {
    ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
  }

  // Crop dimensions label
  ctx.font = '12px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  const label = `${Math.round(w)} × ${Math.round(h)}`;
  const labelX = sx + sw / 2;
  const labelY = sy + sh + 20;
  const tm = ctx.measureText(label);
  ctx.fillStyle = 'rgba(91, 61, 245, 0.9)';
  ctx.beginPath();
  ctx.roundRect(labelX - tm.width / 2 - 8, labelY - 10, tm.width + 16, 22, 6);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(label, labelX, labelY + 2);

  ctx.restore();
}

/* ═══════════════════════════════════════════════════════════════════
 * ZOOM
 * ═══════════════════════════════════════════════════════════════════ */

export function getZoom() {
  return zoom;
}

export function setZoom(level) {
  zoom = Math.max(0.05, Math.min(10, level));
  if (onZoomChangeCallback) onZoomChangeCallback(zoom);
  render();
}

export function zoomIn() {
  const idx = ZOOM_LEVELS.findIndex(z => z > zoom);
  if (idx >= 0) setZoom(ZOOM_LEVELS[idx]);
  else setZoom(zoom * 1.25);
}

export function zoomOut() {
  const idx = [...ZOOM_LEVELS].reverse().findIndex(z => z < zoom);
  if (idx >= 0) setZoom(ZOOM_LEVELS[ZOOM_LEVELS.length - 1 - idx]);
  else setZoom(zoom / 1.25);
}

export function fitToScreen() {
  if (!currentImage) return;

  const cw = canvas.getBoundingClientRect().width;
  const ch = canvas.getBoundingClientRect().height;
  const iw = currentImage.width;
  const ih = currentImage.height;

  const padding = 60;
  const scaleX = (cw - padding * 2) / iw;
  const scaleY = (ch - padding * 2) / ih;
  zoom = Math.min(scaleX, scaleY, 1); // don't zoom in beyond 100%

  panX = 0;
  panY = 0;

  if (onZoomChangeCallback) onZoomChangeCallback(zoom);
  render();
}

export function setZoomTo100() {
  setZoom(1);
  panX = 0;
  panY = 0;
  render();
}

export function onZoomChange(fn) {
  onZoomChangeCallback = fn;
}

/* ═══════════════════════════════════════════════════════════════════
 * TOOLS
 * ═══════════════════════════════════════════════════════════════════ */

export function setTool(tool) {
  activeTool = tool;
  cropRect = null;

  // Update cursor
  if (tool === 'hand') {
    canvas.style.cursor = 'grab';
  } else if (tool === 'crop') {
    canvas.style.cursor = 'crosshair';
  } else {
    canvas.style.cursor = 'default';
  }

  render();
}

export function getTool() {
  return activeTool;
}

export function getCropRect() {
  return cropRect;
}

export function clearCrop() {
  cropRect = null;
  render();
}

export function onCrop(fn) {
  onCropCallback = fn;
}

/* ═══════════════════════════════════════════════════════════════════
 * MOUSE / TOUCH HANDLERS
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Convert screen coordinates to image-space coordinates.
 */
function screenToImage(screenX, screenY) {
  const cw = canvas.getBoundingClientRect().width;
  const ch = canvas.getBoundingClientRect().height;
  const iw = currentImage.width;
  const ih = currentImage.height;

  const scaledW = iw * zoom;
  const scaledH = ih * zoom;
  const imgX = (cw - scaledW) / 2 + panX;
  const imgY = (ch - scaledH) / 2 + panY;

  return {
    x: (screenX - imgX) / zoom,
    y: (screenY - imgY) / zoom
  };
}

function getMousePos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function onMouseDown(e) {
  if (!currentImage) return;
  const pos = getMousePos(e);

  if (activeTool === 'hand') {
    isPanning = true;
    panStartMouse = pos;
    panStartOffset = { x: panX, y: panY };
    canvas.style.cursor = 'grabbing';
  } else if (activeTool === 'crop') {
    const imgPos = screenToImage(pos.x, pos.y);
    isCropping = true;
    cropStart = imgPos;
    cropRect = { x: imgPos.x, y: imgPos.y, w: 0, h: 0 };
  }
}

function onMouseMove(e) {
  const pos = getMousePos(e);

  if (isPanning) {
    panX = panStartOffset.x + (pos.x - panStartMouse.x);
    panY = panStartOffset.y + (pos.y - panStartMouse.y);
    render();
  } else if (isCropping && currentImage) {
    const imgPos = screenToImage(pos.x, pos.y);

    // Build the rect from start to current, handling negative drag
    const x = Math.min(cropStart.x, imgPos.x);
    const y = Math.min(cropStart.y, imgPos.y);
    const w = Math.abs(imgPos.x - cropStart.x);
    const h = Math.abs(imgPos.y - cropStart.y);

    // Clamp to image bounds
    cropRect = {
      x: Math.max(0, Math.round(x)),
      y: Math.max(0, Math.round(y)),
      w: Math.min(Math.round(w), currentImage.width - Math.max(0, Math.round(x))),
      h: Math.min(Math.round(h), currentImage.height - Math.max(0, Math.round(y)))
    };

    render();
  }
}

function onMouseUp(e) {
  if (isPanning) {
    isPanning = false;
    canvas.style.cursor = activeTool === 'hand' ? 'grab' : 'default';
  }

  if (isCropping) {
    isCropping = false;
    // Only keep the crop if it's meaningful
    if (cropRect && cropRect.w > 5 && cropRect.h > 5) {
      if (onCropCallback) onCropCallback(cropRect);
    } else {
      cropRect = null;
    }
    render();
  }
}

function onWheel(e) {
  e.preventDefault();
  if (!currentImage) return;

  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  const newZoom = Math.max(0.05, Math.min(10, zoom + delta * zoom));

  // Zoom toward the mouse cursor
  const pos = getMousePos(e);
  const cw = canvas.getBoundingClientRect().width;
  const ch = canvas.getBoundingClientRect().height;

  const factor = newZoom / zoom;
  panX = pos.x - factor * (pos.x - panX - cw / 2 + currentImage.width * zoom / 2)
         - cw / 2 + currentImage.width * newZoom / 2;
  // Simplified: just zoom toward center for now
  panX = panX * (newZoom / zoom) || 0;
  panY = panY * (newZoom / zoom) || 0;

  // Actually, let's just do a simple center-zoom
  panX = panX;
  panY = panY;

  zoom = newZoom;
  if (onZoomChangeCallback) onZoomChangeCallback(zoom);
  render();
}

/* Touch support */
let lastTouchDist = 0;

function onTouchStart(e) {
  if (e.touches.length === 1) {
    const touch = e.touches[0];
    const fakeEvent = { clientX: touch.clientX, clientY: touch.clientY };

    if (activeTool === 'hand') {
      isPanning = true;
      panStartMouse = getMousePos(fakeEvent);
      panStartOffset = { x: panX, y: panY };
    } else if (activeTool === 'crop') {
      onMouseDown(fakeEvent);
    }
  } else if (e.touches.length === 2) {
    e.preventDefault();
    lastTouchDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
  }
}

function onTouchMove(e) {
  if (e.touches.length === 1) {
    const touch = e.touches[0];
    const fakeEvent = { clientX: touch.clientX, clientY: touch.clientY };
    onMouseMove(fakeEvent);
  } else if (e.touches.length === 2) {
    e.preventDefault();
    const dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    if (lastTouchDist > 0) {
      const scale = dist / lastTouchDist;
      setZoom(zoom * scale);
    }
    lastTouchDist = dist;
  }
}

function onTouchEnd(e) {
  isPanning = false;
  isCropping = false;
  lastTouchDist = 0;
}

/**
 * Export the canvas content as a data URL.
 * @param {'png'|'jpeg'} format
 * @param {number} quality - JPEG quality 0-1
 * @returns {string}
 */
export function exportAsDataURL(format = 'png', quality = 0.92) {
  if (!currentImage) return null;

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = currentImage.width;
  exportCanvas.height = currentImage.height;
  const exportCtx = exportCanvas.getContext('2d');
  exportCtx.putImageData(currentImage, 0, 0);

  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  return exportCanvas.toDataURL(mimeType, quality);
}
