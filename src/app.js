// SprayCan — app controller. Owns state, runs the pipeline, wires the UI.

import { fileToImage, imageToGray } from './image.js';
import { autoThresholds, buildLayers } from './posterize.js';
import { despeckle, frameBorder, removeSmallComponents, dilate, morphClose } from './morphology.js';
import { edgeMask } from './edges.js';
import { findIslands } from './islands.js';
import { autoBridges, burnBridges, prepareIslands } from './bridges.js';
import { traceMaskToPaths } from './trace.js';
import { physicalSize, toMm } from './units.js';
import { cornerMarks } from './registration.js';
import { layerToSVG, combinedSVG } from './exporters/svg.js';
import { exportPDF as buildPDF } from './exporters/pdf.js';
import { makeZipBlob } from './exporters/bundle.js';
import { toHex } from './color.js';
import { PALETTES, findPaintName, findNearestPaint } from './palettes.js';
import { readParams, reflectValues, bindControls, renderThresholds, addSteppers } from './ui/controls.js';
import { renderGuide } from './ui/guide.js';
import { PRESETS, imageStats, pickPreset } from './presets.js';
import { buildColorPanel, setColorPanelValue } from './ui/colors.js';
import { LayerEditor } from './ui/editor.js';

const $ = id => document.getElementById(id);
const els = {
  root: document.body, file: $('file'), sample: $('sample'), open: $('open'), thresholds: $('thresholds'),
  layers: $('layers'), minFeature: $('minFeature'), bridgeWidth: $('bridgeWidth'),
  targetWidth: $('targetWidth'), unit: $('unit'),
  autoBridge: $('autoBridge'), addBridge: $('addBridge'), delBridge: $('delBridge'),
  exportSvg: $('exportSvg'), exportPdf: $('exportPdf'), exportBtn: $('exportBtn'), exportMenu: $('exportMenu'),
  dims: $('dims'), status: $('status'), guide: $('guide'),
  activeLabel: $('activeLabel'), editor: $('editor'), combined: $('combined'), colorPanel: $('colorPanel'), editorEmpty: $('editorEmpty'), removeBg: $('removeBg'), removeBgBtn: $('removeBgBtn'), reset: $('reset'), preset: $('preset'),
  stage: document.querySelector('.stage'), canvasFrame: document.querySelector('.canvas-frame'),
  srcPreview: $('srcPreview'), srcCard: $('srcCard'), srcUpload: $('srcUpload'),
  zoomFit: $('zoomFit'), zoomOut: $('zoomOut'), zoomIn: $('zoomIn'), zoomLabel: $('zoomLabel'),
};

const state = { img: null, gray: null, params: null, layers: [], colors: [], colorNames: [], active: 0, sampleData: null, processedImg: null };
let busyToken = 0;
const undoStack = []; // per-layer bridge snapshots for Cmd/Ctrl-Z

const editor = new LayerEditor(els.editor, {
  onBridgesChanged,
  onBeforeChange: () => pushUndo(),
  onSample: (x, y) => { const hex = sampleImageColor(x, y); if (hex) { setColor(state.active, hex, 'Sampled'); ready(`Sampled ${hex} for layer ${state.active + 1}.`); } },
});

// ---- status helpers -------------------------------------------------------
function busy(msg) { els.status.textContent = msg; els.status.className = 'status busy'; }
function ready(msg = 'Ready.') { els.status.textContent = msg; els.status.className = 'status'; }
function fail(msg) { els.status.textContent = msg; els.status.className = 'status error'; }
// Yield to let the status text paint. Uses setTimeout (not requestAnimationFrame)
// so it still fires when the tab is backgrounded, instead of hanging the pipeline.
const raf = () => new Promise(r => setTimeout(r, 0));

// ---- derived values -------------------------------------------------------
function mmPerPx() { return toMm(state.params.targetWidth, state.params.unit) / (state.gray ? state.gray.width : 1); }
function bridgeWidthPx() { return Math.max(1, Math.round(state.params.bridgeWidth / mmPerPx())); }
function dims() { return physicalSize(state.gray.width, state.gray.height, toMm(state.params.targetWidth, state.params.unit)); }
function marks() { return state.params.layers > 1 ? cornerMarks(state.gray.width, state.gray.height) : []; }

function defaultColors(n) {
  // Street-stencil greyscale: light grey -> near-black (white = the bare wall/paper).
  if (n <= 1) return ['#1a1a1a'];
  const out = [];
  for (let i = 0; i < n; i++) { const t = i / (n - 1); out.push(toHex(`hsl(0 0% ${Math.round(82 - 68 * t)}%)`)); }
  return out;
}
function defaultColorNames(n) { return new Array(n).fill(null); }
function nearestCanLabel(hex) { const n = findNearestPaint(hex); return n ? `${n.brand} ${n.name}` : ''; }

// Material / cut-method presets: default bridge width + the thinnest feature the
// material can hold (mm), used to warn when a bridge would be too fragile.
const MATERIALS = {
  // tieSpacing = anchor a tie roughly every N mm of an island's span; flimsier
  // materials (card) get more ties, stiffer/precise ones (laser) fewer.
  mylar: { bridge: 2.0, minFeatureMm: 0.6, tieSpacing: 65 },
  vinyl: { bridge: 2.0, minFeatureMm: 1.0, tieSpacing: 65 },
  card: { bridge: 3.0, minFeatureMm: 1.5, tieSpacing: 45 },
  laser: { bridge: 1.2, minFeatureMm: 0.3, tieSpacing: 80 },
};
function materialInfo() { return MATERIALS[state.params && state.params.material] || MATERIALS.mylar; }

// ---- pipeline -------------------------------------------------------------
function reGray() {
  const p = state.params;
  const src = (p.removeBg && state.processedImg) ? state.processedImg : state.img;
  state.gray = imageToGray(src, {
    maxResolution: p.maxResolution, brightness: p.brightness * 1.2, contrast: p.contrast * 2,
    invert: p.invert, smooth: p.smooth, autoLevels: p.autoLevels, mirror: p.mirror, vflip: p.vflip,
  });
  if (!p.thresholds || !p.thresholds.length) p.thresholds = autoThresholds(state.gray, p.layers);
  buildSampleData(src);
}

// Cache the image at working resolution so the eyedropper can read true colours.
function buildSampleData(src) {
  const g = state.gray;
  src = src || state.img;
  if (!g || !src) { state.sampleData = null; return; }
  const c = document.createElement('canvas'); c.width = g.width; c.height = g.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, g.width, g.height);
  state.sampleData = ctx.getImageData(0, 0, g.width, g.height);
}
function buildBrightMask(gray) {
  const b = new Uint8Array(gray.data.length);
  for (let i = 0; i < b.length; i++) b[i] = gray.data[i] >= 210 ? 1 : 0;
  return b;
}
function sampleImageColor(x, y) {
  const d = state.sampleData;
  if (!d) return null;
  if (state.params && state.params.mirror) x = d.width - 1 - x; // sampleData is un-mirrored
  if (state.params && state.params.vflip) y = d.height - 1 - y;  // …and un-flipped vertically
  const ix = Math.max(0, Math.min(d.width - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(d.height - 1, Math.round(y)));
  const i = (iy * d.width + ix) * 4;
  return '#' + [d.data[i], d.data[i + 1], d.data[i + 2]].map(n => n.toString(16).padStart(2, '0')).join('');
}

function reburn(layer) {
  layer.workMask = layer.bridges.length ? burnBridges(layer.baseMask, layer.bridges) : layer.baseMask;
  if (layer.isEdge) { layer.floatingMask = new Uint8Array(layer.workMask.data.length); return; } // lines are the design
  const { islandMask } = findIslands(layer.workMask);
  const fm = new Uint8Array(layer.workMask.data.length);
  for (let i = 0; i < fm.length; i++) fm[i] = islandMask.data[i] === 0 ? 1 : 0;
  layer.floatingMask = fm;
}
// Line-detail → vectoriser fidelity. Higher detail keeps smaller features
// (lower pathomit) and truer curves (lower ltres/qtres).
function traceOpts() {
  const d = state.params ? state.params.detail : 2;
  const pathomit = [12, 6, 2, 1][d] ?? 2;
  return d >= 3 ? { pathomit, ltres: 0.5, qtres: 0.5 } : { pathomit, ltres: 0.8, qtres: 0.8 };
}
function retrace(layer) { layer.traced = traceMaskToPaths(layer.workMask, layer.isEdge ? { pathomit: 8 } : traceOpts()); }

async function recomputeAll() {
  if (!state.gray) return;
  const my = ++busyToken;
  undoStack.length = 0;
  try {
    busy('Building layers…'); await raf();
    const p = state.params;
    const minArea = p.minFeature * p.minFeature;          // despeckle: drop tiny specks
    const minIslandArea = Math.max(64, (p.minFeature * 4) ** 2); // fill islands below this instead of bridging
    const maxBridges = p.bridgeMode === 'none' ? 0 : 16;  // None = fill every island (no ties)
    const brightMask = p.keepHighlights ? buildBrightMask(state.gray) : null;
    const bw = bridgeWidthPx();
    // Thin material holding frame — keeps the sheet connected at the edges so
    // islands can always be bridged, and matches a real stencil's border.
    const border = Math.max(2, Math.round(Math.min(state.gray.width, state.gray.height) * 0.01));
    const built = buildLayers(state.gray, p.thresholds);
    state.layers = [];
    for (let i = 0; i < built.length; i++) {
      const cleaned = minArea > 1 ? despeckle(built[i].mask, minArea) : built[i].mask;
      const framed = frameBorder(cleaned, border);
      // Smart bridging: fill tiny islands, tie only the meaningful (capped) ones.
      const { mask: baseMask, bridges } = prepareIslands(framed, { widthPx: bw, minIslandArea, maxBridges, brightMask, keepHighlights: p.keepHighlights, mmPerPx: mmPerPx(), tieSpacingMm: materialInfo().tieSpacing });
      const layer = { order: i, threshold: built[i].threshold, baseMask, bridges, workMask: null, floatingMask: null, traced: null };
      reburn(layer);
      retrace(layer);
      state.layers.push(layer);
      if (my !== busyToken) return;            // a newer change superseded this run
      busy(`Building layer ${i + 1} of ${built.length}…`); await raf();  // yield → UI stays responsive
    }
    const tonalN = state.layers.length;
    // Optional edge/line-detail layer: outlines + texture as the top (sprayed-last) layer.
    if (p.edges) {
      busy('Tracing outlines…'); await raf();
      // Strong outlines only — kill the speckle photos used to produce. Work on the
      // thin (un-dilated) edge map so component size = contour length: drop short
      // isolated runs, then thicken + close gaps into clean, cuttable contours.
      const px = state.gray.width * state.gray.height;
      const edgeMin = Math.max(40, Math.round(px * 0.00012)); // resolution-scaled floor
      let em = edgeMask(state.gray, { amount: p.edgeAmount, dilate: 0 });
      em = removeSmallComponents(em, 1, edgeMin); // keep only sizeable contours, drop dots
      em = dilate(em, 1);                         // restore a cuttable stroke width
      em = morphClose(em, 1);                     // bridge small gaps in the outlines
      em = despeckle(em, edgeMin);                // final tidy (open specks + material slivers)
      const baseMask = frameBorder(em, border);
      // Edge lines ARE the design: no island fill / bridging (would solid-fill the gaps).
      const layer = { order: state.layers.length, threshold: -1, isEdge: true, baseMask, bridges: [], workMask: null, floatingMask: null, traced: null };
      reburn(layer); retrace(layer); state.layers.push(layer);
      if (my !== busyToken) return;
    }
    if (state.colors.length !== state.layers.length) {
      state.colors = defaultColors(tonalN);
      state.colorNames = defaultColorNames(tonalN);
      if (p.edges) { state.colors.push('#161616'); state.colorNames.push('Edge lines'); }
    }
    state.active = Math.min(state.active, state.layers.length - 1);
    refreshUI();
    const minF = materialInfo().minFeatureMm;
    if (p.bridgeMode !== 'none' && p.bridgeWidth < minF) {
      els.status.textContent = `Heads-up: ${p.bridgeWidth} mm bridges are below this material's ~${minF} mm minimum — they may tear. Raise bridge width.`;
      els.status.className = 'status busy';
    } else if (p.bridgeMode !== 'none' && bridgeWidthPx() < 2) {
      els.status.textContent = 'Heads-up: bridges are very thin at this output size — raise the bridge width or target size.';
      els.status.className = 'status busy';
    } else {
      const ties = state.layers.reduce((n, L) => n + (L.isEdge ? 0 : L.bridges.length), 0);
      ready(ties
        ? `Ready — auto-placed ${ties} tie(s) sized for ${state.params.material} to hold every island. Adjust or export.`
        : 'Ready — no islands to tie. Adjust or export.');
    }
  } catch (err) {
    console.error(err);
    fail('Error: ' + err.message);
  }
}

// Re-vectorise the existing masks (e.g. when only Line detail changed) — much
// cheaper than rebuilding layers, and yields between layers to stay responsive.
async function retraceAll() {
  if (!state.layers.length) return;
  const my = ++busyToken;
  busy('Re-tracing…'); await raf();
  try {
    for (const layer of state.layers) { retrace(layer); if (my !== busyToken) return; await raf(); }
    refreshUI();
    ready('Ready — adjust, fix bridges, then export.');
  } catch (err) { console.error(err); fail('Error: ' + err.message); }
}

// ---- UI sync --------------------------------------------------------------
function edData(layer) { return { baseMask: layer.baseMask, bridges: layer.bridges, floatingMask: layer.floatingMask, bridgeWidth: bridgeWidthPx() }; }

function refreshUI() {
  renderGuide(els.guide, state.layers, state.colors, state.colorNames, state.active, { onSelect: setActive });
  const layer = state.layers[state.active];
  els.activeLabel.textContent = layer ? `Layer ${state.active + 1} of ${state.layers.length}` : '—';
  if (layer) {
    editor.setLayer(edData(layer));
    setColorPanelValue(state.colors[state.active], state.colorNames[state.active], nearestCanLabel(state.colors[state.active]));
    els.colorPanel.classList.add('show');
  } else {
    els.colorPanel.classList.remove('show');
  }
  updateCombined();
  updateDims();
  renderSource();
  setExportsEnabled(state.layers.length > 0);
  els.editorEmpty.style.display = state.layers.length ? 'none' : 'block';
}

function updateCombined() {
  if (!state.layers.length || !state.layers[0].traced) { els.combined.innerHTML = '<p class="empty">No image yet.</p>'; return; }
  const svg = combinedSVG(state.layers.map(l => l.traced), dims(), { colors: state.colors, marks: marks() });
  els.combined.innerHTML = svg.replace(/^<\?xml[^>]*\?>\s*/, '');
  // On screen, size by the viewBox (square) — the mm width/height are for export.
  const node = els.combined.querySelector('svg');
  if (node) { node.removeAttribute('width'); node.removeAttribute('height'); node.style.width = '100%'; node.style.height = 'auto'; }
}

function updateDims() {
  if (!state.gray) { els.dims.textContent = '—'; return; }
  const d = dims();
  const inW = d.widthMm / 25.4, inH = d.heightMm / 25.4;
  els.dims.textContent = `True size: ${Math.round(d.widthMm)} × ${Math.round(d.heightMm)} mm (≈ ${inW.toFixed(1)} × ${inH.toFixed(1)} in)  ·  working ${state.gray.width}×${state.gray.height}px`;
}

function setExportsEnabled(on) { [els.exportSvg, els.exportPdf, els.exportBtn].forEach(b => { if (b) b.disabled = !on; }); }

// Draw the original uploaded image into the small "Original" preview (pyramid apex).
function renderSource() {
  const cv = els.srcPreview, img = state.img;
  if (!cv) return;
  if (!img) { cv.hidden = true; if (els.srcUpload) els.srcUpload.hidden = false; return; }
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.min(200 / iw, 150 / ih, 1);
  cv.width = Math.max(1, Math.round(iw * s));
  cv.height = Math.max(1, Math.round(ih * s));
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  cv.hidden = false; if (els.srcUpload) els.srcUpload.hidden = true; // preview replaces the + tile
}

// Keep the Remove-background toggle button's visual state in sync with its checkbox.
function syncRemoveBgBtn() {
  if (!els.removeBgBtn) return;
  const on = els.removeBg.checked;
  els.removeBgBtn.classList.toggle('active', on);
  els.removeBgBtn.setAttribute('aria-pressed', String(on));
}

// Canvas zoom + the Export ▾ menu.
let zoom = 1;
function setZoom(z) {
  zoom = Math.max(0.25, Math.min(4, Math.round(z * 100) / 100));
  if (els.canvasFrame) els.canvasFrame.style.setProperty('--zoom', zoom);
  els.zoomLabel.textContent = Math.round(zoom * 100) + '%';
}
function toggleExportMenu(open) {
  const pop = els.exportMenu.querySelector('.menu-pop');
  const show = (open === undefined) ? pop.hidden : open;
  pop.hidden = !show;
  els.exportBtn.setAttribute('aria-expanded', String(show));
}

function setActive(i) {
  state.active = i;
  els.addBridge.classList.remove('active'); editor.setMode('select');
  refreshUI();
}
function setColor(i, hex, name = null) {
  if (i == null || i < 0 || !state.layers[i]) return;
  state.colors[i] = hex;
  state.colorNames[i] = name || findPaintName(hex);
  renderGuide(els.guide, state.layers, state.colors, state.colorNames, state.active, { onSelect: setActive });
  if (i === state.active) setColorPanelValue(state.colors[i], state.colorNames[i], nearestCanLabel(state.colors[i]));
  updateCombined();
}

// editor commit (drag / add / delete) — recompute just the active layer
function onBridgesChanged() {
  const layer = state.layers[state.active];
  if (!layer) return;
  els.addBridge.classList.remove('active');
  reburn(layer);
  retrace(layer);
  editor.refreshBase(layer.baseMask, layer.floatingMask);
  updateCombined();
}

// Background removal toggle — lazy-loads an in-browser model only when enabled.
async function toggleBackground() {
  if (!state.img) return;
  if (!state.params.removeBg) { state.processedImg = null; reGray(); recomputeAll(); return; }
  const my = ++busyToken;
  busy('Removing background… (first run downloads a model — please wait)');
  try {
    const { removeBackgroundToImage } = await import('./bg.js');
    const out = await removeBackgroundToImage(state.img);
    if (my !== busyToken) return; // superseded by a newer action
    state.processedImg = out;
    reGray();
    await recomputeAll();
  } catch (e) {
    console.error(e);
    state.processedImg = null;
    els.removeBg.checked = false;
    if (state.params) state.params.removeBg = false;
    fail('Background removal failed (it needs internet to fetch the model): ' + e.message);
  }
}

// ---- undo + eyedropper ----------------------------------------------------
function pushUndo() {
  const L = state.layers[state.active];
  if (!L) return;
  undoStack.push({ layer: state.active, bridges: L.bridges.map(b => ({ ...b })) });
  if (undoStack.length > 60) undoStack.shift();
}
function undo() {
  const u = undoStack.pop();
  if (!u) { ready('Nothing to undo.'); return; }
  const L = state.layers[u.layer];
  if (!L) return;
  L.bridges.length = 0; L.bridges.push(...u.bridges);
  state.active = u.layer;
  reburn(L); retrace(L);
  refreshUI();
  ready('Undid a bridge change.');
}
function startEyedrop() {
  if (!state.layers.length) return;
  editor.setMode('eyedrop');
  busy(`Eyedropper — click your image to colour layer ${state.active + 1}.`);
}

// ---- control wiring -------------------------------------------------------
function mergeParams() {
  const p = readParams(els.root);
  p.thresholds = state.params?.thresholds ? state.params.thresholds.slice() : [];
  return p;
}

// Control defaults captured from the HTML at startup, for "Reset to defaults"
// and for giving each newly-loaded image a clean look-baseline.
const DEFAULTS = {};
const LOOK_IDS = ['brightness', 'contrast', 'smooth', 'detail', 'invert', 'autoLevels', 'mirror', 'vflip', 'layers', 'minFeature', 'keepHighlights', 'edges', 'edgeAmount', 'removeBg'];
function captureDefaults() {
  els.root.querySelectorAll('[data-param]').forEach(el => { DEFAULTS[el.id] = (el.type === 'checkbox') ? el.checked : el.value; });
}
function applyDefaults(ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el || !(id in DEFAULTS)) return;
    if (el.type === 'checkbox') el.checked = DEFAULTS[id]; else el.value = DEFAULTS[id];
  });
  reflectValues(els.root);
  syncRemoveBgBtn();
}
function resetToDefaults() {
  applyDefaults(Object.keys(DEFAULTS));
  state.processedImg = null;
  state.params = mergeParams();
  state.params.thresholds = [];
  if (state.img) {
    reGray();
    renderThresholds(els.thresholds, state.params.thresholds, onThreshold);
    recomputeAll();
  }
  ready('Settings reset to defaults.');
}

// Apply a preset: reset the look to a clean baseline, then layer the preset's
// control values on top, then recompute (background removal handles its own).
function applyPreset(id) {
  const preset = PRESETS[id] || PRESETS.photo;
  applyDefaults(LOOK_IDS);
  Object.entries(preset.params).forEach(([cid, val]) => {
    const el = document.getElementById(cid);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!val; else el.value = String(val);
  });
  reflectValues(els.root);
  syncRemoveBgBtn();
  state.params = mergeParams();
  state.params.thresholds = [];
  if (!state.img) return;
  reGray();
  renderThresholds(els.thresholds, state.params.thresholds, onThreshold);
  if (state.params.removeBg) return toggleBackground();
  return recomputeAll();
}

// Resolve the preset to apply for the current image: an explicit choice, or
// auto-pick from a quick neutral probe of the image when the select is on "Auto".
function presetForImage(img) {
  const sel = els.preset ? els.preset.value : 'auto';
  if (sel !== 'auto') { if (els.preset) els.preset.title = ''; return sel; }
  const probe = imageToGray(img, { maxResolution: 360, autoLevels: false, smooth: 0 });
  const aspect = (img.naturalWidth || img.width) / (img.naturalHeight || img.height || 1);
  const id = pickPreset(imageStats(probe, aspect));
  if (els.preset) els.preset.title = 'Auto-picked: ' + (PRESETS[id]?.label || id);
  return id;
}

function onInput(el) { reflectValues(els.root); }

function onChange(el) {
  reflectValues(els.root);
  state.params = mergeParams();
  if (!state.img) return;
  switch (el.id) {
    case 'brightness': case 'contrast': case 'invert': case 'maxResolution':
    case 'smooth': case 'autoLevels': case 'mirror': case 'vflip':
      reGray(); recomputeAll(); break;
    case 'layers':
      state.params.thresholds = autoThresholds(state.gray, state.params.layers);
      renderThresholds(els.thresholds, state.params.thresholds, onThreshold);
      recomputeAll(); break;
    case 'minFeature':
    case 'bridgeMode':
    case 'keepHighlights':
    case 'edges':
    case 'edgeAmount':
      recomputeAll(); break;
    case 'detail':
      retraceAll(); break;
    case 'material': {
      const m = MATERIALS[state.params.material] || MATERIALS.mylar;
      els.bridgeWidth.value = String(m.bridge); state.params.bridgeWidth = m.bridge;
      reflectValues(els.root); editor.defaultWidth = bridgeWidthPx();
      recomputeAll(); break;
    }
    case 'preset':
      applyPreset(presetForImage(state.img)); break;
    case 'removeBg':
      toggleBackground(); break;
    case 'bridgeWidth':
      editor.defaultWidth = bridgeWidthPx(); recomputeAll(); break;
    case 'targetWidth': case 'unit':
      editor.defaultWidth = bridgeWidthPx(); updateDims(); updateCombined(); break;
  }
}

function onThreshold(i, value) {
  if (!state.params) return;
  state.params.thresholds[i] = value;
  recomputeAll();
}

// ---- export ---------------------------------------------------------------
function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function download(name, content, mime = 'image/svg+xml') { downloadBlob(name, new Blob([content], { type: mime })); }

function colorLabel(i) {
  const hex = state.colors[i];
  if (state.colorNames[i]) return `${state.colorNames[i]} (${hex})`;
  const n = findNearestPaint(hex);
  return n ? `${hex} — closest can: ${n.brand} ${n.name}` : hex;
}

function exportReadme(d) {
  return [
    'SprayCan export',
    '===============',
    `Final size: ${Math.round(d.widthMm)} x ${Math.round(d.heightMm)} mm`,
    `Layers: ${state.layers.length} (spray light -> dark; layer 1 first)`,
    '',
    'Files:',
    ...state.layers.map((L, i) => `  layer-${i + 1}.svg  — spray ${i + 1} of ${state.layers.length}, ${colorLabel(i)}, ${L.bridges.length} bridge(s)`),
    '  preview-all-layers.svg — all layers stacked, for reference',
    '',
    'Cut out the filled areas; KEEP the small bridges (ties) — they hold loose',
    'pieces in place. Align layers with the red registration crosshairs and spray',
    'the lightest layer first.',
  ].join('\n');
}

async function exportPerLayer() {
  if (!state.layers.length) return;
  const d = dims();
  busy('Packaging SVGs…'); await raf();
  try {
    const files = state.layers.map((layer, i) => ({
      name: `layer-${i + 1}.svg`,
      content: layerToSVG(layer.traced, d, { fill: state.colors[i], marks: marks() }),
    }));
    files.push({ name: 'preview-all-layers.svg', content: combinedSVG(state.layers.map(l => l.traced), d, { colors: state.colors, marks: marks() }) });
    files.push({ name: 'README.txt', content: exportReadme(d) });
    downloadBlob('stencil-svgs.zip', await makeZipBlob(files));
    ready(`Exported ${state.layers.length}-layer SVG bundle (.zip).`);
  } catch (e) { console.error(e); fail('SVG export failed: ' + e.message); }
}

async function exportPDF() {
  if (!state.layers.length) return;
  busy('Building PDF (this can take a moment)…'); await raf();
  try {
    const pdf = await buildPDF(state.layers, state.colors, dims(), { pageSize: state.params.pageSize, marks: marks(), colorLabels: state.layers.map((_, i) => colorLabel(i)), margin: state.params.margin });
    pdf.save('stencil.pdf');
    ready('PDF exported.');
  } catch (e) { console.error(e); fail('PDF export failed: ' + e.message); }
}

// ---- image intake ---------------------------------------------------------
async function useImage(img) {
  state.img = img;
  state.processedImg = null;
  // Start from a tuned preset (auto-picked per image, or the user's explicit choice)
  // so the upload looks near-finished instead of starting from a generic default.
  await applyPreset(presetForImage(img));
}

// A built-in demo (concentric tones + enclosed islands) so the tool can be
// tried without a file. Drawn on a canvas, which doubles as an <img> source.
function loadSample() {
  const c = document.createElement('canvas'); c.width = c.height = 600;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 600, 600);
  const disc = (r, color) => { x.fillStyle = color; x.beginPath(); x.arc(300, 300, r, 0, Math.PI * 2); x.fill(); };
  disc(250, '#111111');  // outer ring (dark)
  disc(200, '#ffffff');  // gap -> makes the dark ring an island former
  disc(150, '#777777');  // mid-tone disc
  disc(95, '#ffffff');   // gap
  disc(48, '#111111');   // centre dot (enclosed island)
  busy('Loading sample…');
  useImage(c).catch(err => fail('Sample failed: ' + err.message));
}

// ---- init -----------------------------------------------------------------
function init() {
  reflectValues(els.root);
  captureDefaults();
  setExportsEnabled(false);
  bindControls(els.root, { onInput, onChange });
  els.root.querySelectorAll('input[type=range][data-param]').forEach(addSteppers);
  // Clicking a section "?" shows its tooltip but must not collapse the section.
  els.root.querySelectorAll('.help').forEach(h => h.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); }));
  // Single-open accordion: expanding a section collapses the others (less scrolling).
  els.root.querySelectorAll('details.group').forEach(d => {
    d.addEventListener('toggle', () => {
      if (!d.open) return;
      els.root.querySelectorAll('details.group[open]').forEach(o => { if (o !== d) o.open = false; });
    });
  });
  buildColorPanel(els.colorPanel, { palettes: PALETTES, onPick: (hex, name) => setColor(state.active, hex, name), onPickFromImage: startEyedrop });

  els.file.addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    busy('Loading image…');
    try { await useImage(await fileToImage(f)); }
    catch (err) { fail('Could not load image: ' + err.message); }
  });
  els.sample.addEventListener('click', loadSample);
  els.open.addEventListener('click', () => els.file.click());
  els.srcUpload.addEventListener('click', () => els.file.click());
  els.srcPreview.addEventListener('click', () => els.file.click()); // click the preview to replace
  els.reset.addEventListener('click', resetToDefaults);
  els.removeBgBtn.addEventListener('click', () => {
    els.removeBg.checked = !els.removeBg.checked;
    syncRemoveBgBtn();
    els.removeBg.dispatchEvent(new Event('change', { bubbles: true }));
  });
  syncRemoveBgBtn();

  els.autoBridge.addEventListener('click', () => {
    const layer = state.layers[state.active];
    if (!layer) return;
    pushUndo();
    const nb = autoBridges(layer.baseMask, { widthPx: bridgeWidthPx(), mmPerPx: mmPerPx(), tieSpacingMm: materialInfo().tieSpacing });
    layer.bridges.length = 0; layer.bridges.push(...nb);
    reburn(layer); retrace(layer);
    editor.setLayer(edData(layer)); updateCombined();
    ready(`Auto-placed ${nb.length} bridge(s) on layer ${state.active + 1}.`);
  });
  els.addBridge.addEventListener('click', () => {
    const adding = !els.addBridge.classList.contains('active');
    els.addBridge.classList.toggle('active', adding);
    editor.setMode(adding ? 'add' : 'select');
  });
  els.delBridge.addEventListener('click', () => editor.removeSelected());

  els.exportSvg.addEventListener('click', exportPerLayer);
  els.exportPdf.addEventListener('click', exportPDF);

  // Zoom
  els.zoomFit.addEventListener('click', () => setZoom(1));
  els.zoomIn.addEventListener('click', () => setZoom(zoom + 0.25));
  els.zoomOut.addEventListener('click', () => setZoom(zoom - 0.25));
  setZoom(1);
  // Export ▾ menu open/close
  els.exportBtn.addEventListener('click', e => { e.stopPropagation(); toggleExportMenu(); });
  document.addEventListener('click', e => { if (!els.exportMenu.contains(e.target)) toggleExportMenu(false); });
  els.exportSvg.addEventListener('click', () => toggleExportMenu(false));
  els.exportPdf.addEventListener('click', () => toggleExportMenu(false));

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return;
      if (!state.layers.length) return;
      e.preventDefault(); undo();
    }
  });
}

init();

// Debug hook (handy for automated verification; harmless in production).
window.__sf = {
  get state() { return state; },
  get editor() { return editor; },
  bridgeWidthPx,
  buildPDF: () => buildPDF(state.layers, state.colors, dims(), { pageSize: state.params.pageSize, marks: marks(), colorLabels: state.layers.map((_, i) => colorLabel(i)), margin: state.params.margin }),
};
