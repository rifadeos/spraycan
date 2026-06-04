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
import { ensurePdfLibs, ensureZip } from './vendor.js';
import { toHex } from './color.js';
import { PALETTES, findPaintName, findNearestPaint } from './palettes.js';
import { readParams, reflectValues, bindControls, renderThresholds, addSteppers } from './ui/controls.js';
import { renderGuide } from './ui/guide.js';
import { PRESETS, imageStats, pickPreset, analyzeColor, presetFromSignals } from './presets.js';
import { buildColorPanel, setColorPanelValue } from './ui/colors.js';
import { LayerEditor } from './ui/editor.js';

const $ = id => document.getElementById(id);
const els = {
  root: document.body, file: $('file'), sample: $('sample'), open: $('open'), thresholds: $('thresholds'),
  layers: $('layers'), minFeature: $('minFeature'), bridgeWidth: $('bridgeWidth'),
  targetWidth: $('targetWidth'), unit: $('unit'),
  autoBridge: $('autoBridge'), addBridge: $('addBridge'), delBridge: $('delBridge'), undoBtn: $('undoBtn'), redoBtn: $('redoBtn'),
  exportSvg: $('exportSvg'), exportPdf: $('exportPdf'), exportPng: $('exportPng'), exportBtn: $('exportBtn'), exportMenu: $('exportMenu'),
  dims: $('dims'), status: $('status'), guide: $('guide'),
  activeLabel: $('activeLabel'), editor: $('editor'), combined: $('combined'), colorPanel: $('colorPanel'), editorEmpty: $('editorEmpty'), removeBg: $('removeBg'), removeBgBtn: $('removeBgBtn'), reset: $('reset'), preset: $('preset'), presetReason: $('presetReason'),
  stage: document.querySelector('.stage'), canvasFrame: document.querySelector('.canvas-frame'),
  srcPreview: $('srcPreview'), srcCard: $('srcCard'), srcUpload: $('srcUpload'),
  zoomFit: $('zoomFit'), zoomOut: $('zoomOut'), zoomIn: $('zoomIn'), zoomLabel: $('zoomLabel'),
};

const state = { img: null, gray: null, params: null, layers: [], colors: [], colorNames: [], active: 0, sampleData: null, processedImg: null, presetId: 'photo', grayPreview: false, grayFlat: false };
let busyToken = 0;
let genToken = 0;        // bumped on every new image; lets async chains bail when a newer upload supersedes them
let eyedropMode = false; // true while "Pick from image" is armed (sampling a colour)
const undoStack = []; // per-layer bridge snapshots for undo (Cmd/Ctrl-Z)
const redoStack = []; // states undone, for redo (Cmd/Ctrl-Shift-Z)

const editor = new LayerEditor(els.editor, {
  onBridgesChanged,
  onBeforeChange: () => pushUndo(),
  onSample: (x, y) => { const hex = sampleImageColor(x, y); if (hex) { setColor(state.active, hex, 'Sampled'); ready(`Sampled ${hex} for layer ${state.active + 1}.`); } endEyedrop(); },
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
function dims() { if (!state.gray) return { widthMm: 0, heightMm: 0, mmPerPx: 1 }; return physicalSize(state.gray.width, state.gray.height, toMm(state.params.targetWidth, state.params.unit)); }
function marks() { return (state.gray && state.params && state.params.layers > 1) ? cornerMarks(state.gray.width, state.gray.height) : []; }

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
// Cap working resolution on very low-memory devices to avoid out-of-memory crashes.
// deviceMemory is undefined on many browsers (incl. iOS Safari) → we don't cap there.
function safeMaxResolution(requested) {
  const mem = navigator.deviceMemory;
  if (mem && mem <= 2) return Math.min(requested, 1000);
  return requested;
}

function reGray(opts = {}) {
  const p = state.params;
  const src = state.processedImg || state.img; // bg-removed or AI-simplified base, else the original
  const maxResolution = opts.maxResolution || safeMaxResolution(p.maxResolution);
  state.gray = imageToGray(src, {
    maxResolution, brightness: p.brightness * 1.2, contrast: p.contrast * 2,
    invert: p.invert, smooth: p.smooth, autoLevels: p.autoLevels, mirror: p.mirror, vflip: p.vflip,
  });
  state.grayPreview = maxResolution < p.maxResolution; // true → this is a low-res drag preview, not final
  let lo = 255, hi = 0; const gd = state.gray.data;
  for (let i = 0; i < gd.length; i++) { const v = gd[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  state.grayFlat = (hi - lo) < 4; // near-uniform image → posterising yields empty/flat layers; warn the user
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
// Pixels at/above `thresh` are protected from being sprayed (kept as bare wall),
// so highlights survive posterising. Portraits use a much lower threshold so the
// continuous mid-tones of a face stay connected instead of punching "face holes".
function buildBrightMask(gray, thresh = 210) {
  const b = new Uint8Array(gray.data.length);
  for (let i = 0; i < b.length; i++) b[i] = gray.data[i] >= thresh ? 1 : 0;
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
  const pathomit = [16, 9, 4, 1][d] ?? 4;       // drop more tiny specks at lower detail
  const tol = [1.4, 1.0, 0.7, 0.4][d] ?? 0.8;   // higher = smoother Bézier fit; lower = more faithful to pixels
  return { pathomit, ltres: tol, qtres: tol };
}
function retrace(layer) { layer.traced = traceMaskToPaths(layer.workMask, layer.isEdge ? { pathomit: 8 } : traceOpts()); }

async function recomputeAll() {
  if (!state.gray) return;
  const my = ++busyToken;
  undoStack.length = 0; redoStack.length = 0; updateUndoButtons();
  try {
    busy('Building layers…'); await raf();
    const p = state.params;
    const minArea = p.minFeature * p.minFeature;          // despeckle: drop tiny specks
    // Fill islands smaller than this instead of bridging. Portraits fill much larger
    // ones so facial highlights merge into the face (far fewer "holes" + ties).
    const islandSpan = state.presetId === 'portrait' ? 7 : 4;
    const minIslandArea = Math.max(64, (p.minFeature * islandSpan) ** 2);
    const maxBridges = p.bridgeMode === 'none' ? 0 : 16;  // None = fill every island (no ties)
    const brightMask = p.keepHighlights ? buildBrightMask(state.gray) : null;
    const bw = bridgeWidthPx();
    // Thin material holding frame — keeps the sheet connected at the edges so
    // islands can always be bridged, and matches a real stencil's border.
    const border = Math.max(2, Math.round(Math.min(state.gray.width, state.gray.height) * 0.01));
    const built = buildLayers(state.gray, p.thresholds);
    // Build into a local array and commit atomically at the end, so a superseded
    // run (or a mid-build error) never leaves state.layers half-built.
    const newLayers = [];
    for (let i = 0; i < built.length; i++) {
      if (my !== busyToken) return;            // a newer change superseded this run — leave state untouched
      const cleaned = minArea > 1 ? despeckle(built[i].mask, minArea) : built[i].mask;
      const framed = frameBorder(cleaned, border);
      // Smart bridging: fill tiny islands, tie only the meaningful (capped) ones.
      const { mask: baseMask, bridges } = prepareIslands(framed, { widthPx: bw, minIslandArea, maxBridges, brightMask, keepHighlights: p.keepHighlights, mmPerPx: mmPerPx(), tieSpacingMm: materialInfo().tieSpacing });
      const layer = { order: i, threshold: built[i].threshold, baseMask, bridges, workMask: null, floatingMask: null, traced: null };
      reburn(layer);
      retrace(layer);
      newLayers.push(layer);
      busy(`Building layer ${i + 1} of ${built.length}…`); await raf();  // yield → UI stays responsive
    }
    const tonalN = newLayers.length;
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
      const layer = { order: newLayers.length, threshold: -1, isEdge: true, baseMask, bridges: [], workMask: null, floatingMask: null, traced: null };
      reburn(layer); retrace(layer); newLayers.push(layer);
    }
    if (my !== busyToken) return;   // final supersession check before the atomic commit
    state.layers = newLayers;       // commit
    if (state.colors.length !== state.layers.length) {
      state.colors = defaultColors(tonalN);
      state.colorNames = defaultColorNames(tonalN);
      if (p.edges) { state.colors.push('#161616'); state.colorNames.push('Edge lines'); }
    }
    state.active = Math.max(0, Math.min(state.active, state.layers.length - 1));
    refreshUI();
    if (state.grayFlat) {
      els.status.textContent = 'Heads-up: this image is almost one flat tone — adjust Brightness/Contrast, or try a different image.';
      els.status.className = 'status busy';
      return;
    }
    const minF = materialInfo().minFeatureMm;
    if (p.bridgeMode !== 'none' && p.bridgeWidth < minF) {
      els.status.textContent = `Heads-up: ${p.bridgeWidth} mm bridges are below this material's ~${minF} mm minimum — they may tear. Raise bridge width.`;
      els.status.className = 'status busy';
    } else if (p.bridgeMode !== 'none' && bridgeWidthPx() < 2) {
      els.status.textContent = 'Heads-up: bridges are very thin at this output size — raise the bridge width or target size.';
      els.status.className = 'status busy';
    } else {
      const tieCounts = state.layers.filter(L => !L.isEdge).map(L => L.bridges.length);
      const ties = tieCounts.reduce((a, b) => a + b, 0);
      const maxTies = tieCounts.length ? Math.max(...tieCounts) : 0;
      if (maxTies >= 14) {
        els.status.textContent = `Heads-up: a layer has ${maxTies} ties (${ties} total) — raise Simplify or lower Layers to cut down the marks you'll touch up.`;
        els.status.className = 'status busy';
      } else {
        ready(ties
          ? `Ready — auto-placed ${ties} tie(s) sized for ${state.params.material} to hold every island. Adjust or export.`
          : 'Ready — no islands to tie. Adjust or export.');
      }
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
function edData(layer) { return { baseMask: layer.baseMask, bridges: layer.bridges, floatingMask: layer.floatingMask, bridgeWidth: bridgeWidthPx(), mmPerPx: mmPerPx() }; }

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
  const hasLayers = state.layers.length > 0;
  els.editorEmpty.style.display = hasLayers ? 'none' : 'block';
  els.editor.style.display = hasLayers ? '' : 'none'; // hide the empty 300×150 canvas so the placeholder centres
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

function setExportsEnabled(on) { [els.exportSvg, els.exportPdf, els.exportPng, els.exportBtn].forEach(b => { if (b) b.disabled = !on; }); }

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
  if (show) { const first = pop.querySelector('button'); if (first) first.focus(); }
}

function setActive(i) {
  state.active = i;
  els.addBridge.classList.remove('active'); editor.setMode('select');
  refreshUI();
  ready(`Layer ${i + 1} of ${state.layers.length} selected.`);
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
  if (!state.img || !state.params) return;
  const gen = genToken;
  if (!state.params.removeBg) { state.processedImg = null; reGray(); await recomputeAll(); return; }
  const my = ++busyToken;
  busy('Removing background… (first run downloads a model — please wait)');
  try {
    const { removeBackgroundToImage } = await import('./bg.js');
    const res = await removeBackgroundToImage(state.img, (key, current, total) => {
      if (my !== busyToken || gen !== genToken) return;
      const pct = total ? Math.round(100 * current / total) : null;
      busy(pct != null ? `Removing background… ${pct}% (first run downloads a model)` : 'Removing background…');
    });
    if (my !== busyToken || gen !== genToken) return; // superseded by a newer action / image
    if (res.coverage < 0.05 || res.coverage > 0.95) {
      // No clear subject (≈0) or it kept everything (≈1) → don't isolate; use the full image.
      state.processedImg = null;
      els.removeBg.checked = false; if (state.params) state.params.removeBg = false; syncRemoveBgBtn();
      reGray(); await recomputeAll();
      ready('No clear subject to isolate — using the full image.');
      return;
    }
    state.processedImg = res.image;
    reGray();
    await recomputeAll();
  } catch (e) {
    console.error(e);
    state.processedImg = null;
    els.removeBg.checked = false;
    if (state.params) state.params.removeBg = false;
    syncRemoveBgBtn();
    // Still give the user a stencil from the full image rather than nothing.
    try { reGray(); await recomputeAll(); } catch { /* leave whatever's there */ }
    fail('Background removal failed (needs internet to fetch the model) — using the full image.');
  }
}

// ---- undo + eyedropper ----------------------------------------------------
function snapshot(layerIdx) {
  const L = state.layers[layerIdx];
  return L ? { layer: layerIdx, bridges: L.bridges.map(b => ({ ...b })) } : null;
}
function applySnapshot(s) {
  const L = state.layers[s.layer];
  if (!L) return;
  L.bridges.length = 0; L.bridges.push(...s.bridges);
  state.active = s.layer;
  reburn(L); retrace(L);
  refreshUI();
}
function updateUndoButtons() {
  if (els.undoBtn) els.undoBtn.disabled = !undoStack.length;
  if (els.redoBtn) els.redoBtn.disabled = !redoStack.length;
}
function pushUndo() {
  const s = snapshot(state.active);
  if (!s) return;
  undoStack.push(s);
  redoStack.length = 0;            // a fresh edit invalidates the redo trail
  if (undoStack.length > 60) undoStack.shift();
  updateUndoButtons();
}
function undo() {
  const u = undoStack.pop();
  if (!u) { ready('Nothing to undo.'); return; }
  const cur = snapshot(u.layer); if (cur) redoStack.push(cur); // current (post-change) → redo
  applySnapshot(u);
  ready('Undid a bridge change.'); updateUndoButtons();
}
function redo() {
  const r = redoStack.pop();
  if (!r) { ready('Nothing to redo.'); return; }
  const cur = snapshot(r.layer); if (cur) undoStack.push(cur);
  applySnapshot(r);
  ready('Redid a bridge change.'); updateUndoButtons();
}
function startEyedrop() {
  if (!state.layers.length) return;
  eyedropMode = true;
  editor.setMode('eyedrop');
  if (els.srcPreview) els.srcPreview.style.cursor = 'copy';
  busy(`Eyedropper — click the Original photo (top) or the editing image to colour layer ${state.active + 1}.`);
}
function endEyedrop() {
  eyedropMode = false;
  if (els.srcPreview) els.srcPreview.style.cursor = '';
  editor.setMode('select');
}
// Sample a colour straight from the colour Original preview (the obvious "image").
function sampleFromSrcPreview(e) {
  const cv = els.srcPreview;
  if (!cv || cv.hidden || !cv.width) { endEyedrop(); return; }
  const r = cv.getBoundingClientRect();
  const x = Math.max(0, Math.min(cv.width - 1, Math.round((e.clientX - r.left) / r.width * cv.width)));
  const y = Math.max(0, Math.min(cv.height - 1, Math.round((e.clientY - r.top) / r.height * cv.height)));
  try {
    const d = cv.getContext('2d').getImageData(x, y, 1, 1).data;
    const hex = '#' + [d[0], d[1], d[2]].map(n => n.toString(16).padStart(2, '0')).join('');
    setColor(state.active, hex, 'Sampled');
    endEyedrop();
    ready(`Sampled ${hex} for layer ${state.active + 1}.`);
  } catch { endEyedrop(); fail('Could not sample that pixel.'); }
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

// Persist workshop/output preferences (NOT look/preset params, which auto-pick per
// image) so they survive across visits — handy when you always cut the same size /
// material / machine.
const PERSIST_IDS = ['material', 'targetWidth', 'unit', 'pageSize', 'maxResolution', 'margin'];
function saveSettings() {
  const o = {};
  PERSIST_IDS.forEach(id => { const el = document.getElementById(id); if (el) o[id] = el.value; });
  try { localStorage.setItem('spraycan_settings', JSON.stringify(o)); } catch {}
}
function loadSettings() {
  try {
    const o = JSON.parse(localStorage.getItem('spraycan_settings') || '{}');
    PERSIST_IDS.forEach(id => { const el = document.getElementById(id); if (el && o[id] != null) el.value = o[id]; });
  } catch {}
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
    recomputeAll().catch(err => fail('Error: ' + err.message));
  }
  ready('Settings reset to defaults.');
}

// Reset just ONE section's controls to their defaults, then recompute. The
// Layers section keeps the chosen layer COUNT (only the other controls reset).
function resetSection(grp) {
  const layersEl = grp.querySelector('#layers');
  grp.querySelectorAll('[data-param]').forEach(el => {
    if (el.id === 'layers') return;              // keep the current number of layers/colours
    if (!(el.id in DEFAULTS)) return;
    if (el.type === 'checkbox') el.checked = DEFAULTS[el.id]; else el.value = DEFAULTS[el.id];
  });
  reflectValues(els.root);
  syncRemoveBgBtn();
  if (!state.img) { ready('Section reset to defaults.'); return; }
  state.params = mergeParams();
  editor.defaultWidth = bridgeWidthPx();
  if (layersEl) {                                // re-derive tones for the (kept) layer count
    state.params.thresholds = [];
    reGray();
    renderThresholds(els.thresholds, state.params.thresholds, onThreshold);
  } else {
    reGray();
  }
  recomputeAll().catch(err => fail('Error: ' + err.message));
  ready('Section reset to defaults.');
}

// Apply a preset: reset the look to a clean baseline, then layer the preset's
// control values on top, then recompute (background removal handles its own).
async function applyPreset(id) {
  const preset = PRESETS[id] || PRESETS.photo;
  state.presetId = PRESETS[id] ? id : 'photo';   // drives face-aware highlight protection
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
  const gen = genToken;
  try {
    reGray();
    if (gen !== genToken) return;   // a newer image arrived during setup
    renderThresholds(els.thresholds, state.params.thresholds, onThreshold);
    if (state.params.removeBg) await toggleBackground();
    else await recomputeAll();
  } catch (e) { console.error(e); fail('Could not apply preset: ' + e.message); }
}

// Resolve the preset to apply for the current image: an explicit choice, or
// auto-pick from a quick neutral probe of the image when the select is on "Auto".
function setPresetReason(text) { if (els.presetReason) els.presetReason.textContent = text || ''; }

async function pickPresetForImage(img) {
  const sel = els.preset ? els.preset.value : 'auto';
  if (sel !== 'auto') { if (els.preset) els.preset.title = ''; setPresetReason(''); return sel; }
  // Cheap colour/tone stats are always available (logo signal + offline fallback).
  const probe = imageToGray(img, { maxResolution: 360, autoLevels: false, smooth: 0 });
  const aspect = (img.naturalWidth || img.width) / (img.naturalHeight || img.height || 1);
  const stats = imageStats(probe, aspect);
  Object.assign(stats, colorStatsForImage(img, 360)); // skin / sky / foliage / saturation
  // Prefer on-device ML recognition (generalises to any image); fall back to the heuristic.
  try {
    const { classifyImage } = await import('./classify.js');
    busy('Analysing image with on-device AI (first run downloads ~20 MB, then cached)…');
    const ml = await classifyImage(img);
    if (ml) {
      const id = presetFromSignals({ ...stats, faces: ml.faces, faceArea: ml.faceArea, faceConf: ml.faceConf, scene: ml.scene, animal: ml.animal, hasObject: ml.hasObject });
      const top1 = ((ml.top && ml.top[0] && ml.top[0].className) || '').split(',')[0];
      const why = id === 'portrait' ? 'face detected'
        : id === 'landscape' ? (ml.scene ? (ml.sceneName || 'scene') : ml.animal ? `${top1} in scene` : 'scene')
        : (id === 'subject' && top1) ? top1
        : '';
      const label = (PRESETS[id]?.label || id) + (why ? ` — ${why}` : '');
      if (els.preset) els.preset.title = 'AI: ' + label;
      setPresetReason('AI · ' + label);
      return id;
    }
  } catch (e) { console.warn('Auto (AI) recognition unavailable — using the colour heuristic:', e); }
  const id = pickPreset(stats);
  if (els.preset) els.preset.title = 'Auto: ' + (PRESETS[id]?.label || id);
  setPresetReason('Auto · ' + (PRESETS[id]?.label || id));
  return id;
}

// Small colour (RGBA) probe → skin / sky / foliage / saturation signals for auto-pick.
function colorStatsForImage(img, max = 360) {
  try {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const s = Math.min(1, max / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * s)), h = Math.max(1, Math.round(ih * s));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    return analyzeColor(ctx.getImageData(0, 0, w, h).data, w, h);
  } catch { return {}; }
}

let previewTimer = 0;
const PREVIEW_IDS = new Set(['brightness', 'contrast', 'smooth', 'layers', 'minFeature', 'edgeAmount', 'bridgeWidth']);
const PREVIEW_MAX = 700; // working resolution for the live drag preview

function onInput(el) {
  reflectValues(els.root);
  if (!state.img || !PREVIEW_IDS.has(el.id)) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => runPreview(el.id), 110);
}

// Fast low-res recompute while a slider is dragged, so the result updates live.
// The full-res run on "change" (release) supersedes it via busyToken, and
// onChange cancels any still-pending preview so a stale low-res result can't win.
function runPreview(id) {
  if (!state.img) return;
  state.params = mergeParams();
  if (id === 'layers') state.params.thresholds = [];
  try {
    reGray({ maxResolution: Math.min(PREVIEW_MAX, state.params.maxResolution) });
    if (id === 'layers') renderThresholds(els.thresholds, state.params.thresholds, onThreshold);
    recomputeAll().catch(() => {});
  } catch { /* preview is best-effort */ }
}

async function onChange(el) {
  clearTimeout(previewTimer);            // cancel a pending low-res preview
  reflectValues(els.root);
  state.params = mergeParams();
  if (PERSIST_IDS.includes(el.id)) saveSettings();   // remember output/material prefs across visits
  if (!state.img) return;
  const stale = state.grayPreview;       // a drag preview may have left state at low resolution
  try {
    switch (el.id) {
      case 'brightness': case 'contrast': case 'invert': case 'maxResolution':
      case 'smooth': case 'autoLevels': case 'mirror': case 'vflip':
        reGray(); await recomputeAll(); break;
      case 'layers':
        reGray();                        // ensure full-res before sampling thresholds
        state.params.thresholds = autoThresholds(state.gray, state.params.layers);
        renderThresholds(els.thresholds, state.params.thresholds, onThreshold);
        await recomputeAll(); break;
      case 'minFeature':
      case 'bridgeMode':
      case 'keepHighlights':
      case 'edges':
      case 'edgeAmount':
        if (stale) reGray();             // restore full resolution after a preview
        await recomputeAll(); break;
      case 'detail':
        if (stale) { reGray(); await recomputeAll(); } else { await retraceAll(); }
        break;
      case 'material': {
        const m = MATERIALS[state.params.material] || MATERIALS.mylar;
        els.bridgeWidth.value = String(m.bridge); state.params.bridgeWidth = m.bridge;
        reflectValues(els.root); editor.defaultWidth = bridgeWidthPx();
        if (stale) reGray();
        await recomputeAll(); break;
      }
      case 'preset':
        await applyPreset(await pickPresetForImage(state.img)); break;
      case 'removeBg':
        await toggleBackground(); break;
      case 'bridgeWidth':
        editor.defaultWidth = bridgeWidthPx(); if (stale) reGray(); await recomputeAll(); break;
      case 'targetWidth': case 'unit':
        editor.defaultWidth = bridgeWidthPx(); updateDims(); updateCombined(); break;
    }
  } catch (err) { console.error(err); fail('Error: ' + err.message); }
}

function onThreshold(i, value) {
  if (!state.params) return;
  state.params.thresholds[i] = value;
  recomputeAll().catch(err => fail('Error: ' + err.message));
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

async function exportPerLayer() {
  if (!state.layers.length) return;
  const d = dims();
  busy('Packaging SVGs…'); await raf();
  try {
    await ensureZip();   // JSZip is loaded on first export, not at page load
    // One clean cut file per layer — nothing combined.
    const files = state.layers.map((layer, i) => ({
      name: `layer-${i + 1}.svg`,
      content: layerToSVG(layer.traced, d, { fill: state.colors[i], marks: marks() }),
    }));
    downloadBlob('stencil-svgs.zip', await makeZipBlob(files));
    ready(`Exported ${state.layers.length} per-layer SVG cut files (.zip).`);
  } catch (e) { console.error(e); fail('SVG export failed: ' + e.message); }
}

// Rasterise the stacked preview to a PNG — a shareable picture of the result
// (the SVG/PDF are the cut/print deliverables).
async function exportPngPreview() {
  if (!state.layers.length || !state.layers[0].traced) return;
  busy('Rendering preview image…'); await raf();
  try {
    const tw = state.layers[0].traced.width, th = state.layers[0].traced.height;
    const svg = combinedSVG(state.layers.map(l => l.traced), dims(), { colors: state.colors });
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('could not render the preview')); img.src = url; });
    const W = Math.min(1600, Math.max(800, tw)), H = Math.round(W * th / tw);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#16171a'; ctx.fillRect(0, 0, W, H);   // dark backdrop so light layers stay visible
    ctx.drawImage(img, 0, 0, W, H);
    URL.revokeObjectURL(url);
    await new Promise(r => c.toBlob(b => { if (b) { downloadBlob('spraycan-preview.png', b); ready('Preview image (PNG) exported.'); } else fail('Could not render the preview.'); r(); }, 'image/png'));
  } catch (e) { console.error(e); fail('Preview export failed: ' + e.message); }
}

async function exportPDF() {
  if (!state.layers.length) return;
  busy('Building PDF (this can take a moment)…'); await raf();
  try {
    await ensurePdfLibs();   // jsPDF + svg2pdf are loaded on first export, not at page load
    const pdf = await buildPDF(state.layers, state.colors, dims(), { pageSize: state.params.pageSize, marks: marks(), colorLabels: state.layers.map((_, i) => colorLabel(i)), margin: state.params.margin });
    pdf.save('stencil.pdf');
    ready('PDF exported.');
  } catch (e) { console.error(e); fail('PDF export failed: ' + e.message); }
}

// ---- image intake ---------------------------------------------------------
// Release the previous image's heavy buffers so memory doesn't creep across uploads.
function freeLayers() {
  for (const L of state.layers) { L.baseMask = L.workMask = L.floatingMask = L.traced = null; }
  state.layers = [];
  state.sampleData = null;
}

async function useImage(img) {
  const my = ++genToken;                     // new generation — supersedes any in-flight pipeline
  try { localStorage.setItem('spraycan_seen', '1'); } catch {}
  freeLayers();
  state.img = img;
  state.processedImg = null;
  state.active = 0;                          // new image → start at the first layer
  state.colors = []; state.colorNames = [];  // …and fresh default colours (don't carry the last image's)
  // Start from a tuned preset (auto-picked per image, or the user's explicit choice)
  // so the upload looks near-finished instead of starting from a generic default.
  const id = await pickPresetForImage(img);
  if (my !== genToken) return;               // a newer image arrived while analysing — drop this one
  await applyPreset(id);
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
  loadSettings();              // restore saved output/material prefs
  reflectValues(els.root);     // reflect restored values (e.g. the margin readout)
  if (!localStorage.getItem('spraycan_seen')) {
    const first = els.root.querySelector('details.group'); if (first) first.open = true; // first visit → open the Image section
  }
  setExportsEnabled(false);
  els.editor.style.display = 'none';   // no image yet → keep the empty placeholder centred
  bindControls(els.root, { onInput, onChange });
  els.root.querySelectorAll('input[type=range][data-param]').forEach(addSteppers);
  // Clicking a section "?" shows its tooltip but must not collapse the section.
  els.root.querySelectorAll('.help').forEach(h => h.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); }));
  // Per-section reset (↺): reset that section's controls only; don't toggle the section.
  els.root.querySelectorAll('.sec-reset').forEach(b => b.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    const grp = b.closest('details.group');
    if (grp) resetSection(grp);
  }));
  // Sections are independent: start closed, open as many as you like.
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
  els.srcPreview.addEventListener('click', e => {
    if (eyedropMode) { sampleFromSrcPreview(e); return; }  // eyedropper armed → sample the photo
    els.file.click();                                       // otherwise → click the preview to replace
  });
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
  if (els.undoBtn) els.undoBtn.addEventListener('click', undo);
  if (els.redoBtn) els.redoBtn.addEventListener('click', redo);

  els.exportSvg.addEventListener('click', exportPerLayer);
  els.exportPdf.addEventListener('click', exportPDF);
  if (els.exportPng) els.exportPng.addEventListener('click', exportPngPreview);

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
  if (els.exportPng) els.exportPng.addEventListener('click', () => toggleExportMenu(false));
  // Keyboard nav inside the open Export menu.
  els.exportMenu.querySelector('.menu-pop').addEventListener('keydown', e => {
    const items = [...els.exportMenu.querySelectorAll('.menu-pop button')];
    const idx = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); toggleExportMenu(false); els.exportBtn.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); (items[(idx + 1) % items.length] || items[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (items[(idx - 1 + items.length) % items.length] || items[0]).focus(); }
  });

  document.addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return;
    if (!state.layers.length) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
  });
}

init();

// Debug hook (handy for automated verification; harmless in production).
window.__sf = {
  get state() { return state; },
  get editor() { return editor; },
  bridgeWidthPx,
  buildPDF: async () => { await ensurePdfLibs(); return buildPDF(state.layers, state.colors, dims(), { pageSize: state.params.pageSize, marks: marks(), colorLabels: state.layers.map((_, i) => colorLabel(i)), margin: state.params.margin }); },
};
