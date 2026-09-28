// Canvas-generated textures: blood writing, TV screen, clock, gradients, fallbacks
const HAND = '"Nanum Pen Script", "Gaegu", cursive';

export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function rnd(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

// smeared, dripping stroke helper
function bloodStyle(g, alpha = 1) {
  g.strokeStyle = `rgba(92,6,6,${alpha})`; g.fillStyle = `rgba(92,6,6,${alpha})`;
  g.lineCap = 'round'; g.lineJoin = 'round';
}
function drips(g, x0, x1, y, n, r) {
  for (let i = 0; i < n; i++) {
    const x = x0 + r() * (x1 - x0), len = 10 + r() * 60, w = 2 + r() * 4;
    const grd = g.createLinearGradient(0, y, 0, y + len);
    grd.addColorStop(0, 'rgba(92,6,6,0.9)'); grd.addColorStop(1, 'rgba(70,4,4,0.0)');
    g.fillStyle = grd; g.beginPath(); g.ellipse(x, y + len / 2, w / 2, len / 2, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(80,5,5,0.85)'; g.beginPath(); g.arc(x, y + len * 0.95, w * 0.7, 0, Math.PI * 2); g.fill();
  }
}
function roughen(g, w, h, seed) {
  // eat holes into the paint so it looks smeared onto the wall
  const r = rnd(seed + 7);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${0.15 + r() * 0.5})`; g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3); }
  g.globalCompositeOperation = 'source-over';
}

// scratched tally marks: count n (groups of five)
export function tallyTex(n, seed = 3) {
  const c = canvas(512, 256), g = c.getContext('2d'), r = rnd(seed);
  g.strokeStyle = 'rgba(230,220,200,0.85)'; g.lineCap = 'round';
  let x = 50;
  const groups = Math.floor(n / 5), rest = n % 5;
  const stroke = (x0, y0, x1, y1) => {
    for (let k = 0; k < 3; k++) {
      g.lineWidth = 3 + r() * 3; g.globalAlpha = 0.5 + r() * 0.4;
      g.beginPath(); g.moveTo(x0 + r() * 4, y0 + r() * 4); g.lineTo(x1 + r() * 4, y1 + r() * 4); g.stroke();
    }
    g.globalAlpha = 1;
  };
  for (let gi = 0; gi < groups; gi++) {
    for (let i = 0; i < 4; i++) stroke(x + i * 26, 60, x + i * 26 + 6, 200);
    stroke(x - 14, 180, x + 100, 80); x += 150;
  }
  for (let i = 0; i < rest; i++) stroke(x + i * 26, 60, x + i * 26 + 6, 200);
  // dark gouge shading
  g.globalCompositeOperation = 'destination-over'; g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 6;
  g.globalCompositeOperation = 'source-over';
  return c;
}

// Digit with position dots, written in blood
export function digitTex(digit, pos, seed = 1) {
  const c = canvas(512, 512), g = c.getContext('2d'), r = rnd(seed);
  bloodStyle(g);
  g.save(); g.translate(256, 250); g.rotate((r() - 0.5) * 0.2);
  g.font = `bold 300px ${HAND}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(digit), 0, 0);
  g.restore();
  drips(g, 170, 340, 330, 7, r);
  // position dots under the digit
  for (let i = 0; i < 4; i++) {
    const x = 136 + i * 80, y = 450;
    g.lineWidth = 9; g.strokeStyle = 'rgba(92,6,6,0.95)';
    g.beginPath(); g.arc(x, y, 22, 0, Math.PI * 2);
    if (i === pos) { g.fillStyle = 'rgba(92,6,6,0.95)'; g.fill(); } else g.stroke();
  }
  roughen(g, 512, 512, seed);
  return c;
}

// crude clock drawing with one hand highlighted: which = 'hour' | 'minute'
export function clockHintTex(h, m, which, seed = 5) {
  const c = canvas(512, 512), g = c.getContext('2d'), r = rnd(seed);
  bloodStyle(g); g.lineWidth = 14;
  g.beginPath();
  for (let a = 0; a <= Math.PI * 2 + 0.2; a += 0.15) {
    const rr = 190 + (r() - 0.5) * 14; const x = 256 + Math.cos(a) * rr, y = 250 + Math.sin(a) * rr;
    a === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.stroke();
  // 12 o'clock mark so orientation is readable
  g.lineWidth = 12; g.beginPath(); g.moveTo(256, 70); g.lineTo(256, 110); g.stroke();
  for (let i = 1; i < 12; i++) {
    const a = i / 12 * Math.PI * 2 - Math.PI / 2;
    g.beginPath(); g.arc(256 + Math.cos(a) * 160, 250 + Math.sin(a) * 160, 6, 0, Math.PI * 2); g.fill();
  }
  const ang = which === 'hour' ? ((h % 12) + m / 60) / 12 * Math.PI * 2 - Math.PI / 2 : m / 60 * Math.PI * 2 - Math.PI / 2;
  const len = which === 'hour' ? 95 : 150;
  g.lineWidth = which === 'hour' ? 26 : 13;
  g.beginPath(); g.moveTo(256, 250); g.lineTo(256 + Math.cos(ang) * len, 250 + Math.sin(ang) * len); g.stroke();
  g.beginPath(); g.arc(256, 250, 16, 0, Math.PI * 2); g.fill();
  g.font = `bold 72px ${HAND}`; g.textAlign = 'center';
  g.fillText(which === 'hour' ? '짧은' : '긴', 256, 500);
  drips(g, 120, 400, 430, 6, r);
  roughen(g, 512, 512, seed);
  return c;
}

// finger-written text on fogged glass
export function glassTextTex(lines) {
  const c = canvas(1024, 512), g = c.getContext('2d');
  g.font = `bold 170px ${HAND}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(210,225,235,0.9)';
  g.shadowColor = 'rgba(200,220,240,0.8)'; g.shadowBlur = 12;
  lines.forEach((l, i) => g.fillText(l, 512, 140 + i * 220));
  // condensation runs
  const r = rnd(11);
  for (let i = 0; i < 20; i++) { const x = 150 + r() * 720, y = 150 + r() * 250; g.fillRect(x, y, 3, 30 + r() * 90); }
  return c;
}

// text on a wall in blood (generic)
export function bloodTextTex(lines, seed = 9, size = 150) {
  const c = canvas(1024, 512), g = c.getContext('2d'), r = rnd(seed);
  bloodStyle(g);
  g.font = `bold ${size}px ${HAND}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => { g.save(); g.translate(512, 150 + i * 200); g.rotate((r() - 0.5) * 0.08); g.fillText(l, 0, 0); g.restore(); });
  drips(g, 200, 820, 200, 14, r);
  roughen(g, 1024, 512, seed);
  return c;
}

export function radialTex(inner = 'rgba(0,0,0,0.85)', outer = 'rgba(0,0,0,0)') {
  const c = canvas(128, 128), g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner); grd.addColorStop(1, outer);
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return c;
}

// procedural fallback when an image asset is missing
export function noiseTex(base = [60, 55, 50], seed = 1) {
  const c = canvas(256, 256), g = c.getContext('2d'), r = rnd(seed);
  g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4000; i++) { const v = (r() - 0.5) * 40; g.fillStyle = `rgba(${base.map(b => b + v)},0.5)`; g.fillRect(r() * 256, r() * 256, 2 + r() * 6, 2 + r() * 6); }
  return c;
}

export function clockFaceTex(c, h, m) {
  const g = c.getContext('2d'), W = c.width, cx = W / 2;
  g.fillStyle = '#c9c0a6'; g.fillRect(0, 0, W, W);
  const grd = g.createRadialGradient(cx, cx, 10, cx, cx, cx);
  grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(60,40,10,0.55)');
  g.fillStyle = grd; g.fillRect(0, 0, W, W);
  g.fillStyle = '#1c1712'; g.font = `bold ${W * 0.1}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 1; i <= 12; i++) {
    const a = i / 12 * Math.PI * 2 - Math.PI / 2;
    g.fillText(String(i), cx + Math.cos(a) * W * 0.38, cx + Math.sin(a) * W * 0.38);
  }
  g.strokeStyle = '#120e0a'; g.lineCap = 'round';
  const ha = ((h % 12) + m / 60) / 12 * Math.PI * 2 - Math.PI / 2, ma = m / 60 * Math.PI * 2 - Math.PI / 2;
  g.lineWidth = W * 0.035; g.beginPath(); g.moveTo(cx, cx); g.lineTo(cx + Math.cos(ha) * W * 0.22, cx + Math.sin(ha) * W * 0.22); g.stroke();
  g.lineWidth = W * 0.02; g.beginPath(); g.moveTo(cx, cx); g.lineTo(cx + Math.cos(ma) * W * 0.33, cx + Math.sin(ma) * W * 0.33); g.stroke();
  g.fillStyle = '#120e0a'; g.beginPath(); g.arc(cx, cx, W * 0.03, 0, Math.PI * 2); g.fill();
  // crack across the glass
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(W * 0.1, W * 0.3); g.lineTo(W * 0.45, W * 0.55); g.lineTo(W * 0.6, W * 0.5); g.lineTo(W * 0.9, W * 0.8); g.stroke();
  return c;
}

// Renders the CRT screen each frame
export class TVScreen {
  constructor(faceImg) {
    this.c = canvas(320, 240); this.g = this.c.getContext('2d');
    this.noise = canvas(160, 120); this.ng = this.noise.getContext('2d');
    this.nd = this.ng.createImageData(160, 120);
    this.face = faceImg; this.mode = 'static'; this.channel = 3; this.osd = 0; this.lines = []; this.t = 0;
  }
  draw(dt, intensity) {
    this.t += dt;
    const g = this.g, W = 320, H = 240, d = this.nd.data;
    for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255 * intensity; d[i] = v; d[i + 1] = v; d[i + 2] = v * 1.05; d[i + 3] = 255; }
    this.ng.putImageData(this.nd, 0, 0);
    g.imageSmoothingEnabled = false;
    if (this.mode === 'off') { g.fillStyle = '#050607'; g.fillRect(0, 0, W, H); return this.c; }
    if (this.mode === 'static') {
      g.drawImage(this.noise, 0, 0, W, H);
    } else if (this.mode === 'broadcast') {
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      const flick = 0.5 + 0.5 * Math.sin(this.t * 1.7);
      if (this.face && this.showFace) {
        g.globalAlpha = 0.25 + 0.35 * flick; g.imageSmoothingEnabled = true;
        const jit = Math.random() < 0.1 ? (Math.random() - 0.5) * 30 : 0;
        g.drawImage(this.face, 40 + jit, 0, 240, 240); g.imageSmoothingEnabled = false;
      }
      g.globalAlpha = 0.35; g.drawImage(this.noise, 0, 0, W, H); g.globalAlpha = 1;
      g.fillStyle = '#e8e8e8'; g.font = `bold 34px ${HAND}`; g.textAlign = 'center';
      this.lines.forEach((l, i) => g.fillText(l, W / 2 + (Math.random() < 0.05 ? 6 : 0), H / 2 - (this.lines.length - 1) * 22 + i * 44));
    }
    // OSD channel number
    if (this.osd > 0) {
      this.osd -= dt;
      g.fillStyle = '#6f6'; g.font = 'bold 30px monospace'; g.textAlign = 'right';
      g.fillText(`CH ${String(this.channel).padStart(2, '0')}`, W - 16, 38);
    }
    // scanlines
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
    return this.c;
  }
}
