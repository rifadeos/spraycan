// Image loading + grayscale conversion (browser-only: uses canvas).
// Produces the working-resolution { width, height, data:Uint8ClampedArray }
// luminance buffer the rest of the pipeline consumes.

import { grayFromRGBA } from './grayfilters.js';

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
// Canvas I/O (downscale + getImageData) happens here on the main thread; the actual
// tone-mapping is grayFromRGBA(), shared with the off-thread pipeline worker.
export function imageToGray(img, opts = {}) {
  const { maxResolution = 1200, ...gopts } = opts;
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  const { w, h } = fitSize(sw, sh, maxResolution);

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const src = ctx.getImageData(0, 0, w, h).data;

  return grayFromRGBA(src, w, h, gopts);
}
