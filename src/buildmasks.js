// Pure per-layer mask construction, shared by the main thread and the pipeline
// Web Worker. Takes a greyscale buffer + thresholds and produces each layer's base
// mask + auto-placed bridges (ties), plus an optional edge/line layer. No DOM and
// no vectoriser — ImageTracer is a UMD global and stays on the main thread, which
// also keeps the interactive bridge editor (reburn/retrace) on the main thread.
//
// This is the exact logic recomputeAll() used to run inline; extracting it lets the
// worker and the main-thread fallback share one implementation, so they can never
// drift apart.

import { buildLayers } from './posterize.js';
import { despeckle, frameBorder, removeSmallComponents, dilate, morphClose } from './morphology.js';
import { prepareIslands } from './bridges.js';
import { edgeMask } from './edges.js';

// Pixels at/above `thresh` are protected from being sprayed (kept as bare wall),
// so highlights survive posterising. (The threshold is the same for portraits —
// faces are protected instead via a larger island-fill span; see `portrait` below.)
export function buildBrightMask(gray, thresh = 210) {
  const b = new Uint8Array(gray.data.length);
  for (let i = 0; i < b.length; i++) b[i] = gray.data[i] >= thresh ? 1 : 0;
  return b;
}

// Returns { layers: [{ threshold, baseMask, bridges }], edge: { baseMask } | null }.
// baseMask is a { width, height, data:Uint8Array } mask object.
export function buildMasks(gray, thresholds, opts = {}) {
  const {
    minFeature = 2, bridgeMode = 'auto', keepHighlights = false,
    edges = false, edgeAmount = 50, portrait = false,
    bridgeWidthPx = 4, mmPerPx = 1, tieSpacingMm = 65,
  } = opts;

  const minArea = minFeature * minFeature;                 // despeckle: drop tiny specks
  // Fill islands smaller than this instead of bridging. Portraits fill much larger
  // ones so facial highlights merge into the face (far fewer "holes" + ties).
  const islandSpan = portrait ? 7 : 4;
  const minIslandArea = Math.max(64, (minFeature * islandSpan) ** 2);
  const maxBridges = bridgeMode === 'none' ? 0 : 16;       // None = fill every island (no ties)
  const brightMask = keepHighlights ? buildBrightMask(gray) : null;
  // Thin material holding frame — keeps the sheet connected at the edges so islands
  // can always be bridged, and matches a real stencil's border.
  const border = Math.max(2, Math.round(Math.min(gray.width, gray.height) * 0.01));

  const built = buildLayers(gray, thresholds);
  const layers = built.map(b => {
    const cleaned = minArea > 1 ? despeckle(b.mask, minArea) : b.mask;
    const framed = frameBorder(cleaned, border);
    // Smart bridging: fill tiny islands, tie only the meaningful (capped) ones.
    const { mask: baseMask, bridges } = prepareIslands(framed, {
      widthPx: bridgeWidthPx, minIslandArea, maxBridges, brightMask,
      keepHighlights, mmPerPx, tieSpacingMm,
    });
    return { threshold: b.threshold, baseMask, bridges };
  });

  // Optional edge/line-detail layer: outlines + texture as the top (sprayed-last) layer.
  let edge = null;
  if (edges) {
    const px = gray.width * gray.height;
    const edgeMin = Math.max(40, Math.round(px * 0.00012)); // resolution-scaled floor
    let em = edgeMask(gray, { amount: edgeAmount, dilate: 0 });
    em = removeSmallComponents(em, 1, edgeMin); // keep only sizeable contours, drop dots
    em = dilate(em, 1);                          // restore a cuttable stroke width
    em = morphClose(em, 1);                      // bridge small gaps in the outlines
    em = despeckle(em, edgeMin);                 // final tidy (open specks + material slivers)
    edge = { baseMask: frameBorder(em, border) };
  }

  return { layers, edge };
}
