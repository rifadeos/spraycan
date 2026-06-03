// Pure grayscale filters applied to clean a photo before posterizing.
// Operate on { width, height, data } luminance buffers — no DOM, unit-testable.

// Stretch luminance to the full 0..255 range using robust percentiles, so flat
// or low-contrast photos (e.g. a subject against a hazy sky) separate into
// distinct layers instead of collapsing into one band.
export function autoLevels(gray, loPct = 0.5, hiPct = 99.5) {
  const { width, height, data } = gray;
  const hist = new Int32Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;
  const total = data.length;
  const loCount = (total * loPct) / 100;
  const hiCount = (total * hiPct) / 100;
  let cum = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { cum += hist[v]; if (cum >= loCount) { lo = v; break; } }
  cum = 0;
  for (let v = 0; v < 256; v++) { cum += hist[v]; if (cum >= hiCount) { hi = v; break; } }
  const out = new Uint8ClampedArray(data.length);
  if (hi <= lo) { out.set(data); return { width, height, data: out }; }
  const scale = 255 / (hi - lo);
  for (let i = 0; i < data.length; i++) out[i] = (data[i] - lo) * scale;
  return { width, height, data: out };
}

// Mirror a grayscale buffer horizontally (for back-cutting / reverse stencils).
export function flipHorizontal(gray) {
  const { width: W, height: H, data } = gray;
  const out = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) out[row + (W - 1 - x)] = data[row + x];
  }
  return { width: W, height: H, data: out };
}

// Contrast-Limited Adaptive Histogram Equalization. Equalises contrast within
// local tiles (with a clip limit so noise isn't over-amplified), then bilinearly
// blends the per-tile mappings so there are no seams. This pulls real detail out
// of a photo's mid-tones, so a dark subject reads as more than a flat blob once
// posterised — the key to a good *automatic* stencil from an arbitrary photo.
export function clahe(gray, opts = {}) {
  const { width: W, height: H, data } = gray;
  const T = Math.max(1, opts.tiles ?? 8);
  const clip = opts.clip ?? 2.5;
  const tw = Math.max(1, Math.ceil(W / T)), th = Math.max(1, Math.ceil(H / T));
  const nx = Math.ceil(W / tw), ny = Math.ceil(H / th);

  // Per-tile clipped-CDF mapping (256 entries each).
  const maps = new Array(nx * ny);
  for (let gy = 0; gy < ny; gy++) {
    for (let gx = 0; gx < nx; gx++) {
      const x0 = gx * tw, y0 = gy * th, x1 = Math.min(W, x0 + tw), y1 = Math.min(H, y0 + th);
      const hist = new Int32Array(256); let count = 0;
      for (let y = y0; y < y1; y++) { const row = y * W; for (let x = x0; x < x1; x++) { hist[data[row + x]]++; count++; } }
      const map = new Uint8Array(256);
      if (count > 0) {
        const limit = Math.max(1, Math.floor((clip * count) / 256));
        let excess = 0;
        for (let i = 0; i < 256; i++) if (hist[i] > limit) { excess += hist[i] - limit; hist[i] = limit; }
        const add = Math.floor(excess / 256);
        for (let i = 0; i < 256; i++) hist[i] += add;
        let cdf = 0; const scale = 255 / count;
        for (let i = 0; i < 256; i++) { cdf += hist[i]; map[i] = Math.min(255, Math.round(cdf * scale)); }
      } else for (let i = 0; i < 256; i++) map[i] = i;
      maps[gy * nx + gx] = map;
    }
  }

  // Bilinearly blend the 4 surrounding tile maps for each pixel.
  const out = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) {
    const gyf = (y + 0.5) / th - 0.5;
    let gy0 = Math.floor(gyf), wy = gyf - gy0;
    if (gy0 < 0) { gy0 = 0; wy = 0; }
    let gy1 = Math.min(ny - 1, gy0 + 1); gy0 = Math.min(gy0, ny - 1);
    for (let x = 0; x < W; x++) {
      const gxf = (x + 0.5) / tw - 0.5;
      let gx0 = Math.floor(gxf), wx = gxf - gx0;
      if (gx0 < 0) { gx0 = 0; wx = 0; }
      let gx1 = Math.min(nx - 1, gx0 + 1); gx0 = Math.min(gx0, nx - 1);
      const v = data[y * W + x];
      const a = maps[gy0 * nx + gx0][v], b = maps[gy0 * nx + gx1][v];
      const c = maps[gy1 * nx + gx0][v], d = maps[gy1 * nx + gx1][v];
      const top = a + (b - a) * wx, bot = c + (d - c) * wx;
      out[y * W + x] = top + (bot - top) * wy;
    }
  }
  return { width: W, height: H, data: out };
}

// Mirror a grayscale buffer vertically (top/bottom).
export function flipVertical(gray) {
  const { width: W, height: H, data } = gray;
  const out = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) {
    const src = y * W, dst = (H - 1 - y) * W;
    for (let x = 0; x < W; x++) out[dst + x] = data[src + x];
  }
  return { width: W, height: H, data: out };
}

// Median filter — edge-preserving despeckle that turns noisy texture (fur,
// grass) into cleaner shapes without blurring boundaries. radius in pixels.
export function medianFilter(gray, radius) {
  const { width: W, height: H, data } = gray;
  const out = new Uint8ClampedArray(W * H);
  if (radius <= 0) { out.set(data); return { width: W, height: H, data: out }; }
  const win = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      win.length = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = Math.min(H - 1, Math.max(0, y + dy));
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = Math.min(W - 1, Math.max(0, x + dx));
          win.push(data[yy * W + xx]);
        }
      }
      win.sort((a, b) => a - b);
      out[y * W + x] = win[win.length >> 1];
    }
  }
  return { width: W, height: H, data: out };
}
