// Connected-component labelling and small-feature removal (despeckle).
// Pure functions over masks — no DOM, fully unit-testable.

import { cloneMask, makeMask } from './grid.js';

// 4-connected labelling of all pixels equal to `value`.
// Returns { labels: Int32Array, sizes: number[] (sizes[label]=area), count }.
export function labelComponents(mask, value) {
  const { width, height, data } = mask;
  const labels = new Int32Array(width * height); // 0 = unlabelled
  const sizes = [0];
  let next = 1;
  const stack = [];
  for (let start = 0; start < data.length; start++) {
    if (data[start] !== value || labels[start] !== 0) continue;
    labels[start] = next;
    let size = 0;
    stack.length = 0;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop();
      size++;
      const x = p % width;
      const y = (p - x) / width;
      if (x > 0)        { const q = p - 1;     if (data[q] === value && labels[q] === 0) { labels[q] = next; stack.push(q); } }
      if (x < width - 1){ const q = p + 1;     if (data[q] === value && labels[q] === 0) { labels[q] = next; stack.push(q); } }
      if (y > 0)        { const q = p - width; if (data[q] === value && labels[q] === 0) { labels[q] = next; stack.push(q); } }
      if (y < height - 1){const q = p + width; if (data[q] === value && labels[q] === 0) { labels[q] = next; stack.push(q); } }
    }
    sizes.push(size);
    next++;
  }
  return { labels, sizes, count: next - 1 };
}

// Flip any connected run of `value` smaller than minArea to the other value.
export function removeSmallComponents(mask, value, minArea) {
  const out = cloneMask(mask);
  if (minArea <= 1) return out;
  const { labels, sizes } = labelComponents(mask, value);
  const other = value ? 0 : 1;
  for (let i = 0; i < out.data.length; i++) {
    const l = labels[i];
    if (l !== 0 && sizes[l] < minArea) out.data[i] = other;
  }
  return out;
}

// Remove tiny OPEN specks (un-sprayable dots) and tiny MATERIAL slivers
// (un-cuttable bits). minArea is in pixels of the working raster.
export function despeckle(mask, minArea) {
  if (minArea <= 1) return cloneMask(mask);
  let m = removeSmallComponents(mask, 1, minArea); // drop tiny open holes
  m = removeSmallComponents(m, 0, minArea);        // drop tiny material slivers
  return m;
}

// --- binary morphology (OPEN=1 / MATERIAL=0), square structuring element ----
// Grow the OPEN region by radius r (out-of-bounds treated as MATERIAL).
export function dilate(mask, r = 1) {
  const { width: W, height: H, data } = mask;
  if (r <= 0) return cloneMask(mask);
  const out = makeMask(W, H, 0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!data[y * W + x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        const ny = y + dy; if (ny < 0 || ny >= H) continue;
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx; if (nx < 0 || nx >= W) continue;
          out.data[ny * W + nx] = 1;
        }
      }
    }
  }
  return out;
}

// Shrink the OPEN region by radius r (a pixel survives only if its whole r-box
// is OPEN; out-of-bounds counts as MATERIAL, so borders erode).
export function erode(mask, r = 1) {
  const { width: W, height: H, data } = mask;
  if (r <= 0) return cloneMask(mask);
  const out = makeMask(W, H, 0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!data[y * W + x]) continue;
      let keep = 1;
      for (let dy = -r; dy <= r && keep; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || !data[ny * W + nx]) { keep = 0; break; }
        }
      }
      out.data[y * W + x] = keep;
    }
  }
  return out;
}

export function morphOpen(mask, r = 1) { return dilate(erode(mask, r), r); }   // removes thin specks/spurs
export function morphClose(mask, r = 1) { return erode(dilate(mask, r), r); }  // bridges small gaps

// Force a MATERIAL border around the mask. This is the stencil's holding frame:
// it guarantees a connected sheet edge so islands always have something to
// bridge to (without it, a design whose OPEN area reaches the border has no
// frame and its islands can't be tied).
export function frameBorder(mask, borderPx) {
  const out = cloneMask(mask);
  if (borderPx <= 0) return out;
  const { width: W, height: H, data } = out;
  const b = Math.min(borderPx, Math.floor(Math.min(W, H) / 2));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x < b || y < b || x >= W - b || y >= H - b) data[y * W + x] = 0; // MATERIAL
    }
  }
  return out;
}
