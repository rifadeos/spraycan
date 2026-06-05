# Vendored libraries

SprayCan has **no npm runtime dependencies** — these UMD bundles are committed directly
and loaded on demand at export time (jsPDF/svg2pdf/JSZip via `src/vendor.js`) or eagerly
(ImageTracer). There's no `npm audit`, so check advisories manually when bumping.

| File | Library | Version | Notes |
|------|---------|---------|-------|
| `imagetracer.js` | ImageTracer | 1.2.6 | Public-domain; parses our own canvas data only. Also imported by the pipeline worker (its UMD assigns `self.ImageTracer`). |
| `jspdf.umd.min.js` | jsPDF | 3.0.1 | Bumped from 2.5.2 — closes the ReDoS advisory below. |
| `svg2pdf.umd.min.js` | svg2pdf.js | 2.5.0 | Registers `jsPDF.API.svg`; peer-compatible with jsPDF 3.x (`^3.0.0 \|\| ^2.0.0`). |
| `jszip.min.js` | JSZip | 3.10.1 | Current 3.x line; clean. |
| `fonts/space-grotesk-*.woff2` | Space Grotesk | OFL | Vendored web font (see `SpaceGrotesk-OFL.txt`). |

## jsPDF — bumped 2.5.2 → 3.0.1
The 2.5.x line carried a ReDoS advisory (**GHSA-w532-jxjh-hjhj** / CVE-2025-29907, High,
fixed in jsPDF **3.0.1**) in the `addImage`/`html`/`addSvgAsImage` methods. Real-world risk
here was low — SprayCan's export path uses only `pdf.svg()` (svg2pdf) and never calls those
methods — but it's now closed. Paired with svg2pdf.js **2.5.0** (declares jsPDF
`^3.0.0 || ^2.0.0` as a peer). PDF export verified end-to-end after the bump (cover page +
per-layer pages render via `pdf.svg()`; jsPDF reports version 3.0.1 at runtime).

## CDN-loaded (not vendored)
The opt-in AI features fetch models from CDNs on first use (then the browser caches them):
- **Auto recognition** — TensorFlow.js + BlazeFace + MobileNet from `cdn.jsdelivr.net`
  (scripts are **SRI-pinned** in `src/classify.js`); model weights from `tfhub.dev` /
  `www.kaggle.com` / `storage.googleapis.com`.
- **Background removal** — `@imgly/background-removal` + ONNX Runtime from `esm.sh`; model
  assets from `staticimgly.com`.

The page CSP (`index.html`) restricts script/connect to exactly these hosts, so even a
compromised CDN bundle can't exfiltrate the image to an arbitrary host. Fully removing the
CDN dependency would mean vendoring `@imgly`'s ~40 MB of WASM/ONNX assets into the repo —
not done, to keep the repo lean; tracked as a possible future hardening step.
