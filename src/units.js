// Physical-unit helpers. Everything downstream works in millimetres.

export function toMm(value, unit) {
  switch (unit) {
    case 'cm': return value * 10;
    case 'in': return value * 25.4;
    case 'mm':
    default: return value;
  }
}

export function fromMm(mm, unit) {
  switch (unit) {
    case 'cm': return mm / 10;
    case 'in': return mm / 25.4;
    case 'mm':
    default: return mm;
  }
}

// Given a working raster size and a target physical width, return the
// physical dimensions (mm) preserving aspect ratio, plus mm-per-pixel.
export function physicalSize(pixelWidth, pixelHeight, targetWidthMm) {
  const mmPerPx = targetWidthMm / pixelWidth;
  return { widthMm: targetWidthMm, heightMm: pixelHeight * mmPerPx, mmPerPx };
}
