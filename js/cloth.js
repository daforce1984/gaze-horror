// A curtain panel as a small Verlet cloth: a grid hanging from pinned top points, held together by distance
// constraints (structural + shear), with gravity, a breath of draught, body capsules it drapes over, and the
// window wall behind it. Vertex data is rebuilt each step in the engine's 12-float layout.
export class Cloth {
  constructor({ x, z0, z1, yTop, yBot, cols = 20, rows = 34, pleat = 0.03, folds = 7, wall = -2.19 }) {
    Object.assign(this, { x, z0, z1, yTop, yBot, cols, rows, wall });
    const n = cols * rows;
    this.p = new Float32Array(n * 3); this.o = new Float32Array(n * 3);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1), v = r / (rows - 1), i = (r * cols + c) * 3;
      this.p[i] = x + Math.sin(u * folds * Math.PI * 2) * pleat;
      this.p[i + 1] = yTop - v * (yTop - yBot);
      this.p[i + 2] = z0 + u * (z1 - z0);
    }
    this.o.set(this.p);
    this.pin0 = []; for (let c = 0; c < cols; c++) this.pin0.push([this.p[c * 3], this.p[c * 3 + 1], this.p[c * 3 + 2]]);
    // constraints: [a, b, rest]
    const C = [], add = (a, b) => { const dx = this.p[a * 3] - this.p[b * 3], dy = this.p[a * 3 + 1] - this.p[b * 3 + 1], dz = this.p[a * 3 + 2] - this.p[b * 3 + 2]; C.push(a, b, Math.hypot(dx, dy, dz)); };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (c < cols - 1) add(i, i + 1);
      if (r < rows - 1) add(i, i + cols);
      if (c < cols - 1 && r < rows - 1) { add(i, i + cols + 1); add(i + 1, i + cols); }
      if (c < cols - 2) add(i, i + 2);   // a little bending stiffness
    }
    this.C = new Float32Array(C);
    // render buffers
    this.v = new Float32Array(n * 12);
    const idx = [];
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) { const i = r * cols + c; idx.push(i, i + 1, i + cols + 1, i, i + cols + 1, i + cols); }
    this.i = new Uint32Array(idx);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const k = (r * cols + c) * 12; this.v[k + 6] = (c / (cols - 1)) * (z1 - z0) / 0.9; this.v[k + 7] = (r / (rows - 1)) * (yTop - yBot) / 0.9;
      this.v[k + 8] = this.v[k + 9] = this.v[k + 10] = this.v[k + 11] = 1;
    }
    this.build();
  }
  // gather: 0 hanging, 1 bunched towards `gatherTo` (z). bodies: [{x, z, y0, y1, r}]. poke: [{z, y, s}]
  step(dt, t, { gather = 0, gatherTo = this.z0, bodies = [], pokes = [] } = {}) {
    dt = Math.min(dt, 1 / 30);
    const P = this.p, O = this.o, n = this.cols * this.rows, g = -9.8 * dt * dt, damp = 0.94;   // heavy fabric settles quickly
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const vx = (P[k] - O[k]) * damp, vy = (P[k + 1] - O[k + 1]) * damp, vz = (P[k + 2] - O[k + 2]) * damp;
      O[k] = P[k]; O[k + 1] = P[k + 1]; O[k + 2] = P[k + 2];
      const zz = P[k + 2], yy = P[k + 1];
      const draught = 0;   // a closed room: no wind (only her body and hands move it)
      P[k] += vx + draught; P[k + 1] += vy + g; P[k + 2] += vz;
    }
    for (const pk of pokes) for (let i = 0; i < n; i++) {
      const k = i * 3, d = Math.hypot(P[k + 2] - pk.z, P[k + 1] - pk.y);
      if (d < 0.35) P[k] += pk.s * (1 - d / 0.35) * dt;
    }
    const C = this.C, m = C.length, cols = this.cols;
    for (let it = 0; it < 10; it++) {
      for (let j = 0; j < m; j += 3) {
        const a = C[j] * 3, b = C[j + 1] * 3, rest = C[j + 2];
        const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2], d = Math.hypot(dx, dy, dz) || 1e-6;
        const f = (d - rest) / d * 0.5;
        P[a] += dx * f; P[a + 1] += dy * f; P[a + 2] += dz * f; P[b] -= dx * f; P[b + 1] -= dy * f; P[b + 2] -= dz * f;
      }
      // pins: the top row rides the rod; gathering slides the rings towards one end
      for (let c = 0; c < cols; c++) {
        const k = c * 3, p0 = this.pin0[c];
        P[k] = p0[0]; P[k + 1] = p0[1]; P[k + 2] = p0[2] + (gatherTo - p0[2]) * gather * 0.85;
      }
      // bodies (capsules along y) push the cloth out into the room; the wall stops it behind
      for (let i = cols; i < n; i++) {
        const k = i * 3;
        for (const b of bodies) {
          if (P[k + 1] < b.y0 || P[k + 1] > b.y1 + b.r) continue;
          const cy = Math.min(P[k + 1], b.y1), ex = P[k] - b.x, ez = P[k + 2] - b.z, ey = P[k + 1] - cy;
          const d = Math.hypot(ex, ey, ez);
          if (d < b.r) { const s = (b.r - d) / Math.max(d, 1e-4); P[k] += ex * s + (d < 1e-3 ? b.r : 0); P[k + 1] += ey * s; P[k + 2] += ez * s; }
        }
        if (P[k] < this.wall) P[k] = this.wall;
        if (P[k + 1] < 0.01) P[k + 1] = 0.01;
      }
    }
    // tethers: nothing hangs further from its ring than it did at rest (stops the long drop from stretching)
    const dy = (this.yTop - this.yBot) / (this.rows - 1);
    for (let r = 1; r < this.rows; r++) for (let c = 0; c < cols; c++) {
      const k = (r * cols + c) * 3, t = c * 3, L = r * dy * 1.01;
      const ex = P[k] - P[t], ey = P[k + 1] - P[t + 1], ez = P[k + 2] - P[t + 2], d = Math.hypot(ex, ey, ez);
      if (d > L) { const f = L / d; P[k] = P[t] + ex * f; P[k + 1] = P[t + 1] + ey * f; P[k + 2] = P[t + 2] + ez * f; }
    }
    this.build();
  }
  build() {
    const P = this.p, V = this.v, cols = this.cols, rows = this.rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c, k = i * 3, o = i * 12;
      V[o] = P[k]; V[o + 1] = P[k + 1]; V[o + 2] = P[k + 2];
      const l = c > 0 ? i - 1 : i, rr = c < cols - 1 ? i + 1 : i, u = r > 0 ? i - cols : i, d = r < rows - 1 ? i + cols : i;
      const ax = P[rr * 3] - P[l * 3], ay = P[rr * 3 + 1] - P[l * 3 + 1], az = P[rr * 3 + 2] - P[l * 3 + 2];
      const bx = P[d * 3] - P[u * 3], by = P[d * 3 + 1] - P[u * 3 + 1], bz = P[d * 3 + 2] - P[u * 3 + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const nl = Math.hypot(nx, ny, nz) || 1;
      if (nx < 0) { nx = -nx; ny = -ny; nz = -nz; }   // facing into the room (+x)
      V[o + 3] = nx / nl; V[o + 4] = ny / nl; V[o + 5] = nz / nl;
    }
  }
}
