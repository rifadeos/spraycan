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

// Multilevel Otsu thresholds: choose the K = `layers` boundaries that split the
// histogram into K+1 tonal classes maximizing between-class variance — i.e. the
// cleanest possible figure/ground separation. This is what makes a freshly
// loaded photo read as a recognizable stencil out of the box, instead of the
// blobby result that equal-pixel-share (quantile) thresholds tend to give.
// Solved exactly with a DP over the 256-bin histogram (Liao's moment tables).
export function autoThresholds(gray, layers) {
  const K = Math.max(1, layers);
  const hist = luminanceHistogram(gray);
  const total = gray.data.length || 1;
  // Cumulative zeroth (P) and first (S) moments of the probability histogram.
  const P = new Float64Array(256), S = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const p = hist[i] / total;
    P[i] = (i ? P[i - 1] : 0) + p;
    S[i] = (i ? S[i - 1] : 0) + i * p;
  }
  // Between-class term for a class spanning [a..b]: (Σ i·p)² / (Σ p).
  const H = (a, b) => {
    const w = P[b] - (a ? P[a - 1] : 0);
    if (w <= 1e-12) return 0;
    const s = S[b] - (a ? S[a - 1] : 0);
    return (s * s) / w;
  };
  const M = K + 1; // number of classes
  // dp[v] = best between-class variance partitioning [0..v]; rebuilt per class count.
  let dp = new Float64Array(256);
  for (let v = 0; v < 256; v++) dp[v] = H(0, v);
  const argTables = [];
  for (let k = 2; k <= M; k++) {
    const cur = new Float64Array(256).fill(-Infinity);
    const arg = new Int16Array(256).fill(-1);
    for (let v = k - 1; v < 256; v++) {
      let best = -Infinity, bestU = k - 2;
      for (let u = k - 2; u < v; u++) {
        const val = dp[u] + H(u + 1, v);
        if (val > best) { best = val; bestU = u; }
      }
      cur[v] = best; arg[v] = bestU;
    }
    dp = cur; argTables.push(arg);
  }
  // Backtrack the K cut points (boundary = end-of-previous-class + 1).
  const t = [];
  let v = 255;
  for (let k = M; k >= 2; k--) {
    const u = argTables[k - 2][v];
    t.push(u + 1);
    v = u;
  }
  t.reverse();
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
