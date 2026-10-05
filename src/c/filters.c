/*
 * filters.c — Image filters compiled to WebAssembly.
 *
 * All functions work on flat RGBA pixel buffers.  They read from `in`
 * and write to `out`.  Some also need a temporary buffer (`tmp`) of
 * the same size for multi-pass algorithms.
 *
 * JS is responsible for allocating all buffers via _malloc and freeing
 * them via _free after reading the result.
 */

#include "image_ops.h"
#include <string.h>  /* memcpy, memset */

/* ────────────────────────────────────────────────────────────────
 * grayscale — perceptual luminance conversion
 *
 * Uses the ITU-R BT.601 formula:
 *   gray = 0.299·R + 0.587·G + 0.114·B
 *
 * We use fixed-point integer math (multiplied by 256) for speed:
 *   gray = (77·R + 150·G + 29·B) >> 8
 *
 * Alpha is preserved unchanged.
 * ──────────────────────────────────────────────────────────────── */
void grayscale(const uint8_t *in, uint8_t *out,
               int32_t width, int32_t height)
{
    int32_t total = width * height;

    for (int32_t i = 0; i < total; i++) {
        int32_t off = i * 4;
        /* Fixed-point luminance (>> 8 is the same as / 256) */
        uint8_t gray = (uint8_t)((77  * in[off + 0] +   /* R × 0.299 */
                                  150 * in[off + 1] +    /* G × 0.587 */
                                  29  * in[off + 2])     /* B × 0.114 */
                                 >> 8);
        out[off + 0] = gray;       /* R */
        out[off + 1] = gray;       /* G */
        out[off + 2] = gray;       /* B */
        out[off + 3] = in[off + 3]; /* A — keep unchanged */
    }
}

/* ────────────────────────────────────────────────────────────────
 * invert_colors — inverts RGB, preserves alpha
 * ──────────────────────────────────────────────────────────────── */
void invert_colors(const uint8_t *in, uint8_t *out,
                   int32_t width, int32_t height)
{
    int32_t total = width * height;

    for (int32_t i = 0; i < total; i++) {
        int32_t off = i * 4;
        out[off + 0] = 255 - in[off + 0]; /* R */
        out[off + 1] = 255 - in[off + 1]; /* G */
        out[off + 2] = 255 - in[off + 2]; /* B */
        out[off + 3] = in[off + 3];       /* A */
    }
}

/* ────────────────────────────────────────────────────────────────
 * box_blur — separable O(n) box blur
 *
 * HOW IT WORKS:
 *   A naïve 2D box blur is O(r²) per pixel.  By separating it into
 *   a horizontal pass then a vertical pass, each is O(1) per pixel
 *   using a sliding-window running sum.
 *
 *   Pass 1 (horizontal): read from `in`, write to `tmp`.
 *   Pass 2 (vertical):   read from `tmp`, write to `out`.
 *
 *   The running sum adds the new pixel entering the window on the
 *   right and subtracts the one leaving on the left.  Division by
 *   the kernel size gives the average.
 *
 *   Edge pixels use "extend" boundary: we clamp the index so pixels
 *   outside the image repeat the edge value.
 * ──────────────────────────────────────────────────────────────── */
void box_blur(const uint8_t *in, uint8_t *out, uint8_t *tmp,
              int32_t width, int32_t height, int32_t radius)
{
    /* Clamp radius to something reasonable */
    if (radius < 0)   radius = 0;
    if (radius > 100)  radius = 100;
    if (radius == 0) {
        /* No blur — just copy */
        memcpy(out, in, (size_t)(width * height * 4));
        return;
    }

    int32_t kernelSize = 2 * radius + 1;

    /* ── Pass 1: horizontal blur  (in → tmp) ───────────────────── */
    for (int32_t y = 0; y < height; y++) {
        /* Initialise running sum for channels R, G, B, A */
        int32_t sumR = 0, sumG = 0, sumB = 0, sumA = 0;

        /* Seed the sum with the first kernel window [-radius .. radius] */
        for (int32_t kx = -radius; kx <= radius; kx++) {
            int32_t sx = kx;
            if (sx < 0)      sx = 0;           /* clamp left  */
            if (sx >= width)  sx = width - 1;   /* clamp right */
            int32_t off = (y * width + sx) * 4;
            sumR += in[off + 0];
            sumG += in[off + 1];
            sumB += in[off + 2];
            sumA += in[off + 3];
        }

        /* Write the first pixel */
        int32_t dstOff = y * width * 4;
        tmp[dstOff + 0] = (uint8_t)(sumR / kernelSize);
        tmp[dstOff + 1] = (uint8_t)(sumG / kernelSize);
        tmp[dstOff + 2] = (uint8_t)(sumB / kernelSize);
        tmp[dstOff + 3] = (uint8_t)(sumA / kernelSize);

        /* Slide the window across the row */
        for (int32_t x = 1; x < width; x++) {
            /* Add new pixel entering on the right */
            int32_t addX = x + radius;
            if (addX >= width) addX = width - 1;
            int32_t addOff = (y * width + addX) * 4;
            sumR += in[addOff + 0];
            sumG += in[addOff + 1];
            sumB += in[addOff + 2];
            sumA += in[addOff + 3];

            /* Subtract pixel leaving on the left */
            int32_t subX = x - radius - 1;
            if (subX < 0) subX = 0;
            int32_t subOff = (y * width + subX) * 4;
            sumR -= in[subOff + 0];
            sumG -= in[subOff + 1];
            sumB -= in[subOff + 2];
            sumA -= in[subOff + 3];

            dstOff = (y * width + x) * 4;
            tmp[dstOff + 0] = (uint8_t)(sumR / kernelSize);
            tmp[dstOff + 1] = (uint8_t)(sumG / kernelSize);
            tmp[dstOff + 2] = (uint8_t)(sumB / kernelSize);
            tmp[dstOff + 3] = (uint8_t)(sumA / kernelSize);
        }
    }

    /* ── Pass 2: vertical blur  (tmp → out) ────────────────────── */
    for (int32_t x = 0; x < width; x++) {
        int32_t sumR = 0, sumG = 0, sumB = 0, sumA = 0;

        /* Seed */
        for (int32_t ky = -radius; ky <= radius; ky++) {
            int32_t sy = ky;
            if (sy < 0)       sy = 0;
            if (sy >= height) sy = height - 1;
            int32_t off = (sy * width + x) * 4;
            sumR += tmp[off + 0];
            sumG += tmp[off + 1];
            sumB += tmp[off + 2];
            sumA += tmp[off + 3];
        }

        int32_t dstOff = x * 4;
        out[dstOff + 0] = (uint8_t)(sumR / kernelSize);
        out[dstOff + 1] = (uint8_t)(sumG / kernelSize);
        out[dstOff + 2] = (uint8_t)(sumB / kernelSize);
        out[dstOff + 3] = (uint8_t)(sumA / kernelSize);

        for (int32_t y = 1; y < height; y++) {
            int32_t addY = y + radius;
            if (addY >= height) addY = height - 1;
            int32_t addOff = (addY * width + x) * 4;
            sumR += tmp[addOff + 0];
            sumG += tmp[addOff + 1];
            sumB += tmp[addOff + 2];
            sumA += tmp[addOff + 3];

            int32_t subY = y - radius - 1;
            if (subY < 0) subY = 0;
            int32_t subOff = (subY * width + x) * 4;
            sumR -= tmp[subOff + 0];
            sumG -= tmp[subOff + 1];
            sumB -= tmp[subOff + 2];
            sumA -= tmp[subOff + 3];

            dstOff = (y * width + x) * 4;
            out[dstOff + 0] = (uint8_t)(sumR / kernelSize);
            out[dstOff + 1] = (uint8_t)(sumG / kernelSize);
            out[dstOff + 2] = (uint8_t)(sumB / kernelSize);
            out[dstOff + 3] = (uint8_t)(sumA / kernelSize);
        }
    }
}

/* ────────────────────────────────────────────────────────────────
 * sharpen — unsharp mask sharpening
 *
 * Algorithm:
 *   1. Blur the input with a small box blur (radius 1).
 *   2. For each pixel:  out = clamp( in + strength × (in − blurred) )
 *
 * This enhances edges by adding back the high-frequency detail
 * that was removed by the blur.
 *
 * `tmp` is used as scratch space for the internal blur.
 * We also need a second scratch area, so we reuse `out` temporarily
 * for the blur result, then overwrite it with the final sharpened
 * pixels.
 *
 * Actually, to keep it clean we'll use tmp for horizontal pass
 * and do everything in-place carefully.
 * ──────────────────────────────────────────────────────────────── */
void sharpen(const uint8_t *in, uint8_t *out, uint8_t *tmp,
             int32_t width, int32_t height, float strength)
{
    int32_t size = width * height * 4;

    if (strength < 0.0f)  strength = 0.0f;
    if (strength > 10.0f) strength = 10.0f;

    /* Step 1: blur the input into `out` (using `tmp` as scratch).
       We use box_blur with radius=1 (3×3 kernel). */
    box_blur(in, out, tmp, width, height, 1);

    /* Step 2: unsharp mask:  result = in + strength * (in - blurred) */
    for (int32_t i = 0; i < size; i += 4) {
        for (int c = 0; c < 3; c++) {  /* R, G, B only */
            float orig    = (float)in[i + c];
            float blurred = (float)out[i + c];
            float val     = orig + strength * (orig - blurred);

            /* Clamp to valid byte range */
            if (val < 0.0f)   val = 0.0f;
            if (val > 255.0f) val = 255.0f;
            out[i + c] = (uint8_t)(val + 0.5f);
        }
        /* Preserve alpha from original */
        out[i + 3] = in[i + 3];
    }
}
