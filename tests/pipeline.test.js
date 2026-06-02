import test from 'node:test';
import assert from 'node:assert/strict';

import { toMm, physicalSize } from '../src/units.js';
import {
  luminanceHistogram, luminanceRange, autoThresholds,
  buildLayers, layerMaskFromThreshold,
} from '../src/posterize.js';
import { openArea } from '../src/grid.js';
import { despeckle, labelComponents, frameBorder } from '../src/morphology.js';
import { findIslands } from '../src/islands.js';
import { autoBridges, burnBridges, prepareIslands } from '../src/bridges.js';
import { PALETTES, findPaintName, findNearestPaint } from '../src/palettes.js';
import { PAGE_OPTIONS } from '../src/exporters/pdf.js';
import { autoLevels, medianFilter } from '../src/filters.js';
import { edgeMask } from '../src/edges.js';

// --- helpers ---------------------------------------------------------------

function gray(rows) {
  const height = rows.length, width = rows[0].length;
  const data = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = rows[y][x];
  return { width, height, data };
}

// '#' = OPEN (1), '.' = MATERIAL (0)
function art(s) {
  const rows = s.trim().split('\n').map(r => r.trim());
  const height = rows.length, width = rows[0].length;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = rows[y][x] === '#' ? 1 : 0;
  return { width, height, data };
}

// --- units -----------------------------------------------------------------

test('unit conversion', () => {
  assert.equal(toMm(1, 'cm'), 10);
  assert.equal(toMm(1, 'in'), 25.4);
  assert.equal(toMm(5, 'mm'), 5);
  const p = physicalSize(100, 50, 200); // 100px wide -> 200mm
  assert.equal(p.widthMm, 200);
  assert.equal(p.heightMm, 100);
  assert.equal(p.mmPerPx, 2);
});

// --- posterize -------------------------------------------------------------

test('histogram + range', () => {
  const g = gray([[0, 0, 128, 255]]);
  const h = luminanceHistogram(g);
  assert.equal(h[0], 2);
  assert.equal(h[128], 1);
  assert.equal(h[255], 1);
  const r = luminanceRange(g);
  assert.deepEqual(r, { lo: 0, hi: 255 });
});

test('threshold mask: dark pixels are OPEN', () => {
  const g = gray([[0, 64, 128, 192, 255]]);
  const m = layerMaskFromThreshold(g, 128);
  assert.deepEqual([...m.data], [1, 1, 0, 0, 0]);
});

test('auto thresholds are ascending and in range', () => {
  const g = gray([[10, 50, 120, 200, 240]]);
  const t = autoThresholds(g, 3);
  assert.equal(t.length, 3);
  for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1], 'ascending');
  assert.ok(t[0] >= 10 && t[t.length - 1] <= 240, 'within tonal range');
});

test('layers nest: darker layer OPEN ⊆ lighter layer OPEN', () => {
  const g = gray([[0, 60, 120, 180, 240]]);
  const layers = buildLayers(g, [80, 160]);
  assert.equal(layers.length, 2);
  // layer 0 = sprayed first / lightest / largest open area
  assert.ok(openArea(layers[0].mask) >= openArea(layers[1].mask));
  for (let i = 0; i < g.data.length; i++) {
    if (layers[1].mask.data[i] === 1) assert.equal(layers[0].mask.data[i], 1, 'nesting holds');
  }
});

// --- morphology ------------------------------------------------------------

test('despeckle removes a lone open pixel', () => {
  const m = art(`
    .....
    .....
    ..#..
    .....
    .....
  `);
  assert.equal(openArea(m), 1);
  const cleaned = despeckle(m, 2);
  assert.equal(openArea(cleaned), 0);
});

test('labelComponents counts separate blobs', () => {
  const m = art(`
    #..#
    #..#
    ....
  `);
  const { count } = labelComponents(m, 1);
  assert.equal(count, 2);
});

// --- islands + bridges -----------------------------------------------------

const DONUT = `
  .......
  .#####.
  .#...#.
  .#...#.
  .#...#.
  .#####.
  .......
`;

test('island detection finds the enclosed counter', () => {
  const m = art(DONUT);
  const { islands } = findIslands(m);
  assert.equal(islands.length, 1);
  assert.equal(islands[0].size, 9); // inner 3x3 material block
});

test('a plain blob has no islands', () => {
  const m = art(`
    .....
    .###.
    .###.
    .....
  `);
  assert.equal(findIslands(m).islands.length, 0);
});

test('auto-bridge ties the island so it no longer floats', () => {
  const m = art(DONUT);
  const bridges = autoBridges(m, { widthPx: 1 });
  assert.ok(bridges.length >= 1, 'at least one bridge placed');
  const burned = burnBridges(m, bridges);
  assert.equal(findIslands(burned).islands.length, 0, 'island connected after burning');
});

test('autoLevels stretches the tonal range to 0..255', () => {
  const g = gray([[50, 100, 150, 200]]);
  const r = autoLevels(g, 0.5, 99.5);
  assert.equal(r.data[0], 0);
  assert.equal(r.data[3], 255);
  assert.ok(r.data[1] > 0 && r.data[1] < r.data[2]);
});

test('edgeMask finds boundaries, not flat areas', () => {
  const W = 12, H = 6;
  const data = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[y * W + x] = x < 6 ? 0 : 255;
  const m = edgeMask({ width: W, height: H, data }, { amount: 60, dilate: 1 });
  let edges = 0; for (const v of m.data) edges += v;
  assert.ok(edges > 0, 'edge detected at the boundary');
  assert.equal(m.data[0], 0, 'flat corner stays material');
});

test('medianFilter removes a lone speckle', () => {
  const g = gray([[100, 100, 100], [100, 255, 100], [100, 100, 100]]);
  const r = medianFilter(g, 1);
  assert.ok([...r.data].every(v => v === 100));
});

test('page-size table is sane (mm; A-series ascending)', () => {
  assert.deepEqual(PAGE_OPTIONS.a4, [210, 297]);
  for (const [k, v] of Object.entries(PAGE_OPTIONS)) {
    assert.ok(Array.isArray(v) && v.length === 2 && v[0] > 0 && v[1] > 0, `${k} valid`);
  }
  const a = ['a6', 'a5', 'a4', 'a3', 'a2', 'a1', 'a0'];
  const area = s => PAGE_OPTIONS[s][0] * PAGE_OPTIONS[s][1];
  for (let i = 1; i < a.length; i++) assert.ok(area(a[i]) > area(a[i - 1]), `${a[i]} > ${a[i - 1]}`);
});

test('findNearestPaint returns a real can', () => {
  const exact = findNearestPaint('#ffd200'); // exact Montana Shock Yellow
  assert.ok(exact && exact.hex.toLowerCase() === '#ffd200');
  const near = findNearestPaint('#0b0b0b'); // near-black -> some black
  assert.ok(near && near.name && near.brand);
});

test('palette entries are valid {name, #rrggbb}', () => {
  assert.ok(PALETTES.length >= 1);
  for (const p of PALETTES) {
    assert.ok(p.id && p.label && Array.isArray(p.colors) && p.colors.length, `palette ${p.id} populated`);
    for (const c of p.colors) {
      assert.ok(typeof c.name === 'string' && c.name.length, `name in ${p.id}`);
      assert.match(c.hex, /^#[0-9a-f]{6}$/i, `hex ${c.hex} in ${p.id}`);
    }
  }
  assert.equal(findPaintName('#ffffff'), 'White');
  assert.equal(findPaintName('#nomatch'), null);
});

test('prepareIslands fills small islands and bridges the kept ones', () => {
  const m = art(DONUT); // one enclosed island, size 9
  // Threshold above the island size -> filled (sprayed solid), no bridges.
  const filled = prepareIslands(m, { minIslandArea: 100, widthPx: 1 });
  assert.equal(filled.kept, 0);
  assert.equal(filled.bridges.length, 0);
  assert.equal(findIslands(filled.mask).islands.length, 0, 'tiny island absorbed');
  // Threshold below the island size -> kept and tied.
  const kept = prepareIslands(m, { minIslandArea: 5, widthPx: 1 });
  assert.equal(kept.kept, 1);
  assert.ok(kept.bridges.length >= 1);
  assert.equal(findIslands(burnBridges(kept.mask, kept.bridges)).islands.length, 0, 'kept island tied');
});

test('prepareIslands keeps bright highlight islands regardless of size', () => {
  // donut with a 5x5 (25px) enclosed material centre — big enough to clear the
  // bright-island minimum, but below the size-keep threshold.
  const m = art(`
    .........
    .#######.
    .#.....#.
    .#.....#.
    .#.....#.
    .#.....#.
    .#.....#.
    .#######.
    .........
  `);
  assert.equal(findIslands(m).islands.length, 1);
  const brightMask = new Uint8Array(m.width * m.height).fill(1); // mark all as bright
  const r = prepareIslands(m, { minIslandArea: 100, widthPx: 1, brightMask, keepHighlights: true });
  assert.equal(r.kept, 1);
  assert.ok(r.bridges.length >= 1);
});

test('prepareIslands caps how many islands are kept', () => {
  // Four separate single-cell islands in an open field.
  const m = art(`
    #####
    #.#.#
    #####
    #.#.#
    #####
  `);
  assert.equal(findIslands(m).islands.length, 4);
  const r = prepareIslands(m, { minIslandArea: 0, maxBridges: 2, widthPx: 1 });
  assert.equal(r.kept, 2);
  assert.equal(r.filled, 2);
});

test('frameBorder gives edge-touching designs a frame to bridge to', () => {
  // OPEN reaches every border, with one enclosed MATERIAL island in the centre.
  const m = art(`
    #######
    #######
    #######
    ###.###
    #######
    #######
    #######
  `);
  // Without a frame there is no border-connected material, so the island
  // is detected but cannot be tied to anything.
  assert.equal(findIslands(m).islands.length, 1);
  assert.equal(autoBridges(m, { widthPx: 1 }).length, 0);
  // A 1px material frame gives it an anchor, and now it bridges.
  const framed = frameBorder(m, 1);
  const bridges = autoBridges(framed, { widthPx: 1 });
  assert.ok(bridges.length >= 1, 'bridge placed to frame');
  assert.equal(findIslands(burnBridges(framed, bridges)).islands.length, 0);
});
