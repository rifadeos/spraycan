// Per-layer colour editor for the ACTIVE layer: shows the current colour + paint
// name, a native picker, a hex field, and brand swatch grids to pick from.
// Built once; setColorPanelValue() reflects whichever layer is selected.

import { PALETTE_DISCLAIMER } from '../palettes.js';

let cb = null;        // onPick(hex, name)
let ui = null;        // cached sub-elements
let palettes = [];
let activeBrand = 0;

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

export function buildColorPanel(container, opts) {
  cb = opts.onPick;
  palettes = opts.palettes;
  activeBrand = 0;
  container.innerHTML = '';

  const head = el('div', 'cp-head', 'Layer colour');

  const current = el('div', 'cp-current');
  const swatch = el('span', 'cp-swatch');
  const labels = el('div', 'cp-labels');
  const nameEl = el('strong', null, '—');
  const hexEl = el('small', null, '');
  const nearestEl = el('small', 'cp-nearest', '');
  labels.append(nameEl, hexEl, nearestEl);
  current.append(swatch, labels);

  const controls = el('div', 'cp-controls');
  const picker = document.createElement('input');
  picker.type = 'color'; picker.value = '#000000'; picker.title = 'Custom colour';
  const hexInput = document.createElement('input');
  hexInput.type = 'text'; hexInput.className = 'cp-hex'; hexInput.placeholder = '#rrggbb';
  hexInput.spellcheck = false; hexInput.maxLength = 7;
  const brand = document.createElement('select');
  brand.className = 'cp-brand';
  palettes.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = String(i); o.textContent = p.label;
    brand.appendChild(o);
  });
  const eye = document.createElement('button');
  eye.type = 'button'; eye.className = 'cp-eye'; eye.textContent = '⦿ Pick from image';
  eye.title = 'Sample a colour straight from your photo';
  eye.addEventListener('click', () => opts.onPickFromImage && opts.onPickFromImage());
  controls.append(picker, hexInput, brand, eye);

  const grid = el('div', 'cp-grid');
  const note = el('p', 'cp-note', PALETTE_DISCLAIMER);

  container.append(head, current, controls, grid, note);
  ui = { swatch, nameEl, hexEl, nearestEl, picker, hexInput, brand, grid };

  picker.addEventListener('input', () => cb && cb(picker.value, null));
  hexInput.addEventListener('change', () => {
    if (HEX_RE.test(hexInput.value)) {
      const v = hexInput.value[0] === '#' ? hexInput.value : '#' + hexInput.value;
      cb && cb(v.toLowerCase(), null);
    } else {
      hexInput.value = ui.hexEl.textContent; // revert invalid input
    }
  });
  brand.addEventListener('change', () => { activeBrand = +brand.value; renderGrid(); });

  renderGrid();
}

function renderGrid() {
  if (!ui) return;
  ui.grid.innerHTML = '';
  const colors = palettes[activeBrand]?.colors || [];
  for (const c of colors) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cp-chip'; b.style.background = c.hex;
    b.title = `${c.name} (${c.hex})`;
    b.addEventListener('click', () => cb && cb(c.hex, c.name));
    ui.grid.appendChild(b);
  }
}

export function setColorPanelValue(hex, name, nearest) {
  if (!ui) return;
  ui.swatch.style.background = hex || '#000';
  ui.nameEl.textContent = name || 'Custom';
  ui.hexEl.textContent = hex || '';
  ui.nearestEl.textContent = (!name && nearest) ? `≈ closest can: ${nearest}` : '';
  if (hex) { ui.picker.value = hex; ui.hexInput.value = hex; }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
