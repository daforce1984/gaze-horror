// Small forward WebGPU renderer: HDR MSAA scene pass + post-process pass
const SHARED = /* wgsl */`
struct Globals {
  viewProj: mat4x4f,
  camPos: vec4f,   // w = time
  bulbPos: vec4f,  // w = intensity
  bulbCol: vec4f,
  tvPos: vec4f,    // w = intensity
  tvCol: vec4f,
  moonPos: vec4f,  // w = intensity
  moonCol: vec4f,
  ambient: vec4f,  // w = fog density
  params: vec4f,   // x fear, y zoom, z glitch, w reveal
  ghostPos: vec4f, // w = ghost cold light
  extra: vec4f,    // x = door light, y = shadow strength, z = room decay 0..1, w = hand light
  shadowPos: vec4f,// xyz light, w = 1 when the moon owns the shadow map
  shift: vec4f,    // the other world spreading: xyz origin, w radius of the front
  shift2: vec4f,   // x decay behind the front, y decay inside, z burn (ember edge / ash), w ambient ash
};
struct Obj {
  model: mat4x4f,
  tint: vec4f,
  emissive: vec4f, // w = alpha cutoff
  uvx: vec4f,      // uv scale xy, offset zw
  flags: vec4f,    // x wrap lighting, y unlit, z ao amount, w emissive texture mode
  extra: vec4f,    // x: 1 = decaying surface (tex2 clean -> tex dirty), y ghost clip height, z 0<v<1 forming out of ash, w 1 = ash flakes
  pbr: vec4f,      // x normal map, y metal-rough map (2 = its red is occlusion), z roughness, w metalness
};
@group(0) @binding(0) var<uniform> G: Globals;
@group(1) @binding(0) var<uniform> O: Obj;
@group(1) @binding(1) var tex: texture_2d<f32>;
@group(1) @binding(2) var samp: sampler;
@group(1) @binding(3) var tex2: texture_2d<f32>;
@group(1) @binding(4) var ntex: texture_2d<f32>;
@group(1) @binding(5) var mtex: texture_2d<f32>;
@group(0) @binding(1) var shadowMap: texture_depth_2d_array;
@group(0) @binding(2) var shadowSamp: sampler_comparison;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,
  @location(3) col: vec4f,
};

fn hash21(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }

@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f, @location(3) c: vec4f) -> VOut {
  var o: VOut;
  var lp = p;
  // ghost mode: wet hair sway + glitch jitter (flags.w == 2)
  if (O.flags.w > 1.5) {
    let t = G.camPos.w;
    let hairy = step(0.5, O.uvx.z);
    lp.x += sin(t * 1.7 + p.y * 5.0) * 0.006 * hairy * (1.5 - p.y);
    lp.z += cos(t * 1.3 + p.y * 4.0) * 0.004 * hairy;
    let g = G.params.z;
    let row = floor(p.y * 18.0);
    lp.x += (hash21(vec2f(row, floor(t * 20.0))) - 0.5) * 0.06 * g * step(0.8, hash21(vec2f(row * 3.1, floor(t * 13.0))));
    // vanishing (extra.z 0..1): she tears into slices that jerk sideways, faster and wider as she goes
    let vz = O.extra.z;
    if (vz > 0.0) {
      let vr = floor(p.y * 26.0);
      let jer = hash21(vec2f(vr, floor(t * 24.0))) - 0.5;
      lp.x += jer * 0.45 * vz * step(0.45 - vz * 0.4, hash21(vec2f(vr * 1.7, floor(t * 17.0))));
      lp.z += (hash21(vec2f(vr + 5.0, floor(t * 19.0))) - 0.5) * 0.15 * vz;
    }
  }
  if (O.extra.w > 0.5) {   // peeling flake: p = its place on the surface, n = surface normal, uv = corner, c = (rand, size, rand)
    let t = G.camPos.w;
    let behind = G.shift.w - frontDist(p);                  // how far the front has already gone past this spot
    let life = clamp(behind / (0.9 + c.z * 0.9), 0.0, 1.0);
    let alive = step(0.0, behind) * step(life, 0.999) * step(0.001, G.shift2.z) * step(0.35, changeAt(p));   // only what actually turns peels
    let peel = smoothstep(0.0, 0.3, life);
    var t1 = cross(n, vec3f(0.0, 1.0, 0.0));
    if (length(t1) < 0.1) { t1 = vec3f(1.0, 0.0, 0.0); }
    t1 = normalize(t1);
    let t2 = cross(n, t1);
    // curl out of the surface around its own edge, then tumble slowly as it rises
    let ang = peel * (0.9 + c.x * 1.1) + life * (1.2 + c.x * 2.0) * sign(c.z - 0.5) + sin(t * 6.0 + c.x * 30.0) * 0.7 * life;   // flutter
    let a2 = t2 * cos(ang) + n * sin(ang);
    let size = mix(0.06, 0.13, c.y) * alive;
    let q = (uv - vec2f(0.5)) * size;
    // scatter: each flake gets its own direction and speed off the surface (some up, some sideways, a few
    // falling), plus turbulence, so nothing moves in step
    // burnt paper in an updraft: pushed off the wall, then carried up, drifting and fluttering; walls and ceiling stop it
    let hr = fract(sin(vec3f(c.x * 91.7, c.z * 57.3, c.y * 23.1) + p.yzx * 3.7) * 43758.5453) * 2.0 - vec3f(1.0);
    let lf = max(life - 0.12, 0.0);
    let up = pow(lf, 1.25) * (0.8 + 0.9 * fract(c.z * 13.7));
    let away = n * (0.12 + 0.3 * fract(c.x * 7.1)) * smoothstep(0.0, 0.5, lf);
    let drift = vec3f(hr.x, 0.0, hr.z) * lf * 0.5;
    let sway = vec3f(sin(t * 2.1 + c.x * 20.0), 0.0, cos(t * 1.7 + c.z * 13.0)) * 0.1 * lf + vec3f(0.0, sin(t * 3.3 + c.y * 9.0) * 0.03 * lf, 0.0);
    var center = p + n * (0.003 + peel * 0.07) + away + drift + sway + vec3f(0.0, up, 0.0);
    // collisions: fold back inside the room (a soft bounce off walls, sliding along the ceiling)
    let lo = vec3f(-2.16, 0.03, -2.46); let hi = vec3f(2.16, 2.55, 2.46);
    center = select(center, lo + (lo - center) * 0.25, center < lo);
    center = select(center, hi - (center - hi) * 0.25, center > hi);
    var wp = center + t1 * q.x + a2 * q.y;
    if (c.w > 1.5) {   // a dust grain shed by this flake as it crumbles: drifts away, sinks a little, fades
      let di = c.w - 1.0;
      let h = fract(sin(vec3f(di * 12.9, di * 78.2, di * 37.7) + c.xyz * 43.1) * 43758.5);
      let shed = clamp((life - 0.3 - h.x * 0.25) / 0.45, 0.0, 1.0);
      let dir = normalize(h * 2.0 - vec3f(1.0) + n * 0.6 + vec3f(0.0, 0.15, 0.0));
      let gp = center + (t1 * (h.y - 0.5) + a2 * (h.z - 0.5)) * mix(0.06, 0.13, c.y) + dir * shed * (0.12 + h.y * 0.22) + vec3f(0.0, -shed * shed * 0.08, 0.0);
      let gs = mix(0.006, 0.016, h.z) * step(0.001, shed) * (1.0 - shed) * alive;
      let f = normalize(gp - G.camPos.xyz); let r = normalize(cross(f, vec3f(0.0, 1.0, 0.0))); let u2 = cross(r, f);
      wp = gp + (r * (uv.x - 0.5) + u2 * (uv.y - 0.5)) * gs;
      o.pos = G.viewProj * vec4f(wp, 1.0);
      o.wp = wp; o.n = vec3f(0.0); o.uv = uv; o.col = vec4f(c.x, 2.0 + shed, (1.0 - shed), 1.0);   // col.y > 1.5 marks dust
      return o;
    }
    o.pos = G.viewProj * vec4f(wp, 1.0);
    o.wp = wp;
    // which bit of wallpaper this flake was (same world mapping for every flake)
    let su = select(select(vec2f(p.x, p.z), vec2f(p.x, p.y), abs(n.z) > 0.5), vec2f(p.z, p.y), abs(n.x) > 0.5);
    o.n = vec3f(su * 0.9, 0.0);
    o.uv = uv; o.col = vec4f(c.x, life, alive * (1.0 - smoothstep(0.65, 1.0, life)), 1.0);
    return o;
  }
  var w = O.model * vec4f(lp, 1.0);
  if (O.flags.w > 1.5 && O.extra.z > 0.0) {   // her head and shoulders lunge at you as she goes
    let vz = O.extra.z;
    w = vec4f(w.xyz + normalize(G.camPos.xyz - w.xyz) * sin(min(vz * 1.4, 1.0) * 3.14159) * 0.55 * smoothstep(0.35, 1.3, p.y), 1.0);
  }
  o.pos = G.viewProj * w;
  o.wp = w.xyz;
  let wn = (O.model * vec4f(n, 0.0)).xyz;
  o.n = select(vec3f(0.0), normalize(wn), length(wn) > 1e-6);
  o.uv = uv * O.uvx.xy + select(O.uvx.zw, vec2f(0.0), O.flags.w > 1.5);
  o.col = c;
  return o;
}

const SH_NEAR = 0.04;
const SH_FAR = 14.0;
fn shadowAt(p: vec3f, n: vec3f) -> f32 {
  let d = p + n * 0.012 - G.shadowPos.xyz;
  let a = abs(d);
  var face = 0; var up = vec3f(0.0, 1.0, 0.0); var right = vec3f(0.0, 0.0, 1.0); var dz = a.x;
  if (a.x >= a.y && a.x >= a.z) {
    if (d.x > 0.0) { face = 0; right = vec3f(0.0, 0.0, 1.0); } else { face = 1; right = vec3f(0.0, 0.0, -1.0); }
    dz = a.x;
  } else if (a.y >= a.z) {
    up = vec3f(0.0, 0.0, 1.0);
    if (d.y > 0.0) { face = 2; right = vec3f(1.0, 0.0, 0.0); } else { face = 3; right = vec3f(-1.0, 0.0, 0.0); }
    dz = a.y;
  } else {
    if (d.z > 0.0) { face = 4; right = vec3f(-1.0, 0.0, 0.0); } else { face = 5; right = vec3f(1.0, 0.0, 0.0); }
    dz = a.z;
  }
  let uv = vec2f(dot(d, right) / dz * 0.5 + 0.5, 0.5 - dot(d, up) / dz * 0.5);
  let depth = SH_FAR / (SH_FAR - SH_NEAR) * (1.0 - SH_NEAR / dz) - 0.00015;
  let texel = 1.0 / f32(textureDimensions(shadowMap).x);
  var s = 0.0;
  for (var i = -1; i <= 1; i++) {
    for (var j = -1; j <= 1; j++) {
      s += textureSampleCompareLevel(shadowMap, shadowSamp, clamp(uv + vec2f(f32(i), f32(j)) * texel * 2.2, vec2f(0.0), vec2f(1.0)), face, depth);
    }
  }
  return mix(1.0, s / 9.0, G.extra.y);
}

fn hash31(p: vec3f) -> f32 { return fract(sin(dot(p, vec3f(127.1, 311.7, 74.7))) * 43758.5453); }
fn noise3(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  let a = mix(mix(hash31(i), hash31(i + vec3f(1.0, 0.0, 0.0)), u.x), mix(hash31(i + vec3f(0.0, 1.0, 0.0)), hash31(i + vec3f(1.0, 1.0, 0.0)), u.x), u.y);
  let b = mix(mix(hash31(i + vec3f(0.0, 0.0, 1.0)), hash31(i + vec3f(1.0, 0.0, 1.0)), u.x), mix(hash31(i + vec3f(0.0, 1.0, 1.0)), hash31(i + vec3f(1.0, 1.0, 1.0)), u.x), u.y);
  return mix(a, b, u.z);
}
// how rotten this spot of the room is (0 clean .. 1 rotten); stains creep out of corners, floor and ceiling
fn frontDist(p: vec3f) -> f32 { return length(p - G.shift.xyz) + (noise3(p * 2.3) - 0.5) * 0.9; }
fn roomDecay(p: vec3f) -> f32 {
  if (G.shift.w > 50.0) { return G.shift2.y; }   // no change rolling through the room right now
  let passed = 1.0 - smoothstep(G.shift.w - 0.5, G.shift.w, frontDist(p));
  return mix(G.shift2.x, G.shift2.y, passed);
}
// the burning, peeling edge right behind the front
fn burnBand(p: vec3f) -> f32 {
  if (G.shift2.z <= 0.0) { return 0.0; }
  let k = G.shift.w - frontDist(p);
  return G.shift2.z * smoothstep(-0.1, 0.12, k) * (1.0 - smoothstep(0.15, 0.7, k));
}
// how prone a spot is to rot (fixed per point); a decay level d turns it into a mask
fn rotField(p: vec3f) -> f32 {
  let n = noise3(p * 1.7) * 0.55 + noise3(p * 5.3) * 0.3 + noise3(p * 13.0) * 0.15;
  let dx = 2.2 - abs(p.x); let dz = 2.5 - abs(p.z);
  let m2 = secondMin(dx, dz, p.y, 2.6 - p.y);
  let edge = 1.0 - smoothstep(0.0, 1.2, m2);
  let drip = smoothstep(1.2, 2.6, p.y) * noise3(vec3f(p.x * 9.0, p.y * 0.8, p.z * 9.0));
  return n * 0.6 + edge * 0.3 + drip * 0.25;
}
fn maskAt(v: f32, d: f32) -> f32 {
  if (d <= 0.001) { return 0.0; }
  let th = 1.05 - d * 1.25;
  return smoothstep(th - 0.06, th + 0.06, v);
}
// how much this spot actually turns in the current shift (0 where nothing changes)
fn changeAt(p: vec3f) -> f32 {
  let v = rotField(p);
  return clamp(maskAt(v, G.shift2.y) - maskAt(v, G.shift2.x), 0.0, 1.0);
}
fn decayMask(p: vec3f) -> f32 {
  return maskAt(rotField(p), roomDecay(p));
}

fn secondMin(a: f32, b: f32, c: f32, d: f32) -> f32 {
  return min(max(min(a, b), min(c, d)), min(max(a, b), max(c, d)));
}

fn roomAO(p: vec3f) -> f32 {
  let dx = 2.2 - abs(p.x); let dz = 2.5 - abs(p.z);
  let m2 = secondMin(dx, dz, p.y, 2.6 - p.y);
  return 0.35 + 0.65 * smoothstep(0.0, 0.75, m2);
}

fn wrapDiffuse(n: vec3f, l: vec3f, wrap: f32) -> f32 {
  return max((dot(n, l) + wrap) / (1.0 + wrap), 0.0);
}

fn lighting(p: vec3f, nIn: vec3f, wrap: f32, spec: f32) -> vec3f {
  var n = nIn;
  if (dot(n, normalize(G.camPos.xyz - p)) < 0.0) { n = -n; }
  return lightingS(p, nIn, wrap, spec, shadowAt(p, n));
}
fn lightingS(p: vec3f, nIn: vec3f, wrap: f32, spec: f32, sh: f32) -> vec3f {
  var n = nIn;
  let V = normalize(G.camPos.xyz - p);
  if (dot(n, V) < 0.0) { n = -n; }
  var c = G.ambient.rgb;
  let bulbSh = select(sh, 1.0, G.shadowPos.w > 0.5);
  let moonSh = select(1.0, sh, G.shadowPos.w > 0.5);
  // hanging bulb
  let bl = G.bulbPos.xyz - p; let bd = length(bl); let bn = bl / bd;
  let bdiff = wrapDiffuse(n, bn, wrap);
  let bspec = pow(max(dot(n, normalize(bn + V)), 0.0), 22.0) * spec * 0.6;
  c += G.bulbCol.rgb * G.bulbPos.w * (bdiff + bspec) * bulbSh / (1.0 + bd * bd * 1.6);
  // CRT: forward cone towards +z
  let tl = G.tvPos.xyz - p; let td = length(tl); let tn = tl / td;
  let cone = pow(max(-tn.z, 0.0), 1.3);
  let tspec = pow(max(dot(n, normalize(tn + V)), 0.0), 40.0) * spec;
  c += G.tvCol.rgb * G.tvPos.w * (wrapDiffuse(n, tn, wrap) + tspec) * cone / (1.0 + td * td * 0.9);
  // moonlight through the window (towards +x)
  let ml = G.moonPos.xyz - p; let md = length(ml); let mn = ml / md;
  let mcone = pow(max(-mn.x, 0.0), 1.1);
  let mspec = pow(max(dot(n, normalize(mn + V)), 0.0), 40.0) * spec;
  c += G.moonCol.rgb * G.moonPos.w * (wrapDiffuse(n, mn, wrap) + mspec) * mcone * moonSh / (1.0 + md * md * 0.5);
  // cold glow around the ghost
  let gl = G.ghostPos.xyz - p; let gd = length(gl);
  c += vec3f(0.35, 0.5, 0.6) * G.ghostPos.w * wrapDiffuse(n, gl / max(gd, 0.001), 0.5) / (1.0 + gd * gd * 6.0);
  // faint light from the player's own position (to read things held in the lap)
  let hl = G.camPos.xyz + vec3f(0.0, 0.25, 0.1) - p; let hd = length(hl);
  c += vec3f(1.0, 0.9, 0.75) * G.extra.w * wrapDiffuse(n, hl / hd, 0.3) / (1.0 + hd * hd * 18.0);
  // light spilling through the door at the end
  let dpos = mix(vec3f(0.7, 0.06, 2.3), vec3f(0.7, 1.1, 2.9), clamp(G.extra.x * 2.0, 0.0, 1.0));  // under the door → the open corridor
  let dl = dpos - p; let dd = length(dl);
  c += vec3f(1.0, 0.95, 0.85) * G.extra.x * wrapDiffuse(n, dl / dd, 0.3) / (1.0 + dd * dd * 0.4);
  return c;
}

fn fog(col: vec3f, p: vec3f) -> vec3f {
  let d = length(p - G.camPos.xyz);
  let f = exp(-d * G.ambient.w);
  return mix(vec3f(0.004, 0.006, 0.008), col, f);
}
`;

const LIT = SHARED + /* wgsl */`
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  // every implicit-derivative operation first, while control flow is still uniform
  var t = textureSample(tex, samp, i.uv);
  let t2 = textureSample(tex2, samp, i.uv);
  let tn = textureSample(ntex, samp, i.uv).xyz * 2.0 - 1.0;
  let mr = textureSample(mtex, samp, i.uv);
  let n0 = normalize(i.n + vec3f(0.0, 1e-6, 0.0));
  let dp1 = dpdx(i.wp); let dp2 = dpdy(i.wp); let duv1 = dpdx(i.uv); let duv2 = dpdy(i.uv);   // cotangent frame for normal maps
  let paper = textureSample(tex, samp, i.n.xy + (i.uv - vec2f(0.5)) * 0.07).rgb;           // flakes: the wallpaper they were
  if (O.extra.w > 0.5 && i.col.y > 1.5) {   // dust grain
    let dq = length(i.uv - vec2f(0.5)) * 2.0;
    let da = (1.0 - smoothstep(0.4, 1.0, dq)) * i.col.z * 0.85;
    if (da < 0.01) { discard; }
    let cool = clamp((i.col.y - 2.0) * 1.6, 0.0, 1.0);
    let dc = mix(vec3f(0.14, 0.012, 0.008), vec3f(0.04, 0.005, 0.005), cool);   // dark red crumbs
    return vec4f(fog(dc, i.wp), da);
  }
  if (O.extra.w > 0.5) {   // peeling flake: old wallpaper on its face, rust eating in from the ragged edge
    let q = (i.uv - vec2f(0.5)) * 2.0;
    let edge = max(abs(q.x), abs(q.y)) * 0.6 + length(q) * 0.4 + (noise3(vec3f(i.uv * 6.0, i.col.x * 17.0)) - 0.5) * 0.55;
    // eaten away: little bites from the rim inwards and holes opening inside, until nothing is left (no coloured rim)
    let life = i.col.y;
    let bites = noise3(vec3f(i.uv * 9.0, i.col.x * 13.0)) * 0.55 + noise3(vec3f(i.uv * 23.0, i.col.x * 7.0)) * 0.3 + noise3(vec3f(i.uv * 51.0, i.col.x * 3.0)) * 0.15;
    let inner = (1.0 - edge) * 0.55 + bites * 0.45;
    if (inner < smoothstep(0.1, 1.0, life) * 0.95) { discard; }
    let a = (1.0 - smoothstep(0.62, 0.8, edge)) * i.col.z * O.tint.a;
    if (a < 0.01) { discard; }
    let rustN = noise3(vec3f(i.uv * 9.0, i.col.x * 5.0));
    let rustAmt = clamp(0.25 + i.col.y * 1.8 + smoothstep(0.25, 0.7, edge) * 0.9 + (rustN - 0.5) * 0.5, 0.0, 1.0);
    let rust = mix(vec3f(0.36, 0.14, 0.05), vec3f(0.12, 0.05, 0.03), rustN);
    // what falls away is not paper any more: dark, clotted red-black lumps
    let clot = noise3(vec3f(i.uv * 7.0, i.col.x * 9.0));
    var col = mix(vec3f(0.11, 0.006, 0.005), vec3f(0.035, 0.004, 0.004), clot) * (0.85 + 0.3 * paper.r);
    col = col * (0.3 + 0.2 * G.bulbPos.w / 4.0 + G.ambient.r * 4.0);

    return vec4f(fog(col, i.wp), a);
  }
  var ember = 0.0;
  if (O.extra.x > 0.5 && O.extra.x < 1.5) {   // a decaying surface (walls, floor, ceiling)
    let dm = decayMask(i.wp);
    let rim = 1.0 - abs(dm * 2.0 - 1.0);           // water-stain edge where rot meets clean paper
    t = mix(t2, t, dm);
    let burn = burnBand(i.wp);
    let chg = select(0.0, changeAt(i.wp), burn > 0.0);   // does this spot actually turn in this shift?
    // while the front passes, the edge between the two worlds chars and glows like burning paper
    t = vec4f(t.rgb * (1.0 - 0.45 * rim * step(0.02, roomDecay(i.wp))), t.a);   // (the flaking itself is real geometry now)
    // deep in the other world the paper is gone: rusted metal, dark drips running down
    let dl = roomDecay(i.wp);
    let ow = smoothstep(0.55, 0.95, dl) * dm;
    let rn = noise3(i.wp * 5.0) * 0.6 + noise3(i.wp * 23.0) * 0.4;
    let drip = smoothstep(0.55, 0.8, noise3(vec3f(i.wp.x * 34.0 + i.wp.z * 34.0, i.wp.y * 1.6, i.wp.z * 7.0)));
    let metal = mix(vec3f(0.2, 0.07, 0.03), vec3f(0.46, 0.2, 0.07), rn) * (1.0 - 0.7 * drip) + vec3f(0.1, 0.0, 0.0) * drip * rn;
    t = vec4f(mix(t.rgb, metal, ow * 0.85), t.a);
    let rustC = mix(vec3f(0.34, 0.13, 0.05), vec3f(0.14, 0.06, 0.03), noise3(i.wp * 14.0));


  }
  // things that form out of the ash: burn in from the floor up with a glowing edge
  var formEdge = 0.0;
  if (O.extra.z > 0.0 && O.extra.z < 1.0) {
    let v = noise3(i.wp * 11.0) * 0.55 + noise3(i.wp * 3.1) * 0.25 + clamp((i.wp.y - O.model[3].y) * 0.9, 0.0, 1.0) * 0.3;
    let th = O.extra.z * 1.15;
    if (v > th) { discard; }
    formEdge = 1.0 - smoothstep(0.0, 0.08, th - v);
  }
  let a = t.a * O.tint.a;
  if (a < O.emissive.w) { discard; }
  var col: vec3f;
  var alb = t.rgb * O.tint.rgb;
  // everything in the room rots with it: drained colour, grime, blood; photos and drawings melt (extra.x == 2)
  if ((O.extra.x < 0.5 || O.extra.x > 1.5) && O.flags.y < 0.5 && O.flags.w < 0.5) {
    let dlp = roomDecay(i.wp);
    let kc = smoothstep(0.3, 1.0, dlp);
    if (kc > 0.0) {
      var a2 = alb;
      if (O.extra.x > 1.5) {
        let mu = i.uv + vec2f((noise3(vec3f(i.uv.y * 9.0, 3.0, 1.0)) - 0.5) * 0.03, -abs(noise3(vec3f(i.uv.x * 16.0, 0.0, 2.0)) - 0.35) * 0.18) * kc;
        a2 = textureSampleLevel(tex, samp, mu, 0.0).rgb * O.tint.rgb;
        a2 = mix(a2, vec3f(dot(a2, vec3f(0.3, 0.59, 0.11))) * vec3f(1.0, 0.72, 0.66), 0.7 * kc);
      }
      a2 = mix(a2, vec3f(dot(a2, vec3f(0.3, 0.59, 0.11))) * vec3f(0.85, 0.7, 0.6), kc * 0.6) * (1.0 - 0.45 * kc);
      let stain = smoothstep(0.55, 0.75, noise3(i.wp * 6.0 + vec3f(3.3))) * kc;
      a2 = mix(a2, vec3f(0.1, 0.06, 0.035), stain * 0.7);
      let blood = smoothstep(0.68, 0.8, noise3(i.wp * 11.0 + vec3f(7.1))) * smoothstep(0.5, 1.0, dlp);
      a2 = mix(a2, vec3f(0.22, 0.01, 0.01), blood * 0.85);
      alb = a2;
    }
  }
  if (O.flags.y > 0.5) {
    col = alb;
  } else {
    var ao = sqrt(i.col.r);
    var nrm = n0;
    var spec = O.flags.z;
    if (O.pbr.x > 0.5) {
      let p1 = cross(n0, dp1); let p2 = cross(dp2, n0);
      let T = p2 * duv1.x + p1 * duv2.x; let B = p2 * duv1.y + p1 * duv2.y;
      let im = inverseSqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
      let nn = T * im * tn.x - B * im * tn.y + n0 * max(tn.z, 0.05);   // glTF normal maps are +y up, uv v runs down
      nrm = select(n0, normalize(nn), dot(nn, nn) > 1e-8);
    }
    var metal = O.pbr.w;
    if (O.pbr.y > 0.5) {
      let rough = clamp(mr.g * O.pbr.z, 0.04, 1.0);
      metal = mr.b * O.pbr.w;
      spec = (1.0 - rough) * (1.0 - rough) * 1.6;
      if (O.pbr.y > 1.5) { ao = ao * mix(1.0, mr.r, 0.85); }
    }
    col = alb * lighting(i.wp, nrm, O.flags.x, spec) * ao * (1.0 - 0.55 * metal);
  }
  if (O.flags.w > 0.5) { col += t.rgb * O.emissive.rgb; } else { col += O.emissive.rgb * t.a; }
  // the more a spot has rotted, the more the room's corners and edges swallow the light
  {
    let cx = 2.2 - abs(i.wp.x); let cz = 2.5 - abs(i.wp.z);
    let edge = secondMin(cx, cz, i.wp.y, 2.6 - i.wp.y);     // near two boundaries = in a corner / along an edge
    let wall = min(min(cx, cz), min(i.wp.y + 0.6, 2.6 - i.wp.y));
    let dk = clamp(roomDecay(i.wp) * 1.1, 0.0, 1.0) * 0.8;
    let k = select(dk, 0.0, O.flags.y > 0.5 || O.flags.w > 0.5);   // not the TV picture, clock face or glowing things
    col = col * mix(1.0, 0.08 + 0.92 * smoothstep(0.0, 1.5, edge) * mix(0.55, 1.0, smoothstep(0.0, 0.9, wall)), k);
  }
  col = col * (1.0 - 0.8 * formEdge) + vec3f(1.0, 0.3, 0.05) * (ember * 0.35 + formEdge * 1.2);
  col = fog(col, i.wp);
  return vec4f(col, a);
}
`;

const GHOST = SHARED + /* wgsl */`
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let time = G.camPos.w;
  if (O.extra.y > 0.0 && i.wp.y > O.extra.y) { discard; }   // only her feet show under the curtain
  if (O.flags.y > 0.5) { return vec4f(textureSample(tex, samp, i.uv).rgb * O.tint.rgb * select(1.0, i.col.r, O.flags.y > 1.5), 1.0); }
  // screen-door fade so she can materialise without sorting problems
  let a = O.tint.a;
  if (a < 0.995 && a < hash21(floor(i.pos.xy))) { discard; }   // screen-door only while fading
  let t = textureSample(tex, samp, i.uv);
  let ao = select(sqrt(clamp(i.col.r, 0.0, 1.0)), 1.0, O.emissive.w > 0.999);
  // scanned meshes have spots where opposite faces cancel the vertex normal: fall back to facing the viewer
  let nl = length(i.n);
  // the photographic texture already carries its shading: light her with a viewer-facing normal
  // (scan normals are noisy), and take only a soft half-lambert form term from the mesh
  let nrm = normalize(G.camPos.xyz - i.wp);
  let nm = select(nrm, i.n / max(nl, 1e-6), nl > 1e-3);
  let form = mix(0.5, 1.05, clamp(dot(nm, normalize(nrm + vec3f(0.0, 0.9, 0.0))) * 0.5 + 0.5, 0.0, 1.0));
  // no self-shadowing: thin cloth and hair would acne against their own shadow map
  var col = t.rgb * O.tint.rgb * lightingS(i.wp, nrm, O.flags.x, O.flags.z, 1.0) * ao * form * 1.15 + t.rgb * O.emissive.rgb * ao;
  col = mix(col, col * vec3f(0.8, 1.0, 1.12), 0.5);
  let Vg = normalize(G.camPos.xyz - i.wp);
  let rim = pow(1.0 - clamp(abs(dot(nm, Vg)), 0.0, 1.0), 2.5) * select(1.0, 0.25, O.uvx.w > 0.5);
  col += vec3f(0.35, 0.45, 0.55) * rim * 0.55 * (0.4 + 0.6 * ao);
  // vanishing: she goes black and crumbles into ash from the feet up, a dark red line where she comes apart
  let vz = O.extra.z;
  if (vz > 0.0) {
    let hgt = (i.wp.y - O.model[3].y) / max(length(O.model[1].xyz), 0.01);
    let an = noise3(i.wp * 14.0 + vec3f(0.0, -time * 2.5, 0.0)) * 0.6 + noise3(i.wp * 4.0) * 0.4;
    let lv = hgt * 0.55 + an * 0.6;
    let thr = smoothstep(0.25, 1.0, vz) * 1.55 - 0.08;   // black first, then the ash eats her from the feet up
    if (lv < thr) { discard; }
    let edgeV = 1.0 - smoothstep(0.0, 0.03, lv - thr);
    col = mix(col, vec3f(0.004, 0.003, 0.003), smoothstep(0.0, 0.3, vz));
    col += vec3f(0.05, 0.002, 0.002) * edgeV;   // barely a colour at the tear: she just comes apart into black
    col = fog(col, i.wp);
    return vec4f(col, 1.0);
  }
  if (O.uvx.z > 0.5) {
    // hair: one flat wet-black with a faint cold sheen, independent of each lock's normal,
    // so overlapping locks never flicker against each other
    let lum = dot(lighting(i.wp, vec3f(0.0, 1.0, 0.0), 1.0, 0.0), vec3f(0.33));
    col = vec3f(0.006, 0.007, 0.009) + vec3f(0.012, 0.016, 0.02) * clamp(lum, 0.0, 2.0) + vec3f(0.05, 0.065, 0.08) * rim * 0.35;
  }
  col = fog(col, i.wp);
  return vec4f(col, 1.0);
}
`;

const SHADOW = /* wgsl */`
struct SG { viewProj: mat4x4f, lightPos: vec4f };
struct Obj { model: mat4x4f, tint: vec4f, emissive: vec4f, uvx: vec4f, flags: vec4f, extra: vec4f, pbr: vec4f };
@group(0) @binding(0) var<uniform> G: SG;
@group(1) @binding(0) var<uniform> O: Obj;
@vertex fn vs(@location(0) p: vec3f) -> @builtin(position) vec4f {
  return G.viewProj * (O.model * vec4f(p, 1.0));
}
`;

const POST = /* wgsl */`
struct Post {
  res: vec4f,    // w,h,time,aspect
  a: vec4f,      // exposure, fear, blackout, grain
  flash: vec4f,  // rgb, amount
  cue: vec4f,    // dir xy (screen), strength, heartbeat pulse
  b: vec4f,      // chroma, warp, vignette, noiseBands
  ins: vec4f,    // insanity amount, ghost screen uv xy, ghost on screen
  ins2: vec4f,   // x: invert flash, y: stare time, z: frost (cold), w: inspect dim
};
@group(0) @binding(0) var<uniform> P: Post;
@group(0) @binding(1) var hdr: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VO {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VO;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.uv = vec2f((p[vi].x + 1.0) * 0.5, 1.0 - (p[vi].y + 1.0) * 0.5);
  return o;
}
fn h(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2f(1.0, 0.0)), u.x), mix(h(i + vec2f(0.0, 1.0)), h(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn fbm(p0: vec2f) -> f32 {
  var p = p0; var a = 0.5; var s = 0.0;
  for (var k = 0; k < 4; k++) { s += vnoise(p) * a; p = p * 2.03 + vec2f(3.1, 1.7); a *= 0.5; }
  return s;
}
fn rot2(v: vec2f, a: f32) -> vec2f { let c = cos(a); let s = sin(a); return vec2f(c * v.x - s * v.y, s * v.x + c * v.y); }
fn aces(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let time = P.res.z;
  var uv = i.uv;
  var d = uv - 0.5;
  let r2 = dot(d, d);
  let ins = P.ins.x;
  let asp = P.res.w;
  // ---- insanity: the room breathes
  let breath = sin(time * 1.9) * 0.5 + 0.5;
  uv = 0.5 + d * (1.0 + P.b.y * r2 + ins * 0.07 * sin(time * 2.1 + r2 * 9.0) - ins * 0.03 * breath);
  if (ins > 0.001) {
    // swirl that drags the view towards her
    let gp = select(vec2f(0.5), P.ins.yz, P.ins.w > 0.5);
    var q = (uv - gp) * vec2f(asp, 1.0);
    let dist = length(q);
    let ang = ins * ins * 1.4 * exp(-dist * 2.4) * sin(time * 0.6 + dist * 3.0);
    q = rot2(q, ang);
    uv = gp + q / vec2f(asp, 1.0);
    uv = mix(uv, gp, ins * 0.08 * exp(-dist * 1.5) * (0.5 + 0.5 * sin(time * 3.0)));
    // melting horizontal waves
    uv.x += sin(uv.y * 23.0 + time * 4.0) * 0.005 * ins * ins;
    uv.y += sin(uv.x * 17.0 - time * 2.7) * 0.003 * ins * ins;
  }
  // tearing bands under stress
  let band = step(0.985 - P.b.w * 0.05, h(vec2f(floor(uv.y * 40.0), floor(time * 18.0))));
  uv.x += band * (h(vec2f(time, uv.y)) - 0.5) * 0.04 * P.b.w;
  d = uv - 0.5;
  let ca = P.b.x + ins * 0.012;
  var col = vec3f(
    textureSampleLevel(hdr, samp, uv - d * ca, 0.0).r,
    textureSampleLevel(hdr, samp, uv, 0.0).g,
    textureSampleLevel(hdr, samp, uv + d * ca, 0.0).b);
  if (ins > 0.05) {
    // double vision: a drifting, slightly rotated second image
    let off = vec2f(cos(time * 0.9), sin(time * 1.3)) * 0.018 * ins;
    let uv2 = 0.5 + rot2(uv - 0.5 + off, 0.02 * ins * sin(time * 0.7));
    let ghostImg = textureSampleLevel(hdr, samp, uv2, 0.0).rgb;
    col = mix(col, max(col, ghostImg), 0.55 * ins);
  }
  col *= P.a.x;
  col = aces(col);
  // grade: crush, desaturate, cold shadows
  let l = dot(col, vec3f(0.299, 0.587, 0.114));
  col = mix(vec3f(l), col, 0.62);
  col = col * vec3f(0.92, 1.0, 1.04) + vec3f(0.0, 0.004, 0.008) * (1.0 - l);
  // insanity grade: drained, sickly, red-soaked shadows
  if (ins > 0.001) {
    let ll = dot(col, vec3f(0.299, 0.587, 0.114));
    let sick = vec3f(ll * 1.1, ll * 0.92, ll * 0.8) + vec3f(0.016, 0.0, 0.0) * (1.0 - ll) * ins;
    col = mix(col, sick, ins * 0.7);
    col *= 1.0 - 0.3 * ins * P.cue.w;  // pulses with the heartbeat
  }
  // vignette (aspect aware) closes into a tunnel
  let dv = d * vec2f(max(P.res.w, 1.0), max(1.0 / P.res.w, 1.0));
  let vig = 1.0 - smoothstep(0.3 - ins * 0.12, 1.05 - ins * 0.3, length(dv) * P.b.z);
  col *= vig;
  // veins creeping in from the edges
  if (ins > 0.15) {
    let pol = vec2f(atan2(dv.y, dv.x) * 2.5, length(dv) * 5.0 - time * 0.15);
    let n = fbm(pol * vec2f(1.0, 1.4) + vec2f(0.0, time * 0.05));
    let vein = 1.0 - smoothstep(0.02, 0.07, abs(n - 0.5));
    let reach = smoothstep(0.95 - ins * 0.6, 1.1 - ins * 0.4, length(dv) * 1.25);
    col = mix(col, vec3f(0.035, 0.0, 0.004), vein * reach * smoothstep(0.15, 0.6, ins));
    col = mix(col, vec3f(0.006, 0.0, 0.0), reach * 0.6 * smoothstep(0.3, 1.0, ins));
  }
  // direction cue: faint red pulse at the screen edge towards the ghost
  if (P.cue.z > 0.001) {
    let dn = normalize(dv + vec2f(1e-5));
    let e = max(dot(dn, P.cue.xy), 0.0);
    let edge = smoothstep(0.35, 0.85, length(dv));
    col += vec3f(0.16, 0.01, 0.01) * pow(e, 8.0) * edge * P.cue.z * (0.5 + 0.5 * P.cue.w);
  }
  // grain + scanline
  let g = h(i.uv * P.res.xy + vec2f(time * 61.0, time * 17.0)) - 0.5;
  col += g * P.a.w;
  col *= 0.96 + 0.04 * sin(i.uv.y * P.res.y * 1.3);
  col *= 1.0 - P.a.z;
  col = mix(col, P.flash.rgb, P.flash.w);
  // frost: the girl's touch drains warmth — ice creeps over the view
  let fr = P.ins2.z;
  if (fr > 0.001) {
    let lf = dot(col, vec3f(0.299, 0.587, 0.114));
    col = mix(col, vec3f(lf * 0.8, lf * 0.92, lf * 1.1), fr * 0.6);
    let crystal = fbm(i.uv * vec2f(asp, 1.0) * 24.0) * 0.6 + fbm(i.uv * vec2f(asp, 1.0) * 70.0) * 0.4;
    let edgeF = smoothstep(0.95 - fr * 0.5, 1.3 - fr * 0.35, length(dv) + crystal * 0.22);
    col = mix(col, vec3f(0.78, 0.88, 0.97) * (0.55 + crystal * 0.6), edgeF * fr);
  }
  col *= 1.0 - P.ins2.w * 0.55 * smoothstep(0.15, 0.6, length(dv));
  // brief negative flashes at the edge of sanity
  col = mix(col, vec3f(0.9, 0.85, 0.8) - col * 1.2, P.ins2.x);
  col = pow(max(col, vec3f(0.0)), vec3f(1.0 / 2.2));
  return vec4f(col, 1.0);
}
`;

const MIP = /* wgsl */`
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var s: sampler;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VO {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VO; o.pos = vec4f(p[vi], 0.0, 1.0);
  o.uv = vec2f((p[vi].x + 1.0) * 0.5, 1.0 - (p[vi].y + 1.0) * 0.5); return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f { return textureSampleLevel(src, s, i.uv, 0.0); }
`;

const VBL = [{ arrayStride: 48, attributes: [
  { shaderLocation: 0, offset: 0, format: 'float32x3' },
  { shaderLocation: 1, offset: 12, format: 'float32x3' },
  { shaderLocation: 2, offset: 24, format: 'float32x2' },
  { shaderLocation: 3, offset: 32, format: 'float32x4' }] }];
const SH_NEAR = 0.04, SH_FAR = 14.0;
// cube face bases: [right, up, forward]
const FACES = [
  [[0, 0, 1], [0, 1, 0], [1, 0, 0]], [[0, 0, -1], [0, 1, 0], [-1, 0, 0]],
  [[1, 0, 0], [0, 0, 1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, -1, 0]],
  [[-1, 0, 0], [0, 1, 0], [0, 0, 1]], [[1, 0, 0], [0, 1, 0], [0, 0, -1]]];

// frustum planes (a, b, c, d) of a column-major view-projection matrix, WebGPU depth 0..1
function frustum(m) {
  const row = (i) => [m[i], m[4 + i], m[8 + i], m[12 + i]];
  const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
  const pl = [r3.map((x, k) => x + r0[k]), r3.map((x, k) => x - r0[k]), r3.map((x, k) => x + r1[k]), r3.map((x, k) => x - r1[k]), r2, r3.map((x, k) => x - r2[k])];
  return pl.map(p => { const l = Math.hypot(p[0], p[1], p[2]) || 1; return p.map(x => x / l); });
}
function sphereIn(pl, c, r) {
  for (const p of pl) if (p[0] * c[0] + p[1] * c[1] + p[2] * c[2] + p[3] < -r) return false;
  return true;
}

export class Renderer {
  static async create(canvas, opts = {}) {
    if (!navigator.gpu) throw new Error('WebGPU unsupported');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter');
    // GPU timings per pass for the performance log, where the browser allows it
    const feats = adapter.features.has('timestamp-query') ? ['timestamp-query'] : [];
    const device = await adapter.requestDevice({ requiredFeatures: feats });
    const r = new Renderer(canvas, device, opts);
    const i = adapter.info || {};
    r.adapterInfo = { vendor: i.vendor, architecture: i.architecture, device: i.device, description: i.description, fallback: !!adapter.isFallbackAdapter };
    return r;
  }

  constructor(canvas, device, opts = {}) {
    this.canvas = canvas; this.device = device;
    this.ctx = canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device, format: this.format, alphaMode: 'opaque' });
    this.samples = 4;
    this.hdrFormat = 'rgba16float';
    const d = device;
    this.stats = { draws: 0, tris: 0, shadowDraws: 0, shadowTris: 0 };
    this.frameNo = 0;
    if (device.features.has('timestamp-query')) {
      this.ts = { qs: device.createQuerySet({ type: 'timestamp', count: 8 }), busy: false,
        res: device.createBuffer({ size: 64, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
        read: device.createBuffer({ size: 64, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }) };
    }
    this.gpuMs = null;   // { shadow, cctv, main, post } of the last measured frame
    this.shadowSize = opts.shadowSize || 1024;
    this.maxTex = opts.maxTex || 0;
    this.samplerShadow = d.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });
    this.globalsCam = d.createBuffer({ size: 320, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.globals = d.createBuffer({ size: 320, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.postBuf = d.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.samplerRepeat = d.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: opts.aniso || 8 });
    this.samplerClamp = d.createSampler({ addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
    this.samplerLinear = d.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    this.gLayout = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', viewDimension: '2d-array' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } }] });
    this.oLayout = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {} }] });
    this.setShadowSize(this.shadowSize);
    // CCTV: a small second view rendered to a texture shown on the TV
    this.camW = 320; this.camH = 240;
    this.camMsaa = d.createTexture({ size: [this.camW, this.camH], format: this.hdrFormat, sampleCount: this.samples, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.camDepth = d.createTexture({ size: [this.camW, this.camH], format: 'depth24plus', sampleCount: this.samples, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.camTex = d.createTexture({ size: [this.camW, this.camH], format: this.hdrFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.camTex._levels = 1;
    // shadow pass resources
    this.sLayout = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {} }] });
    this.sBufs = FACES.map(() => d.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    this.sBinds = this.sBufs.map(b => d.createBindGroup({ layout: this.sLayout, entries: [{ binding: 0, resource: { buffer: b } }] }));
    const shm = d.createShaderModule({ code: SHADOW });
    this.shadowPipe = d.createRenderPipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.sLayout, this.oLayout] }),
      vertex: { module: shm, entryPoint: 'vs', buffers: VBL },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 3, depthBiasSlopeScale: 2.5 },
    });
    const layout = d.createPipelineLayout({ bindGroupLayouts: [this.gLayout, this.oLayout] });
    const lit = d.createShaderModule({ code: LIT }), ghost = d.createShaderModule({ code: GHOST });
    const mk = (module, blend, depthWrite, a2c = false) => d.createRenderPipeline({
      layout,
      vertex: { module, entryPoint: 'vs', buffers: VBL },
      fragment: { module, entryPoint: 'fs', targets: [{ format: this.hdrFormat, blend }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: depthWrite, depthCompare: 'less-equal' },
      multisample: { count: this.samples, alphaToCoverageEnabled: a2c },
    });
    const alpha = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
    const add = { color: { srcFactor: 'src-alpha', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
    this.pipes = {
      opaque: mk(lit, undefined, true),
      cutout: mk(lit, undefined, true, true),
      blend: mk(lit, alpha, false),
      add: mk(lit, add, false),
      ghost: mk(ghost, undefined, true),
    };
    const post = d.createShaderModule({ code: POST });
    this.postLayout = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} }] });
    this.postPipe = d.createRenderPipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.postLayout] }),
      vertex: { module: post, entryPoint: 'vs' },
      fragment: { module: post, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
    const mip = d.createShaderModule({ code: MIP });
    this.mipPipes = {};
    this.mipModule = mip;
    this.width = 0; this.height = 0;
    this.whiteTex = this.solidTexture([255, 255, 255, 255]);
    this.flatNormal = this.solidTexture([128, 128, 255, 255], false);
    this.linearWhite = this.solidTexture([255, 255, 255, 255], false);
  }

  // quality settings that can change while playing
  setShadowSize(n) {
    const d = this.device;
    if (this.shadowTex) this.shadowTex.destroy();
    this.shadowSize = n;
    this.shadowTex = d.createTexture({ size: [n, n, 6], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.shadowFaces = [0, 1, 2, 3, 4, 5].map(i => this.shadowTex.createView({ dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 }));
    const g = (buf) => d.createBindGroup({ layout: this.gLayout, entries: [
      { binding: 0, resource: { buffer: buf } },
      { binding: 1, resource: this.shadowTex.createView({ dimension: '2d-array' }) },
      { binding: 2, resource: this.samplerShadow }] });
    this.gBind = g(this.globals); this.gBindCam = g(this.globalsCam);
  }
  setAniso(n, objects) {
    this.samplerRepeat = this.device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: n });
    for (const o of objects) if (!o.clamp) this.rebind(o);
  }

  mipPipe(format) {
    if (!this.mipPipes[format]) {
      this.mipPipes[format] = this.device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: this.mipModule, entryPoint: 'vs' },
        fragment: { module: this.mipModule, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
    }
    return this.mipPipes[format];
  }

  solidTexture(rgba, srgb = true) {
    const t = this.device.createTexture({ size: [1, 1], format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.device.queue.writeTexture({ texture: t }, new Uint8Array(rgba), { bytesPerRow: 4 }, [1, 1]);
    return t;
  }

  // source: ImageBitmap | HTMLCanvasElement
  texture(source, { mips = true, srgb = true } = {}) {
    if (this.maxTex && Math.max(source.width, source.height) > this.maxTex && mips) {
      const k = this.maxTex / Math.max(source.width, source.height);
      const c = new OffscreenCanvas(Math.max(1, Math.round(source.width * k)), Math.max(1, Math.round(source.height * k)));
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(source, 0, 0, c.width, c.height);
      source = c;
    }
    const w = source.width, h = source.height;
    const levels = mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
    const format = srgb ? 'rgba8unorm-srgb' : 'rgba8unorm';
    const tex = this.device.createTexture({
      size: [w, h], format, mipLevelCount: levels,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture({ source }, { texture: tex, premultipliedAlpha: false }, [w, h]);
    if (levels > 1) this.genMips(tex, format, levels);
    tex._fmt = format; tex._levels = levels;
    return tex;
  }

  updateTexture(tex, source) {
    this.device.queue.copyExternalImageToTexture({ source }, { texture: tex, premultipliedAlpha: false }, [source.width, source.height]);
    if (tex._levels > 1) this.genMips(tex, tex._fmt, tex._levels);
  }

  genMips(tex, format, levels) {
    const d = this.device, pipe = this.mipPipe(format);
    const enc = d.createCommandEncoder();
    for (let i = 1; i < levels; i++) {
      const bg = d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
        { binding: 0, resource: tex.createView({ baseMipLevel: i - 1, mipLevelCount: 1 }) },
        { binding: 1, resource: this.samplerLinear }] });
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView({ baseMipLevel: i, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
      pass.setPipeline(pipe); pass.setBindGroup(0, bg); pass.draw(3); pass.end();
    }
    d.queue.submit([enc.finish()]);
  }

  mesh(geo) {
    const d = this.device;
    const vb = d.createBuffer({ size: geo.v.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(vb, 0, geo.v);
    const ib = d.createBuffer({ size: geo.i.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(ib, 0, geo.i);
    // local bounding sphere (for culling)
    const v = geo.v, mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let k = 0; k < v.length; k += 12) for (let q = 0; q < 3; q++) { const x = v[k + q]; if (x < mn[q]) mn[q] = x; if (x > mx[q]) mx[q] = x; }
    const c = mn.map((x, q) => (x + mx[q]) / 2), r = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2;
    return { vb, ib, count: geo.i.length, c, r };
  }

  // Drawable object
  object(mesh, tex, opts = {}) {
    const d = this.device;
    if (!this.objBuf || this.nextSlot >= this.maxSlots) this.growSlots();
    const o = {
      mesh, tex: tex || this.whiteTex, slot: this.nextSlot++, pipe: opts.pipe || 'opaque', visible: true,
      model: opts.model || new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
      tint: opts.tint || [1, 1, 1, 1], emissive: opts.emissive || [0, 0, 0, 0],
      uvx: opts.uvx || [1, 1, 0, 0], flags: opts.flags || [0, 0, 1, 0], extra: opts.extra || [0, 0, 0, 0], tex2: opts.tex2 || this.whiteTex,
      clamp: !!opts.clamp, order: opts.order || 0, castShadow: opts.castShadow ?? false,
      nrm: opts.nrm || null, mr: opts.mr || null,
      pbr: [opts.nrm ? 1 : 0, opts.mr ? (opts.mrAO ? 2 : 1) : 0, opts.rough ?? 1, opts.metal ?? 0],
    };
    this.rebind(o);
    return o;
  }
  // objects live in 256-byte slots of one big uniform buffer
  growSlots() {
    const n = (this.maxSlots || 0) + 1024;
    const buf = this.device.createBuffer({ size: n * 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const data = new Float32Array(n * 64);
    if (this.objData) data.set(this.objData);
    this.objBuf = buf; this.objData = data; this.maxSlots = n; this.nextSlot = this.nextSlot || 0;
    for (const o of this.allObjects || []) this.rebind(o);
  }

  // (re)build an object's bind group, e.g. after swapping its texture
  rebind(o) {
    (this.allObjects = this.allObjects || new Set()).add(o);
    o.bind = this.device.createBindGroup({ layout: this.oLayout, entries: [
      { binding: 0, resource: { buffer: this.objBuf, offset: o.slot * 256, size: 160 } },
      { binding: 1, resource: o.tex.createView() },
      { binding: 2, resource: o.clamp ? this.samplerClamp : this.samplerRepeat },
      { binding: 3, resource: o.tex2.createView() },
      { binding: 4, resource: (o.nrm || this.flatNormal).createView() },
      { binding: 5, resource: (o.mr || this.linearWhite).createView() }] });
  }

  resize(w, h) {
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    this.canvas.width = w; this.canvas.height = h;
    const d = this.device;
    for (const t of [this.msaa, this.depth, this.hdr]) t && t.destroy();
    this.msaa = d.createTexture({ size: [w, h], format: this.hdrFormat, sampleCount: this.samples, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.depth = d.createTexture({ size: [w, h], format: 'depth24plus', sampleCount: this.samples, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.hdr = d.createTexture({ size: [w, h], format: this.hdrFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.postBind = d.createBindGroup({ layout: this.postLayout, entries: [
      { binding: 0, resource: { buffer: this.postBuf } },
      { binding: 1, resource: this.hdr.createView() },
      { binding: 2, resource: this.samplerClamp }] });
  }

  drawScene(pass, bind, objects, planes) {
    pass.setBindGroup(0, bind);
    const rank = { opaque: 0, cutout: 1, blend: 2, ghost: 3, add: 4 };
    const list = objects.filter(o => o.visible && !(bind === this.gBindCam && o.noCam) && !(bind === this.gBind && o.camOnly)
      && (!planes || o.noCull || sphereIn(planes, o._wc, o._wr))).sort((a, b) => (rank[a.pipe] - rank[b.pipe]) || (a.order - b.order));
    let cur = null;
    if (bind === this.gBind) { this.stats.draws = list.length; this.stats.tris = list.reduce((n, o) => n + o.mesh.count / 3, 0); }
    for (const o of list) {
      if (o.pipe !== cur) { pass.setPipeline(this.pipes[o.pipe]); cur = o.pipe; }
      pass.setBindGroup(1, o.bind);
      pass.setVertexBuffer(0, o.mesh.vb);
      pass.setIndexBuffer(o.mesh.ib, 'uint32');
      pass.drawIndexed(o.mesh.count);
    }
  }

  render(globals, post, objects, lightPos, camGlobals = null) {
    const d = this.device, q = d.queue;
    q.writeBuffer(this.globals, 0, globals);
    q.writeBuffer(this.postBuf, 0, post);
    const D = this.objData;
    let top = 0;
    for (const o of objects) {
      if (!o.visible) continue;
      const b = o.slot * 64, m = o.model;
      D.set(m, b); D.set(o.tint, b + 16); D.set(o.emissive, b + 20); D.set(o.uvx, b + 24); D.set(o.flags, b + 28); D.set(o.extra, b + 32); D.set(o.pbr, b + 36);
      if (o.slot + 1 > top) top = o.slot + 1;
      // world bounding sphere for culling
      const c = o.mesh.c, sc = Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10]));
      o._wc = [m[0] * c[0] + m[4] * c[1] + m[8] * c[2] + m[12], m[1] * c[0] + m[5] * c[1] + m[9] * c[2] + m[13], m[2] * c[0] + m[6] * c[1] + m[10] * c[2] + m[14]];
      o._wr = o.mesh.r * sc * 1.1 + 0.02;
    }
    q.writeBuffer(this.objBuf, 0, D.buffer, 0, top * 256);
    const enc = d.createCommandEncoder();
    this.frameNo++;
    const T = this.ts && !this.ts.busy && this.frameNo % 15 === 0 ? this.ts : null;   // measure every 15th frame
    const tw = (b, e) => T ? { timestampWrites: { querySet: T.qs, beginningOfPassWriteIndex: b, endOfPassWriteIndex: e } } : {};
    this.stats.shadowDraws = 0; this.stats.shadowTris = 0;
    if (lightPos) {
      const proj = persp90(SH_NEAR, SH_FAR);
      const casters = objects.filter(o => o.visible && o.castShadow);
      FACES.forEach(([r, u, f], i) => {
        const view = viewM(lightPos, r, u, [-f[0], -f[1], -f[2]]);
        const vp = mul(proj, view), fp = frustum(vp);
        const m = new Float32Array(20); m.set(vp, 0); m.set([...lightPos, 1], 16);
        const faceCasters = casters.filter(o => o.noCull || sphereIn(fp, o._wc, o._wr));   // only what this face can see
        this.stats.shadowDraws += faceCasters.length; this.stats.shadowTris += faceCasters.reduce((n, o) => n + o.mesh.count / 3, 0);
        q.writeBuffer(this.sBufs[i], 0, m);
        const sp = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: this.shadowFaces[i], depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
          ...(T && (i === 0 || i === 5) ? { timestampWrites: { querySet: T.qs, ...(i === 0 ? { beginningOfPassWriteIndex: 0 } : { endOfPassWriteIndex: 1 }) } } : {}) });
        sp.setPipeline(this.shadowPipe); sp.setBindGroup(0, this.sBinds[i]);
        for (const o of faceCasters) {
          sp.setBindGroup(1, o.bind); sp.setVertexBuffer(0, o.mesh.vb); sp.setIndexBuffer(o.mesh.ib, 'uint32'); sp.drawIndexed(o.mesh.count);
        }
        sp.end();
      });
    }
    if (camGlobals) {
      q.writeBuffer(this.globalsCam, 0, camGlobals);
      const cp = enc.beginRenderPass({
        colorAttachments: [{ view: this.camMsaa.createView(), resolveTarget: this.camTex.createView(), loadOp: 'clear', storeOp: 'discard', clearValue: [0, 0, 0, 1] }],
        depthStencilAttachment: { view: this.camDepth.createView(), depthLoadOp: 'clear', depthStoreOp: 'discard', depthClearValue: 1 }, ...tw(2, 3),
      });
      this.drawScene(cp, this.gBindCam, objects, frustum(camGlobals.subarray(0, 16)));
      cp.end();
    }
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: this.msaa.createView(), resolveTarget: this.hdr.createView(), loadOp: 'clear', storeOp: 'discard', clearValue: [0, 0, 0, 1] }],
      depthStencilAttachment: { view: this.depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'discard', depthClearValue: 1 }, ...tw(4, 5),
    });
    this.drawScene(pass, this.gBind, objects, frustum(globals.subarray(0, 16)));
    pass.end();
    const pp = enc.beginRenderPass({ colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }], ...tw(6, 7) });
    pp.setPipeline(this.postPipe); pp.setBindGroup(0, this.postBind); pp.draw(3); pp.end();
    if (T) { enc.resolveQuerySet(T.qs, 0, 8, T.res, 0); enc.copyBufferToBuffer(T.res, 0, T.read, 0, 64); }
    q.submit([enc.finish()]);
    if (T) {
      T.busy = true;
      const had = { shadow: !!lightPos, cctv: !!camGlobals };
      T.read.mapAsync(GPUMapMode.READ).then(() => {
        const t = new BigInt64Array(T.read.getMappedRange().slice(0));
        T.read.unmap(); T.busy = false;
        const ms = (a, b) => Number(t[b] - t[a]) / 1e6;
        this.gpuMs = { shadow: had.shadow ? ms(0, 1) : 0, cctv: had.cctv ? ms(2, 3) : 0, main: ms(4, 5), post: ms(6, 7) };
        this.gpuMs.total = this.gpuMs.shadow + this.gpuMs.cctv + this.gpuMs.main + this.gpuMs.post;
      }).catch(() => { T.busy = false; });
    }
  }
}

function persp90(n, f) {
  const o = new Float32Array(16);
  o[0] = 1; o[5] = 1; o[10] = f / (n - f); o[11] = -1; o[14] = f * n / (n - f);
  return o;
}
function viewM(p, r, u, b) {
  const dot = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
  return new Float32Array([r[0], u[0], b[0], 0, r[1], u[1], b[1], 0, r[2], u[2], b[2], 0, -dot(r, p), -dot(u, p), -dot(b, p), 1]);
}
function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
