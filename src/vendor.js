// On-demand loader for the vendored UMD libraries used only at export time
// (jsPDF, svg2pdf, JSZip). Keeping them out of the initial page load makes the
// app start faster; they're injected the first time the user exports. ImageTracer
// stays eager in index.html because the live pipeline needs it.

const cache = new Map();

function loadScript(src) {
  if (cache.has(src)) return cache.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { cache.delete(src); reject(new Error('Failed to load ' + src)); };
    document.head.appendChild(s);
  });
  cache.set(src, p);
  return p;
}

// jsPDF first (svg2pdf registers itself onto jsPDF.API at load time).
export async function ensurePdfLibs() {
  if (!window.jspdf) await loadScript('vendor/jspdf.umd.min.js');
  if (!(window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API && window.jspdf.jsPDF.API.svg) && !window.svg2pdf) {
    await loadScript('vendor/svg2pdf.umd.min.js');
  }
}

export async function ensureZip() {
  if (!window.JSZip) await loadScript('vendor/jszip.min.js');
}
