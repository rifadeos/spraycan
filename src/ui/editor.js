// Interactive layer editor. Renders one layer's cut result and lets the user
// drag / add / delete bridges. The canvas backing store is the working raster
// size, so canvas coords ARE working-pixel coords (CSS scales for display).
//
// The app owns each layer's `bridges` array; this editor mutates it in place
// and calls onBridgesChanged() on commit (pointer-up / add / delete) so the app
// can re-burn + re-trace just that layer.

const MATERIAL = [233, 228, 218, 255]; // cardboard
const INK      = [26, 26, 26, 255];    // sprayed / cut-away
const ISLAND   = [230, 40, 41, 255];   // still-floating island (warning)

export class LayerEditor {
  constructor(canvas, { onBridgesChanged, onSample, onBeforeChange } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onBridgesChanged = onBridgesChanged || (() => {});
    this.onSample = onSample || (() => {});          // eyedropper: (x,y) -> sample colour
    this.onBeforeChange = onBeforeChange || (() => {}); // snapshot for undo
    this.bridges = [];
    this.mode = 'select';
    this.selected = -1;
    this.drag = null;      // { which: 1|2|'whole', ox, oy }
    this.pending = null;   // first click of an add
    this.pendingEnd = null;
    this.defaultWidth = 6;
    this.mmPerPx = 0; // set per layer so a selected tie can show its real width in mm
    this.maskW = this.maskH = 1;
    this.baseImage = null;
    this._bind();
  }

  setLayer({ baseMask, bridges, floatingMask, bridgeWidth, mmPerPx }) {
    this.maskW = baseMask.width;
    this.maskH = baseMask.height;
    this.canvas.width = this.maskW;
    this.canvas.height = this.maskH;
    this.bridges = bridges;
    if (bridgeWidth) this.defaultWidth = bridgeWidth;
    if (mmPerPx) this.mmPerPx = mmPerPx;
    this.selected = -1;
    this.pending = null;
    this.refreshBase(baseMask, floatingMask);
  }

  // Recompute the cached background (ink + island warnings) without resetting
  // the current selection — used after a bridge edit commits.
  refreshBase(baseMask, floatingMask) {
    const { width, height, data } = baseMask;
    const id = new ImageData(width, height);
    const o = id.data;
    for (let i = 0, p = 0; i < data.length; i++, p += 4) {
      const c = (floatingMask && floatingMask[i]) ? ISLAND : (data[i] === 1 ? INK : MATERIAL);
      o[p] = c[0]; o[p + 1] = c[1]; o[p + 2] = c[2]; o[p + 3] = c[3];
    }
    this.baseImage = id;
    this.render();
  }

  setMode(mode) {
    this.mode = mode;
    this.pending = null; this.pendingEnd = null;
    if (mode !== 'select') this.selected = -1;
    this.canvas.style.cursor = mode === 'eyedrop' ? 'copy' : 'crosshair';
    this.render();
  }

  removeSelected() {
    if (this.selected < 0) return;
    this.onBeforeChange();
    this.bridges.splice(this.selected, 1);
    this.selected = -1;
    this.onBridgesChanged();
  }

  render() {
    const ctx = this.ctx;
    if (this.baseImage) ctx.putImageData(this.baseImage, 0, 0);
    for (let i = 0; i < this.bridges.length; i++) this._drawBridge(this.bridges[i], i === this.selected);
    if (this.pending && this.pendingEnd) {
      ctx.save();
      ctx.setLineDash([Math.max(2, this.maskW * 0.006)]);
      ctx.strokeStyle = '#2f6df6'; ctx.lineWidth = this._line();
      ctx.beginPath(); ctx.moveTo(this.pending.x, this.pending.y); ctx.lineTo(this.pendingEnd.x, this.pendingEnd.y); ctx.stroke();
      ctx.restore();
    }
  }

  _drawBridge(b, sel) {
    const ctx = this.ctx;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // material-coloured strip: the tie interrupting the cut
    ctx.strokeStyle = `rgb(${MATERIAL[0]},${MATERIAL[1]},${MATERIAL[2]})`;
    ctx.lineWidth = Math.max(1, b.width);
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    // green centreline
    ctx.strokeStyle = sel ? '#0a7d2c' : 'rgba(20,140,60,0.9)'; ctx.lineWidth = this._line();
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    // endpoints: small dots normally; full grab-handles only when selected
    if (sel) {
      const r = this._handleR();
      for (const [hx, hy] of [[b.x1, b.y1], [b.x2, b.y2]]) {
        ctx.beginPath(); ctx.arc(hx, hy, r, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill();
        ctx.lineWidth = Math.max(1, r * 0.4); ctx.strokeStyle = '#0a7d2c'; ctx.stroke();
      }
      // Real-world tie width, so the user can judge whether it'll hold / show.
      if (this.mmPerPx > 0) {
        const mm = b.width * this.mmPerPx;
        const txt = (mm < 10 ? mm.toFixed(1) : Math.round(mm)) + ' mm';
        const fs = Math.max(9, Math.min(this.maskW, this.maskH) * 0.032);
        const mx = (b.x1 + b.x2) / 2, my = (b.y1 + b.y2) / 2;
        ctx.save();
        ctx.font = `600 ${fs}px "Space Grotesk", system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.lineWidth = Math.max(2, fs * 0.24); ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(txt, mx, my - r - fs * 0.35);
        ctx.fillStyle = '#fff'; ctx.fillText(txt, mx, my - r - fs * 0.35);
        ctx.restore();
      }
    } else {
      const r = this._dotR();
      ctx.fillStyle = '#148c3c';
      for (const [hx, hy] of [[b.x1, b.y1], [b.x2, b.y2]]) {
        ctx.beginPath(); ctx.arc(hx, hy, r, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  _handleR() { return Math.max(5, Math.min(this.maskW, this.maskH) * 0.012); }
  _dotR() { return Math.max(2, Math.min(this.maskW, this.maskH) * 0.005); }
  _line() { return Math.max(1, Math.min(this.maskW, this.maskH) * 0.0025); }

  _pt(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * this.maskW;
    const y = (e.clientY - rect.top) / rect.height * this.maskH;
    return { x: clamp(x, 0, this.maskW), y: clamp(y, 0, this.maskH) };
  }

  _hitHandle(p) {
    const r = this._handleR() * 1.6;
    for (let i = 0; i < this.bridges.length; i++) {
      const b = this.bridges[i];
      if (dist(p.x, p.y, b.x1, b.y1) <= r) return { i, which: 1 };
      if (dist(p.x, p.y, b.x2, b.y2) <= r) return { i, which: 2 };
    }
    return null;
  }

  _hitBody(p) {
    for (let i = 0; i < this.bridges.length; i++) {
      const b = this.bridges[i];
      if (segDist(p.x, p.y, b.x1, b.y1, b.x2, b.y2) <= Math.max(b.width / 2, this._handleR())) return i;
    }
    return -1;
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => {
      c.focus();
      const p = this._pt(e);
      if (this.mode === 'eyedrop') { this.onSample(p.x, p.y); this.setMode('select'); return; }
      if (this.mode === 'add') {
        if (!this.pending) { this.pending = p; this.pendingEnd = p; }
        else {
          this.onBeforeChange();
          this.bridges.push({ x1: this.pending.x, y1: this.pending.y, x2: p.x, y2: p.y, width: this.defaultWidth });
          this.pending = null; this.pendingEnd = null;
          this.selected = this.bridges.length - 1;
          this.setMode('select');
          this.onBridgesChanged();
        }
        this.render();
        return;
      }
      const h = this._hitHandle(p);
      if (h) { this.selected = h.i; this.onBeforeChange(); this.drag = { which: h.which }; try { c.setPointerCapture(e.pointerId); } catch {} this.render(); return; }
      const body = this._hitBody(p);
      if (body >= 0) {
        this.selected = body;
        this.onBeforeChange();
        this.drag = { which: 'whole', ox: p.x, oy: p.y };
        try { c.setPointerCapture(e.pointerId); } catch {}
      } else {
        this.selected = -1;
      }
      this.render();
    });

    c.addEventListener('pointermove', e => {
      const p = this._pt(e);
      if (this.mode === 'add' && this.pending) { this.pendingEnd = p; this.render(); return; }
      if (!this.drag) return;
      const b = this.bridges[this.selected];
      if (!b) return;
      if (this.drag.which === 1) { b.x1 = p.x; b.y1 = p.y; }
      else if (this.drag.which === 2) { b.x2 = p.x; b.y2 = p.y; }
      else {
        const dx = p.x - this.drag.ox, dy = p.y - this.drag.oy;
        b.x1 = clamp(b.x1 + dx, 0, this.maskW); b.y1 = clamp(b.y1 + dy, 0, this.maskH);
        b.x2 = clamp(b.x2 + dx, 0, this.maskW); b.y2 = clamp(b.y2 + dy, 0, this.maskH);
        this.drag.ox = p.x; this.drag.oy = p.y;
      }
      this.render();
    });

    const end = e => {
      if (this.drag) { this.drag = null; try { c.releasePointerCapture(e.pointerId); } catch {} this.onBridgesChanged(); }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);

    c.addEventListener('keydown', e => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected >= 0) { e.preventDefault(); this.removeSelected(); }
      if (e.key === 'Escape') { this.pending = null; this.pendingEnd = null; this.setMode('select'); }
    });
  }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
