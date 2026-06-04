# Vendored libraries

SprayCan has **no npm runtime dependencies** — these UMD bundles are committed directly
and loaded on demand at export time (jsPDF/svg2pdf/JSZip via `src/vendor.js`) or eagerly
(ImageTracer). There's no `npm audit`, so check advisories manually when bumping.

| File | Library | Version | Notes |
|------|---------|---------|-------|
| `imagetracer.js` | ImageTracer | 1.2.6 | Public-domain; parses our own canvas data only. |
| `jspdf.umd.min.js` | jsPDF | 2.5.2 | ⚠️ See advisory below. Runs at export time on our own layer data. |
| `svg2pdf.umd.min.js` | svg2pdf.js | (bundled w/ jsPDF API) | Registers onto `jsPDF.API.svg`. |
| `jszip.min.js` | JSZip | 3.10.1 | Current 3.x line; clean. |
| `fonts/space-grotesk-*.woff2` | Space Grotesk | OFL | Vendored web font (see `SpaceGrotesk-OFL.txt`). |

## Known: jsPDF 2.5.2
A prototype-pollution advisory (**GHSA-w532-jxjh-hjhj**, fixed in jsPDF **3.0.1**) affects
this line. Real-world risk here is low — jsPDF only runs at *export* time on data the user
already controls (their own layers/colours/labels), never on untrusted input. A bump to
3.x is **deferred** because it's a major version and the svg2pdf integration
(`src/exporters/pdf.js`) must be re-verified for API changes (the code already probes
`jsPDF.API.svg` defensively). When bumping: replace both `jspdf.umd.min.js` and a
compatible `svg2pdf.umd.min.js`, then verify PDF export end-to-end.

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
