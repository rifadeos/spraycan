// Optional background removal. Lazy-loads an in-browser ML model from a CDN the
// first time it's used — so the core tool stays offline/free/private unless the
// user opts in. The cutout is composited on white so the removed area reads as
// "unsprayed" (bare wall/paper) in the stencil.

let removeBgFn = null;

async function loadLib() {
  if (removeBgFn) return removeBgFn;
  const mod = await import('https://esm.sh/@imgly/background-removal@1.5.8');
  removeBgFn = mod.removeBackground || (mod.default && mod.default.removeBackground);
  if (typeof removeBgFn !== 'function') throw new Error('background-removal unavailable');
  return removeBgFn;
}

// Cap the model input: big phone photos (4000px+) process far faster downscaled,
// and posterised stencil shapes don't need more resolution than this.
const MAX_BG_EDGE = 1280;

function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b)
      : reject(new Error('Could not read the image (the canvas may be blocked by the browser).')), type);
  });
}

function toCanvas(img, maxEdge = 0) {
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (maxEdge > 0) {
    const long = Math.max(w, h);
    if (long > maxEdge) { const s = maxEdge / long; w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s)); }
  }
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c;
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image decode failed')); };
    img.src = url;
  });
}

// Returns { image, coverage }: the subject composited on white, plus the fraction
// of the frame the subject occupies (from the cutout's alpha). `coverage` lets the
// caller skip isolation when there's no clear subject (≈0) or it kept everything (≈1).
export async function removeBackgroundToImage(srcImg, onProgress) {
  const fn = await loadLib();
  const srcCanvas = toCanvas(srcImg, MAX_BG_EDGE);
  const srcBlob = await canvasToBlob(srcCanvas);
  const cutoutBlob = await fn(srcBlob, onProgress ? { progress: onProgress } : undefined);
  const cutout = await blobToImage(cutoutBlob);

  const w = srcCanvas.width, h = srcCanvas.height;
  // Measure subject coverage from the cutout's alpha (subsampled for speed).
  let kept = 0, total = 0;
  try {
    const mc = document.createElement('canvas'); mc.width = w; mc.height = h;
    const mctx = mc.getContext('2d', { willReadFrequently: true });
    mctx.drawImage(cutout, 0, 0, w, h);
    const a = mctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < a.length; i += 16) { total++; if (a[i] > 24) kept++; } // every 4th px (RGBA stride 16)
  } catch { /* coverage best-effort */ }
  const coverage = total ? kept / total : 1;

  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(cutout, 0, 0, w, h);
  const image = await blobToImage(await canvasToBlob(c));
  return { image, coverage };
}
