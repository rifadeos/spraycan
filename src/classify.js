// On-device image recognition for the "Auto" preset. Lazy-loads two small models
// from a CDN the first time (then the browser caches them): BlazeFace for face
// detection (→ Portrait, robust across skin tones/lighting/angle) and MobileNet
// for content/scene recognition (→ Landscape / object). Everything runs in the
// browser via TensorFlow.js — the image is never uploaded. If the models can't
// load (offline / blocked), classifyImage() throws and the caller falls back to
// the colour heuristic, so Auto always produces something.

import { loadScript } from './vendor.js';

const TF = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
const BLAZEFACE = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/blazeface@0.0.7/dist/blazeface.min.js';
const MOBILENET = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js';

let models = null;

async function load() {
  if (models) return models;
  await loadScript(TF);
  if (!window.tf) throw new Error('tfjs unavailable');
  await window.tf.ready();
  await loadScript(BLAZEFACE);
  await loadScript(MOBILENET);
  if (!window.blazeface || !window.mobilenet) throw new Error('models unavailable');
  const [face, net] = await Promise.all([
    window.blazeface.load(),
    window.mobilenet.load({ version: 2, alpha: 1.0 }),
  ]);
  models = { face, net };
  return models;
}

function toCanvas(img, maxEdge = 512) {
  let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const long = Math.max(w, h);
  if (long > maxEdge) { const s = maxEdge / long; w = Math.round(w * s); h = Math.round(h * s); }
  const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// MobileNet (ImageNet) class-name fragments that mean "outdoor scene" → Landscape.
const SCENE = [
  'alp', 'volcano', 'valley', 'cliff', 'promontory', 'lakeside', 'lakeshore', 'seashore',
  'sandbar', 'geyser', 'coral reef', 'mountain', 'snow', 'megalith', 'dam', 'breakwater',
  'rapeseed', 'hay', 'barn', 'boathouse', 'castle', 'cliff dwelling', 'valley',
];

// MobileNet class fragments that mean "an animal". A wild animal in a wide frame
// is usually a scene to keep (→ landscape) rather than a subject to cut out.
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

// Returns ML signals: { faces, faceArea (largest face as a fraction of the frame),
// scene, sceneName, hasObject, top }. Throws if the models can't load.
export async function classifyImage(img) {
  const { face, net } = await load();
  const c = toCanvas(img, 512);
  const area = (c.width * c.height) || 1;

  let raw = [];
  try { raw = await face.estimateFaces(c, false); } catch { raw = []; }
  // Track the most prominent face + its confidence. BlazeFace weakly fires on
  // circular patterns, so the caller combines confidence + size + skin to decide.
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
  try { top = await net.classify(c, 5); } catch { top = []; }
  const names = (top || []).map(t => (t.className || '').toLowerCase());
  const sceneHit = names.find(n => SCENE.some(s => n.includes(s)));
  const animal = names.length > 0 && ANIMAL.some(a => names[0].includes(a)); // top-1 is an animal

  return {
    faces, faceArea, faceConf,
    scene: !!sceneHit, sceneName: sceneHit ? sceneHit.split(',')[0] : '',
    animal,
    hasObject: (top || []).length > 0,
    top: top || [],
  };
}
