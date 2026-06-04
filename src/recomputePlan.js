// Pure decision table: given a changed control id (+ whether a low-res drag preview
// left the working gray downscaled), what does the app need to recompute? Extracted
// from onChange so the most logic-dense, most-edited branch is unit-testable in
// isolation (no DOM / no pipeline). app.js maps each `action` to the real call.
//
//   action:
//     'pipeline'   → runPipeline({ regray, recomputeThresholds })
//     'retrace'    → retraceAll() (line-detail only changes the vectoriser)
//     'material'   → set bridge width from the material, then runPipeline({ regray })
//     'bridgeWidth'→ update editor default width, then runPipeline({ regray })
//     'preset'     → re-pick + applyPreset
//     'removeBg'   → toggleBackground
//     'dims'       → updateDims + updateCombined (no re-pipeline; size only)
//     'none'       → ignore
export function recomputePlan(id, stale) {
  switch (id) {
    // Tone-mapping inputs → re-gray + rebuild masks.
    case 'brightness': case 'contrast': case 'invert': case 'maxResolution':
    case 'smooth': case 'autoLevels': case 'mirror': case 'vflip':
      return { action: 'pipeline', regray: true, recomputeThresholds: false };
    // New layer count → re-derive tones at full resolution + redraw the sliders.
    case 'layers':
      return { action: 'pipeline', regray: true, recomputeThresholds: true };
    // Mask-only inputs (don't change the greyscale): reuse the cached gray unless a
    // low-res preview left it downscaled (then re-gray to full res).
    case 'minFeature': case 'bridgeMode': case 'keepHighlights': case 'edges': case 'edgeAmount':
      return { action: 'pipeline', regray: !!stale, recomputeThresholds: false };
    case 'detail':
      return stale ? { action: 'pipeline', regray: true, recomputeThresholds: false } : { action: 'retrace' };
    case 'material':
      return { action: 'material', regray: !!stale, recomputeThresholds: false };
    case 'bridgeWidth':
      return { action: 'bridgeWidth', regray: !!stale, recomputeThresholds: false };
    case 'preset':   return { action: 'preset' };
    case 'removeBg': return { action: 'removeBg' };
    case 'targetWidth': case 'unit': return { action: 'dims' };
    default: return { action: 'none' };
  }
}
