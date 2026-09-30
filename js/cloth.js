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
  // Pleats and body bulges are kinematic (a free-running sim jitters like a draught); opening is physical:
  // a hand pushes the leading edge along the rod, the rings bunch against each other (accordion, the pleats
  // deepening where the fabric is compressed) and each row hangs from the one above on a soft spring, so the
  // hem trails behind, swings out a little and settles.
  // gather: 0 hanging, 1 bunched (the hand position). bodies: [{x, z, y0, y1, r}] capsules along y. pokes: [{z, y, s}]
  step(dt, t, { gather = 0, gatherTo = this.z0, bodies = [], pokes = [] } = {}) {
    const P = this.p, cols = this.cols, rows = this.rows, W = this.z1 - this.z0;
    const back = Math.abs(gatherTo - this.z0) < Math.abs(gatherTo - this.z1) ? 0 : cols - 1, dir = back === 0 ? 1 : -1, zBack = back === 0 ? this.z0 : this.z1;
    const rest = W / (cols - 1), minGap = rest * 0.15, hand = W * (1 - 0.85 * gather);
    this.bulge = this.bulge || new Float32Array(cols * rows);
    if (!this.ring) {   // j = rings counted from the gathered side, as distance along the rod
      this.ring = Float32Array.from({ length: cols }, (_, j) => j / (cols - 1) * hand);
      this.vz = new Float32Array(cols * rows); this.vx = new Float32Array(cols * rows);
      this.zs = new Float32Array(cols * rows);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) this.zs[r * cols + c] = zBack + dir * this.ring[back === 0 ? c : cols - 1 - c];
    }
    const ring = this.ring, n = cols - 1;
    this.handV = dt > 0 ? (this.handV || 0) * 0.8 + 0.2 * Math.abs(hand - ring[n]) / dt : 0;   // how fast the hand is moving
    ring[0] = 0; ring[n] = hand;
    for (let j = 1; j < n; j++) ring[j] += ((ring[j - 1] + ring[j + 1]) / 2 - ring[j]) * Math.min(1, dt * 1.2);   // the fabric slowly evens its pleats out
    for (let it = 0; it < 3; it++) {   // rings cannot pass each other, and the cloth between two cannot stretch
      for (let j = n - 1; j >= 1; j--) ring[j] = Math.min(Math.max(ring[j], ring[j + 1] - rest), ring[j + 1] - minGap);
      for (let j = 1; j < n; j++) ring[j] = Math.min(Math.max(ring[j], ring[j - 1] + minGap), ring[j - 1] + rest);
    }
    for (const pk of pokes) this.pokeT = Math.max(this.pokeT || 0, pk.s * 0.4), this.pokeZ = pk.z, this.pokeY = pk.y;
    this.pokeT = Math.max(0, (this.pokeT || 0) - dt * 1.5);
    const h = Math.min(dt, 0.05), sub = h > 0.02 ? 2 : 1, hs = h / sub;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c, k = i * 3, u = c / (cols - 1), v = r / (rows - 1);
      const j = back === 0 ? c : n - c;
      const zRing = zBack + dir * ring[j];
      const y = this.yTop - v * (this.yTop - this.yBot);
      // each row hangs from the one above: follow it (and a little the ring) on a spring, softer towards the hem
      if (r === 0) { this.zs[i] = zRing; this.vz[i] = 0; }
      else {
        const above = this.zs[i - cols], want = above * 0.7 + zRing * 0.3, kk = 320 - 250 * v, cc = 2 * Math.sqrt(kk) * (0.6 - 0.3 * v);
        for (let s2 = 0; s2 < sub; s2++) { this.vz[i] += ((want - this.zs[i]) * kk - this.vz[i] * cc) * hs; this.zs[i] += this.vz[i] * hs; }
      }
      const zRest = this.zs[i];
      // local compression of this row -> pleat depth (the same length of cloth folded into less width)
      const zl = c > 0 ? this.zs[i - 1] : zRest, zr = c < n ? this.zs[i + 1] : zRest;   // (the row's left neighbour is already updated this step, right one from the last: close enough)
      const rho = Math.min(1, Math.abs(zr - zl) / ((c > 0 && c < n) ? 2 : 1) / rest);
      const pleat = Math.sin(u * this.folds2 * Math.PI * 2) * this.pleat2 * (1 + 2.4 * (1 - rho) ** 0.7);
      // moving cloth drags air: the lower part billows into the room while it swings
      const flare = Math.min(0.09, Math.abs(this.vz[i]) * 0.07) * v * v;
      // the hand holds the leading edge at chest height and pulls it a little into the room while it walks
      const grip = Math.min(0.1, this.handV * 0.12) * Math.exp(-(((n - j) / 2.2) ** 2)) * Math.exp(-(((y - 1.35) / 0.55) ** 2));
      let x = this.x + pleat + flare + grip, want = 0;
      for (const b of bodies) {   // how far this point must stand out to clear her shape (plus a draped skirt below)
        const dz = zRest - b.z, cy = Math.min(Math.max(y, b.y0), b.y1), dy = y - cy;
        const rr = b.r + 0.06 * v;                       // the fabric falls wider towards the hem
        const d2 = dz * dz + dy * dy * 0.6;
        if (d2 < rr * rr * 2.2) want = Math.max(want, (b.x - this.x) + Math.sqrt(Math.max(0, rr * rr - Math.min(d2, rr * rr))) + 0.02 * Math.exp(-d2 / (rr * rr)));
        want = Math.max(want, (b.x - this.x + rr) * Math.exp(-d2 / (rr * rr * 0.9)) * 0.9);
      }
      if (this.pokeT > 0) { const d = Math.hypot(zRest - this.pokeZ, y - this.pokeY); want = Math.max(want, this.pokeT * 0.12 * Math.max(0, 1 - d / 0.35)); }
      // the bulge is physical: a body pushes the cloth out (it cannot pass through her), and when nothing
      // holds it any more it falls back on its own weight, overshoots a little and sways still; each point is
      // tied to its neighbours so the release ripples across the panel
      const nb = ((c > 0 ? this.bulge[i - 1] : this.bulge[i]) + (c < n ? this.bulge[i + 1] : this.bulge[i]) + (r > 0 ? this.bulge[i - cols] : 0) + (r < rows - 1 ? this.bulge[i + cols] : this.bulge[i])) / 4;
      const bv = this.bv || (this.bv = new Float32Array(cols * rows));
      for (let s2 = 0; s2 < sub; s2++) {
        bv[i] += ((0 - this.bulge[i]) * 18 + (nb - this.bulge[i]) * 90 - bv[i] * 1.6) * hs;
        this.bulge[i] += bv[i] * hs;
      }
      if (this.bulge[i] < want) { this.bulge[i] += (want - this.bulge[i]) * Math.min(1, dt * 6); bv[i] = Math.max(bv[i], 0); }   // her shape holds it out
      P[k] = Math.max(x + this.bulge[i], this.wall); P[k + 1] = y - flare * 0.4; P[k + 2] = zRest;
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
