// Main-thread client for the on-device "Auto" recogniser. The heavy work — loading
// TF.js + the BlazeFace / MobileNet models and running inference — happens in
// classify.worker.js so it never blocks the UI thread (the first Auto upload used to
// freeze for tens of seconds while the models initialised). Here we just downscale the
// image off-thread (createImageBitmap), hand the pixels to the worker, and await the
// signals. classifyImage() keeps its old signature + throw-on-failure contract, so the
// callers' existing try/catch still falls back to the colour heuristic. The image is
// only ever passed to a same-origin worker — it is never uploaded.

let _worker = null, _broken = false, _reqId = 0;
const _pending = new Map();

function getWorker() {
  if (_broken) return null;
  if (_worker) return _worker;
  try {
    _worker = new Worker(new URL('./classify.worker.js', import.meta.url), { type: 'module' });
    // A dead worker (failed to load, OOM, or an undeserializable message) permanently
    // drops Auto back to the colour heuristic and rejects anything in flight, so a
    // request can never hang unsettled.
    const fail = (msg) => {
      _broken = true;
      for (const [, r] of _pending) r.reject(new Error(msg));
      _pending.clear();
      try { _worker.terminate(); } catch {}
      _worker = null;
    };
    _worker.onmessage = (e) => {
      const r = _pending.get(e.data.id);
      if (!r) return;
      _pending.delete(e.data.id);
      if (e.data.ok) r.resolve(e.data.ml);
      else r.reject(new Error(e.data.error || 'classify failed'));
    };
    _worker.onerror = () => fail('classify worker error');
    _worker.onmessageerror = () => fail('classify worker message error');
  } catch { _broken = true; _worker = null; }
  return _worker;
}

// Cap the long edge at 512px — createImageBitmap does the decode + resize off the main
// thread, so even preparing the input doesn't jank the UI.
function toBitmap(img, maxEdge = 512) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const long = Math.max(iw, ih);
  const s = long > maxEdge ? maxEdge / long : 1;
  const w = Math.max(1, Math.round(iw * s)), h = Math.max(1, Math.round(ih * s));
  return createImageBitmap(img, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
}

// Returns ML signals { faces, faceArea, faceConf, scene, sceneName, animal, hasObject, top },
// or throws if the worker / models can't load — the caller falls back to the colour heuristic.
export async function classifyImage(img) {
  const w = getWorker();
  if (!w) throw new Error('classify worker unavailable');
  const bitmap = await toBitmap(img);
  const id = ++_reqId;
  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    try { w.postMessage({ id, bitmap }, [bitmap]); }
    catch (e) { _pending.delete(id); reject(e); }
  });
}
