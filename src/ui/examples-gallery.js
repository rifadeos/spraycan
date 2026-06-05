// The "try an example" gallery in the Image panel — canvas-drawn examples (no assets,
// offline) shown as before→after cards, clickable to load. Extracted from app.js to
// keep the controller lean; the app passes in its grid/preset element + helpers.

import { EXAMPLES } from '../examples.js';
import { fitSize } from '../image.js';
import { grayFromRGBA } from '../grayfilters.js';
import { buildMasks } from '../buildmasks.js';
import { autoThresholds } from '../posterize.js';
import { traceMaskToPaths } from '../trace.js';
import { combinedSVG } from '../exporters/svg.js';

// Render a small stencil preview (the card "after") at low resolution, reusing the
// pure pipeline functions. Returns an SVG string, '' on failure.
function stencilThumb(srcCanvas, defaultColors, maxRes = 200) {
  try {
    const { w, h } = fitSize(srcCanvas.width, srcCanvas.height, maxRes);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(srcCanvas, 0, 0, w, h);
    const gray = grayFromRGBA(ctx.getImageData(0, 0, w, h).data, w, h, { autoLevels: true });
    const { layers } = buildMasks(gray, autoThresholds(gray, 4), { minFeature: 1, bridgeMode: 'auto', bridgeWidthPx: 2, mmPerPx: 1, tieSpacingMm: 65 });
    const traced = layers.map(L => traceMaskToPaths(L.baseMask, { pathomit: 8, ltres: 1, qtres: 1 }));
    return combinedSVG(traced, { widthMm: w, heightMm: h, mmPerPx: 1 }, { colors: defaultColors(layers.length) }).replace(/^<\?xml[^>]*\?>\s*/, '');
  } catch { return ''; }
}

// Build the gallery into `grid`. opts: { grid, presetEl, defaultColors, raf, busy, fail, loadImage }.
// Each card shows the original (before) and crossfades to its stencil (after) on hover;
// clicking sets the preset + loads it. Thumbnails generate lazily (only when the Image
// panel is open), yielding between cards so they never block first interaction.
export function initExamplesGallery({ grid, presetEl, defaultColors, raf, busy, fail, loadImage }) {
  if (!grid) return;
  grid.innerHTML = '';
  const cards = EXAMPLES.map(ex => {
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'ex-card'; card.title = `Try the ${ex.label} example`;
    card.setAttribute('aria-label', `${ex.label} example — load a sample image and turn it into a stencil`);
    const thumb = document.createElement('span'); thumb.className = 'ex-thumb';
    const before = ex.draw(180); before.className = 'ex-before'; before.setAttribute('aria-hidden', 'true');
    const after = document.createElement('span'); after.className = 'ex-after';
    thumb.append(before, after);
    const name = document.createElement('span'); name.className = 'ex-name'; name.textContent = ex.label;
    card.append(thumb, name);
    card.addEventListener('click', () => {
      if (presetEl) presetEl.value = ex.preset;          // land on the intended route instantly (no ML guess)
      busy(`Loading ${ex.label} example…`);
      loadImage(ex.draw(600)).catch(err => fail('Example failed: ' + err.message));
    });
    grid.appendChild(card);
    return { ex, after };
  });
  let generated = false;
  const genThumbs = async () => {
    if (generated) return; generated = true;
    for (const { ex, after } of cards) {
      const svg = stencilThumb(ex.draw(360), defaultColors);
      if (svg) { after.innerHTML = svg; const n = after.querySelector('svg'); if (n) { n.removeAttribute('width'); n.removeAttribute('height'); } }
      await raf();   // yield between cards
    }
  };
  const grp = grid.closest('details.group');
  if (grp && !grp.open) grp.addEventListener('toggle', () => { if (grp.open) genThumbs(); });
  else setTimeout(genThumbs, 60);   // panel already open (first visit) → after first paint
}
