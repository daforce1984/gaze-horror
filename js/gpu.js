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
  extra: vec4f,    // x = door light, y = shadow strength
  shadowPos: vec4f,// xyz light, w = 1 when the moon owns the shadow map
};
struct Obj {
  model: mat4x4f,
  tint: vec4f,
  emissive: vec4f, // w = alpha cutoff
  uvx: vec4f,      // uv scale xy, offset zw
  flags: vec4f,    // x wrap lighting, y unlit, z ao amount, w emissive texture mode
};
@group(0) @binding(0) var<uniform> G: Globals;
@group(1) @binding(0) var<uniform> O: Obj;
@group(1) @binding(1) var tex: texture_2d<f32>;
@group(1) @binding(2) var samp: sampler;
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
  }
  let w = O.model * vec4f(lp, 1.0);
  o.pos = G.viewProj * w;
  o.wp = w.xyz;
  o.n = normalize((O.model * vec4f(n, 0.0)).xyz);
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
  let V = normalize(G.camPos.xyz - p);
  if (dot(n, V) < 0.0) { n = -n; }
  var c = G.ambient.rgb;
  let sh = shadowAt(p, n);
  let bulbSh = select(sh, 1.0, G.shadowPos.w > 0.5);
  let moonSh = select(1.0, sh, G.shadowPos.w > 0.5);
  // hanging bulb
  let bl = G.bulbPos.xyz - p; let bd = length(bl); let bn = bl / bd;
  let bdiff = wrapDiffuse(n, bn, wrap);
  let bspec = pow(max(dot(n, normalize(bn + V)), 0.0), 40.0) * spec;
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
  // light spilling through the door at the end
  let dl = vec3f(0.7, 1.1, 2.9) - p; let dd = length(dl);
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
  let t = textureSample(tex, samp, i.uv);
  let a = t.a * O.tint.a;
  if (a < O.emissive.w) { discard; }
  var col: vec3f;
  let alb = t.rgb * O.tint.rgb;
  if (O.flags.y > 0.5) {
    col = alb;
  } else {
    let ao = sqrt(i.col.r);
    col = alb * lighting(i.wp, normalize(i.n), O.flags.x, O.flags.z) * ao;
  }
  if (O.flags.w > 0.5) { col += t.rgb * O.emissive.rgb; } else { col += O.emissive.rgb * t.a; }
  col = fog(col, i.wp);
  return vec4f(col, a);
}
`;

const GHOST = SHARED + /* wgsl */`
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let time = G.camPos.w;
  // screen-door fade so she can materialise without sorting problems
  let a = O.tint.a * (0.92 + 0.08 * sin(time * 17.0 + i.wp.y * 9.0));
  if (a < hash21(floor(i.pos.xy) + fract(time) * 0.0)) { discard; }
  let t = textureSample(tex, samp, i.uv);
  let ao = mix(sqrt(i.col.r), 1.0, O.emissive.w);
  var col = t.rgb * O.tint.rgb * lighting(i.wp, normalize(i.n), O.flags.x, O.flags.z) * ao * 1.15 + t.rgb * O.emissive.rgb * ao;
  col = mix(col, col * vec3f(0.8, 1.0, 1.12), 0.5);
  col = fog(col, i.wp);
  return vec4f(col, 1.0);
}
`;

const SHADOW = /* wgsl */`
struct SG { viewProj: mat4x4f, lightPos: vec4f };
struct Obj { model: mat4x4f, tint: vec4f, emissive: vec4f, uvx: vec4f, flags: vec4f };
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
fn aces(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let time = P.res.z;
  var uv = i.uv;
  var d = uv - 0.5;
  let r2 = dot(d, d);
  uv = 0.5 + d * (1.0 + P.b.y * r2);
  // tearing bands under stress
  let band = step(0.985 - P.b.w * 0.05, h(vec2f(floor(uv.y * 40.0), floor(time * 18.0))));
  uv.x += band * (h(vec2f(time, uv.y)) - 0.5) * 0.04 * P.b.w;
  d = uv - 0.5;
  let ca = P.b.x;
  var col = vec3f(
    textureSampleLevel(hdr, samp, uv - d * ca, 0.0).r,
    textureSampleLevel(hdr, samp, uv, 0.0).g,
    textureSampleLevel(hdr, samp, uv + d * ca, 0.0).b);
  col *= P.a.x;
  col = aces(col);
  // grade: crush, desaturate, cold shadows
  let l = dot(col, vec3f(0.299, 0.587, 0.114));
  col = mix(vec3f(l), col, 0.62);
  col = col * vec3f(0.92, 1.0, 1.04) + vec3f(0.0, 0.004, 0.008) * (1.0 - l);
  // vignette (aspect aware)
  let dv = d * vec2f(max(P.res.w, 1.0), max(1.0 / P.res.w, 1.0));
  let vig = 1.0 - smoothstep(0.3, 1.05, length(dv) * P.b.z);
  col *= vig;
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

export class Renderer {
  static async create(canvas, opts = {}) {
    if (!navigator.gpu) throw new Error('WebGPU unsupported');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter');
    const device = await adapter.requestDevice();
    return new Renderer(canvas, device, opts);
  }

  constructor(canvas, device, opts = {}) {
    this.canvas = canvas; this.device = device;
    this.ctx = canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device, format: this.format, alphaMode: 'opaque' });
    this.samples = 4;
    this.hdrFormat = 'rgba16float';
    const d = device;
    this.shadowSize = opts.shadowSize || 1024;
    this.shadowTex = d.createTexture({ size: [this.shadowSize, this.shadowSize, 6], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.shadowFaces = [0, 1, 2, 3, 4, 5].map(i => this.shadowTex.createView({ dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 }));
    this.samplerShadow = d.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });
    this.globals = d.createBuffer({ size: 320, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.postBuf = d.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.samplerRepeat = d.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8 });
    this.samplerClamp = d.createSampler({ addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
    this.samplerLinear = d.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    this.gLayout = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', viewDimension: '2d-array' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } }] });
    this.oLayout = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} }] });
    this.gBind = d.createBindGroup({ layout: this.gLayout, entries: [
      { binding: 0, resource: { buffer: this.globals } },
      { binding: 1, resource: this.shadowTex.createView({ dimension: '2d-array' }) },
      { binding: 2, resource: this.samplerShadow }] });
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

  solidTexture(rgba) {
    const t = this.device.createTexture({ size: [1, 1], format: 'rgba8unorm-srgb', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.device.queue.writeTexture({ texture: t }, new Uint8Array(rgba), { bytesPerRow: 4 }, [1, 1]);
    return t;
  }

  // source: ImageBitmap | HTMLCanvasElement
  texture(source, { mips = true, srgb = true } = {}) {
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
    return { vb, ib, count: geo.i.length };
  }

  // Drawable object
  object(mesh, tex, opts = {}) {
    const d = this.device;
    const ub = d.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const o = {
      mesh, tex: tex || this.whiteTex, ub, pipe: opts.pipe || 'opaque', visible: true,
      model: opts.model || new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
      tint: opts.tint || [1, 1, 1, 1], emissive: opts.emissive || [0, 0, 0, 0],
      uvx: opts.uvx || [1, 1, 0, 0], flags: opts.flags || [0, 0, 1, 0],
      clamp: !!opts.clamp, order: opts.order || 0, castShadow: opts.castShadow ?? false,
    };
    o.bind = d.createBindGroup({ layout: this.oLayout, entries: [
      { binding: 0, resource: { buffer: ub } },
      { binding: 1, resource: o.tex.createView() },
      { binding: 2, resource: o.clamp ? this.samplerClamp : this.samplerRepeat }] });
    o._data = new Float32Array(32);
    return o;
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

  render(globals, post, objects, lightPos) {
    const d = this.device, q = d.queue;
    q.writeBuffer(this.globals, 0, globals);
    q.writeBuffer(this.postBuf, 0, post);
    for (const o of objects) {
      if (!o.visible) continue;
      const a = o._data;
      a.set(o.model, 0); a.set(o.tint, 16); a.set(o.emissive, 20); a.set(o.uvx, 24); a.set(o.flags, 28);
      q.writeBuffer(o.ub, 0, a);
    }
    const enc = d.createCommandEncoder();
    if (lightPos) {
      const proj = persp90(SH_NEAR, SH_FAR);
      const casters = objects.filter(o => o.visible && o.castShadow);
      FACES.forEach(([r, u, f], i) => {
        const view = viewM(lightPos, r, u, [-f[0], -f[1], -f[2]]);
        const m = new Float32Array(20); m.set(mul(proj, view), 0); m.set([...lightPos, 1], 16);
        q.writeBuffer(this.sBufs[i], 0, m);
        const sp = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: this.shadowFaces[i], depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 } });
        sp.setPipeline(this.shadowPipe); sp.setBindGroup(0, this.sBinds[i]);
        for (const o of casters) {
          sp.setBindGroup(1, o.bind); sp.setVertexBuffer(0, o.mesh.vb); sp.setIndexBuffer(o.mesh.ib, 'uint32'); sp.drawIndexed(o.mesh.count);
        }
        sp.end();
      });
    }
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: this.msaa.createView(), resolveTarget: this.hdr.createView(), loadOp: 'clear', storeOp: 'discard', clearValue: [0, 0, 0, 1] }],
      depthStencilAttachment: { view: this.depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'discard', depthClearValue: 1 },
    });
    pass.setBindGroup(0, this.gBind);
    const rank = { opaque: 0, cutout: 1, blend: 2, ghost: 3, add: 4 };
    const list = objects.filter(o => o.visible).sort((a, b) => (rank[a.pipe] - rank[b.pipe]) || (a.order - b.order));
    let cur = null;
    for (const o of list) {
      if (o.pipe !== cur) { pass.setPipeline(this.pipes[o.pipe]); cur = o.pipe; }
      pass.setBindGroup(1, o.bind);
      pass.setVertexBuffer(0, o.mesh.vb);
      pass.setIndexBuffer(o.mesh.ib, 'uint32');
      pass.drawIndexed(o.mesh.count);
    }
    pass.end();
    const pp = enc.beginRenderPass({ colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    pp.setPipeline(this.postPipe); pp.setBindGroup(0, this.postBind); pp.draw(3); pp.end();
    q.submit([enc.finish()]);
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
