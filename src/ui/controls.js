// Reads the control panel into a params object and wires change handlers.
// "input" events update labels live; the expensive recompute runs on "change"
// (slider release / select change) so dragging a slider stays smooth.

export function readParams(root) {
  const g = id => root.querySelector('#' + id);
  return {
    preset: g('preset').value,            // auto | photo | portrait | subject | poster | lineart | logo
    layers: +g('layers').value,
    minFeature: +g('minFeature').value,
    bridgeWidth: +g('bridgeWidth').value, // mm
    bridgeMode: g('bridgeMode').value,    // 'auto' | 'none'
    material: g('material').value,        // mylar | vinyl | card | laser
    targetWidth: +g('targetWidth').value,
    unit: g('unit').value,
    pageSize: g('pageSize').value,
    margin: +g('margin').value,           // mm (PDF page border)
    brightness: +g('brightness').value,
    contrast: +g('contrast').value,
    invert: g('invert').checked,
    mirror: g('mirror').checked,
    vflip: g('vflip').checked,
    smooth: +g('smooth').value,
    detail: +g('detail').value,
    autoLevels: g('autoLevels').checked,
    keepHighlights: g('keepHighlights').checked,
    edges: g('edges').checked,
    edgeAmount: +g('edgeAmount').value,
    removeBg: g('removeBg').checked,
    maxResolution: +g('maxResolution').value,
    thresholds: [], // filled by app from the dynamic sliders
  };
}

export function reflectValues(root) {
  root.querySelectorAll('input[type=range][data-param]').forEach(el => {
    const out = root.querySelector(`[data-out="${el.id}"]`);
    if (!out) return;
    if (out.tagName === 'INPUT') { if (out !== document.activeElement) out.value = el.value; }
    else out.textContent = el.value;
  });
}

export function bindControls(root, { onInput, onChange }) {
  root.querySelectorAll('[data-param]').forEach(el => {
    el.addEventListener('input', () => onInput(el));
    el.addEventListener('change', () => onChange(el));
  });
}

// Wrap a range input with − / + stepper buttons (Illustrator-style precise nudge).
export function addSteppers(range) {
  if (!range || range.dataset.stepped) return;
  range.dataset.stepped = '1';
  const step = +range.step || 1;
  const bump = d => {
    const v = Math.max(+range.min, Math.min(+range.max, +range.value + d * step));
    if (v === +range.value) return;
    range.value = String(v);
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const mk = (txt, d) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'step'; b.textContent = txt; b.tabIndex = -1;
    b.addEventListener('click', () => bump(d));
    return b;
  };
  const wrap = document.createElement('div');
  wrap.className = 'range-wrap';
  range.replaceWith(wrap);
  wrap.append(mk('−', -1), range, mk('+', 1));

  // Make the value readout an editable number field — type a value or clear to 0.
  const out = document.querySelector(`[data-out="${range.id}"]`);
  if (out && out.tagName !== 'INPUT') {
    const num = document.createElement('input');
    num.type = 'number'; num.className = out.className; num.setAttribute('data-out', range.id);
    num.min = range.min; num.max = range.max; num.step = range.step || '1'; num.value = range.value;
    out.replaceWith(num);
    const commit = () => {
      let v = +num.value; if (Number.isNaN(v)) v = +range.min || 0;
      v = Math.max(+range.min, Math.min(+range.max, v));
      num.value = String(v); range.value = String(v);
      range.dispatchEvent(new Event('input', { bubbles: true }));
      range.dispatchEvent(new Event('change', { bubbles: true }));
    };
    num.addEventListener('change', commit);
    num.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); num.blur(); } });
  }
}

// Dynamic per-tone threshold sliders (count follows the layer count).
export function renderThresholds(container, thresholds, onInput) {
  container.innerHTML = '';
  thresholds.forEach((t, i) => {
    const row = document.createElement('label');
    row.className = 'trow';
    row.innerHTML = `<span>Tone ${i + 1}</span>`;
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = '0'; slider.max = '255'; slider.value = String(t);
    const val = document.createElement('span');
    val.className = 'tval'; val.textContent = String(t);
    slider.addEventListener('input', () => { val.textContent = slider.value; });
    slider.addEventListener('change', () => onInput(i, +slider.value));
    row.append(slider, val);
    addSteppers(slider);
    container.appendChild(row);
  });
}
