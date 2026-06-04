// Off-main-thread pipeline. Receives raw RGBA (or a cached greyscale buffer) plus
// parameters, and returns the greyscale buffer, the chosen thresholds, and each
// layer's base mask + bridges (and an optional edge layer). This removes the heavy,
// unchunked CPU work (bilateral/CLAHE tone-mapping + posterise + morphology + island
// bridging) from the UI thread so dragging stays smooth.
//
// The vectoriser (ImageTracer) and the interactive editor stay on the main thread,
// which reburns + retraces each returned mask. The main thread runs these very same
// pure functions as a fallback when a worker can't be created, so output is identical.

import { grayFromRGBA, isFlatGray } from './grayfilters.js';
import { autoThresholds } from './posterize.js';
import { buildMasks } from './buildmasks.js';

self.onmessage = (e) => {
  const msg = e.data || {};
  const id = msg.id;
  try {
    const { w, h, rgba, grayData, gopts, layersCount, thresholds, maskOpts } = msg;
    // Either tone-map fresh from RGBA, or reuse a greyscale buffer the main thread
    // already has (mask-only rebuilds, e.g. moving a threshold — no re-gray needed).
    const gray = grayData ? { width: w, height: h, data: grayData } : grayFromRGBA(rgba, w, h, gopts);
    const th = (thresholds && thresholds.length) ? thresholds : autoThresholds(gray, layersCount);
    const grayFlat = isFlatGray(gray);
    const { layers, edge } = buildMasks(gray, th, maskOpts);

    // Transfer the result buffers back zero-copy (the worker is done with them).
    const transfer = [];
    const outLayers = layers.map(L => {
      transfer.push(L.baseMask.data.buffer);
      return { threshold: L.threshold, bridges: L.bridges, baseMask: L.baseMask };
    });
    let outEdge = null;
    if (edge) { transfer.push(edge.baseMask.data.buffer); outEdge = { baseMask: edge.baseMask }; }

    const out = { id, ok: true, grayFlat, thresholds: th, layers: outLayers, edge: outEdge };
    if (!grayData) { out.gray = gray; transfer.push(gray.data.buffer); } // return the fresh gray only when we computed it
    self.postMessage(out, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err && err.message) || String(err) });
  }
};
