// Tiled PDF export. Uses jsPDF + svg2pdf (loaded as globals). Each tile is a
// cropped SVG (its viewBox selects the region) rendered as vectors onto one
// page, with crop marks. Page 1 is a "cut & spray kit": stacked preview, spray
// order, assembly grid, technique checklist, and a print-at-100% scale ruler.

import { markToSVG } from '../registration.js';
import { toRgb } from '../color.js';
import { combinedSVG } from './svg.js';

// All sizes stored as [width, height] in millimetres.
const PAGES = {
  // ISO A-series
  a6: [105, 148], a5: [148, 210], a4: [210, 297], a3: [297, 420],
  a2: [420, 594], a1: [594, 841], a0: [841, 1189],
  // US
  letter: [215.9, 279.4], legal: [215.9, 355.6], tabloid: [279.4, 431.8],
  arch_a: [228.6, 304.8], arch_b: [304.8, 457.2], arch_c: [457.2, 609.6],
  arch_d: [609.6, 914.4], arch_e: [914.4, 1219.2],
  // Cutting-machine usable beds/mats
  cricut_12x12: [292, 292], cricut_12x24: [292, 597], cameo_12x24: [301, 607],
  glowforge_aura: [279, 495], glowforge_pro: [495, 279], xtool_p2: [600, 308],
};

const PAGE_LABELS = {
  a6: 'A6', a5: 'A5', a4: 'A4', a3: 'A3', a2: 'A2', a1: 'A1', a0: 'A0',
  letter: 'Letter', legal: 'Legal', tabloid: 'Tabloid',
  arch_a: 'Arch A', arch_b: 'Arch B', arch_c: 'Arch C', arch_d: 'Arch D', arch_e: 'Arch E',
  cricut_12x12: 'Cricut 12×12', cricut_12x24: 'Cricut 12×24', cameo_12x24: 'Cameo 12×24',
  glowforge_aura: 'Glowforge Aura', glowforge_pro: 'Glowforge Pro', xtool_p2: 'xTool P2',
};

export const PAGE_OPTIONS = PAGES; // exported for tests / UI

// Largest custom page we'll emit at true 1:1 size (A0). Bigger designs fall
// back to the selected page, scaled to fit (with a ruler + true-size label).
export const MAX_PAGE_MM = [841, 1189];

// Pure: pick the per-layer page for "sheet" mode. `extraV` = vertical chrome
// (label band + ruler band) added on top of the artwork. Returns the page size
// and a `fit` scale (1 = true 1:1 custom page; <1 = scaled into the fallback).
export function sheetPageSize(designW, designH, margin, extraV, fallback, max = MAX_PAGE_MM) {
  const padW = designW + 2 * margin;
  const padH = designH + 2 * margin + extraV;
  const [maxShort, maxLong] = max;
  const fitsCustom = Math.min(padW, padH) <= maxShort && Math.max(padW, padH) <= maxLong;
  if (fitsCustom) return { pageW: padW, pageH: padH, fit: 1 };
  const [fW, fH] = fallback;
  const fit = Math.min((fW - 2 * margin) / designW, (fH - 2 * margin - extraV) / designH);
  return { pageW: fW, pageH: fH, fit };
}

function parseSVG(str) {
  return new DOMParser().parseFromString(str.replace(/^<\?xml[^>]*\?>\s*/, ''), 'image/svg+xml').documentElement;
}

// Cropped SVG element for one tile (viewBox in working px; svg2pdf sizes it in mm).
function tileSVGElement(traced, fill, marks, vb) {
  const paths = traced.paths.map(d => `<path d="${d}"/>`).join('');
  const sw = Math.max(0.4, Math.min(traced.width, traced.height) * 0.002);
  const reg = (marks && marks.length)
    ? `<g fill="none" stroke="#ff0000" stroke-width="${sw}">${marks.map(m => markToSVG(m)).join('')}</g>` : '';
  return parseSVG(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}">` +
    `<g fill="${fill}" fill-rule="evenodd">${paths}</g>${reg}</svg>`
  );
}

// svg2pdf's global shape varies by build; resolve robustly. Attach offscreen so
// getComputedStyle works, then render.
async function renderSVG(pdf, el, box) {
  document.body.appendChild(el);
  el.style.position = 'absolute'; el.style.left = '-99999px'; el.style.width = '10px';
  try {
    if (typeof pdf.svg === 'function') return await pdf.svg(el, box);
    const fn = (window.svg2pdf && (window.svg2pdf.svg2pdf || (typeof window.svg2pdf === 'function' ? window.svg2pdf : null)));
    if (!fn) throw new Error('svg2pdf unavailable');
    return await fn(el, pdf, box);
  } finally {
    el.remove();
  }
}

function cropMarks(pdf, x, y, w, h) {
  const L = 4;
  pdf.setDrawColor(150); pdf.setLineWidth(0.2);
  for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
    pdf.line(cx, cy, cx + L * sx, cy);
    pdf.line(cx, cy, cx, cy + L * sy);
  }
}

// A measurable ruler so the user can confirm the print came out at 100%.
function scaleBar(pdf, x, y, mm) {
  pdf.setDrawColor(40); pdf.setLineWidth(0.4);
  pdf.line(x, y, x + mm, y);
  pdf.line(x, y - 1.6, x, y + 1.6); pdf.line(x + mm, y - 1.6, x + mm, y + 1.6);
  for (let t = 10; t < mm; t += 10) pdf.line(x + t, y - 1, x + t, y + 1);
  pdf.setFontSize(7.5); pdf.setTextColor(40);
  pdf.text(`Print at 100% — this bar must measure ${mm} mm (${mm / 10} cm).`, x, y + 5);
}

async function coverPage(pdf, info) {
  const { margin, designW, designH, layers, colors, colorLabels, pageLabel, marks } = info;
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const lineW = pageW - 2 * margin;
  let y = margin + 4;

  pdf.setTextColor(20); pdf.setFontSize(18); pdf.text('SprayCan — cut & spray kit', margin, y); y += 8;
  pdf.setFontSize(10); pdf.setTextColor(90);
  pdf.text(`True size ${Math.round(designW)} × ${Math.round(designH)} mm · ${layers.length} layer(s) · one page per layer · cover: ${pageLabel}`, margin, y);
  y += 9;

  // Stacked-result preview (top-right)
  const pw = Math.min(64, lineW * 0.4);
  const ph = pw * designH / designW;
  const px = pageW - margin - pw;
  const listRight = px - 6;
  try {
    const svg = combinedSVG(layers.map(l => l.traced), { widthMm: designW, heightMm: designH }, { colors, marks: marks || [] });
    pdf.setFillColor(244, 244, 244); pdf.rect(px, y, pw, ph, 'F');
    await renderSVG(pdf, parseSVG(svg), { x: px, y, width: pw, height: ph });
    pdf.setFontSize(7.5); pdf.setTextColor(120); pdf.text('Final result (layers stacked)', px, y - 1.5);
  } catch { /* preview is non-essential */ }

  // Spray order (left)
  pdf.setTextColor(20); pdf.setFontSize(12); pdf.text('Spray order (light → dark)', margin, y); y += 6;
  pdf.setFontSize(9.5);
  layers.forEach((L, i) => {
    const [r, g, b] = toRgb(colors[i] || '#111111');
    pdf.setDrawColor(150); pdf.setFillColor(r, g, b); pdf.rect(margin, y - 3.4, 5.5, 4.6, 'FD');
    pdf.setTextColor(60);
    const label = (colorLabels && colorLabels[i]) || colors[i] || '#111111';
    const detail = L.isEdge ? 'outlines' : `${L.bridges.length} tie(s)`;
    const lines = pdf.splitTextToSize(`${i + 1}. ${label} — ${detail}`, listRight - margin - 8);
    pdf.text(lines, margin + 8, y);
    y += 5.4 * lines.length + 0.6;
  });
  y = Math.max(y, margin + 21 + ph) + 6;

  if (y > pageH - 72) { pdf.addPage(); y = margin + 4; }
  pdf.setTextColor(20); pdf.setFontSize(12); pdf.text('Cut & spray', margin, y); y += 6;
  pdf.setFontSize(9.5); pdf.setTextColor(70);
  const steps = [
    'Each following page is ONE layer at its true size — cut these, or send the SVG cut files to your shop.',
    'On each sheet, cut away the coloured (sprayed) areas; KEEP everything else and the small bridges/ties.',
    'Tape the stencil flat to the surface and press the edges so paint cannot creep underneath.',
    'Spray light, even coats from ~15 cm, held at 90°; let each layer dry before the next.',
    'Line the layers up with the red registration marks; spray the lightest layer first, darkest last.',
    'To erase tie marks: use the Touch-up map (next page) — dab each spot with that layer’s colour after peeling.',
  ];
  steps.forEach((s, i) => { const lines = pdf.splitTextToSize(`${i + 1}. ${s}`, lineW); pdf.text(lines, margin, y); y += 4.7 * lines.length; });
  y += 5;
  scaleBar(pdf, margin, y + 2, 100);
}

// "Touch-up map": the stacked preview with every tie marked, so the user can dab
// each spot with that layer's colour after peeling the stencil and erase the
// thin un-sprayed line a bridge leaves behind.
async function touchUpPage(pdf, layers, colors, dims, margin) {
  const tonal = layers.filter(l => l.traced && !l.isEdge);
  const ties = tonal.reduce((n, l) => n + l.bridges.length, 0);
  if (!ties || !tonal.length) return;
  const designW = dims.widthMm, designH = dims.heightMm;
  pdf.addPage();
  const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight();
  let y = margin + 4;
  pdf.setTextColor(20); pdf.setFontSize(15); pdf.text('Touch-up map', margin, y); y += 6;
  pdf.setFontSize(9); pdf.setTextColor(80);
  const note = 'A bridge (tie) leaves a thin un-sprayed gap. After spraying and peeling the stencil, dab each marked spot with that layer’s colour to erase it. Darker layers’ ties are largely hidden by the colour underneath — the lightest layer’s are the ones that show.';
  const nlines = pdf.splitTextToSize(note, pageW - 2 * margin);
  pdf.text(nlines, margin, y); y += 4.6 * nlines.length + 4;
  const availW = pageW - 2 * margin, availH = pageH - margin - y;
  const fit = Math.min(availW / designW, availH / designH);
  const boxW = designW * fit, boxH = designH * fit, bx = (pageW - boxW) / 2, by = y;
  try {
    const svg = combinedSVG(tonal.map(l => l.traced), { widthMm: designW, heightMm: designH }, { colors });
    pdf.setFillColor(244, 244, 244); pdf.rect(bx, by, boxW, boxH, 'F');
    await renderSVG(pdf, parseSVG(svg), { x: bx, y: by, width: boxW, height: boxH });
  } catch { /* preview is non-essential */ }
  const tw = tonal[0].traced.width, th = tonal[0].traced.height;
  pdf.setDrawColor(255, 0, 160); pdf.setLineWidth(0.5);
  for (const L of tonal) for (const b of L.bridges) {
    const mx = bx + (((b.x1 + b.x2) / 2) / tw) * boxW;
    const my = by + (((b.y1 + b.y2) / 2) / th) * boxH;
    pdf.circle(mx, my, 1.6, 'S');
  }
}

// A proof cover, then ONE page per layer. Each layer page is sized
// to the design's true mm (prints 1:1) when it fits within A0; oversized designs
// are scaled onto the selected page with a ruler + true-size label. This is the
// format to hand a print/cut shop.
export async function exportSheetPDF(layers, colors, dims, opts = {}) {
  if (!window.jspdf) throw new Error('jsPDF not loaded');
  const { jsPDF } = window.jspdf;
  const pageKey = PAGES[opts.pageSize] ? opts.pageSize : 'a4';
  const [coverW, coverH] = PAGES[pageKey];
  const margin = Math.max(3, opts.margin ?? 10);
  const designW = dims.widthMm, designH = dims.heightMm;
  const colorLabels = opts.colorLabels || [];
  const marks = opts.marks || [];
  const titleBand = 10, footBand = 14, extraV = titleBand + footBand;

  const pdf = new jsPDF({ unit: 'mm', format: [coverW, coverH], orientation: coverW > coverH ? 'landscape' : 'portrait' });
  await coverPage(pdf, {
    margin, designW, designH, layers, colors, colorLabels,
    pageLabel: PAGE_LABELS[pageKey] || pageKey, marks,
  });
  await touchUpPage(pdf, layers, colors, dims, margin);

  for (let li = 0; li < layers.length; li++) {
    const { pageW, pageH, fit } = sheetPageSize(designW, designH, margin, extraV, [coverW, coverH]);
    pdf.addPage([pageW, pageH], pageW > pageH ? 'landscape' : 'portrait');
    const boxW = designW * fit, boxH = designH * fit;
    const x = (pageW - boxW) / 2, y = margin + titleBand;
    const traced = layers[li].traced;
    const el = tileSVGElement(traced, colors[li] || '#111111', marks, { x: 0, y: 0, w: traced.width, h: traced.height });
    await renderSVG(pdf, el, { x, y, width: boxW, height: boxH });
    cropMarks(pdf, x, y, boxW, boxH);
    pdf.setFontSize(9); pdf.setTextColor(60);
    const label = colorLabels[li] || colors[li] || '#111111';
    const note = fit === 1
      ? `cut at ${Math.round(designW)} × ${Math.round(designH)} mm (1:1)`
      : `scaled to fit — true size ${Math.round(designW)} × ${Math.round(designH)} mm`;
    pdf.text(`Layer ${li + 1} of ${layers.length} · ${label} · ${note}`, margin, margin + 5);
    scaleBar(pdf, x, y + boxH + 6, Math.max(20, Math.min(100, Math.round(boxW))));
  }
  return pdf;
}

// Public entry: a proof cover + one page per layer at true size.
export async function exportPDF(layers, colors, dims, opts = {}) {
  return exportSheetPDF(layers, colors, dims, opts);
}
