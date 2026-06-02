// Posterize a grayscale buffer into N nested ("cumulative") stencil layers.
//
// For K layers we pick K ascending luminance thresholds t1 < t2 < ... < tK.
// Spraying goes light -> dark, so the FIRST sprayed layer (lightest colour)
// covers the largest area and the LAST (darkest) the smallest. We therefore
// hand layer j (spray order, 0-based) the threshold sorted[K-1-j]:
//   layer 0  -> largest threshold  -> most OPEN area (sprayed first)
//   layer K-1-> smallest threshold -> least OPEN area (sprayed last, on top)
// Because {lum < small} ⊆ {lum < large}, the layers nest cleanly, which makes
// physical registration forgiving.

import { makeMask } from './grid.js';

export function luminanceHistogram(gray) {
  const h = new Int32Array(256);
  const d = gray.data;
  for (let i = 0; i < d.length; i++) h[d[i]]++;
  return h;
}

export function luminanceRange(gray) {
  let lo = 255, hi = 0;
  const d = gray.data;
  for (let i = 0; i < d.length; i++) {
    const v = d[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo > hi) { lo = 0; hi = 255; }
  return { lo, hi };
}

// Histogram-quantile thresholds: place each threshold where an equal share of
// the image's pixels falls, so the layers track the tones that actually exist.
// This captures detail in busy regions (fur, grass) far better than naive even
// spacing, which wastes bands on empty tonal gaps (e.g. a flat sky).
export function autoThresholds(gray, layers) {
  const hist = luminanceHistogram(gray);
  const total = gray.data.length || 1;
  const t = [];
  let cum = 0, next = 1;
  for (let v = 0; v < 256; v++) {
    cum += hist[v];
    while (next <= layers && cum >= (total * next) / (layers + 1)) { t.push(v); next++; }
  }
  while (t.length < layers) t.push(255);
  return dedupeAscending(t);
}

function dedupeAscending(arr) {
  const s = [...arr].sort((a, b) => a - b);
  for (let i = 1; i < s.length; i++) if (s[i] <= s[i - 1]) s[i] = s[i - 1] + 1;
  return s;
}

// OPEN where the pixel is darker than the threshold.
export function layerMaskFromThreshold(gray, threshold) {
  const { width, height, data } = gray;
  const m = makeMask(width, height, 0);
  for (let i = 0; i < data.length; i++) m.data[i] = data[i] < threshold ? 1 : 0;
  return m;
}

// Returns layers in spray order: [{ order, threshold, mask }, ...]
export function buildLayers(gray, thresholds) {
  const sorted = [...thresholds].sort((a, b) => a - b);
  const K = sorted.length;
  const layers = [];
  for (let j = 0; j < K; j++) {
    const threshold = sorted[K - 1 - j];
    layers.push({ order: j, threshold, mask: layerMaskFromThreshold(gray, threshold) });
  }
  return layers;
}
