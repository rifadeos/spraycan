// "Pick a look" strip — a row of thumbnails, one per preset, each a quick low-res
// preview of how that look posterises the *current* image. Clicking one switches the
// preset. The previews reuse the real tone pipeline (grayscale → optional CLAHE →
// multi-Otsu posterise, or a Sobel edge map for line art) at thumbnail resolution, so
// what you see closely matches what you'll get — but cheaply, and painted one-per-frame
// so building the strip never janks the UI.

import { grayFromRGBA } from '../grayfilters.js';
import { autoThresholds } from '../posterize.js';
import { edgeMask } from '../edges.js';
import { fitSize } from '../image.js';

const THUMB = 132;        // preview long-edge in px (CSS scales it into the strip box)

// Draw the source image to a small canvas once; every per-preset preview reads this RGBA.
function sourceRGBA(img, max) {
  const { w, h } = fitSize(img.naturalWidth || img.width, img.naturalHeight || img.height, max);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h).data, w, h };
}

// Render one preset's look → grayscale stencil preview onto `canvas`.
function paint(canvas, src, params) {
  const gray = grayFromRGBA(src.data, src.w, src.h, {
    contrast: params.contrast || 0,
    smooth: params.smooth || 0,
    autoLevels: !!params.autoLevels,
    invert: !!params.invert,
  });
  const w = gray.width, h = gray.height, gd = gray.data;
  const out = new Uint8ClampedArray(w * h * 4);
  if (params.edges) {                                   // line art → dark Sobel outlines on paper
    const e = edgeMask(gray, { amount: params.edgeAmount ?? 55 });
    for (let i = 0, p = 0; i < gd.length; i++, p += 4) {
      const v = e.data[i] ? 38 : 236;
      out[p] = out[p + 1] = out[p + 2] = v; out[p + 3] = 255;
    }
  } else {                                              // tonal → posterise into light→dark bands
    const th = autoThresholds(gray, Math.max(1, params.layers || 1));
    const K = th.length || 1;
    for (let i = 0, p = 0; i < gd.length; i++, p += 4) {
      const v = gd[i];
      let tone = 0;                                      // how many spray layers cover this pixel
      for (let j = 0; j < th.length; j++) if (th[j] > v) tone++;
      const g = Math.round(255 * (1 - tone / K));        // 0 layers → paper-white, K → black
      out[p] = out[p + 1] = out[p + 2] = g; out[p + 3] = 255;
    }
  }
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);
}

const shortLabel = s => s.replace(/\s*\(.*\)\s*/, '').trim();

// Build the strip once. `presets` is [{ id, label, params }]; onPick(id) fires on click.
// Returns { render(img), setActive(id), show(on) }.
export function initLooks(container, { presets, onPick }) {
  container.textContent = '';
  const cap = document.createElement('span');
  cap.className = 'looks-label'; cap.textContent = 'Pick a look';
  container.appendChild(cap);

  const items = presets.map(p => {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'look'; btn.dataset.id = p.id; btn.title = p.label;
    btn.setAttribute('aria-label', 'Use the ' + shortLabel(p.label) + ' look');
    const cv = document.createElement('canvas'); cv.className = 'look-thumb'; cv.setAttribute('aria-hidden', 'true');
    const lab = document.createElement('span'); lab.className = 'look-label'; lab.textContent = shortLabel(p.label);
    btn.append(cv, lab);
    btn.addEventListener('click', () => onPick(p.id));
    container.appendChild(btn);
    return { id: p.id, el: btn, canvas: cv, params: p.params };
  });

  let token = 0;
  function render(img) {
    const my = ++token;
    let src;
    try { src = sourceRGBA(img, THUMB); } catch { return; }
    let i = 0;
    const step = () => {
      if (my !== token || i >= items.length) return;     // superseded by a newer image, or done
      try { paint(items[i].canvas, src, items[i].params); } catch {}
      i++;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function setActive(id) { items.forEach(it => it.el.classList.toggle('active', it.id === id)); }
  function show(on) { container.hidden = !on; }
  return { render, setActive, show };
}
