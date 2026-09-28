// Geometry builders. Vertex = pos3, normal3, uv2, color4 (12 floats)
function pack(verts, idx) {
  const n = verts.length / 8, v = new Float32Array(n * 12);
  for (let k = 0; k < n; k++) { v.set(verts.slice(k * 8, k * 8 + 8), k * 12); v.set([1, 1, 1, 1], k * 12 + 8); }
  return { v, i: new Uint32Array(idx) };
}

// Quad in XY plane facing +Z, centred (or anchored at bottom when bottom=true). uv v=0 at top.
export function plane(w = 1, h = 1, bottom = false) {
  const y0 = bottom ? 0 : -h / 2, y1 = bottom ? h : h / 2, x0 = -w / 2, x1 = w / 2;
  return pack([
    x0, y0, 0, 0, 0, 1, 0, 1,
    x1, y0, 0, 0, 0, 1, 1, 1,
    x1, y1, 0, 0, 0, 1, 1, 0,
    x0, y1, 0, 0, 0, 1, 0, 0,
  ], [0, 1, 2, 0, 2, 3]);
}

// Axis aligned box centred at origin. tile>0 => uv in world units / tile
export function box(w, h, d, tile = 0) {
  const hw = w / 2, hh = h / 2, hd = d / 2, V = [], I = [];
  const face = (n, u, v, su, sv) => {
    const b = V.length / 8;
    const c = [n[0] * hw, n[1] * hh, n[2] * hd];
    for (const [a, bb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = [c[0] + u[0] * a * su / 2 + v[0] * bb * sv / 2, c[1] + u[1] * a * su / 2 + v[1] * bb * sv / 2, c[2] + u[2] * a * su / 2 + v[2] * bb * sv / 2];
      const uu = tile ? (a * su / 2) / tile + 0.5 : (a + 1) / 2, vv = tile ? (-bb * sv / 2) / tile + 0.5 : (1 - bb) / 2;
      V.push(...p, ...n, uu, vv);
    }
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  face([0, 0, 1], [1, 0, 0], [0, 1, 0], w, h);
  face([0, 0, -1], [-1, 0, 0], [0, 1, 0], w, h);
  face([1, 0, 0], [0, 0, -1], [0, 1, 0], d, h);
  face([-1, 0, 0], [0, 0, 1], [0, 1, 0], d, h);
  face([0, 1, 0], [1, 0, 0], [0, 0, -1], w, d);
  face([0, -1, 0], [1, 0, 0], [0, 0, 1], w, d);
  return pack(V, I);
}

export function sphere(r, seg = 12, ring = 8) {
  const V = [], I = [];
  for (let y = 0; y <= ring; y++) for (let x = 0; x <= seg; x++) {
    const th = y / ring * Math.PI, ph = x / seg * Math.PI * 2;
    const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    V.push(n[0] * r, n[1] * r, n[2] * r, ...n, x / seg, y / ring);
  }
  for (let y = 0; y < ring; y++) for (let x = 0; x < seg; x++) {
    const a = y * (seg + 1) + x, b = a + seg + 1;
    I.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return pack(V, I);
}

// Hanging cloth: grid in XY (top at y=0, hanging down to -h) with sinusoidal folds in Z
export function cloth(w, h, cols = 48, rows = 12, folds = 7, amp = 0.05, seed = 0) {
  const V = [], I = [];
  const zf = (x, y) => {
    const t = x / w;
    return Math.sin(t * folds * Math.PI * 2 + seed) * amp * (0.85 + 0.15 * Math.sin(y * 3 + t * 9))
      + Math.sin(t * 23 + seed * 2) * amp * 0.25;
  };
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
    const x = -w / 2 + c / cols * w, y = -r / rows * h, z = zf(x + w / 2, y);
    const e = 0.002, dzdx = (zf(x + w / 2 + e, y) - zf(x + w / 2 - e, y)) / (2 * e);
    const n = [-dzdx, 0, 1], l = Math.hypot(n[0], n[2]);
    V.push(x, y, z, n[0] / l, 0, n[2] / l, c / cols * w / 0.9, r / rows * h / 0.9);
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = r * (cols + 1) + c, b = a + cols + 1;
    I.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return pack(V, I);
}
