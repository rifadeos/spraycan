// OPTIONAL cloud step. Ask Gemini ("Nano Banana", gemini-2.5-flash-image) to
// redraw the photo as a clean, flat, high-contrast stencil-ready image, which the
// local pipeline then traces. Uses the user's own Google AI Studio API key, which
// is stored only in their browser (localStorage) and sent with the request to
// Google. Lazy-loaded so the app stays fully local/offline unless this is used.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';

function imgToBase64(img, maxSide = 1024) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const s = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  c.getContext('2d').drawImage(img, 0, 0, cw, ch);
  return c.toDataURL('image/png').split(',')[1];
}

function loadImage(dataUrl) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('Gemini returned an image that could not be decoded.'));
    im.src = dataUrl;
  });
}

// Returns an HTMLImageElement of the simplified result. Throws on any failure.
export async function aiSimplify(img, { apiKey, model = 'gemini-2.5-flash-image', layers = 4 } = {}) {
  if (!apiKey) throw new Error('No Gemini API key.');
  const prompt =
    `Redraw this photo as a clean, high-contrast spray-paint STENCIL reference using about ${layers} flat tones and NO gradients: ` +
    `bold solid regions, smooth simplified edges, strong figure/ground separation, and remove fine noisy texture (grass, fur, skin pores, fabric weave). ` +
    `Preserve the subject's overall shape, pose and recognisable features, and keep the same framing and aspect ratio. Output only the image.`;
  const body = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/png', data: imgToBase64(img) } }] }],
  };
  let r;
  try {
    r = await fetch(ENDPOINT + encodeURIComponent(model) + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error('Network error reaching Gemini (needs internet; the API may also block browser calls): ' + e.message);
  }
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try { const e = await r.json(); if (e?.error?.message) msg = e.error.message; } catch { /* keep status */ }
    throw new Error(msg);
  }
  const j = await r.json();
  const parts = j?.candidates?.[0]?.content?.parts || [];
  const inline = parts.map(p => p.inlineData || p.inline_data).find(Boolean);
  if (!inline?.data) {
    const txt = parts.find(p => p.text)?.text;
    throw new Error('Gemini did not return an image' + (txt ? `: ${txt.slice(0, 140)}` : '.'));
  }
  const mime = inline.mimeType || inline.mime_type || 'image/png';
  return loadImage(`data:${mime};base64,${inline.data}`);
}
