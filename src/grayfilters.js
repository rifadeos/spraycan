// Pure greyscale + tone pipeline, shared by the main thread (image.js) and the
// pipeline Web Worker (pipeline.worker.js). No DOM here — it operates on raw RGBA
// bytes (Uint8ClampedArray, 4/pixel) so the identical code runs on either thread,
// which is what guarantees the worker and the main-thread fallback agree exactly.

import { clahe, bilateralFilter, flipHorizontal, flipVertical } from './filters.js';

// Smoothing strength (0–3) → bilateral-filter radius in pixels.
const BILATERAL_RADIUS_BY_SMOOTH = [0, 4, 6, 8];

// rgba: Uint8ClampedArray (RGBA, length w*h*4). Returns the working-resolution
// { width, height, data:Uint8ClampedArray } luminance buffer. This is byte-for-byte
// the same computation imageToGray() used to do after getImageData().
export function grayFromRGBA(rgba, w, h, opts = {}) {
  const { brightness = 0, contrast = 0, invert = false, smooth = 0, autoLevels = true, mirror = false, vflip = false } = opts;
  const data = new Uint8ClampedArray(w * h);
  const cf = (259 * (contrast + 255)) / (255 * (259 - contrast)); // contrast factor
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    let lum = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
    lum = cf * (lum - 128) + 128 + brightness;
    if (invert) lum = 255 - lum;
    data[p] = lum; // Uint8ClampedArray clamps to 0..255
  }
  let gray = { width: w, height: h, data };
  if (smooth > 0) gray = bilateralFilter(gray, { radius: BILATERAL_RADIUS_BY_SMOOTH[smooth] ?? 6, sigmaR: 40 }); // flatten texture, keep edges
  if (autoLevels) gray = clahe(gray);                    // local-contrast equalize → detail in mid-tones
  if (mirror) gray = flipHorizontal(gray);               // back-cut / reverse stencil
  if (vflip) gray = flipVertical(gray);                  // top/bottom flip
  return gray;
}

// Near-uniform image → posterising yields flat/empty layers; the caller warns.
// Cheap single-pass min/max scan over the luminance buffer.
export function isFlatGray(gray) {
  let lo = 255, hi = 0; const d = gray.data;
  for (let i = 0; i < d.length; i++) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  return (hi - lo) < 4;
}
