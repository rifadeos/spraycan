// Image loading + grayscale conversion (browser-only: uses canvas).
// Produces the working-resolution { width, height, data:Uint8ClampedArray }
// luminance buffer the rest of the pipeline consumes.

import { autoLevels as stretchLevels, clahe, medianFilter, flipHorizontal, flipVertical } from './filters.js';

export function fitSize(w, h, max) {
  const longEdge = Math.max(w, h);
  if (longEdge <= max) return { w, h };
  const s = max / longEdge;
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

export function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')); };
    img.src = url;
  });
}

// brightness: -255..255 (additive). contrast: -255..255 (standard formula).
export function imageToGray(img, opts = {}) {
  const { maxResolution = 1200, brightness = 0, contrast = 0, invert = false, smooth = 0, autoLevels = true, mirror = false, vflip = false } = opts;
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  const { w, h } = fitSize(sw, sh, maxResolution);

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const src = ctx.getImageData(0, 0, w, h).data;

  const data = new Uint8ClampedArray(w * h);
  const cf = (259 * (contrast + 255)) / (255 * (259 - contrast)); // contrast factor
  for (let i = 0, p = 0; i < src.length; i += 4, p++) {
    let lum = 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
    lum = cf * (lum - 128) + 128 + brightness;
    if (invert) lum = 255 - lum;
    data[p] = lum; // Uint8ClampedArray clamps to 0..255
  }

  let gray = { width: w, height: h, data };
  if (smooth > 0) gray = medianFilter(gray, smooth);     // edge-preserving despeckle
  if (autoLevels) gray = clahe(gray);                    // local-contrast equalize → detail in mid-tones
  if (mirror) gray = flipHorizontal(gray);               // back-cut / reverse stencil
  if (vflip) gray = flipVertical(gray);                  // top/bottom flip
  return gray;
}
