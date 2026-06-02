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

function assemblyGrid(pdf, x, y, cols, rows, cell) {
  pdf.setDrawColor(120); pdf.setLineWidth(0.3);
  pdf.setFontSize(7); pdf.setTextColor(90);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cx = x + c * cell, cy = y + r * cell;
    pdf.rect(cx, cy, cell, cell);
    pdf.text(`${c + 1},${r + 1}`, cx + cell / 2, cy + cell / 2 + 1.5, { align: 'center' });
  }
}

async function coverPage(pdf, info) {
  const { margin, designW, designH, layers, colors, colorLabels, cols, rows, pageLabel, marks } = info;
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const lineW = pageW - 2 * margin;
  let y = margin + 4;

  pdf.setTextColor(20); pdf.setFontSize(18); pdf.text('SprayCan — cut & spray kit', margin, y); y += 8;
  pdf.setFontSize(10); pdf.setTextColor(90);
  pdf.text(`Final size ${Math.round(designW)} × ${Math.round(designH)} mm · ${layers.length} layer(s) · ${pageLabel} · ${cols}×${rows} page(s) per layer`, margin, y);
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
    const lines = pdf.splitTextToSize(`${i + 1}. ${label} — ${L.bridges.length} tie(s)`, listRight - margin - 8);
    pdf.text(lines, margin + 8, y);
    y += 5.4 * lines.length + 0.6;
  });
  y = Math.max(y, margin + 21 + ph) + 6;

  if (cols * rows > 1) {
    pdf.setTextColor(20); pdf.setFontSize(11); pdf.text('Assembly — trim, overlap & tape pages per layer:', margin, y); y += 5;
    const cell = Math.min(11, Math.max(8, lineW / Math.max(cols, 1)));
    assemblyGrid(pdf, margin, y, cols, rows, cell);
    y += rows * cell + 7;
  }

  if (y > pageH - 72) { pdf.addPage(); y = margin + 4; }
  pdf.setTextColor(20); pdf.setFontSize(12); pdf.text('Cut & spray', margin, y); y += 6;
  pdf.setFontSize(9.5); pdf.setTextColor(70);
  const steps = [
    'Print every page at 100% (Actual size — no "fit to page"); check the ruler below.',
    'Trim tiles to the grey crop marks, then overlap and tape the tiles of the SAME layer.',
    'Cut away the coloured (sprayed) areas; KEEP everything else and the small bridges/ties.',
    'Tape the stencil flat and press the edges down so paint cannot creep underneath.',
    'Spray light, even coats from ~15 cm, held at 90°; let each layer dry before the next.',
    'Line layers up with the red registration marks; spray the lightest layer first.',
  ];
  steps.forEach((s, i) => { const lines = pdf.splitTextToSize(`${i + 1}. ${s}`, lineW); pdf.text(lines, margin, y); y += 4.7 * lines.length; });
  y += 5;
  scaleBar(pdf, margin, y + 2, 100);
}

export async function exportTiledPDF(layers, colors, dims, opts = {}) {
  if (!window.jspdf) throw new Error('jsPDF not loaded');
  const { jsPDF } = window.jspdf;
  const pageKey = PAGES[opts.pageSize] ? opts.pageSize : 'a4';
  const [pageW, pageH] = PAGES[pageKey];
  const margin = Math.max(3, opts.margin ?? 10);
  const overlap = Math.max(0, opts.overlap ?? 8);
  const printW = pageW - 2 * margin, printH = pageH - 2 * margin;
  const designW = dims.widthMm, designH = dims.heightMm;
  const pxPerMm = layers[0].traced.width / designW;

  const stepW = Math.max(1, printW - overlap), stepH = Math.max(1, printH - overlap);
  const cols = designW <= printW ? 1 : Math.ceil((designW - overlap) / stepW);
  const rows = designH <= printH ? 1 : Math.ceil((designH - overlap) / stepH);

  const pdf = new jsPDF({ unit: 'mm', format: [pageW, pageH], orientation: 'portrait' });
  await coverPage(pdf, {
    margin, designW, designH, layers, colors, colorLabels: opts.colorLabels || [],
    cols, rows, pageLabel: PAGE_LABELS[pageKey] || pageKey, marks: opts.marks || [],
  });

  for (let li = 0; li < layers.length; li++) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        pdf.addPage();
        const tileXmm = c * stepW, tileYmm = r * stepH;
        const tileWmm = Math.min(printW, designW - tileXmm);
        const tileHmm = Math.min(printH, designH - tileYmm);
        const vb = { x: tileXmm * pxPerMm, y: tileYmm * pxPerMm, w: tileWmm * pxPerMm, h: tileHmm * pxPerMm };
        const el = tileSVGElement(layers[li].traced, colors[li] || '#111111', opts.marks || [], vb);
        await renderSVG(pdf, el, { x: margin, y: margin, width: tileWmm, height: tileHmm });
        cropMarks(pdf, margin, margin, tileWmm, tileHmm);
        pdf.setFontSize(8); pdf.setTextColor(120);
        pdf.text(`Layer ${li + 1} (spray ${li + 1}/${layers.length}) — page ${c + 1},${r + 1} of ${cols}×${rows}`, margin, margin - 3);
      }
    }
  }
  return pdf;
}
