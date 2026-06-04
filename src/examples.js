// Built-in example images so the tool can be tried without uploading a file.
// Each is drawn on a <canvas> (which doubles as an <img> source) — no external
// assets, works offline, license-clean — and each one demonstrates a different
// preset/route so the gallery doubles as a tour of what SprayCan does.

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

// Stylised head-and-shoulders with warm skin tones → Portrait route.
function drawPortrait(size = 600) {
  const c = makeCanvas(size), x = c.getContext('2d'), S = v => v * size / 600;
  const bg = x.createLinearGradient(0, 0, 0, size); bg.addColorStop(0, '#efe9e0'); bg.addColorStop(1, '#dcd3c6');
  x.fillStyle = bg; x.fillRect(0, 0, size, size);
  const cx = size / 2;
  // shoulders
  x.fillStyle = '#3b4a5a';
  x.beginPath(); x.moveTo(S(80), size); x.quadraticCurveTo(S(120), S(440), S(230), S(420));
  x.lineTo(S(370), S(420)); x.quadraticCurveTo(S(480), S(440), S(520), size); x.closePath(); x.fill();
  // neck
  x.fillStyle = '#bd8b6a'; x.fillRect(cx - S(45), S(355), S(90), S(95));
  // head (skin) with volume
  const skin = x.createRadialGradient(cx - S(35), S(245), S(20), cx, S(265), S(195));
  skin.addColorStop(0, '#e8c4a2'); skin.addColorStop(1, '#b6815d');
  x.fillStyle = skin; x.beginPath(); x.ellipse(cx, S(255), S(140), S(178), 0, 0, Math.PI * 2); x.fill();
  // hair
  x.fillStyle = '#241c17';
  x.beginPath(); x.moveTo(cx - S(150), S(255));
  x.quadraticCurveTo(cx - S(165), S(70), cx, S(78)); x.quadraticCurveTo(cx + S(165), S(70), cx + S(150), S(255));
  x.quadraticCurveTo(cx + S(120), S(150), cx, S(140)); x.quadraticCurveTo(cx - S(120), S(150), cx - S(150), S(255));
  x.closePath(); x.fill();
  // eyes
  x.fillStyle = '#2a211b';
  x.beginPath(); x.ellipse(cx - S(56), S(250), S(23), S(13), 0, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.ellipse(cx + S(56), S(250), S(23), S(13), 0, 0, Math.PI * 2); x.fill();
  // brows
  x.strokeStyle = '#2a211b'; x.lineWidth = S(9); x.lineCap = 'round';
  x.beginPath(); x.moveTo(cx - S(84), S(224)); x.quadraticCurveTo(cx - S(56), S(212), cx - S(28), S(223)); x.stroke();
  x.beginPath(); x.moveTo(cx + S(28), S(223)); x.quadraticCurveTo(cx + S(56), S(212), cx + S(84), S(224)); x.stroke();
  // nose
  x.strokeStyle = 'rgba(120,80,55,0.55)'; x.lineWidth = S(10);
  x.beginPath(); x.moveTo(cx, S(258)); x.lineTo(cx - S(17), S(307)); x.quadraticCurveTo(cx, S(320), cx + S(15), S(307)); x.stroke();
  // mouth
  x.strokeStyle = '#7a3b34'; x.lineWidth = S(14);
  x.beginPath(); x.moveTo(cx - S(46), S(340)); x.quadraticCurveTo(cx, S(362), cx + S(46), S(340)); x.stroke();
  return c;
}

// Sky + sun + layered mountains → Landscape route.
function drawLandscape(size = 600) {
  const c = makeCanvas(size), x = c.getContext('2d'), S = v => v * size / 600;
  const sky = x.createLinearGradient(0, 0, 0, S(430)); sky.addColorStop(0, '#9ec7e8'); sky.addColorStop(1, '#eaf1f6');
  x.fillStyle = sky; x.fillRect(0, 0, size, size);
  x.fillStyle = '#fbe6a0'; x.beginPath(); x.arc(S(150), S(140), S(72), 0, Math.PI * 2); x.fill();   // sun
  // back range
  x.fillStyle = '#9aa8b2'; x.beginPath(); x.moveTo(0, S(330));
  x.lineTo(S(170), S(165)); x.lineTo(S(320), S(330)); x.lineTo(S(470), S(150)); x.lineTo(size, S(330));
  x.lineTo(size, size); x.lineTo(0, size); x.closePath(); x.fill();
  // front range (darker)
  x.fillStyle = '#3f4a52'; x.beginPath(); x.moveTo(0, size);
  x.lineTo(S(180), S(330)); x.lineTo(S(330), S(470)); x.lineTo(S(520), S(300)); x.lineTo(size, size); x.closePath(); x.fill();
  // snow caps
  x.fillStyle = '#eef3f5';
  x.beginPath(); x.moveTo(S(180), S(330)); x.lineTo(S(152), S(382)); x.lineTo(S(212), S(382)); x.closePath(); x.fill();
  x.beginPath(); x.moveTo(S(520), S(300)); x.lineTo(S(486), S(356)); x.lineTo(S(560), S(356)); x.closePath(); x.fill();
  return c;
}

// Bold high-contrast star → Logo / poster route.
function drawLogo(size = 600) {
  const c = makeCanvas(size), x = c.getContext('2d'), cx = size / 2, cy = size / 2, R = size * 0.38, r = size * 0.16;
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, size, size);
  x.fillStyle = '#141414'; x.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 === 0 ? R : r;
    const px = cx + Math.cos(ang) * rad, py = cy + Math.sin(ang) * rad;
    i === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
  }
  x.closePath(); x.fill();
  return c;
}

// Concentric tones with an enclosed centre dot — the classic islands/bridges demo.
function drawRings(size = 600) {
  const c = makeCanvas(size), x = c.getContext('2d'), S = v => v * size / 600;
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, size, size);
  const disc = (r, color) => { x.fillStyle = color; x.beginPath(); x.arc(size / 2, size / 2, S(r), 0, Math.PI * 2); x.fill(); };
  disc(250, '#111111'); disc(200, '#ffffff'); disc(150, '#777777'); disc(95, '#ffffff'); disc(48, '#111111');
  return c;
}

// `preset` is applied before loading so each example lands on its intended route
// instantly (no ML download / guessing); the user can switch to Auto for their own photos.
// Note: presets are chosen to load instantly & offline (no background-removal /
// AI model downloads). The examples are drawn on clean backgrounds, so the Photo
// route gives the portrait a clean multi-tone face stencil without isolation.
export const EXAMPLES = [
  { id: 'portrait',  label: 'Portrait',  preset: 'photo',     draw: drawPortrait },
  { id: 'landscape', label: 'Landscape', preset: 'landscape', draw: drawLandscape },
  { id: 'logo',      label: 'Logo',      preset: 'logo',      draw: drawLogo },
  { id: 'rings',     label: 'Rings',     preset: 'photo',     draw: drawRings },
];
