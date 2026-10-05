/*
 * image_ops.h — Shared header for the WASM image-processing library.
 *
 * MEMORY CONTRACT (JS ↔ WASM)
 * ----------------------------
 * All image data lives inside the WASM linear memory.  JavaScript is
 * responsible for:
 *   1. Calling _malloc(width * height * 4) to reserve space for the
 *      *input* buffer inside WASM memory.
 *   2. Copying the canvas ImageData pixels into that buffer via
 *      Module.HEAPU8.set(pixelArray, inputPtr).
 *   3. Calling _malloc again for the *output* buffer (size depends on
 *      the operation — may be different from input for crop/resize/rotate).
 *   4. Calling the C function, which reads from inputPtr and writes to
 *      outputPtr.
 *   5. Reading the result back:  new Uint8ClampedArray(
 *          Module.HEAPU8.buffer, outputPtr, outWidth * outHeight * 4);
 *   6. Calling _free on both pointers.
 *
 * WHY pointers instead of returning arrays?
 *   WebAssembly functions can only return simple scalar values (i32, f64…).
 *   We pass pointers (which are just i32 byte-offsets into WASM linear
 *   memory) so the C code can read/write arbitrary amounts of data.
 *
 * PIXEL FORMAT
 *   Every pixel is 4 consecutive bytes: R, G, B, A (same as HTML Canvas
 *   ImageData).  A "pixel buffer" is simply width × height × 4 bytes.
 *
 * RESULT INFO
 *   Operations that change the image dimensions (rotate 90°/270°, crop,
 *   resize) need to tell JS the new width and height.  We use a tiny
 *   struct written into a caller-allocated 8-byte block in WASM memory.
 *   JS reads two consecutive int32 values from that pointer.
 */

#ifndef IMAGE_OPS_H
#define IMAGE_OPS_H

#include <stdint.h>

/*
 * ResultInfo — written by C into caller-supplied memory so JS can read
 * the new dimensions after an operation that changes the image size.
 *
 * In JS:
 *   const infoPtr = Module._malloc(8);          // 2 × int32
 *   Module._some_op(in, out, w, h, …, infoPtr);
 *   const newW = Module.HEAP32[infoPtr >> 2];    // first  int32
 *   const newH = Module.HEAP32[(infoPtr >> 2)+1];// second int32
 *   Module._free(infoPtr);
 *
 * The ">> 2" is because HEAP32 is a view of 4-byte elements, so we
 * convert a byte-offset to an element-index.
 */
typedef struct {
    int32_t width;
    int32_t height;
} ResultInfo;

/* ── Transforms ─────────────────────────────────────────────────── */

/*
 * flip_horizontal — mirrors the image left ↔ right.
 *   in/out are width×height×4 byte buffers.
 *   out may alias in (the function works correctly either way).
 */
void flip_horizontal(const uint8_t *in, uint8_t *out,
                     int32_t width, int32_t height);

/*
 * flip_vertical — mirrors the image top ↔ bottom.
 */
void flip_vertical(const uint8_t *in, uint8_t *out,
                   int32_t width, int32_t height);

/*
 * rotate_90_cw — rotates 90° clockwise.
 *   Output dimensions: outWidth = height, outHeight = width.
 *   Caller must allocate out as height×width×4 bytes,
 *   and supply an 8-byte info buffer for ResultInfo.
 */
void rotate_90_cw(const uint8_t *in, uint8_t *out,
                  int32_t width, int32_t height,
                  ResultInfo *info);

/*
 * rotate_90_ccw — rotates 90° counter-clockwise.
 *   Output dimensions: outWidth = height, outHeight = width.
 */
void rotate_90_ccw(const uint8_t *in, uint8_t *out,
                   int32_t width, int32_t height,
                   ResultInfo *info);

/*
 * rotate_180 — rotates 180°.  Same dimensions as input.
 */
void rotate_180(const uint8_t *in, uint8_t *out,
                int32_t width, int32_t height);

/*
 * crop — extracts a rectangular sub-region.
 *   cx, cy, cw, ch define the crop rectangle.
 *   Bounds are clamped so no out-of-bounds read occurs.
 *   Output size: cw × ch × 4  (after clamping).
 *   info receives the clamped cw and ch.
 */
void crop(const uint8_t *in, uint8_t *out,
          int32_t width, int32_t height,
          int32_t cx, int32_t cy, int32_t cw, int32_t ch,
          ResultInfo *info);

/*
 * resize_bilinear — resizes using bilinear interpolation.
 *   newW, newH are the target dimensions.
 *   Output size: newW × newH × 4.
 *   info receives newW, newH.
 */
void resize_bilinear(const uint8_t *in, uint8_t *out,
                     int32_t width, int32_t height,
                     int32_t newW, int32_t newH,
                     ResultInfo *info);

/* ── Filters ────────────────────────────────────────────────────── */

/*
 * grayscale — converts to luminance-weighted grayscale.
 *   Uses the perceptual formula: 0.299R + 0.587G + 0.114B.
 *   Alpha channel is preserved.
 */
void grayscale(const uint8_t *in, uint8_t *out,
               int32_t width, int32_t height);

/*
 * invert — inverts R, G, B channels.  Alpha is preserved.
 */
void invert_colors(const uint8_t *in, uint8_t *out,
                   int32_t width, int32_t height);

/*
 * box_blur — separable two-pass box blur for O(n) per pixel.
 *   radius is the blur radius in pixels (kernel size = 2*radius + 1).
 *   Clamps radius to [0, 100].
 *   Requires a temporary buffer (tmp) of the same size as in/out
 *   (width × height × 4 bytes).  Caller allocates it.
 *
 *   WHY a temp buffer?
 *     A separable blur does a horizontal pass then a vertical pass.
 *     The horizontal pass writes intermediate results to tmp, and the
 *     vertical pass reads from tmp and writes the final result to out.
 *     This avoids allocating memory inside C (keeping _malloc/_free
 *     ownership with JS, which is cleaner for WASM).
 */
void box_blur(const uint8_t *in, uint8_t *out, uint8_t *tmp,
              int32_t width, int32_t height, int32_t radius);

/*
 * sharpen — applies an unsharp-mask-style sharpening.
 *   strength is a float [0.0 … 10.0].
 *   Internally blurs then subtracts: out = in + strength * (in − blurred).
 *   Requires a temporary buffer (tmp) for the internal blur pass,
 *   same size as in (width × height × 4).
 */
void sharpen(const uint8_t *in, uint8_t *out, uint8_t *tmp,
             int32_t width, int32_t height, float strength);

#endif /* IMAGE_OPS_H */
