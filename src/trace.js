// Vectorize a binary mask into SVG path data using ImageTracer (loaded as a
// global by index.html). OPEN pixels become filled black shapes; their traced
// outlines are exactly the cut paths (holes/bridges come through as subpaths).
// Coordinates stay in working pixels — the SVG viewBox maps them to mm.

const TRACE_DEFAULTS = {
  ltres: 1, qtres: 1, pathomit: 2, rightangleenhance: true,
  colorsampling: 0, numberofcolors: 2, mincolorratio: 0, colorquantcycles: 1,
  blurradius: 0, strokewidth: 0, linefilter: false, roundcoords: 2,
  pal: [{ r: 0, g: 0, b: 0, a: 255 }, { r: 255, g: 255, b: 255, a: 255 }],
};

function maskToImageData(mask) {
  const { width, height, data } = mask;
  const id = new ImageData(width, height);
  const d = id.data;
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    const v = data[i] === 1 ? 0 : 255; // OPEN -> black, MATERIAL -> white
    d[p] = v; d[p + 1] = v; d[p + 2] = v; d[p + 3] = 255;
  }
  return id;
}

function round2(n) { return Math.round(n * 100) / 100; }

function segmentsToD(segments) {
  if (!segments.length) return '';
  let s = `M ${round2(segments[0].x1)} ${round2(segments[0].y1)} `;
  for (const seg of segments) {
    s += `${seg.type} ${round2(seg.x2)} ${round2(seg.y2)} `;
    if (seg.x3 !== undefined) s += `${round2(seg.x3)} ${round2(seg.y3)} `;
  }
  return s + 'Z';
}

// Returns { paths:[dString...], width, height } for the OPEN (black) regions.
export function traceMaskToPaths(mask, options = {}) {
  if (typeof ImageTracer === 'undefined') throw new Error('ImageTracer not loaded');
  const opts = { ...TRACE_DEFAULTS, ...options };
  const td = ImageTracer.imagedataToTracedata(maskToImageData(mask), opts);

  // Pick the darkest palette entry = the OPEN regions.
  let best = 0, bestLum = Infinity;
  for (let i = 0; i < td.palette.length; i++) {
    const c = td.palette[i];
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    if (c.a >= 128 && lum < bestLum) { bestLum = lum; best = i; }
  }

  const layer = td.layers[best] || [];
  const paths = [];
  for (const smp of layer) {
    const d = segmentsToD(smp.segments);
    if (d) paths.push(d);
  }
  return { paths, width: mask.width, height: mask.height };
}
