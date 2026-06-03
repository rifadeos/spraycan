// Bridges (ties): thin strips of MATERIAL burned across an OPEN gap to hold a
// floating island in place. A bridge is { x1, y1, x2, y2, width } in working
// pixel coords; per-layer bridge lists are managed by the caller.

import { cloneMask } from './grid.js';
import { findIslands } from './islands.js';

// Tie every floating island back to the main (border-connected) material.
// With `mmPerPx` set, bridging is PHYSICS-AWARE: the number of ties scales with
// the island's real-world span (anchored roughly every `tieSpacingMm`), so a big
// island gets several evenly-spread ties and can't pivot, sag, or tear — instead
// of dangling from a single point. Without `mmPerPx` it falls back to one tie.
export function autoBridges(mask, opts = {}) {
  const widthPx = opts.widthPx ?? 4;
  // Bound the search so each tie is cheap to find (a real bridge is short).
  const maxGap = opts.maxGap ?? Math.max(40, Math.round(Math.min(mask.width, mask.height) * 0.3));
  const mmPerPx = opts.mmPerPx ?? null;
  const tieSpacingMm = opts.tieSpacingMm ?? 50;
  const maxTiesPerIsland = opts.maxTiesPerIsland ?? 8;
  const { reached, labels } = findIslands(mask);
  const W = mask.width;

  const islandPixels = new Map(); // label -> pixel indices
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (l > 0) {
      if (!islandPixels.has(l)) islandPixels.set(l, []);
      islandPixels.get(l).push(i);
    }
  }

  const bridges = [];
  for (const pixels of islandPixels.values()) {
    if (!mmPerPx) { // legacy: a single shortest tie
      const tie = shortestTie(mask, reached, pixels, maxGap);
      if (tie) bridges.push({ ...tie, width: widthPx });
      continue;
    }
    // How many ties does this island physically need at the real print size?
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, sx = 0, sy = 0;
    for (const p of pixels) { const x = p % W, y = (p - x) / W; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; sx += x; sy += y; }
    const spanMm = Math.max(maxX - minX, maxY - minY) * mmPerPx;
    const minTies = spanMm < 12 ? 1 : 2; // tiny → 1; else ≥2 so it can't rotate
    const count = Math.max(minTies, Math.min(maxTiesPerIsland, Math.round(spanMm / tieSpacingMm) || 1));
    const ties = multiTie(mask, reached, pixels, { count, maxGap, cx: sx / pixels.length, cy: sy / pixels.length });
    for (const t of ties) bridges.push({ ...t, width: widthPx });
  }
  return bridges;
}

// Multi-source BFS outward from an island's surrounding OPEN pixels until it
// touches main material. Returns the straight tie island->main, or null.
function shortestTie(mask, reached, islandPixels, maxGap) {
  const { width: W, height: H, data } = mask;
  const N = W * H;
  const dist = new Int32Array(N).fill(-1);
  const origin = new Int32Array(N).fill(-1); // island pixel that seeded this path
  const queue = [];

  for (const p of islandPixels) {
    const x = p % W, y = (p - x) / W;
    const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [nx, ny] of nb) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const q = ny * W + nx;
      if (data[q] === 1 && dist[q] === -1) { dist[q] = 1; origin[q] = p; queue.push(q); }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const p = queue[head++];
    if (dist[p] > maxGap) continue;
    const x = p % W, y = (p - x) / W;
    const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [nx, ny] of nb) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const q = ny * W + nx;
      if (data[q] === 1) {
        if (dist[q] === -1) { dist[q] = dist[p] + 1; origin[q] = origin[p]; queue.push(q); }
      } else if (data[q] === 0 && reached[q]) {
        const isl = origin[p];
        const ix = isl % W, iy = (isl - ix) / W;
        return { x1: ix, y1: iy, x2: nx, y2: ny };
      }
    }
  }
  return null;
}

// Multi-source BFS from an island's surrounding OPEN pixels; keep the shortest
// tie to main material within each of `count` angular sectors around the island
// centroid, so the ties are spread around it rather than clustered at one edge.
function multiTie(mask, reached, islandPixels, { count, maxGap, cx, cy }) {
  const { width: W, height: H, data } = mask;
  const N = W * H;
  const dist = new Int32Array(N).fill(-1);
  const origin = new Int32Array(N).fill(-1);
  const queue = [];
  for (const p of islandPixels) {
    const x = p % W, y = (p - x) / W;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const q = ny * W + nx;
      if (data[q] === 1 && dist[q] === -1) { dist[q] = 1; origin[q] = p; queue.push(q); }
    }
  }
  const sectors = new Map(); // sector index -> { dist, tie }
  const TWO_PI = Math.PI * 2;
  let head = 0;
  while (head < queue.length) {
    const p = queue[head++];
    if (dist[p] > maxGap) continue;
    const x = p % W, y = (p - x) / W;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const q = ny * W + nx;
      if (data[q] === 1) {
        if (dist[q] === -1) { dist[q] = dist[p] + 1; origin[q] = origin[p]; queue.push(q); }
      } else if (data[q] === 0 && reached[q]) {
        const isl = origin[p], ix = isl % W, iy = (isl - ix) / W;
        const ang = Math.atan2(iy - cy, ix - cx);
        const sec = Math.min(count - 1, Math.floor(((ang + Math.PI) / TWO_PI) * count));
        const cur = sectors.get(sec);
        if (!cur || dist[p] < cur.dist) sectors.set(sec, { dist: dist[p], tie: { x1: ix, y1: iy, x2: nx, y2: ny } });
      }
    }
  }
  const ties = [...sectors.values()].map(s => s.tie);
  if (!ties.length) { const t = shortestTie(mask, reached, islandPixels, maxGap); if (t) ties.push(t); }
  return ties;
}

// Smart island handling. Fill (spray solid) every island that is smaller than
// minIslandArea, plus any beyond the maxBridges cap, then auto-bridge only the
// kept (largest) islands. This stops detailed photos from spawning hundreds of
// ties. Returns the simplified mask + the bridges for the kept islands.
export function prepareIslands(mask, opts = {}) {
  const widthPx = opts.widthPx ?? 4;
  const minIslandArea = opts.minIslandArea ?? 0;
  const maxBridges = opts.maxBridges ?? 24;
  const brightMask = opts.brightMask || null;
  const keepHighlights = opts.keepHighlights && brightMask;
  const mmPerPx = opts.mmPerPx ?? null;
  const tieSpacingMm = opts.tieSpacingMm ?? 50;
  const maxTiesPerIsland = opts.maxTiesPerIsland ?? 8;
  const { labels, islands } = findIslands(mask);

  const ranked = islands.slice().sort((a, b) => b.size - a.size);
  const keep = new Set();
  for (const isl of ranked) {
    if (keep.size >= maxBridges) break;
    if (isl.size >= minIslandArea) keep.add(isl.label);
  }

  // Always keep bright islands (eye/nose/teeth highlights) so they survive,
  // regardless of the size threshold or the cap.
  if (keepHighlights) {
    const brightCount = new Map();
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i];
      if (l > 0 && brightMask[i]) brightCount.set(l, (brightCount.get(l) || 0) + 1);
    }
    // Keep only sizeable, mostly-bright islands, largest first, and CAP the
    // total — otherwise a noisy or near-solid layer spawns thousands of ties
    // and hangs the app.
    const minBright = Math.max(16, minIslandArea * 0.15);
    const cap = maxBridges + 12;
    const bright = islands
      .filter(isl => isl.size >= minBright && (brightCount.get(isl.label) || 0) >= isl.size * 0.5)
      .sort((a, b) => b.size - a.size);
    for (const isl of bright) { if (keep.size >= cap) break; keep.add(isl.label); }
  }

  const out = cloneMask(mask);
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (l > 0 && !keep.has(l)) out.data[i] = 1; // fill: spray it solid
  }

  const bridges = keep.size ? autoBridges(out, { widthPx, mmPerPx, tieSpacingMm, maxTiesPerIsland }) : [];
  // Guarantee no floaters: if any kept island couldn't be tied (e.g. it's deeper
  // than maxGap from any material), fill it so nothing can fall out when cut.
  if (bridges.length) {
    const { labels: l2, islands: i2 } = findIslands(burnBridges(out, bridges));
    if (i2.length) {
      const floating = new Set(i2.map(isl => isl.label));
      for (let i = 0; i < l2.length; i++) { if (floating.has(l2[i])) out.data[i] = 1; }
    }
  }
  return { mask: out, bridges, kept: keep.size, filled: islands.length - keep.size };
}

// Burn bridges into a copy of the mask (set their footprint to MATERIAL).
export function burnBridges(mask, bridges) {
  const out = cloneMask(mask);
  for (const b of bridges) stampSegment(out, b.x1, b.y1, b.x2, b.y2, b.width);
  return out;
}

function stampSegment(mask, x1, y1, x2, y2, width) {
  const { width: W, height: H, data } = mask;
  const r = Math.max(0.5, width / 2);
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len * 2));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = x1 + dx * t, cy = y1 + dy * t;
    const minX = Math.max(0, Math.floor(cx - r)), maxX = Math.min(W - 1, Math.ceil(cx + r));
    const minY = Math.max(0, Math.floor(cy - r)), maxY = Math.min(H - 1, Math.ceil(cy + r));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const ddx = x - cx, ddy = y - cy;
        if (ddx * ddx + ddy * ddy <= r * r) data[y * W + x] = 0; // MATERIAL
      }
    }
  }
}
