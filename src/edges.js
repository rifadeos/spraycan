// Edge / line-detail layer. Runs a Sobel operator over the grayscale image and
// keeps the strong gradients as OPEN (sprayed) pixels — i.e. the outlines and
// texture (fur, creases) that flat tonal posterizing can't reproduce. The edge
// strokes are dilated slightly so they stay continuous and cuttable. The result
// is a normal stencil mask used as an extra top (sprayed-last) layer.

import { makeMask } from './grid.js';

export function edgeMask(gray, opts = {}) {
  const { width: W, height: H, data } = gray;
  const amount = Math.max(0, Math.min(100, opts.amount ?? 55));
  const thr = (100 - amount) * 4 + 20; // higher amount → lower threshold → more edges
  const dilate = Math.max(0, opts.dilate ?? 1);

  const edge = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const a = data[i - W - 1], b = data[i - W], c = data[i - W + 1];
      const d = data[i - 1], f = data[i + 1];
      const g = data[i + W - 1], h = data[i + W], k = data[i + W + 1];
      const gx = (c + 2 * f + k) - (a + 2 * d + g);
      const gy = (g + 2 * h + k) - (a + 2 * b + c);
      if (Math.abs(gx) + Math.abs(gy) > thr) edge[i] = 1; // |gx|+|gy| ≈ gradient magnitude
    }
  }

  const out = makeMask(W, H, 0); // MATERIAL background
  const r = dilate;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!edge[y * W + x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H) out.data[ny * W + nx] = 1; // OPEN (edge stroke)
        }
      }
    }
  }
  return out;
}
