// Floating-island detection.
//
// A stencil sheet is MATERIAL with OPEN regions cut out. Any piece of MATERIAL
// that is NOT connected (4-way) to the sheet border is a "floating island" —
// it would fall out when cut and must be tied back with a bridge.
//
// Strategy: flood MATERIAL inward from the border; every material pixel the
// flood fails to reach belongs to an island. Then label those into components.

import { labelComponents } from './morphology.js';

export function findIslands(mask) {
  const { width, height, data } = mask;
  const reached = new Uint8Array(width * height); // material connected to border
  const stack = [];

  const seed = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (data[i] === 0 && !reached[i]) { reached[i] = 1; stack.push(i); }
  };

  for (let x = 0; x < width; x++) { seed(x, 0); seed(x, height - 1); }
  for (let y = 0; y < height; y++) { seed(0, y); seed(width - 1, y); }

  while (stack.length) {
    const p = stack.pop();
    const x = p % width;
    const y = (p - x) / width;
    seed(x - 1, y); seed(x + 1, y); seed(x, y - 1); seed(x, y + 1);
  }

  // Build a mask whose value 0 marks island material, then label those.
  const islandMask = { width, height, data: new Uint8Array(width * height) };
  for (let i = 0; i < data.length; i++) islandMask.data[i] = (data[i] === 0 && !reached[i]) ? 0 : 1;

  const { labels, sizes, count } = labelComponents(islandMask, 0);

  const islands = [];
  for (let l = 1; l <= count; l++) islands.push({ label: l, size: sizes[l], sumX: 0, sumY: 0 });
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (l === 0) continue;
    const x = i % width;
    const y = (i - x) / width;
    const isl = islands[l - 1];
    isl.sumX += x; isl.sumY += y;
  }
  for (const isl of islands) { isl.cx = isl.sumX / isl.size; isl.cy = isl.sumY / isl.size; }

  return { reached, islandMask, labels, islands };
}
