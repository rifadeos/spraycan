// Off-thread pipeline runner: owns the module Web Worker + its main-thread fallback.
// The heavy work (tone-map + posterise + morphology + island bridging + vector trace)
// runs in the worker; if one can't be created (old browser) or it errors, the very
// same pure functions run on the main thread — identical output, just on the UI thread.

import { grayFromRGBA, isFlatGray } from './grayfilters.js';
import { autoThresholds } from './posterize.js';
import { buildMasks } from './buildmasks.js';
import { traceBuilt } from './tracelayers.js';

let _worker = null, _workerBroken = false, _reqId = 0, _workerWarned = false;
const _pending = new Map();

// One-time console notice when we permanently drop to the main-thread pipeline (e.g. a
// worker OOM on a low-memory device) — drags get less smooth after this.
function noteWorkerFallback() {
  if (_workerWarned) return;
  _workerWarned = true;
  console.warn('SprayCan: off-thread pipeline worker unavailable — running on the main thread (drags may be less smooth). Reload to retry.');
}

export function getWorker() {
  if (_workerBroken) return null;
  if (_worker) return _worker;
  try {
    _worker = new Worker(new URL('./pipeline.worker.js', import.meta.url), { type: 'module' });
    _worker.onmessage = (e) => {
      const r = _pending.get(e.data.id);
      if (r) { _pending.delete(e.data.id); r.resolve(e.data); }
    };
    _worker.onerror = () => {                 // fall back permanently; reject anything in flight
      noteWorkerFallback();
      _workerBroken = true;
      for (const [, r] of _pending) r.reject(new Error('pipeline worker error'));
      _pending.clear();
      try { _worker.terminate(); } catch {}
      _worker = null;
    };
  } catch { noteWorkerFallback(); _workerBroken = true; _worker = null; }
  return _worker;
}

// Run a compute payload on the worker. Inputs are cloned (not transferred) so the main
// thread keeps its copies (state.gray / sampleData stay valid); the worker transfers
// results back. Assigns the request id used to match the response.
export function runOnWorker(payload) {
  const w = getWorker();
  if (!w) return Promise.reject(new Error('no worker'));
  payload.id = ++_reqId;
  return new Promise((resolve, reject) => {
    _pending.set(payload.id, { resolve, reject });
    try { w.postMessage(payload); } catch (e) { _pending.delete(payload.id); reject(e); }
  });
}

// Main-thread fallback: the identical pure functions, same result shape as the worker.
export function computeMainThread(payload) {
  const { w, h, rgba, grayData, gopts, layersCount, thresholds, maskOpts, traceOpts, edgeOpts } = payload;
  const gray = grayData ? { width: w, height: h, data: grayData } : grayFromRGBA(rgba, w, h, gopts);
  const th = (thresholds && thresholds.length) ? thresholds : autoThresholds(gray, layersCount);
  const built = buildMasks(gray, th, maskOpts);
  const { layers, edge } = traceBuilt(built.layers, built.edge, traceOpts, edgeOpts);   // trace on the main thread
  return { ok: true, grayFlat: isFlatGray(gray), thresholds: th, layers, edge, gray: grayData ? null : gray };
}

// Normalise a mask returned from the worker (typed-array view) or the fallback.
export function asMask(m) { return { width: m.width, height: m.height, data: m.data instanceof Uint8Array ? m.data : new Uint8Array(m.data) }; }

// Worker health, for the debug hook.
export function workerStatus() { return { created: !!_worker, broken: _workerBroken }; }
