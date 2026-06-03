// Illustrator-Image-Trace-style presets: each is a bundle of control-id → value
// applied on top of a clean baseline, so an upload starts from a tuned, near-
// finished stencil instead of a generic default. `pickPreset` chooses one from a
// quick analysis of the image so "Auto" mode just works.
//
// Values are control ids that exist in index.html (data-param). Look leans
// cleaner/bolder: stronger smoothing + higher minFeature → fewer tiny pieces.

// Auto-contrast (CLAHE) and Keep-highlights are OFF by default in every preset —
// the user opts into them per image. Keeping highlight-protection off also stops
// facial highlights from being preserved as little islands ("face holes").
export const PRESETS = {
  photo:    { label: 'Photo',            params: { contrast: 10, smooth: 3, detail: 2, layers: 6, minFeature: 9,  autoLevels: false, keepHighlights: false, edges: false, removeBg: false } },
  portrait: { label: 'Portrait',         params: { contrast: 12, smooth: 3, detail: 2, layers: 4, minFeature: 12, autoLevels: false, keepHighlights: false, edges: false, removeBg: true } },
  subject:  { label: 'Subject (isolate)', params: { contrast: 14, smooth: 3, detail: 2, layers: 6, minFeature: 8,  autoLevels: false, keepHighlights: false, edges: false, removeBg: true } },
  landscape:{ label: 'Landscape',        params: { contrast: 16, smooth: 2, detail: 2, layers: 6, minFeature: 8,  autoLevels: false, keepHighlights: false, edges: false, removeBg: false } },
  poster:   { label: 'Bold poster',      params: { contrast: 35, smooth: 3, detail: 1, layers: 2, minFeature: 14, autoLevels: false, keepHighlights: false, edges: false, removeBg: false } },
  lineart:  { label: 'Line art',         params: { contrast: 12, smooth: 1, detail: 2, layers: 1, minFeature: 6,  autoLevels: false, keepHighlights: false, edges: true,  edgeAmount: 55, removeBg: false } },
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

// Comprehensive colour analysis from a small RGBA probe. Pure, single pass;
// ignores transparent pixels. Returns the signals the classifier needs:
// skin (portrait), sky + foliage (landscape) and overall saturation.
export function analyzeColor(rgba, w, h) {
  const out = { skinFraction: 0, skyFraction: 0, greenFraction: 0, saturation: 0 };
  if (!rgba || !w || !h) return out;
  const sx0 = Math.floor(w * 0.20), sx1 = Math.ceil(w * 0.80);   // a face sits centre-upper
  const sy0 = Math.floor(h * 0.06), sy1 = Math.ceil(h * 0.80);
  const skyY1 = Math.ceil(h * 0.42);                             // sky is usually near the top
  let skin = 0, skinTot = 0, sky = 0, skyTot = 0, green = 0, satSum = 0, n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (rgba[i + 3] < 16) continue;                             // skip transparent (already isolated)
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      n++;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      satSum += mx ? (mx - mn) / mx : 0;
      if (g === mx && (g - r) > 8 && (g - b) > 8 && g > 50) green++;             // foliage / grass
      if (y < skyY1) { skyTot++; if (b === mx && b > 120 && (b - r) > 4) sky++; } // sky (bright blue, top)
      if (x >= sx0 && x < sx1 && y >= sy0 && y < sy1) {
        skinTot++;
        const Y = 0.299 * r + 0.587 * g + 0.114 * b;
        const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
        if (Y > 40 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) skin++;
      }
    }
  }
  out.skinFraction = skinTot ? skin / skinTot : 0;
  out.skyFraction = skyTot ? sky / skyTot : 0;
  out.greenFraction = n ? green / n : 0;
  out.saturation = n ? satSum / n : 0;
  return out;
}

// Map stats → preset id, in priority order. A face wins (portrait); then a flat
// high-contrast graphic (logo); then an outdoor scene with sky/foliage
// (landscape, kept whole); otherwise a photo with a subject to isolate (the
// coverage fallback in bg-removal protects subject-less photos). photo / poster /
// line-art remain manual choices.
export function pickPreset(stats) {
  const { std = 0, toneCount = 0, skinFraction: skin = 0, skyFraction: sky = 0, greenFraction: green = 0 } = stats;
  if (skin >= 0.10) return 'portrait';
  if (toneCount <= 6 && std > 55) return 'logo';
  if (sky >= 0.40 || green >= 0.32) return 'landscape';
  return 'subject';
}

// Combine on-device ML signals (face / scene / recognised-object) with the cheap
// tone stats into a preset. Pure + testable. ML wins where it's strong (a sizeable
// face → portrait; an outdoor scene → landscape); a flat high-contrast graphic →
// logo; a recognised object → isolate it; and with no ML it defers to the colour
// heuristic (pickPreset) so Auto still works offline.
export function presetFromSignals(sig = {}) {
  if (sig.faces > 0 && sig.faceArea >= 0.045) return 'portrait';
  if (sig.scene) return 'landscape';
  if ((sig.toneCount ?? 99) <= 6 && (sig.std ?? 0) > 55) return 'logo';
  if (sig.hasObject) return 'subject';
  return pickPreset(sig);
}
