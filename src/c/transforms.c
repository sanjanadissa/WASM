/*
 * transforms.c — Geometric image transformations compiled to WebAssembly.
 *
 * Every function here takes a flat RGBA pixel buffer, reads from it,
 * and writes the transformed result into a separate output buffer.
 * JavaScript is responsible for allocating and freeing both buffers
 * via _malloc / _free.
 *
 * PIXEL INDEXING:
 *   For a pixel at column x, row y in a WxH image:
 *     byte offset = (y * W + x) * 4
 *   The 4 bytes at that offset are R, G, B, A respectively.
 */

#include "image_ops.h"
#include <string.h>  /* memcpy */

/* ────────────────────────────────────────────────────────────────
 * flip_horizontal — mirrors left ↔ right
 *
 * For each row, the pixel at column x maps to column (width - 1 - x).
 * ──────────────────────────────────────────────────────────────── */
void flip_horizontal(const uint8_t *in, uint8_t *out,
                     int32_t width, int32_t height)
{
    const int32_t stride = width * 4; /* bytes per row */

    for (int32_t y = 0; y < height; y++) {
        for (int32_t x = 0; x < width; x++) {
            /* Source pixel at (x, y) → destination at (width-1-x, y) */
            int32_t src_off = y * stride + x * 4;
            int32_t dst_off = y * stride + (width - 1 - x) * 4;

            /* Copy all 4 channels at once.  memcpy is safe because
               src and dst don't overlap when out != in (and even if
               they alias, this particular access pattern is fine). */
            out[dst_off + 0] = in[src_off + 0]; /* R */
            out[dst_off + 1] = in[src_off + 1]; /* G */
            out[dst_off + 2] = in[src_off + 2]; /* B */
            out[dst_off + 3] = in[src_off + 3]; /* A */
        }
    }
}

/* ────────────────────────────────────────────────────────────────
 * flip_vertical — mirrors top ↔ bottom
 *
 * Row y maps to row (height - 1 - y).  We copy whole rows at a time
 * for speed.
 * ──────────────────────────────────────────────────────────────── */
void flip_vertical(const uint8_t *in, uint8_t *out,
                   int32_t width, int32_t height)
{
    const int32_t stride = width * 4;

    for (int32_t y = 0; y < height; y++) {
        /* Copy entire row y to row (height-1-y) */
        memcpy(out + (height - 1 - y) * stride,
               in  + y * stride,
               (size_t)stride);
    }
}

/* ────────────────────────────────────────────────────────────────
 * rotate_90_cw — 90° clockwise rotation
 *
 * Input pixel at (x, y) goes to output pixel (height-1-y, x).
 * Output dimensions swap: outW = height, outH = width.
 *
 * The info struct lets JS read the new dimensions without needing
 * a return value (WASM functions can only return one scalar).
 * ──────────────────────────────────────────────────────────────── */
void rotate_90_cw(const uint8_t *in, uint8_t *out,
                  int32_t width, int32_t height,
                  ResultInfo *info)
{
    int32_t outW = height;
    int32_t outH = width;

    for (int32_t y = 0; y < height; y++) {
        for (int32_t x = 0; x < width; x++) {
            int32_t src = (y * width + x) * 4;
            /* New position: column = (height-1-y), row = x */
            int32_t dst = (x * outW + (height - 1 - y)) * 4;

            out[dst + 0] = in[src + 0];
            out[dst + 1] = in[src + 1];
            out[dst + 2] = in[src + 2];
            out[dst + 3] = in[src + 3];
        }
    }

    /* Write output dimensions so JS can read them */
    if (info) {
        info->width  = outW;
        info->height = outH;
    }
}

/* ────────────────────────────────────────────────────────────────
 * rotate_90_ccw — 90° counter-clockwise rotation
 *
 * Input pixel at (x, y) goes to output pixel (y, width-1-x).
 * ──────────────────────────────────────────────────────────────── */
void rotate_90_ccw(const uint8_t *in, uint8_t *out,
                   int32_t width, int32_t height,
                   ResultInfo *info)
{
    int32_t outW = height;
    int32_t outH = width;

    for (int32_t y = 0; y < height; y++) {
        for (int32_t x = 0; x < width; x++) {
            int32_t src = (y * width + x) * 4;
            /* New position: column = y, row = (width-1-x) */
            int32_t dst = ((width - 1 - x) * outW + y) * 4;

            out[dst + 0] = in[src + 0];
            out[dst + 1] = in[src + 1];
            out[dst + 2] = in[src + 2];
            out[dst + 3] = in[src + 3];
        }
    }

    if (info) {
        info->width  = outW;
        info->height = outH;
    }
}

/* ────────────────────────────────────────────────────────────────
 * rotate_180 — half turn
 *
 * Pixel at (x, y) → (width-1-x, height-1-y).
 * ──────────────────────────────────────────────────────────────── */
void rotate_180(const uint8_t *in, uint8_t *out,
                int32_t width, int32_t height)
{
    int32_t total = width * height;

    for (int32_t i = 0; i < total; i++) {
        int32_t src = i * 4;
        int32_t dst = (total - 1 - i) * 4;

        out[dst + 0] = in[src + 0];
        out[dst + 1] = in[src + 1];
        out[dst + 2] = in[src + 2];
        out[dst + 3] = in[src + 3];
    }
}

/* ────────────────────────────────────────────────────────────────
 * crop — extract a sub-rectangle
 *
 * Bounds are clamped to the image dimensions so we never read
 * outside the source buffer.  The clamped width/height are written
 * to info so JS knows the exact output size.
 * ──────────────────────────────────────────────────────────────── */
void crop(const uint8_t *in, uint8_t *out,
          int32_t width, int32_t height,
          int32_t cx, int32_t cy, int32_t cw, int32_t ch,
          ResultInfo *info)
{
    /* ── Bounds checking ───────────────────────────────────────── */
    if (cx < 0) { cw += cx; cx = 0; }
    if (cy < 0) { ch += cy; cy = 0; }
    if (cx + cw > width)  cw = width  - cx;
    if (cy + ch > height) ch = height - cy;
    if (cw <= 0 || ch <= 0) {
        /* Degenerate crop — write 0×0 */
        if (info) { info->width = 0; info->height = 0; }
        return;
    }

    int32_t srcStride = width * 4;
    int32_t dstStride = cw * 4;

    for (int32_t row = 0; row < ch; row++) {
        const uint8_t *srcRow = in  + (cy + row) * srcStride + cx * 4;
        uint8_t       *dstRow = out + row * dstStride;
        memcpy(dstRow, srcRow, (size_t)dstStride);
    }

    if (info) {
        info->width  = cw;
        info->height = ch;
    }
}

/* ────────────────────────────────────────────────────────────────
 * resize_bilinear — resizes with bilinear interpolation
 *
 * For each output pixel (ox, oy) we find the corresponding
 * floating-point position in the source image, sample the four
 * surrounding pixels, and blend them.
 *
 * This gives much smoother results than nearest-neighbour while
 * still being simple and fast.
 * ──────────────────────────────────────────────────────────────── */
void resize_bilinear(const uint8_t *in, uint8_t *out,
                     int32_t width, int32_t height,
                     int32_t newW, int32_t newH,
                     ResultInfo *info)
{
    if (newW <= 0 || newH <= 0) {
        if (info) { info->width = 0; info->height = 0; }
        return;
    }

    /* Scale factors: how much of the source each output pixel covers */
    float xRatio = (newW > 1) ? (float)(width  - 1) / (float)(newW - 1) : 0.0f;
    float yRatio = (newH > 1) ? (float)(height - 1) / (float)(newH - 1) : 0.0f;

    for (int32_t oy = 0; oy < newH; oy++) {
        float srcY = oy * yRatio;
        int32_t y0 = (int32_t)srcY;
        int32_t y1 = y0 + 1;
        if (y1 >= height) y1 = height - 1;
        float fy = srcY - (float)y0; /* fractional part */

        for (int32_t ox = 0; ox < newW; ox++) {
            float srcX = ox * xRatio;
            int32_t x0 = (int32_t)srcX;
            int32_t x1 = x0 + 1;
            if (x1 >= width) x1 = width - 1;
            float fx = srcX - (float)x0;

            /* Pointers to the four neighbours */
            const uint8_t *tl = in + (y0 * width + x0) * 4; /* top-left     */
            const uint8_t *tr = in + (y0 * width + x1) * 4; /* top-right    */
            const uint8_t *bl = in + (y1 * width + x0) * 4; /* bottom-left  */
            const uint8_t *br = in + (y1 * width + x1) * 4; /* bottom-right */

            uint8_t *dst = out + (oy * newW + ox) * 4;

            for (int c = 0; c < 4; c++) {
                /* Bilinear blend for this channel */
                float top    = tl[c] * (1.0f - fx) + tr[c] * fx;
                float bottom = bl[c] * (1.0f - fx) + br[c] * fx;
                float val    = top   * (1.0f - fy) + bottom * fy;

                /* Clamp to [0, 255] */
                if (val < 0.0f)   val = 0.0f;
                if (val > 255.0f) val = 255.0f;
                dst[c] = (uint8_t)(val + 0.5f);
            }
        }
    }

    if (info) {
        info->width  = newW;
        info->height = newH;
    }
}
