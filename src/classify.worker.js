// Off-main-thread image recognition for the "Auto" preset. Loads TF.js + BlazeFace
// (faces → Portrait) + MobileNet (scene / object → Landscape / Subject) and runs the
// inference INSIDE this worker, so the first Auto upload no longer freezes the UI thread
// while the models download + initialise. The image arrives as an already-downscaled,
// transferred ImageBitmap; only small numeric signals are posted back — the image itself
// never leaves the device.
//
// The three CDN bundles are UMD (not ES modules), so we can't `import` them here. Instead
// we fetch each one, verify its bytes against the same pinned SHA-384 the old
// <script integrity> used — Subresource-Integrity equivalent, so a CDN compromise still
// can't run unexpected code — then indirect-eval it so its UMD wrapper attaches its global
// (self.tf / self.blazeface / self.mobilenet). Indirect eval needs script-src 'unsafe-eval',
// which the page CSP already grants; the model-weight hosts are already in connect-src.

const TF = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
const TF_SRI = 'sha384-vE8hbVJ4lezako5rlvE7bY0BVzWlFhZncPlckrqNwcUQpVtgbENTgZ8TBbnPjZre';
const BLAZEFACE = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/blazeface@0.0.7/dist/blazeface.min.js';
const BLAZEFACE_SRI = 'sha384-pmFVRqTsqHmtuLJVyzlEVoLnr2CAevVBYX7slpnjib4g66wM8zJV8i/0EL6U2PIk';
const MOBILENET = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js';
const MOBILENET_SRI = 'sha384-oBAqwJ0tv9zzKlbIZyBhhXlEvU/PMrSMqDyOHlEZVC8xWHx4yPySuS7vRikRcYFq';

const SHA = { sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' };

// Fetch a script, verify its bytes against `sri` ("sha384-…"), then run it in the global
// scope so its UMD wrapper attaches to `self`. Throws on a fetch error or hash mismatch —
// the caller turns any throw into a silent fall-back to the colour heuristic.
async function loadVerified(url, sri) {
  const res = await fetch(url, { credentials: 'omit', mode: 'cors' });
  if (!res.ok) throw new Error('fetch ' + res.status + ' ' + url);
  const buf = await res.arrayBuffer();
  const dash = sri.indexOf('-');
  const algo = SHA[sri.slice(0, dash)];
  if (!algo) throw new Error('unknown SRI algorithm: ' + sri);
  const digest = new Uint8Array(await crypto.subtle.digest(algo, buf));
  let bin = '';
  for (let i = 0; i < digest.length; i++) bin += String.fromCharCode(digest[i]);
  if (btoa(bin) !== sri.slice(dash + 1)) throw new Error('SRI mismatch: ' + url);
  (0, eval)(new TextDecoder().decode(buf));   // indirect eval → global scope (UMD sets self.*)
}

// Load TF + both models once; a failed attempt is cleared so the next image can retry.
let modelsP = null;
function load() {
  return modelsP || (modelsP = (async () => {
    await loadVerified(TF, TF_SRI);
    if (!self.tf) throw new Error('tfjs unavailable');
    await self.tf.ready();
    await loadVerified(BLAZEFACE, BLAZEFACE_SRI);
    await loadVerified(MOBILENET, MOBILENET_SRI);
    if (!self.blazeface || !self.mobilenet) throw new Error('models unavailable');
    const [face, net] = await Promise.all([
      self.blazeface.load(),
      self.mobilenet.load({ version: 2, alpha: 1.0 }),
    ]);
    return { face, net };
  })().catch((e) => { modelsP = null; throw e; }));
}

// MobileNet (ImageNet) class-name fragments that mean "outdoor scene" → Landscape.
const SCENE = [
  'alp', 'volcano', 'valley', 'cliff', 'promontory', 'lakeside', 'lakeshore', 'seashore',
  'sandbar', 'geyser', 'coral reef', 'mountain', 'snow', 'megalith', 'dam', 'breakwater',
  'rapeseed', 'hay', 'barn', 'boathouse', 'castle', 'cliff dwelling', 'valley',
];

// MobileNet class fragments that mean "an animal". A wild animal in a wide frame is
// usually a scene to keep (→ landscape) rather than a subject to cut out.
const ANIMAL = [
  'dog', 'hound', 'terrier', 'retriever', 'spaniel', 'poodle', 'cat', 'tabby', 'lion', 'tiger',
  'leopard', 'cheetah', 'jaguar', 'lynx', 'cougar', 'puma', 'wolf', 'fox', 'coyote', 'hyena',
  'bear', 'panda', 'elephant', 'zebra', 'giraffe', 'antelope', 'gazelle', 'impala', 'hartebeest',
  'bison', 'ox', 'ram', 'bighorn', 'ibex', 'hog', 'boar', 'warthog', 'hippopotamus', 'rhinoceros',
  'monkey', 'ape', 'gorilla', 'chimpanzee', 'baboon', 'lemur', 'kangaroo', 'wallaby', 'koala',
  'sloth', 'otter', 'beaver', 'badger', 'weasel', 'mongoose', 'meerkat', 'hare', 'rabbit',
  'squirrel', 'marmot', 'deer', 'elk', 'moose', 'camel', 'llama', 'horse', 'eagle', 'hawk', 'owl',
  'vulture', 'flamingo', 'pelican', 'stork', 'crane', 'heron', 'peacock', 'ostrich', 'penguin',
  'goose', 'swan', 'parrot', 'toucan', 'snake', 'lizard', 'iguana', 'crocodile', 'alligator',
  'turtle', 'frog', 'shark', 'whale', 'dolphin', 'seal', 'sea lion', 'gibbon', 'orangutan',
];

// ImageBitmap (already ≤512px on its long edge) → the ML signal bundle the presets use.
// Same logic + thresholds as the old main-thread classifyImage, just fed ImageData (which
// tf.browser.fromPixels accepts in a worker) drawn from the bitmap via OffscreenCanvas.
async function classify(bitmap) {
  const { face, net } = await load();
  const w = bitmap.width, h = bitmap.height, area = (w * h) || 1;
  const oc = new OffscreenCanvas(w, h);
  const ctx = oc.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const px = ctx.getImageData(0, 0, w, h);

  let raw = [];
  try { raw = await face.estimateFaces(px, false); } catch { raw = []; }
  // Track the most prominent face + its confidence. BlazeFace weakly fires on circular
  // patterns, so the caller combines confidence + size + skin to decide.
  let faceArea = 0, faceConf = 0, faces = 0;
  for (const f of (raw || [])) {
    const tl = f.topLeft, br = f.bottomRight;
    if (!tl || !br) continue;
    const p = Array.isArray(f.probability) ? f.probability[0] : (f.probability ?? 1);
    const a = ((br[0] - tl[0]) * (br[1] - tl[1])) / area;
    if (a < 0.02 || p < 0.5) continue;            // ignore tiny / very-low-confidence noise
    faces++;
    if (a > faceArea) { faceArea = a; faceConf = p; }
  }

  let top = [];
  try { top = await net.classify(px, 5); } catch { top = []; }
  const names = (top || []).map((t) => (t.className || '').toLowerCase());
  const sceneHit = names.find((n) => SCENE.some((s) => n.includes(s)));
  const animal = names.length > 0 && ANIMAL.some((a) => names[0].includes(a)); // top-1 is an animal

  return {
    faces, faceArea, faceConf,
    scene: !!sceneHit, sceneName: sceneHit ? sceneHit.split(',')[0] : '',
    animal,
    hasObject: (top || []).length > 0,
    top: top || [],
  };
}

self.onmessage = async (e) => {
  const { id, bitmap } = e.data || {};
  try {
    const ml = await classify(bitmap);
    self.postMessage({ id, ok: true, ml });
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err && err.message) || String(err) });
  } finally {
    try { if (bitmap && bitmap.close) bitmap.close(); } catch {}
  }
};
