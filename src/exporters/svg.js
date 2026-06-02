// Build exportable SVG strings from traced paths. Paths are in working-pixel
// coords; the viewBox maps them to a real-world mm canvas.

import { markToSVG } from '../registration.js';

function svgOpen(widthMm, heightMm, pxW, pxH) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(widthMm)}mm" height="${round(heightMm)}mm" ` +
    `viewBox="0 0 ${pxW} ${pxH}">\n`;
}

function regGroup(marks, pxW, pxH) {
  if (!marks || !marks.length) return '';
  const sw = Math.max(0.4, Math.min(pxW, pxH) * 0.002);
  return `  <g fill="none" stroke="#ff0000" stroke-width="${round(sw)}">\n    ` +
    marks.map(m => markToSVG(m, sw)).join('\n    ') + `\n  </g>\n`;
}

// One layer as a standalone cut file. fill renders the area that gets sprayed.
export function layerToSVG(traced, dims, opts = {}) {
  const { widthMm, heightMm } = dims;
  const { fill = '#111111', marks = [] } = opts;
  const body = traced.paths.map(d => `    <path d="${d}" />`).join('\n');
  return svgOpen(widthMm, heightMm, traced.width, traced.height) +
    `  <g fill="${fill}" fill-rule="evenodd" stroke="none">\n${body}\n  </g>\n` +
    regGroup(marks, traced.width, traced.height) +
    `</svg>\n`;
}

// All layers stacked with their spray colours — a proof/preview of the result.
export function combinedSVG(tracedLayers, dims, opts = {}) {
  const { widthMm, heightMm } = dims;
  const { colors = [], marks = [] } = opts;
  let groups = '';
  tracedLayers.forEach((traced, i) => {
    const fill = colors[i] || '#111111';
    const body = traced.paths.map(d => `    <path d="${d}" />`).join('\n');
    groups += `  <g fill="${fill}" fill-rule="evenodd" stroke="none">\n${body}\n  </g>\n`;
  });
  const pxW = tracedLayers[0]?.width || 1;
  const pxH = tracedLayers[0]?.height || 1;
  return svgOpen(widthMm, heightMm, pxW, pxH) + groups + regGroup(marks, pxW, pxH) + `</svg>\n`;
}

function round(n) { return Math.round(n * 100) / 100; }
