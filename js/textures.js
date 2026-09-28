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

// ---------------------------------------------------------------- story documents
const CRAYON = '"Nanum Pen Script", cursive';
function paperBg(g, w, h, base = [222, 212, 184], seed = 3) {
  const r = rnd(seed);
  g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(90,70,40,${r() * 0.06})`; g.fillRect(r() * w, r() * h, 2 + r() * 10, 2 + r() * 10); }
  // stains
  for (let i = 0; i < 5; i++) {
    const x = r() * w, y = r() * h, rr = 20 + r() * 80;
    const grd = g.createRadialGradient(x, y, rr * 0.3, x, y, rr);
    grd.addColorStop(0, 'rgba(120,90,40,0.12)'); grd.addColorStop(0.9, 'rgba(110,80,30,0.2)'); grd.addColorStop(1, 'rgba(110,80,30,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
  }
}
function crayonX(g, x, y, s, r, col = 'rgba(170,20,20,0.85)') {
  g.strokeStyle = col; g.lineCap = 'round';
  for (let k = 0; k < 2; k++) {
    g.lineWidth = 3 + r() * 2; g.beginPath();
    g.moveTo(x - s + r() * 4, y - s + r() * 4); g.lineTo(x + s + r() * 4, y + s + r() * 4);
    g.moveTo(x + s + r() * 4, y - s + r() * 4); g.lineTo(x - s + r() * 4, y + s + r() * 4); g.stroke();
  }
}

export function calendarTex() {
  const W = 512, H = 700, c = canvas(W, H), g = c.getContext('2d'), r = rnd(19);
  paperBg(g, W, H, [232, 226, 212], 5);
  g.fillStyle = '#7a1010'; g.fillRect(0, 0, W, 110);
  g.fillStyle = '#f1e6d6'; g.font = 'bold 64px Georgia, serif'; g.textAlign = 'center'; g.fillText('12', W / 2, 78);
  g.font = '22px Georgia, serif'; g.fillText('1999  DECEMBER', W / 2, 104);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  g.font = 'bold 20px sans-serif'; g.fillStyle = '#333';
  days.forEach((d, i) => { g.fillStyle = i === 0 ? '#a01818' : '#333'; g.fillText(d, 40 + i * 72, 145); });
  const cellW = 72, cellH = 88, x0 = 4, y0 = 160, first = 3; // 1999-12-01 was a Wednesday
  g.font = '24px Georgia, serif';
  for (let d = 1; d <= 31; d++) {
    const k = first + d - 1, cx = x0 + (k % 7) * cellW, cy = y0 + Math.floor(k / 7) * cellH;
    g.strokeStyle = 'rgba(0,0,0,0.15)'; g.strokeRect(cx, cy, cellW, cellH);
    g.fillStyle = k % 7 === 0 ? '#a01818' : '#222'; g.textAlign = 'left'; g.fillText(String(d), cx + 8, cy + 28);
    if (d >= 4) crayonX(g, cx + 38, cy + 52, 20, r, d > 24 ? 'rgba(20,20,120,0.8)' : 'rgba(170,20,20,0.85)');
    if (d === 24) {
      g.strokeStyle = 'rgba(200,30,30,0.9)'; g.lineWidth = 5; g.beginPath(); g.ellipse(cx + 36, cy + 44, 40, 36, 0.1, 0, Math.PI * 2); g.stroke();
    }
  }
  g.fillStyle = 'rgba(190,30,30,0.9)'; g.font = `44px ${CRAYON}`; g.textAlign = 'left';
  g.save(); g.translate(250, 640); g.rotate(-0.08); g.fillText('엄마 오는 날?', 0, 0); g.restore();
  g.fillStyle = 'rgba(20,20,110,0.85)'; g.font = `34px ${CRAYON}`;
  g.save(); g.translate(20, 680); g.rotate(0.03); g.fillText('엄마 엄마 엄마 엄마 엄마 엄마', 0, 0); g.restore();
  return c;
}

export function noteTex() {
  const W = 512, H = 640, c = canvas(W, H), g = c.getContext('2d');
  paperBg(g, W, H, [236, 232, 214], 9);
  g.strokeStyle = 'rgba(80,110,170,0.25)'; g.lineWidth = 1;
  for (let y = 90; y < H; y += 48) { g.beginPath(); g.moveTo(20, y); g.lineTo(W - 20, y); g.stroke(); }
  g.fillStyle = 'rgba(25,25,35,0.92)'; g.font = `40px ${CRAYON}`; g.textAlign = 'left';
  const lines = ['수아야', '엄마 일 갔다 올게.', 'TV 보면서 얌전히 기다려.', '문 두드리면 엄마 진짜 화낸다.', '밥은 컵라면 먹고.', '11번(뉴스)은 보지 마.', '무서운 거 나와.', '— 엄마'];
  lines.forEach((l, i) => { g.save(); g.translate(40 + (i % 2) * 6, 80 + i * 48); g.rotate((i % 3 - 1) * 0.012); g.fillText(l, 0, 0); g.restore(); });
  // a child's crayon answer squeezed at the bottom
  g.fillStyle = 'rgba(190,30,30,0.9)'; g.font = `36px ${CRAYON}`;
  g.save(); g.translate(250, 612); g.rotate(-0.06); g.fillText('안 두드릴게 빨리 와', 0, 0); g.restore();
  return c;
}

export function drawingTex(img) {
  const W = 512, H = 512, c = canvas(W, H), g = c.getContext('2d'), r = rnd(4);
  if (img) g.drawImage(img, 0, 0, W, H);
  else {
    paperBg(g, W, H, [236, 230, 210], 12);
    g.lineWidth = 6; g.lineCap = 'round';
    g.strokeStyle = '#222'; g.strokeRect(60, 90, 390, 330);                       // room
    g.strokeStyle = '#2244aa'; g.strokeRect(280, 250, 110, 130); g.fillStyle = '#2244aa22'; g.fillRect(280, 250, 110, 130); // TV
    g.strokeStyle = '#111'; g.beginPath(); g.arc(200, 300, 22, 0, Math.PI * 2); g.stroke(); // girl
    g.beginPath(); g.moveTo(200, 322); g.lineTo(200, 380); g.stroke();
    g.strokeStyle = '#b01818'; g.strokeRect(430, 200, 20, 60);                       // lock
  }
  g.fillStyle = 'rgba(180,20,20,0.9)'; g.font = `54px ${CRAYON}`; g.textAlign = 'center';
  g.save(); g.translate(W / 2 + r() * 10, 480); g.rotate(-0.05); g.fillText('엄마 언제 와?', 0, 0); g.restore();
  return c;
}

export function newsTex(img) {
  const W = 640, H = 480, c = canvas(W, H), g = c.getContext('2d');
  if (img) g.drawImage(img, 0, 0, W, H); else paperBg(g, W, H, [214, 206, 180], 21);
  g.fillStyle = 'rgba(226,218,196,0.95)'; g.fillRect(28, 12, W - 150, 62);
  g.fillStyle = '#161410'; g.font = 'bold 30px "Nanum Myeongjo", serif'; g.textAlign = 'left';
  g.fillText('빌라 303호 7세 여아 숨진 채 발견', 40, 55);
  g.fillStyle = 'rgba(226,218,196,0.95)'; g.fillRect(28, 336, W - 56, 70);
  g.fillStyle = '#2b2720'; g.font = '17px "Nanum Myeongjo", serif';
  g.fillText('밖에서 잠긴 방… 달력엔 날짜마다 X 표시가 남아 있었다', 40, 364);
  g.fillText('경찰, 3주째 연락 끊긴 어머니 행방 추적  (2000. 1. 14)', 40, 392);
  return c;
}

export function scratchTex() {
  const c = canvas(256, 512), g = c.getContext('2d'), r = rnd(33);
  g.lineCap = 'round';
  for (let k = 0; k < 70; k++) {
    const x = 20 + r() * 216, y = 150 + r() * 350, len = 20 + r() * 90;
    for (let f = 0; f < 4; f++) {  // four fingers
      g.strokeStyle = `rgba(${200 + r() * 40},${180 + r() * 30},${150 + r() * 30},${0.25 + r() * 0.35})`;
      g.lineWidth = 1 + r() * 2;
      g.beginPath(); g.moveTo(x + f * 7, y); g.lineTo(x + f * 7 + (r() - 0.5) * 12, y + len); g.stroke();
    }
  }
  // dried blood near the bottom
  for (let k = 0; k < 18; k++) { g.fillStyle = `rgba(70,5,5,${0.2 + r() * 0.3})`; g.fillRect(20 + r() * 216, 380 + r() * 120, 2 + r() * 5, 6 + r() * 30); }
  return c;
}
