// Grid + mask conventions shared across the whole pipeline.
//
// A "mask" is a binary raster: { width, height, data } where `data` is a
// Uint8Array of length width*height, row-major (index = y*width + x).
//
// Stencil convention:
//   OPEN     (1) -> cut away; paint/spray passes through here
//   MATERIAL (0) -> stencil sheet that stays; bridges are made of this
//
// A "gray" buffer is { width, height, data } where `data` holds luminance
// 0..255 (0 = black, 255 = white). Dark pixels become OPEN (sprayed).

export const OPEN = 1;
export const MATERIAL = 0;

export function makeMask(width, height, fill = MATERIAL) {
  const data = new Uint8Array(width * height);
  if (fill) data.fill(fill);
  return { width, height, data };
}

export function cloneMask(mask) {
  return { width: mask.width, height: mask.height, data: Uint8Array.from(mask.data) };
}

export function inBounds(x, y, width, height) {
  return x >= 0 && y >= 0 && x < width && y < height;
}

// Count OPEN pixels (handy for tests + "how much gets sprayed" stats).
export function openArea(mask) {
  const d = mask.data;
  let c = 0;
  for (let i = 0; i < d.length; i++) c += d[i];
  return c;
}
