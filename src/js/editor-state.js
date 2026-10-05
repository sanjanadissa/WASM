/*
 * editor-state.js — Undo/Redo history manager
 *
 * Keeps a stack of ImageData snapshots. The stack is capped at
 * MAX_HISTORY entries to avoid eating too much RAM with large images.
 *
 * Usage:
 *   pushState(imageData, meta) — after every operation
 *   undo()                     — returns the previous ImageData or null
 *   redo()                     — returns the next ImageData or null
 *   getCurrentMeta()           — returns the current step metadata (e.g. { filter: 'grayscale' })
 */

const MAX_HISTORY = 20;

/** @type {{ imageData: ImageData, meta: Record<string, any> }[]} */
let history = [];

/** Points to the current state in the history array. */
let cursor = -1;

/** Listeners notified whenever undo/redo availability changes. */
let listeners = [];

function cloneImageData(src) {
  if (!src) return null;
  return new ImageData(
    new Uint8ClampedArray(src.data),
    src.width,
    src.height
  );
}

function notify() {
  const state = {
    canUndo: cursor > 0,
    canRedo: cursor >= 0 && cursor < history.length - 1,
    index: cursor,
    total: history.length,
    meta: cursor >= 0 && cursor < history.length ? history[cursor].meta : {},
  };
  for (const fn of listeners) {
    try {
      fn(state);
    } catch (e) {
      console.error('[History notify error]:', e);
    }
  }
}

/**
 * Subscribe to undo/redo state changes.
 * Calls fn immediately with current state.
 * @param {function} fn - Called with { canUndo, canRedo, index, total, meta }
 */
export function onHistoryChange(fn) {
  listeners.push(fn);
  fn({
    canUndo: cursor > 0,
    canRedo: cursor >= 0 && cursor < history.length - 1,
    index: cursor,
    total: history.length,
    meta: cursor >= 0 && cursor < history.length ? history[cursor].meta : {},
  });
}

/**
 * Push a new ImageData snapshot onto the history stack.
 * Clones the ImageData to ensure complete snapshot isolation.
 * Optionally attaches metadata (e.g., active filter name).
 */
export function pushState(imageData, meta = {}) {
  if (!imageData) return;

  // Discard future states if we performed an edit after undoing
  if (cursor < history.length - 1) {
    history = history.slice(0, cursor + 1);
  }

  // Always store a deep copy of the pixel buffer + step metadata
  history.push({
    imageData: cloneImageData(imageData),
    meta: { ...meta },
  });

  // Cap the stack size
  if (history.length > MAX_HISTORY) {
    history.shift(); // remove oldest
  }

  cursor = history.length - 1;
  notify();
}

/**
 * Undo — move back one step.
 * @returns {ImageData|null}
 */
export function undo() {
  if (cursor <= 0) return null;
  cursor--;
  notify();
  return cloneImageData(history[cursor].imageData);
}

/**
 * Redo — move forward one step.
 * @returns {ImageData|null}
 */
export function redo() {
  if (cursor < 0 || cursor >= history.length - 1) return null;
  cursor++;
  notify();
  return cloneImageData(history[cursor].imageData);
}

/**
 * Get the current state without moving the cursor.
 * @returns {ImageData|null}
 */
export function getCurrentState() {
  if (cursor < 0 || cursor >= history.length) return null;
  return cloneImageData(history[cursor].imageData);
}

/**
 * Get metadata for the current history state.
 * @returns {Record<string, any>}
 */
export function getCurrentMeta() {
  if (cursor < 0 || cursor >= history.length) return {};
  return { ...history[cursor].meta };
}

/**
 * Clear all history (e.g. when loading a new image).
 */
export function clearHistory() {
  history = [];
  cursor = -1;
  notify();
}
