// Off-main-thread pipeline. Receives raw RGBA (or a cached greyscale buffer) plus
// parameters, and returns the greyscale buffer, the chosen thresholds, each layer's
// base mask + bridges, AND the vectorised cut paths — moving the heaviest stages
// (bilateral/CLAHE tone-mapping + posterise + morphology + island bridging + the
// ImageTracer trace) off the UI thread so the initial build no longer janks.
//
// The interactive editor (drag/add/delete a tie) still reburns + retraces a single
// layer on the main thread. The main thread runs these very same pure functions as a
// fallback when a worker can't be created, so output is identical.

import '../vendor/imagetracer.js';     // side-effect: its UMD assigns self.ImageTracer (used by trace.js)
import { grayFromRGBA, isFlatGray } from './grayfilters.js';
import { autoThresholds } from './posterize.js';
import { buildMasks } from './buildmasks.js';
import { traceBuilt } from './tracelayers.js';

self.onmessage = (e) => {
  const msg = e.data || {};
  const id = msg.id;
  try {
    const { w, h, rgba, grayData, gopts, layersCount, thresholds, maskOpts, traceOpts, edgeOpts } = msg;
    // Either tone-map fresh from RGBA, or reuse a greyscale buffer the main thread
    // already has (mask-only rebuilds, e.g. moving a threshold — no re-gray needed).
    const gray = grayData ? { width: w, height: h, data: grayData } : grayFromRGBA(rgba, w, h, gopts);
    const th = (thresholds && thresholds.length) ? thresholds : autoThresholds(gray, layersCount);
    const grayFlat = isFlatGray(gray);
    const built = buildMasks(gray, th, maskOpts);
    const { layers, edge } = traceBuilt(built.layers, built.edge, traceOpts, edgeOpts);  // + vectorise

    // Transfer the mask buffers back zero-copy (the worker is done with them); the
    // traced path strings ride along as a structured clone.
    const transfer = [];
    const outLayers = layers.map(L => {
      transfer.push(L.baseMask.data.buffer);
      return { threshold: L.threshold, bridges: L.bridges, baseMask: L.baseMask, traced: L.traced };
    });
    let outEdge = null;
    if (edge) { transfer.push(edge.baseMask.data.buffer); outEdge = { baseMask: edge.baseMask, traced: edge.traced }; }

    const out = { id, ok: true, grayFlat, thresholds: th, layers: outLayers, edge: outEdge };
    if (!grayData) { out.gray = gray; transfer.push(gray.data.buffer); } // return the fresh gray only when we computed it
    self.postMessage(out, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err && err.message) || String(err) });
  }
};
