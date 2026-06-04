// Spray-order guide: one chip per layer, in spray order (layer 1 = lightest,
// applied first). Each chip is a selector — click to make that layer active and
// edit its colour in the colour panel. The swatch + paint name are shown for
// at-a-glance reference.

export function renderGuide(container, layers, colors, colorNames, activeIndex, handlers) {
  container.innerHTML = '';
  layers.forEach((layer, i) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'guide-item' + (i === activeIndex ? ' active' : '');
    item.setAttribute('aria-current', i === activeIndex ? 'true' : 'false');

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = colors[i];

    const meta = document.createElement('div');
    meta.className = 'meta';
    const sub = colorNames[i] || `spray ${i + 1} of ${layers.length}`;
    meta.innerHTML = `<strong>Layer ${i + 1}</strong>`;
    const small = document.createElement('small');
    small.textContent = sub;
    meta.appendChild(small);

    item.append(swatch, meta);
    item.addEventListener('click', () => handlers.onSelect(i));
    container.appendChild(item);
  });
}
