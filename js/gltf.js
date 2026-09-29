// Minimal GLB loader: meshes (POSITION/NORMAL/TEXCOORD_0/COLOR_0), materials with embedded PBR maps, node transforms.
const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const NORM = { 5121: 255, 5123: 65535, 5120: 127, 5122: 32767 };

function readAccessor(json, bin, idx) {
  const a = json.accessors[idx], bv = json.bufferViews[a.bufferView];
  const n = SIZE[a.type], T = COMP[a.componentType];
  const stride = bv.byteStride || n * T.BYTES_PER_ELEMENT;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  // fast path: tightly packed, aligned data is copied in one go (parsing element by element is slow on phones)
  const at = bin.byteOffset + base;
  if (stride === n * T.BYTES_PER_ELEMENT && at % T.BYTES_PER_ELEMENT === 0 && !a.normalized) {
    const src = new T(bin.buffer, at, a.count * n);
    return { data: T === Float32Array ? src.slice() : Float32Array.from(src), n, count: a.count };
  }
  const out = new Float32Array(a.count * n);
  const dv = new DataView(bin.buffer, bin.byteOffset);
  const get = { 5126: (o) => dv.getFloat32(o, true), 5125: (o) => dv.getUint32(o, true), 5123: (o) => dv.getUint16(o, true),
    5121: (o) => dv.getUint8(o), 5122: (o) => dv.getInt16(o, true), 5120: (o) => dv.getInt8(o) }[a.componentType];
  const norm = a.normalized ? NORM[a.componentType] : 1;
  for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = get(base + i * stride + k * T.BYTES_PER_ELEMENT) / norm;
  return { data: out, n, count: a.count };
}

function quatMat(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return new Float32Array([
    (1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
    2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1]);
}

export async function loadGLB(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not glb');
  let off = 12, json, bin;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const chunk = new Uint8Array(buf, off + 8, len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  // embedded images (png / jpeg / webp) decoded once, shared between materials
  const imgs = await Promise.all((json.images || []).map(async im => {
    if (im.bufferView == null) return null;
    const bv = json.bufferViews[im.bufferView];
    const bytes = new Uint8Array(bin.buffer, bin.byteOffset + (bv.byteOffset || 0), bv.byteLength);
    try { return await createImageBitmap(new Blob([bytes], { type: im.mimeType || 'image/png' }), { colorSpaceConversion: 'none' }); } catch { return null; }
  }));
  const texImg = (ti) => {
    if (!ti) return null;
    const t = json.textures[ti.index]; if (!t) return null;
    const src = t.source ?? t.extensions?.EXT_texture_webp?.source;
    return src != null ? imgs[src] : null;
  };
  const mats = (json.materials || []).map(m => {
    const p = m.pbrMetallicRoughness || {};
    const mr = texImg(p.metallicRoughnessTexture), occ = texImg(m.occlusionTexture);
    return { name: m.name, color: p.baseColorFactor || [1, 1, 1, 1], rough: p.roughnessFactor ?? 1, metal: p.metallicFactor ?? 0,
      maps: { base: texImg(p.baseColorTexture), normal: texImg(m.normalTexture), mr, mrAO: !!mr && mr === occ },
      blend: m.alphaMode === 'BLEND', cutout: m.alphaMode === 'MASK' };
  });
  const meshes = (json.meshes || []).map(me => me.primitives.map(pr => {
    const A = pr.attributes;
    const P = readAccessor(json, bin, A.POSITION), N = A.NORMAL != null ? readAccessor(json, bin, A.NORMAL) : null;
    const U = A.TEXCOORD_0 != null ? readAccessor(json, bin, A.TEXCOORD_0) : null, C = A.COLOR_0 != null ? readAccessor(json, bin, A.COLOR_0) : null;
    const cnt = P.count, v = new Float32Array(cnt * 12);
    for (let i = 0; i < cnt; i++) {
      const o = i * 12;
      v[o] = P.data[i * 3]; v[o + 1] = P.data[i * 3 + 1]; v[o + 2] = P.data[i * 3 + 2];
      if (N) { v[o + 3] = N.data[i * 3]; v[o + 4] = N.data[i * 3 + 1]; v[o + 5] = N.data[i * 3 + 2]; } else v[o + 4] = 1;
      if (U) { v[o + 6] = U.data[i * 2]; v[o + 7] = U.data[i * 2 + 1]; }
      if (C) { for (let k = 0; k < 3; k++) v[o + 8 + k] = C.data[i * C.n + k]; v[o + 11] = 1; } else { v[o + 8] = v[o + 9] = v[o + 10] = v[o + 11] = 1; }
    }
    // skinning: joints + weights as a second vertex stream (4 + 4 floats)
    let jw = null;
    if (A.JOINTS_0 != null && A.WEIGHTS_0 != null) {
      const J = readAccessor(json, bin, A.JOINTS_0), Wt = readAccessor(json, bin, A.WEIGHTS_0);
      jw = new Float32Array(cnt * 8);
      for (let i = 0; i < cnt; i++) for (let k = 0; k < 4; k++) { jw[i * 8 + k] = J.data[i * 4 + k]; jw[i * 8 + 4 + k] = Wt.data[i * 4 + k]; }
    }
    let idx;
    if (pr.indices != null) idx = Uint32Array.from(readAccessor(json, bin, pr.indices).data);
    else idx = Uint32Array.from({ length: cnt }, (_, i) => i);
    let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
    for (let i = 0; i < cnt; i++) for (let k = 0; k < 3; k++) { const c = P.data[i * 3 + k]; if (c < min[k]) min[k] = c; if (c > max[k]) max[k] = c; }
    return { geo: { v, i: idx, jw }, material: mats[pr.material] || { name: 'default', color: [1, 1, 1, 1], rough: 1, metal: 0 }, min, max };
  }));
  const nodes = {};
  // node tree (rest TRS, parents) for skeletons and animation
  const N = json.nodes.map(n => ({ name: n.name, t: n.translation || [0, 0, 0], r: n.rotation || [0, 0, 0, 1], s: n.scale || [1, 1, 1], parent: -1, children: n.children || [] }));
  N.forEach((n, i) => n.children.forEach(c => { N[c].parent = i; }));
  const walk = (ni, parent) => {
    const n = json.nodes[ni];
    let m = n.matrix ? new Float32Array(n.matrix) : quatMat(n.translation, n.rotation, n.scale);
    if (parent) m = mulM(parent, m);
    N[ni].world = m;
    if (n.mesh != null) {
      const node = nodes[n.name] = { name: n.name, matrix: m, prims: meshes[n.mesh], index: ni };
      if (n.skin != null) {
        const sk = json.skins[n.skin], ib = sk.inverseBindMatrices != null ? readAccessor(json, bin, sk.inverseBindMatrices).data : null;
        node.skin = { joints: sk.joints, inv: sk.joints.map((_, k) => ib ? ib.slice(k * 16, k * 16 + 16) : quatMat()) };
      }
    }
    (n.children || []).forEach(c => walk(c, m));
  };
  const scene = json.scenes[json.scene || 0];
  scene.nodes.forEach(n => walk(n, null));
  // animations: per clip, channels of node TRS keyframes (linear)
  const anims = {};
  for (const a of json.animations || []) {
    const ch = a.channels.map(c => { const sm = a.samplers[c.sampler]; return { node: c.target.node, path: c.target.path, times: readAccessor(json, bin, sm.input).data, values: readAccessor(json, bin, sm.output) }; });
    anims[a.name] = { channels: ch, duration: Math.max(...ch.map(c => c.times[c.times.length - 1])) };
  }
  Object.defineProperty(nodes, '__rig', { value: { nodes: N, anims }, enumerable: false });
  return nodes;
}

function mulM(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

// ---- skeletal animation: evaluate a clip at time t, return the joint matrices of a skinned node (mesh space)
function sample(ch, t) {
  const T = ch.times, n = ch.values.n, V = ch.values.data;
  let i = 0; while (i < T.length - 2 && t > T[i + 1]) i++;
  const f = T.length < 2 ? 0 : Math.max(0, Math.min(1, (t - T[i]) / Math.max(1e-6, T[i + 1] - T[i])));
  const out = []; for (let k = 0; k < n; k++) out.push(V[i * n + k] + (V[Math.min(i + 1, T.length - 1) * n + k] - V[i * n + k]) * f);
  if (n === 4) { const l = Math.hypot(...out) || 1; for (let k = 0; k < 4; k++) out[k] /= l; }
  return out;
}
export function skinMatrices(rig, node, clip, t, out) {
  const N = rig.nodes, a = rig.anims[clip];
  const pose = N.map(n => ({ t: n.t, r: n.r, s: n.s }));
  if (a) { const tt = a.duration > 0 ? t % a.duration : 0; for (const ch of a.channels) pose[ch.node][ch.path === 'translation' ? 't' : ch.path === 'rotation' ? 'r' : 's'] = sample(ch, tt); }
  const world = new Array(N.length);
  const get = (i) => { if (world[i]) return world[i]; const m = quatMat(pose[i].t, pose[i].r, pose[i].s); world[i] = N[i].parent >= 0 ? mulM(get(N[i].parent), m) : m; return world[i]; };
  const inv = invM(N[node.index].world);   // back to the mesh's own space
  node.skin.joints.forEach((j, k) => out.set(mulM(inv, mulM(get(j), node.skin.inv[k])), k * 16));
  return out;
}
function invM(m) {
  const a = m, o = new Float32Array(16);
  const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5],
    b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6], b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12],
    b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det; o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
  o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det; o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
  o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det; o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
  o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det; o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
  return o;
}
