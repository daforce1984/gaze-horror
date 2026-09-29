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
    let idx;
    if (pr.indices != null) idx = Uint32Array.from(readAccessor(json, bin, pr.indices).data);
    else idx = Uint32Array.from({ length: cnt }, (_, i) => i);
    let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
    for (let i = 0; i < cnt; i++) for (let k = 0; k < 3; k++) { const c = P.data[i * 3 + k]; if (c < min[k]) min[k] = c; if (c > max[k]) max[k] = c; }
    return { geo: { v, i: idx }, material: mats[pr.material] || { name: 'default', color: [1, 1, 1, 1], rough: 1, metal: 0 }, min, max };
  }));
  const nodes = {};
  const walk = (ni, parent) => {
    const n = json.nodes[ni];
    let m = n.matrix ? new Float32Array(n.matrix) : quatMat(n.translation, n.rotation, n.scale);
    if (parent) m = mulM(parent, m);
    if (n.mesh != null) nodes[n.name] = { name: n.name, matrix: m, prims: meshes[n.mesh] };
    (n.children || []).forEach(c => walk(c, m));
  };
  const scene = json.scenes[json.scene || 0];
  scene.nodes.forEach(n => walk(n, null));
  return nodes;
}

function mulM(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
