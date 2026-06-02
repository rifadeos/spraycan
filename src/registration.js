// Registration marks: identical crosshairs on every layer so the physical cut
// sheets can be stacked in perfect alignment. Positions are in working pixels.

export function cornerMarks(width, height, opts = {}) {
  const size = opts.size ?? Math.max(8, Math.round(Math.min(width, height) * 0.04));
  const inset = (opts.inset ?? size) + size / 2;
  return [
    { x: inset, y: inset, size },
    { x: width - inset, y: inset, size },
    { x: inset, y: height - inset, size },
    { x: width - inset, y: height - inset, size },
  ];
}

// SVG fragment (crosshair + ring) for one mark, drawn in pixel coords.
export function markToSVG(m, strokeWidth = 0.4) {
  const r = m.size / 2;
  return (
    `<circle cx="${m.x}" cy="${m.y}" r="${r}" />` +
    `<line x1="${m.x - m.size}" y1="${m.y}" x2="${m.x + m.size}" y2="${m.y}" />` +
    `<line x1="${m.x}" y1="${m.y - m.size}" x2="${m.x}" y2="${m.y + m.size}" />`
  );
}
