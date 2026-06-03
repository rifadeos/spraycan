// Reads the control panel into a params object and wires change handlers.
// "input" events update labels live; the expensive recompute runs on "change"
// (slider release / select change) so dragging a slider stays smooth.

export function readParams(root) {
  const g = id => root.querySelector('#' + id);
  return {
    layers: +g('layers').value,
    minFeature: +g('minFeature').value,
    bridgeWidth: +g('bridgeWidth').value, // mm
    bridgeMode: g('bridgeMode').value,    // 'auto' | 'none'
    material: g('material').value,        // mylar | vinyl | card | laser
    targetWidth: +g('targetWidth').value,
    unit: g('unit').value,
    pageSize: g('pageSize').value,
    margin: +g('margin').value,           // mm (PDF)
    overlap: +g('overlap').value,         // mm (PDF tiling)
    brightness: +g('brightness').value,
    contrast: +g('contrast').value,
    invert: g('invert').checked,
    mirror: g('mirror').checked,
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
    if (out) out.textContent = el.value;
  });
}

export function bindControls(root, { onInput, onChange }) {
  root.querySelectorAll('[data-param]').forEach(el => {
    el.addEventListener('input', () => onInput(el));
    el.addEventListener('change', () => onChange(el));
  });
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
    container.appendChild(row);
  });
}
