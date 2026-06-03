// Illustrator-Image-Trace-style presets: each is a bundle of control-id → value
// applied on top of a clean baseline, so an upload starts from a tuned, near-
// finished stencil instead of a generic default. `pickPreset` chooses one from a
// quick analysis of the image so "Auto" mode just works.
//
// Values are control ids that exist in index.html (data-param). Look leans
// cleaner/bolder: stronger smoothing + higher minFeature → fewer tiny pieces.

export const PRESETS = {
  photo:    { label: 'Photo',            params: { contrast: 10, smooth: 3, detail: 2, layers: 6, minFeature: 9,  autoLevels: true,  keepHighlights: true,  edges: false, removeBg: false } },
  portrait: { label: 'Portrait',         params: { contrast: 12, smooth: 3, detail: 2, layers: 4, minFeature: 11, autoLevels: true,  keepHighlights: true,  edges: false, removeBg: true } },
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

// Fraction of likely skin-tone pixels in the central/upper region of an RGBA
// buffer (where a face usually sits). Uses the YCbCr skin-cluster test, which is
// far more robust across skin tones and lighting than a raw-RGB rule (it caught
// well-lit pale faces but missed bearded / shadowed / cooler ones). A brightness
// floor skips near-black hair/shadow. Used to detect portraits so they get fewer
// layers + protected facial mid-tones instead of fragmenting into "face holes".
export function skinFraction(rgba, w, h) {
  if (!rgba || !w || !h) return 0;
  const x0 = Math.floor(w * 0.20), x1 = Math.ceil(w * 0.80);
  const y0 = Math.floor(h * 0.06), y1 = Math.ceil(h * 0.80);
  let skin = 0, total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      if (rgba[i + 3] < 16) continue;           // skip transparent (already-isolated) pixels
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      total++;
      const Y = 0.299 * r + 0.587 * g + 0.114 * b;
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      if (Y > 40 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) skin++;
    }
  }
  return total ? skin / total : 0;
}

// Map stats → preset id. A face → portrait (few layers, protected mid-tones); a
// flat graphic stays whole; any other photo isolates its subject (the bg-removal
// step has a coverage fallback, so a subject-less scene reverts to the full image).
export function pickPreset(stats) {
  const { std, toneCount, skinFraction: skin = 0 } = stats;
  if (skin >= 0.12) return 'portrait';             // a face is present → fewer layers, keep skin continuous
  if (toneCount <= 6 && std > 55) return 'logo';   // few flat tones + high contrast → graphic/logo (keep whole)
  return 'subject';                                 // it's a photo → isolate the subject (auto, with fallback)
}
