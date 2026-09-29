// A curtain panel as a small Verlet cloth: a grid hanging from pinned top points, held together by distance
// constraints (structural + shear), with gravity, a breath of draught, body capsules it drapes over, and the
// window wall behind it. Vertex data is rebuilt each step in the engine's 12-float layout.
export class Cloth {
  constructor({ x, z0, z1, yTop, yBot, cols = 20, rows = 34, pleat = 0.03, folds = 7, wall = -2.19 }) {
    Object.assign(this, { x, z0, z1, yTop, yBot, cols, rows, wall, pleat2: pleat, folds2: folds });
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
  // No dynamics (a free-running sim jitters like a draught): the panel hangs still in its pleats, bunches
  // towards gatherTo when opened, and wraps over the bodies behind it, eased in so nothing pops.
  // gather: 0 hanging, 1 bunched. bodies: [{x, z, y0, y1, r}] capsules along y. pokes: [{z, y, s}]
  step(dt, t, { gather = 0, gatherTo = this.z0, bodies = [], pokes = [] } = {}) {
    const P = this.p, cols = this.cols, rows = this.rows;
    this.bulge = this.bulge || new Float32Array(cols * rows);
    for (const pk of pokes) this.pokeT = Math.max(this.pokeT || 0, pk.s * 0.4), this.pokeZ = pk.z, this.pokeY = pk.y;
    this.pokeT = Math.max(0, (this.pokeT || 0) - dt * 1.5);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c, k = i * 3, u = c / (cols - 1), v = r / (rows - 1);
      const p0 = this.pin0[c], zRest = p0[2] + (gatherTo - p0[2]) * gather * 0.85;
      const y = this.yTop - v * (this.yTop - this.yBot);
      const pleat = Math.sin(u * this.folds2 * Math.PI * 2) * this.pleat2 * (1 + gather * 1.5);
      let x = this.x + pleat, want = 0;
      for (const b of bodies) {   // how far this point must stand out to clear her shape (plus a draped skirt below)
        const dz = zRest - b.z, cy = Math.min(Math.max(y, b.y0), b.y1), dy = y - cy;
        const rr = b.r + 0.06 * v;                       // the fabric falls wider towards the hem
        const d2 = dz * dz + dy * dy * 0.6;
        if (d2 < rr * rr * 2.2) want = Math.max(want, (b.x - this.x) + Math.sqrt(Math.max(0, rr * rr - Math.min(d2, rr * rr))) + 0.02 * Math.exp(-d2 / (rr * rr)));
        want = Math.max(want, (b.x - this.x + rr) * Math.exp(-d2 / (rr * rr * 0.9)) * 0.9);
      }
      if (this.pokeT > 0) { const d = Math.hypot(zRest - this.pokeZ, y - this.pokeY); want = Math.max(want, this.pokeT * 0.12 * Math.max(0, 1 - d / 0.35)); }
      this.bulge[i] += (want - this.bulge[i]) * Math.min(1, dt * 4);   // eased
      P[k] = Math.max(x + this.bulge[i], this.wall); P[k + 1] = y; P[k + 2] = zRest;
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
