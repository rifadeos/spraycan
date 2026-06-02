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

function toCanvas(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
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

// Returns a new image of the subject on a white background.
export async function removeBackgroundToImage(srcImg, onProgress) {
  const fn = await loadLib();
  const srcCanvas = toCanvas(srcImg);
  const srcBlob = await new Promise(r => srcCanvas.toBlob(r, 'image/png'));
  const cutoutBlob = await fn(srcBlob, onProgress ? { progress: onProgress } : undefined);
  const cutout = await blobToImage(cutoutBlob);

  const w = srcCanvas.width, h = srcCanvas.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(cutout, 0, 0, w, h);
  return blobToImage(await new Promise(r => c.toBlob(r, 'image/png')));
}
