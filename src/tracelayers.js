// Burn bridges into each built layer's mask and vectorise it. Shared by the pipeline
// worker AND the main-thread fallback, so both emit byte-identical cut paths (same
// burnBridges + same ImageTracer trace). This is what moves the heaviest stage — the
// per-layer vector trace — off the UI thread on the initial build. (Interactive bridge
// edits still retrace a single layer on the main thread via the same trace.js.)
//
// trace.js uses a global `ImageTracer`: on the main thread it's the <script> in
// index.html; in the worker it's defined by a side-effect `import` of the same vendor
// file (its UMD assigns `self.ImageTracer`, and `self` exists in both contexts).

import { burnBridges } from './bridges.js';
import { traceMaskToPaths } from './trace.js';

export function traceBuilt(built, edge, traceOpts, edgeOpts) {
  const layers = built.map(L => {
    // Same workMask the main-thread editor derives from baseMask + bridges, so the
    // traced result matches what reburn() will reconstruct for interactive editing.
    const workMask = (L.bridges && L.bridges.length) ? burnBridges(L.baseMask, L.bridges) : L.baseMask;
    return { threshold: L.threshold, baseMask: L.baseMask, bridges: L.bridges || [], traced: traceMaskToPaths(workMask, traceOpts) };
  });
  const tracedEdge = edge ? { baseMask: edge.baseMask, traced: traceMaskToPaths(edge.baseMask, edgeOpts) } : null;
  return { layers, edge: tracedEdge };
}
