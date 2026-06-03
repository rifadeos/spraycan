// Edge / line-detail layer. Runs a Sobel operator over the grayscale image and
// keeps the strong gradients as OPEN (sprayed) pixels — i.e. the outlines and
// texture (fur, creases) that flat tonal posterizing can't reproduce. The edge
// strokes are dilated slightly so they stay continuous and cuttable. The result
// is a normal stencil mask used as an extra top (sprayed-last) layer.

import { makeMask } from './grid.js';
import { dilate as dilateMask } from './morphology.js';

export function edgeMask(gray, opts = {}) {
  const { width: W, height: H, data } = gray;
  const amount = Math.max(0, Math.min(100, opts.amount ?? 55));
  const thr = (100 - amount) * 4 + 20; // higher amount → lower threshold → more edges
  const r = Math.max(0, opts.dilate ?? 1);

  const out = makeMask(W, H, 0); // MATERIAL background; mark strong gradients OPEN
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const a = data[i - W - 1], b = data[i - W], c = data[i - W + 1];
      const d = data[i - 1], f = data[i + 1];
      const g = data[i + W - 1], h = data[i + W], k = data[i + W + 1];
      const gx = (c + 2 * f + k) - (a + 2 * d + g);
      const gy = (g + 2 * h + k) - (a + 2 * b + c);
      if (Math.abs(gx) + Math.abs(gy) > thr) out.data[i] = 1; // |gx|+|gy| ≈ gradient magnitude
    }
  }
  return r > 0 ? dilateMask(out, r) : out; // dilate to keep strokes continuous & cuttable
}
