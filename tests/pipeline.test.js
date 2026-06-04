import test from 'node:test';
import assert from 'node:assert/strict';

import { toMm, physicalSize } from '../src/units.js';
import {
  luminanceHistogram, luminanceRange, autoThresholds,
  buildLayers, layerMaskFromThreshold,
} from '../src/posterize.js';
import { openArea } from '../src/grid.js';
import { despeckle, labelComponents, frameBorder, dilate, erode, morphOpen, morphClose } from '../src/morphology.js';
import { findIslands } from '../src/islands.js';
import { autoBridges, burnBridges, prepareIslands } from '../src/bridges.js';
import { PALETTES, findPaintName, findNearestPaint } from '../src/palettes.js';
import { PAGE_OPTIONS, sheetPageSize } from '../src/exporters/pdf.js';
import { autoLevels, clahe, bilateralFilter, medianFilter, flipHorizontal, flipVertical } from '../src/filters.js';
import { edgeMask } from '../src/edges.js';
import { PRESETS, imageStats, pickPreset, skinFraction, analyzeColor, presetFromSignals } from '../src/presets.js';

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

test('autoThresholds (Otsu) splits a bimodal image between the two modes', () => {
  const rows = [];
  for (let y = 0; y < 8; y++) rows.push([40, 40, 40, 40, 210, 210, 210, 210]);
  const g = gray(rows);
  const [t] = autoThresholds(g, 1);
  assert.ok(t > 40 && t <= 210, `Otsu threshold ${t} should sit between the two modes`);
});

test('autoThresholds clamp ≤255 on a near-flat image (no all-OPEN layers)', () => {
  // A nearly uniform image collapses every Otsu cut to one value; forcing them
  // strictly ascending must not exceed 255 (which would make `data < t` always
  // true → every layer fully OPEN/black).
  const rows = [];
  for (let y = 0; y < 8; y++) rows.push(new Array(8).fill(254));
  const t = autoThresholds(gray(rows), 6);
  assert.equal(t.length, 6);
  for (const v of t) assert.ok(v >= 0 && v <= 255, `threshold ${v} must stay ≤255`);
  for (let i = 1; i < t.length; i++) assert.ok(t[i] >= t[i - 1], 'non-decreasing');
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

test('dilate grows a lone pixel into its 3x3 box', () => {
  const m = art(`
    .....
    .....
    ..#..
    .....
    .....`);
  const d = dilate(m, 1);
  assert.equal([...d.data].reduce((a, b) => a + b, 0), 9);
  assert.equal(d.data[2 * 5 + 2], 1);
});

test('morphOpen removes a lone open speck but keeps a solid block', () => {
  const speck = art(`
    .....
    .....
    ..#..
    .....
    .....`);
  assert.ok([...morphOpen(speck, 1).data].every(v => v === 0)); // speck erased

  const block = art(`
    .....
    .###.
    .###.
    .###.
    .....`);
  assert.deepEqual([...morphOpen(block, 1).data], [...block.data]); // 3x3 blob preserved
});

test('morphClose fills a 1px gap in a line', () => {
  const line = art(`
    .......
    .##.##.
    .......`);
  const c = morphClose(line, 1);
  assert.equal(c.data[1 * 7 + 3], 1);            // the gap is now bridged
  for (let x = 1; x <= 5; x++) assert.equal(c.data[1 * 7 + x], 1);
});

test('erode shrinks a block and is undone by dilate (close ≈ identity on a blob)', () => {
  const block = art(`
    .....
    .###.
    .###.
    .###.
    .....`);
  assert.equal([...erode(block, 1).data].reduce((a, b) => a + b, 0), 1); // 3x3 → single core pixel
  assert.deepEqual([...morphClose(block, 1).data], [...block.data]);     // gaps-none → unchanged
});

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

test('autoBridges: physics-aware mode gives a big island several spread ties', () => {
  const W = 41, H = 41;
  const data = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    data[y * W + x] = (x === 0 || y === 0 || x === W - 1 || y === H - 1) ? 0 : 1; // MATERIAL border, OPEN inside
  }
  for (let y = 15; y <= 25; y++) for (let x = 15; x <= 25; x++) data[y * W + x] = 0; // central island
  const mask = { width: W, height: H, data };
  const single = autoBridges(mask, { widthPx: 2 });                                  // legacy: one tie
  const multi = autoBridges(mask, { widthPx: 2, mmPerPx: 2, tieSpacingMm: 6 });      // physics: span 20mm
  assert.equal(single.length, 1);
  assert.ok(multi.length >= 2, `expected >=2 spread ties, got ${multi.length}`);
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

test('flipHorizontal mirrors columns and is its own inverse', () => {
  const g = gray([[1, 2, 3], [4, 5, 6]]);
  const f = flipHorizontal(g);
  assert.equal(f.width, 3); assert.equal(f.height, 2);
  assert.deepEqual([...f.data], [3, 2, 1, 6, 5, 4]);
  assert.deepEqual([...flipHorizontal(f).data], [...g.data]); // double flip = identity
});

test('pickPreset maps image stats to a sensible preset', () => {
  assert.equal(pickPreset({ std: 70, toneCount: 4 }), 'logo');      // few flat tones + contrast → graphic/logo
  assert.equal(pickPreset({ std: 40, toneCount: 60 }), 'subject');  // a photo → isolate the subject
  assert.equal(pickPreset({ std: 35, toneCount: 90 }), 'subject');  // busy photo → still subject (with fallback)
});

test('pickPreset routes a face to the portrait preset', () => {
  assert.equal(pickPreset({ std: 40, toneCount: 60, skinFraction: 0.3 }), 'portrait'); // lots of skin → portrait
  assert.equal(pickPreset({ std: 40, toneCount: 60, skinFraction: 0.02 }), 'subject'); // little skin → subject
  assert.equal(pickPreset({ std: 70, toneCount: 4, skinFraction: 0 }), 'logo');         // flat graphic still logo
});

test('skinFraction detects skin tones and ignores non-skin', () => {
  const W = 20, H = 20;
  const skin = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < skin.length; i += 4) { skin[i] = 200; skin[i + 1] = 140; skin[i + 2] = 110; skin[i + 3] = 255; }
  assert.ok(skinFraction(skin, W, H) > 0.5, 'a skin-toned image reads as mostly skin');
  const blue = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < blue.length; i += 4) { blue[i] = 40; blue[i + 1] = 80; blue[i + 2] = 200; blue[i + 3] = 255; }
  assert.equal(skinFraction(blue, W, H), 0, 'a blue image has no skin');
});

test('portrait preset isolates the subject and uses few layers (fights face holes)', () => {
  assert.equal(PRESETS.portrait.params.removeBg, true);
  assert.ok(PRESETS.portrait.params.layers <= 4, 'portrait uses few layers');
  assert.ok(PRESETS.portrait.params.minFeature >= 10, 'portrait merges small facial islands');
});

test('analyzeColor detects sky + foliage; pickPreset → landscape', () => {
  const W = 40, H = 40, d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, top = y < H * 0.42;       // top = sky, bottom = foliage
    d[i] = top ? 100 : 60; d[i + 1] = top ? 150 : 160; d[i + 2] = top ? 220 : 70; d[i + 3] = 255;
  }
  const a = analyzeColor(d, W, H);
  assert.ok(a.skyFraction > 0.4, `skyFraction ${a.skyFraction}`);
  assert.ok(a.greenFraction > 0.3, `greenFraction ${a.greenFraction}`);
  assert.equal(pickPreset(a), 'landscape');
});

test('pickPreset priority: face > logo > landscape > subject', () => {
  assert.equal(pickPreset({ skinFraction: 0.2, greenFraction: 0.5 }), 'portrait');   // a face wins
  assert.equal(pickPreset({ toneCount: 4, std: 70, greenFraction: 0.5 }), 'logo');   // flat graphic next
  assert.equal(pickPreset({ toneCount: 60, skyFraction: 0.5 }), 'landscape');        // outdoor scene
  assert.equal(pickPreset({ toneCount: 60, std: 40 }), 'subject');                   // plain photo → isolate
});

test('landscape preset keeps the whole image (no isolate) with rich tones', () => {
  assert.equal(PRESETS.landscape.params.removeBg, false);
  assert.ok(PRESETS.landscape.params.layers >= 5);
});

test('presetFromSignals combines ML signals (face/scene/animal/object) with tone stats', () => {
  assert.equal(presetFromSignals({ faceArea: 0.10, faceConf: 0.95 }), 'portrait');                  // confident face
  assert.equal(presetFromSignals({ faceArea: 0.08, faceConf: 0.6, skinFraction: 0.1 }), 'portrait'); // soft face + skin
  assert.equal(presetFromSignals({ faceArea: 0.10, faceConf: 0.6, skinFraction: 0 }), 'subject');   // face-ish but no skin (e.g. a circle)
  assert.equal(presetFromSignals({ faceArea: 0.01, faceConf: 0.99, hasObject: true }), 'subject');  // tiny face → not a portrait
  assert.equal(presetFromSignals({ scene: true }), 'landscape');                                    // recognised outdoor scene
  assert.equal(presetFromSignals({ animal: true, aspect: 1.8 }), 'landscape');                      // wildlife in a wide frame
  assert.equal(presetFromSignals({ animal: true, aspect: 1.0, hasObject: true }), 'subject');       // animal in a tight frame → isolate
  assert.equal(presetFromSignals({ toneCount: 4, std: 70 }), 'logo');                               // flat high-contrast graphic
  assert.equal(presetFromSignals({ hasObject: true }), 'subject');                                  // recognised object → isolate
  assert.equal(presetFromSignals({ skinFraction: 0.2 }), 'portrait');                               // no ML → colour heuristic still routes
  assert.equal(presetFromSignals({}), 'subject');                                                   // nothing → safe default
});

test('every preset only references real control ids', () => {
  const VALID = new Set(['brightness', 'contrast', 'smooth', 'detail', 'invert', 'autoLevels', 'mirror', 'vflip', 'layers', 'minFeature', 'keepHighlights', 'edges', 'edgeAmount', 'removeBg']);
  for (const [id, p] of Object.entries(PRESETS)) {
    assert.ok(p.label, `${id} needs a label`);
    for (const k of Object.keys(p.params)) assert.ok(VALID.has(k), `${id} references unknown control "${k}"`);
  }
});

test('imageStats summarises a two-tone image', () => {
  const rows = [];
  for (let y = 0; y < 16; y++) rows.push(new Array(16).fill(y < 8 ? 40 : 210));
  const s = imageStats(gray(rows), 1);
  assert.ok(s.std > 50);          // high contrast
  assert.equal(s.toneCount, 2);   // two dominant tones
});

test('bilateralFilter smooths noise but keeps a hard edge', () => {
  const W = 24, H = 24, data = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const base = x < W / 2 ? 60 : 200;
    data[y * W + x] = base + (((x + y) % 2) ? 12 : -12); // ±12 checker noise on each side
  }
  const r = bilateralFilter({ width: W, height: H, data }, { radius: 3, sigmaR: 30 });
  const mid = Math.floor(H / 2) * W;
  assert.ok(r.data[mid + 5] < 110, `left side should stay dark, got ${r.data[mid + 5]}`);
  assert.ok(r.data[mid + 18] > 150, `right side should stay light, got ${r.data[mid + 18]}`);
  const variance = buf => { let s = 0, s2 = 0, n = 0; for (let y = 4; y < H - 4; y++) for (let x = 2; x < 10; x++) { const v = buf[y * W + x]; s += v; s2 += v * v; n++; } return s2 / n - (s / n) ** 2; };
  assert.ok(variance(r.data) < variance(data), 'left-region noise variance should drop');
});

test('clahe widens local contrast and stays in range', () => {
  const rows = [];
  for (let y = 0; y < 64; y++) rows.push(new Array(64).fill(110 + y)); // low-contrast vertical ramp 110..173 (range 63)
  const r = clahe(gray(rows), { tiles: 2, clip: 4 });
  assert.equal(r.width, 64); assert.equal(r.height, 64);
  let lo = 255, hi = 0;
  for (const v of r.data) { assert.ok(v >= 0 && v <= 255); if (v < lo) lo = v; if (v > hi) hi = v; }
  assert.ok(hi - lo > 63, `expected widened range (>63), got ${hi - lo}`);
});

test('flipVertical mirrors rows and is its own inverse', () => {
  const g = gray([[1, 2, 3], [4, 5, 6]]);
  const f = flipVertical(g);
  assert.equal(f.width, 3); assert.equal(f.height, 2);
  assert.deepEqual([...f.data], [4, 5, 6, 1, 2, 3]);
  assert.deepEqual([...flipVertical(f).data], [...g.data]); // double flip = identity
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

test('sheetPageSize: true-size custom page when it fits, scaled-to-fit when oversized', () => {
  const small = sheetPageSize(300, 200, 10, 24, [210, 297]); // fits within A0
  assert.equal(small.fit, 1);
  assert.equal(small.pageW, 320);  // 300 + 2*margin
  assert.equal(small.pageH, 244);  // 200 + 2*margin + extraV(24)
  const huge = sheetPageSize(1500, 1000, 10, 24, [210, 297]); // exceeds A0 → fallback A4
  assert.ok(huge.fit < 1);
  assert.equal(huge.pageW, 210);
  assert.equal(huge.pageH, 297);
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
