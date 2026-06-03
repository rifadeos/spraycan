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
