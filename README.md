# SprayCan

Turn any image into a **layered, cuttable spray-paint stencil** — right in your browser.
Upload a photo, choose how many colour layers you want, let it auto-place the *bridges* that
keep islands from falling out, then export clean **SVG** files (for a cutting machine) or a
tiled **PDF** (for printing and hand-cutting).

No server, no upload, no build step. Your image never leaves your device.

## What it does

- **Posterises** an image into 1–4 nested tonal layers (one spray colour each, light → dark).
- **Vectorises** each layer to smooth SVG paths, sized to a real-world width (cm / in / mm).
- **Detects floating islands** (the middle of an *O*, the catch-light in an eye, …) and
  **auto-bridges** them so they stay attached when cut. Bridges are editable: drag, add, delete.
- Adds a **material holding frame** and **registration marks** so multi-layer stencils line up.
- Exports a **ZIP of per-layer SVGs** (+ a stacked preview) and a **tiled PDF** with a cut guide.

## Run it

It's static files, but ES modules must be served over HTTP (not opened as `file://`):

```bash
cd stencilforge
python3 -m http.server 8000      # then open http://localhost:8000
# or:  npx serve .
```

Click **Try a sample image** to see it work immediately, or load your own.

## How to use

1. **Image** — load a picture (high-contrast subjects work best).
2. **Adjust** — brightness / contrast / invert until the shapes read clearly.
3. **Layers** — pick 1–4. Each layer is one spray colour; tune the per-tone sliders.
4. **Bridges** — red areas are islands that would fall out. They're auto-tied; drag the green
   handles to fine-tune, click **+ Add** to draw a tie, select one and **Delete** to remove it.
5. **Output** — set the real-world width, then **Export SVG (.zip)** or **Export PDF**.

For a multi-layer piece: cut each layer sheet, keep the bridges, align the sheets with the red
crosshairs, and spray the **lightest layer first**, each darker layer on top.

## How it works (pipeline)

`image → grayscale → posterize (nested thresholds) → despeckle → frame → island detection →
auto-bridge → vectorize → SVG / tiled PDF`

The image-processing core is plain, dependency-free functions over typed-array masks
(`src/posterize.js`, `morphology.js`, `islands.js`, `bridges.js`) and is unit-tested headlessly:

```bash
node --test
```

The browser layer adds image loading (`image.js`), vectorising (`trace.js`), the interactive
editor (`ui/editor.js`), and exporters (`exporters/`).

## Project layout

```
index.html · styles.css
src/  grid, units, color, posterize, morphology, islands, bridges, trace, registration, app
src/ui/         controls, editor, guide
src/exporters/  svg, pdf, bundle
tests/          node --test over the pure modules
vendor/         ImageTracer, jsPDF, svg2pdf, JSZip (pinned, offline)
```

## Deploy

Any static host. Drag the folder onto Cloudflare Pages / Netlify, or `git push` to a Pages repo —
there's nothing to build.

## Vendored libraries

- [ImageTracer.js](https://github.com/jankovicsandras/imagetracerjs) — vectoriser (Unlicense / public domain)
- [jsPDF](https://github.com/parallax/jsPDF) (MIT) + [svg2pdf.js](https://github.com/yWorks/svg2pdf.js) (MIT) — vector PDF
- [JSZip](https://github.com/Stuk/jszip) (MIT) — ZIP bundling
