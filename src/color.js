// Resolve any CSS colour string to RGB / #rrggbb via a 1px canvas, so we can
// feed jsPDF (needs RGB) and emit hex into export SVGs (max compatibility).

export function toRgb(color) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

export function toHex(color) {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  const [r, g, b] = toRgb(color);
  return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
}
