// Illustrator-Image-Trace-style presets: each is a bundle of control-id → value
// applied on top of a clean baseline, so an upload starts from a tuned, near-
// finished stencil instead of a generic default. `pickPreset` chooses one from a
// quick analysis of the image so "Auto" mode just works.
//
// Values are control ids that exist in index.html (data-param). Look leans
// cleaner/bolder: stronger smoothing + higher minFeature → fewer tiny pieces.

export const PRESETS = {
  photo:    { label: 'Photo',            params: { contrast: 10, smooth: 3, detail: 2, layers: 6, minFeature: 9,  autoLevels: true,  keepHighlights: true,  edges: false, removeBg: false } },
  portrait: { label: 'Portrait',         params: { contrast: 14, smooth: 3, detail: 2, layers: 6, minFeature: 8,  autoLevels: true,  keepHighlights: true,  edges: false, removeBg: false } },
  subject:  { label: 'Subject (isolate)', params: { contrast: 14, smooth: 3, detail: 2, layers: 6, minFeature: 8,  autoLevels: true,  keepHighlights: true,  edges: false, removeBg: true } },
  poster:   { label: 'Bold poster',      params: { contrast: 35, smooth: 3, detail: 1, layers: 2, minFeature: 14, autoLevels: true,  keepHighlights: false, edges: false, removeBg: false } },
  lineart:  { label: 'Line art',         params: { contrast: 12, smooth: 1, detail: 2, layers: 1, minFeature: 6,  autoLevels: true,  keepHighlights: false, edges: true,  edgeAmount: 55, removeBg: false } },
  logo:     { label: 'Logo (B&W)',       params: { contrast: 45, smooth: 3, detail: 1, layers: 1, minFeature: 16, autoLevels: false, keepHighlights: false, edges: false, removeBg: false } },
};

// Quick descriptive stats from a (small, neutral) grayscale buffer.
export function imageStats(gray, aspect = 1) {
  const d = gray.data, n = d.length || 1;
  const hist = new Int32Array(256);
  let sum = 0;
  for (let i = 0; i < n; i++) { hist[d[i]]++; sum += d[i]; }
  const mean = sum / n;
  let varAcc = 0;
  for (let i = 0; i < n; i++) { const t = d[i] - mean; varAcc += t * t; }
  const std = Math.sqrt(varAcc / n);
  let toneCount = 0; const thr = n * 0.004;          // bins holding >0.4% of pixels
  for (let i = 0; i < 256; i++) if (hist[i] > thr) toneCount++;
  // edge density on a subsampled grid (|Δx|+|Δy| over a threshold)
  const W = gray.width, H = gray.height; let edges = 0, samples = 0;
  for (let y = 1; y < H - 1; y += 2) for (let x = 1; x < W - 1; x += 2) {
    const i = y * W + x;
    if (Math.abs(d[i + 1] - d[i - 1]) + Math.abs(d[i + W] - d[i - W]) > 48) edges++;
    samples++;
  }
  return { mean, std, toneCount, edgeDensity: samples ? edges / samples : 0, aspect };
}

// Map stats → preset id. A flat graphic stays whole; any photo tries isolating
// its subject (the bg-removal step has a coverage fallback, so a subject-less
// scene safely reverts to the full image).
export function pickPreset(stats) {
  const { std, toneCount } = stats;
  if (toneCount <= 6 && std > 55) return 'logo';   // few flat tones + high contrast → graphic/logo (keep whole)
  return 'subject';                                 // it's a photo → isolate the subject (auto, with fallback)
}
