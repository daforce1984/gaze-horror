import { Renderer } from './gpu.js';
import { plane } from './geometry.js';
import { loadGLB } from './gltf.js';
import { m4, v3, clamp, lerp, smooth, damp, rayAABB } from './math.js';
import { Telemetry } from './telemetry.js';
import { Sound } from './audio.js';
import * as TX from './textures.js';

/* 응시 — THE GAZE
   You are tied to a chair. Stare at something long enough and "she" brings it to you — but every
   touch of a dead child's hand drains your warmth. The room starts as an ordinary evening in 1999
   and rots as the night goes on. */

// ---------------------------------------------------------------- constants
const SEAT = [0, 1.15, 0.3];
const EYE = SEAT.slice();                 // mutable: rises when you finally stand up
const RX = 2.2, RZ = 2.5, RH = 2.6;
const PI = Math.PI;
const ASSETS = {
  wall: 'assets/wall.webp', wallClean: 'assets/wall_clean.webp', floor: 'assets/floor.webp', floorClean: 'assets/floor_clean.webp',
  ceiling: 'assets/ceiling_rot.webp', ceilClean: 'assets/ceiling.webp', rug: 'assets/rug.webp',
  // PBR maps derived from the Codex albedo (tools/pbrmaps.py): _n normal, _m occlusion/roughness/metal
  wallN: 'assets/wall_clean_n.webp', wallM: 'assets/wall_clean_m.webp', floorN: 'assets/floor_clean_n.webp', floorM: 'assets/floor_clean_m.webp',
  ceilN: 'assets/ceiling_n.webp', ceilM: 'assets/ceiling_m.webp', curtainN: 'assets/curtain_n.webp', curtainM: 'assets/curtain_m.webp',
  rugN: 'assets/rug_n.webp', rugM: 'assets/rug_m.webp', doorN: 'assets/door_n.webp', doorM: 'assets/door_m.webp',
  rope: 'assets/rope.webp', ropeN: 'assets/rope_n.webp', ropeM: 'assets/rope_m.webp', rust: 'assets/rust.webp', rustN: 'assets/rust_n.webp', rustM: 'assets/rust_m.webp',
  woodLight: 'assets/wood_light.webp', woodN: 'assets/wood_n.webp', woodM: 'assets/wood_m.webp', woodLightN: 'assets/wood_light_n.webp', woodLightM: 'assets/wood_light_m.webp',
  curtain: 'assets/curtain.webp', wood: 'assets/wood.webp', door: 'assets/door.webp',
  face: 'assets/ghost_face.webp', window: 'assets/window.webp', fabric: 'assets/fabric.webp', plastic: 'assets/plastic.webp',
  paper: 'assets/paper.webp', drawing: 'assets/child_drawing.webp', newspaper: 'assets/newspaper.webp', family: 'assets/family.webp',
  hands: 'assets/handprints.webp', kids: 'assets/kids_show.webp', kidsBad: 'assets/kids_show_bad.webp', ghostTex: 'assets/ghost_tex.webp', crawlTex: 'assets/ghost_crawl_tex.webp',
};
const GLB = {};
const LAP = () => v3.add(EYE, v3.add(v3.scale(flatFwd(), 0.34), [0, -0.46, 0]));
const CCTV = { pos: [1.95, 2.42, 2.28], target: [-0.05, 0.3, -0.35], tanHalf: 0.62, aspect: 4 / 3 };

// ---------------------------------------------------------------- dom
const $ = (s) => document.querySelector(s);
const ui = {
  title: $('#title'), start: $('#startBtn'), load: $('#loadText'), hud: $('#hud'), sub: $('#subtitle'),
  action: $('#actionBtn'), zoom: $('#zoomBtn'), memoBtn: $('#memoBtn'), pauseBtn: $('#pauseBtn'), gyroBtn: $('#gyroBtn'),
  ring: $('#revealRing'), ringArc: $('#revealArc'), cross: $('#cross'), fear: $('#fearFill'), warm: $('#warmFill'),
  modal: $('#modal'), card: $('#modalCard'), scare: $('#scare'), ending: $('#ending'), fade: $('#fade'),
  nogpu: $('#nogpu'), canvas: $('#gl'), objective: $('#objective'), halluc: $('#halluc'), hint: $('#hint'), tray: $('#tray'),
  inspect: $('#inspect'), inspTitle: $('#inspTitle'), inspDesc: $('#inspDesc'), hotspots: $('#hotspots'),
  inspUse: $('#inspUse'), inspClose: $('#inspClose'), pad: $('#pad'), padCh: $('#padCh'),
};

// ---------------------------------------------------------------- state
const S = {
  yaw: 0, pitch: -0.08, zoom: 1, zoomTarget: 1, holdZoom: false,
  fear: 0, time: 0, paused: true, started: false,
  act: 0, decay: 0, decayTarget: 0, warmth: 100, lastTouch: -99,
  flags: {}, memo: [], inv: [], fetched: new Set(), records: new Set(), tape: 0,
  shake: 0, flash: 0, flashCol: [1, 1, 1], blackout: 0, blackoutTarget: 0, glitch: 0, frost: 0,
  bulbDead: false, bulbBurst: 0, lampSwing: 0, rain: 1,
  tv: { on: false, ch: 3 }, curtainOpen: 0, curtainTarget: 0, doorLight: 0, doorOpen: 0, doorOpenT: 0,
  ghost: null, job: null, stareId: null, stareT: 0, insp: null, useItem: null,
  insanity: 0, stare: 0, invert: 0, hallucT: 3, lastScare: -99, events: 12,
  timers: [], ending: false, walk: 0, walking: false, final: null, examined: new Set(),
  clock: { h: 7, m: 55 }, standing: 0,
};
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ---------------------------------------------------------------- save / puzzle
const SAVE_KEY = 'gaze-save-v2';
let SAVE = null;
try { SAVE = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { }
const SOL = SAVE?.sol || { day: 17 + Math.floor(Math.random() * 11) };   // the circled day on the calendar
const CODE = [1, 2, Math.floor(SOL.day / 10), SOL.day % 10];            // drawer padlock: MMDD
function checkpoint() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      sol: SOL, act: S.act, inv: S.inv, fetched: [...S.fetched], flags: S.flags, memo: S.memo, records: [...S.records],
      tape: S.tape, time: S.time, tv: S.tv,
    }));
  } catch { }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch { } }

let R, snd = new Sound(), IMG = {}, O = {}, W = {}, tvScreen, clockCanvas;
const objects = [];

// ---------------------------------------------------------------- helpers
function after(sec, fn) { S.timers.push({ t: S.time + sec, fn }); }
let subQueue = [], subTimer = 0;
function say(text, dur = 4) { subQueue.push({ text, dur }); if (subTimer <= 0) nextSub(); }
function sayNow(text, dur = 4) { subQueue = [{ text, dur }]; nextSub(); }
function nextSub() {
  const s = subQueue.shift();
  if (!s) { ui.sub.classList.remove('show'); subTimer = 0; return; }
  ui.sub.textContent = s.text; ui.sub.classList.add('show'); subTimer = s.dur;
}
function objective(t) { ui.objective.textContent = t; ui.objective.classList.toggle('show', !!t); S.objective = t; }
function addMemo(html) { S.memo.push(html); ui.memoBtn.classList.add('new'); }
function addFear(v) { S.fear = clamp(S.fear + v, 0, 1); }
function voice(id, pos, gain = 2.2) { return snd.voice(id, pos, gain); }
function girl(id, text, pos, dur) { const d = voice(id, pos); say(`“${text}”`, dur || Math.max(2.5, d + 0.8)); return d; }

function camBasis() {
  const cp = Math.cos(S.pitch), sp = Math.sin(S.pitch), cy = Math.cos(S.yaw), sy = Math.sin(S.yaw);
  const f = [sy * cp, sp, -cy * cp];
  const r = [cy, 0, sy];
  const u = v3.cross(r, f);
  return { f, r, u };
}
function flatFwd() { return [Math.sin(S.yaw), 0, -Math.cos(S.yaw)]; }
function tanHalfY() {
  const a = R.width / R.height;
  const base = a >= 1 ? Math.tan(31 * PI / 180) : clamp(Math.tan(36 * PI / 180) / a, Math.tan(31 * PI / 180), 0.95);
  return base / S.zoom;
}
function screenRay(px, py) {
  const rect = ui.canvas.getBoundingClientRect();
  const nx = ((px - rect.left) / rect.width) * 2 - 1, ny = 1 - ((py - rect.top) / rect.height) * 2;
  const th = tanHalfY(), a = R.width / R.height, { f, r, u } = camBasis();
  return v3.norm(v3.add(f, v3.add(v3.scale(r, nx * th * a), v3.scale(u, ny * th))));
}
function inView(p, margin = 1.0) {
  const { f } = camBasis();
  const dir = v3.norm(v3.sub(p, EYE));
  const ang = Math.acos(clamp(v3.dot(dir, f), -1, 1));
  const th = tanHalfY(), a = R.width / R.height;
  return { ang, visible: ang < Math.atan(th * Math.min(a, 1.4)) * margin, centered: ang < Math.atan(th) * 0.5 };
}
function setModel(list, m) { for (const o of list) o.model = m; }
function setVisible(list, v) { for (const o of list) o.visible = v; }
function setAlpha(list, a) { for (const o of list) o.tint[3] = a; }
function translated(base, p, yaw = 0) {
  const m = yaw ? m4.mul(m4.trs(p, yaw), strip(base)) : strip(base);
  if (!yaw) { m[12] = p[0]; m[13] = p[1]; m[14] = p[2]; }
  return m;
}
function strip(base) { const m = base.slice(); m[12] = m[13] = m[14] = 0; return m; }

// ---------------------------------------------------------------- assets
async function loadImage(url) {
  try {
    const res = await fetch(url); if (!res.ok) throw 0;
    return await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  } catch { return null; }
}
async function loadAll() {
  const keys = Object.keys(ASSETS); let n = 0;
  await Promise.all(keys.map(async k => {
    IMG[k] = await loadImage(ASSETS[k]);
    n++; ui.load.textContent = `불러오는 중… ${Math.round(n / keys.length * 100)}%`;
  }));
  const [room, ghost] = await Promise.all([loadGLB('assets/room.glb'), loadGLB('assets/ghost.glb'), snd.prefetch()]);
  GLB.room = room; GLB.ghost = ghost;
  try { await document.fonts.load('bold 60px "Nanum Pen Script"'); } catch { }
}
const FALLBACK = {
  wall: [150, 150, 128], wallClean: [210, 200, 175], floor: [110, 85, 62], floorClean: [150, 110, 70], ceiling: [180, 175, 160],
  curtain: [120, 50, 45], wood: [120, 90, 64], door: [110, 80, 55], window: [20, 28, 40], fabric: [200, 195, 180], plastic: [30, 30, 32], paper: [170, 160, 130],
};
function tex(k, opt) {
  if (IMG[k]) return R.texture(IMG[k], opt);
  if (FALLBACK[k]) return R.texture(TX.noiseTex(FALLBACK[k], k.length), opt);
  return R.texture(TX.radialTex('rgba(200,200,210,0.9)', 'rgba(200,200,210,0)'), opt);
}

// ---------------------------------------------------------------- scene
function add(o) { objects.push(o); return o; }
// write-if-changed DOM helpers (cached per element, so a steady HUD costs nothing per frame)
const _dom = new WeakMap();
function put(target, key, val) { let m = _dom.get(target); if (!m) _dom.set(target, m = {}); if (m[key] !== val) { m[key] = val; target[key] = val; } }
function cls(el, name, on) { let m = _dom.get(el); if (!m) _dom.set(el, m = {}); const k = 'c:' + name; if (m[k] !== on) { m[k] = on; el.classList.toggle(name, on); } }
function buildScene() {
  const T = {
    wall: tex('wall'), wallClean: tex('wallClean'), floor: tex('floor'), floorClean: tex('floorClean'), ceiling: tex('ceiling'),
    ceilClean: IMG.ceilClean ? tex('ceilClean') : R.solidTexture([232, 226, 212, 255]), curtain: tex('curtain'), rug: tex('rug'), woodLight: tex('woodLight'), rope: tex('rope'), rust: tex('rust'),
    ...Object.fromEntries(['wallN', 'wallM', 'floorN', 'floorM', 'ceilN', 'ceilM', 'curtainN', 'curtainM', 'rugN', 'rugM', 'doorN', 'doorM', 'woodN', 'woodM', 'woodLightN', 'woodLightM', 'ropeN', 'ropeM', 'rustN', 'rustM']
      .filter(k => IMG[k]).map(k => [k, R.texture(IMG[k], { mips: true, srgb: false })])), wood: tex('wood'), door: tex('door'), window: tex('window'),
    fabric: tex('fabric'), plastic: tex('plastic'), paper: tex('paper'), ghostTex: tex('ghostTex', { mips: true }), crawlTex: tex('crawlTex', { mips: true }),
    blob: R.texture(TX.radialTex('rgba(0,0,0,0.9)', 'rgba(0,0,0,0)')),
    halo: R.texture(TX.radialTex('rgba(255,210,150,1)', 'rgba(255,160,80,0)')),
    tvHalo: R.texture(TX.radialTex('rgba(150,190,255,1)', 'rgba(120,160,255,0)')),
  };
  const quad = R.mesh(plane(1, 1)), quadB = R.mesh(plane(1, 1, true));
  O.quad = quad;
  tvScreen = new TX.TVScreen(IMG.face);
  tvScreen.kids = IMG.kids; tvScreen.kidsBad = IMG.kidsBad;
  O.tvTex = R.texture(tvScreen.draw(0, 1), { mips: false });
  clockCanvas = TX.canvas(256, 256);
  TX.clockFaceTex(clockCanvas, S.clock.h, S.clock.m);
  O.clockTex = R.texture(clockCanvas);

  // decaying shell: tex = rotten, tex2 = the clean 1999 room
  const MAT = {
    M_wall: { t: T.wall, t2: T.wallClean, decay: 1, n: T.wallN, mr: T.wallM, uv: 2 }, M_floor: { t: T.floor, t2: T.floorClean, decay: 1, spec: 0.05, n: T.floorN, mr: T.floorM },
    M_ceiling: { t: T.ceiling, t2: T.ceilClean, decay: 1, n: T.ceilN, mr: T.ceilM },
    M_wood: { t: T.woodLight, n: T.woodLightN, mr: T.woodLightM }, M_wooddark: { t: T.wood, tint: [0.8, 0.75, 0.72], n: T.woodN, mr: T.woodM },
    M_door: { t: T.door, spec: 0.12, n: T.doorN, mr: T.doorM }, M_curtain: { t: T.curtain, wrap: 0.4, n: T.curtainN, mr: T.curtainM },
    M_window: { t: T.window, unlit: true, tint: [0.3, 0.32, 0.4] }, M_tvscreen: { t: O.tvTex, unlit: true, key: 'screen' },
    M_clockface: { t: O.clockTex, key: 'clockface' }, M_bulb: { unlit: true, key: 'bulb' }, M_corridor: { unlit: true, key: 'corridor', tint: [0, 0, 0] },
    M_bag: { t: T.plastic, tint: [0.9, 0.9, 0.95], spec: 1.4 }, M_bagwhite: { spec: 0.9 }, M_paper: { t: T.paper, wrap: 0.3 }, M_cardboard: { t: T.paper, tint: [0.75, 0.6, 0.42] },
    M_dress: { t: T.fabric, wrap: 0.45, tint: [0.95, 0.95, 0.95], aoLift: 0.85 }, M_skin: { wrap: 0.35, spec: 0.3, aoLift: 0.5 }, M_hair: { spec: 1.6, wrap: 0.2, aoLift: 1.0 }, M_eye: { spec: 1.5, emissive: [0.05, 0.06, 0.06] },
    M_glassgreen: { spec: 2.0 }, M_can: { spec: 1.5 }, M_can2: { spec: 1.5 }, M_metal: { t: T.rust, n: T.rustN, mr: T.rustM, uv: 4 }, M_rope: { t: T.rope, n: T.ropeN, mr: T.ropeM, uv: 3 }, M_brass: { spec: 1.4 }, M_mirror: { spec: 2.5 },
    M_rug: { t: T.rug, wrap: 0.3, spec: 0.02, n: T.rugN, mr: T.rugM }, M_cushion: { t: T.fabric, tint: [0.75, 0.55, 0.32], wrap: 0.4 },
    M_ghosttex: { t: T.ghostTex, wrap: 0.4, spec: 0.35, aoLift: 1.0 },
    M_ghostcrawl: { t: T.crawlTex, wrap: 0.4, spec: 0.35, aoLift: 1.0 },
    M_dollcloth: { wrap: 0.4 }, M_dolldress: { t: T.fabric, tint: [0.6, 0.16, 0.18], wrap: 0.4 },
  };
  const NO_SHADOW = new Set(['floor', 'ceiling', 'wall_front', 'wall_back', 'wall_left', 'wall_right', 'trim', 'corridor', 'bulb', 'window_glass', 'clock_face', 'tv_screen']);
  O.nodes = {};
  // PBR maps that came inside the GLB (Poly Haven props, retextured pieces): one GPU texture per image
  const texCache = new Map();
  const gpuTex = (img, srgb) => { if (!img) return null; const k = img; if (!texCache.has(k)) texCache.set(k, R.texture(img, { mips: true, srgb })); return texCache.get(k); };
  const addNode = (node, pipe = 'opaque', ghost = false) => {
    const list = node.prims.map(pr => {
      const m = MAT[pr.material.name] || {};
      const c = pr.material.color, maps = pr.material.maps || {};
      const base = m.t || gpuTex(maps.base, true);
      const tint = m.tint ? [...m.tint, 1] : base ? [c[0], c[1], c[2], 1].map((v, k) => maps.base && !m.t ? v : 1) : [c[0], c[1], c[2], 1];
      const spec = m.spec ?? Math.min(1.2, (1 - pr.material.rough) ** 2 * 1.3);
      const o = add(R.object(R.mesh(pr.geo), base || null, {
        nrm: ghost ? null : m.n || gpuTex(maps.normal, false), mr: ghost ? null : m.mr || gpuTex(maps.mr, false), mrAO: m.mr ? true : maps.mrAO, rough: m.mr ? 1 : pr.material.rough, metal: m.mr ? 1 : pr.material.metal,
        pipe: pr.material.cutout && pipe === 'opaque' ? 'cutout' : pipe, model: node.matrix.slice(), tint, emissive: [...(m.emissive || [0, 0, 0]), ghost ? (m.aoLift || 0) : pr.material.cutout ? 0.5 : 0],
        flags: [m.wrap ?? 0.1, m.unlit ? 1 : 0, spec, ghost ? 2 : 0], uvx: [m.uv || 1, m.uv || 1, ghost && pr.material.name === 'M_hair' ? 1 : 0, ghost && m.t ? 1 : 0],
        castShadow: !NO_SHADOW.has(node.name) && Math.max(...pr.max.map((v, k) => v - pr.min[k])) > 0.18, tex2: m.t2, extra: [m.decay ? 1 : 0, 0, 0, 0],   // tiny things cast no shadow (6 draws each)
      }));
      o.base = node.matrix; o.min = pr.min; o.max = pr.max;
      if (m.key) O[m.key] = o;
      return o;
    });
    O.nodes[node.name] = list;
    return list;
  };
  for (const name in GLB.room) addNode(GLB.room[name]);
  O.ghostStand = addNode(GLB.ghost.ghost_stand, 'ghost', true);
  O.ghostCrouch = addNode(GLB.ghost.ghost_crouch, 'ghost', true);
  O.screen.flags = [0, 1, 0, 1]; O.screen.tint = [0.15, 0.15, 0.15, 1];
  const sp = GLB.room.tv_screen.prims[0];
  O.tvCenter = [(sp.min[0] + sp.max[0]) / 2, (sp.min[1] + sp.max[1]) / 2, sp.max[2]];
  O.tvRect = { x0: sp.min[0], x1: sp.max[0], y0: sp.min[1], y1: sp.max[1], z: sp.max[2] };
  // the same screen showing the live CCTV texture
  O.cctvScreen = add(R.object(O.screen.mesh, R.camTex, { model: O.screen.model.slice(), flags: [0, 1, 0, 1], tint: [0.05, 0.05, 0.05, 1], emissive: [1.4, 1.5, 1.4, 1] }));
  O.cctvScreen.noCam = true; O.cctvScreen.visible = false;
  O.tvHalo = add(R.object(quad, T.tvHalo, { pipe: 'add', model: m4.trs([O.tvCenter[0], O.tvCenter[1], -1.9], 0, [1.1, 0.9, 1]), flags: [0, 1, 0, 0], tint: [0.4, 0.5, 0.7, 0.12], clamp: true }));
  O.halo = add(R.object(quad, T.halo, { pipe: 'add', model: m4.ident(), flags: [0, 1, 0, 0], tint: [1, 0.8, 0.6, 0], clamp: true }));
  O.ghostShadow = add(R.object(quadB, T.blob, { pipe: 'blend', model: m4.ident(), tint: [1, 1, 1, 0], clamp: true, order: -1 }));
  // dark backdrop behind an item held up for inspection
  O.backdrop = add(R.object(quad, null, { pipe: 'blend', model: m4.ident(), flags: [0, 1, 0, 0], tint: [0.004, 0.004, 0.006, 0.93], order: 5 }));
  O.backdrop.visible = false; O.backdrop.noCam = true;

  // ---- paper things (engine-side textured quads)
  O.docCanvas = {};
  const doc = (key, canvas, model, pipe = 'opaque') => {
    O.docCanvas[key] = canvas;
    const o = add(R.object(quad, R.texture(canvas), { pipe, model, clamp: true, flags: [0.3, 0, 0.15, 0], tint: [0.95, 0.95, 0.95, 1] }));
    o.base = model; o.min = [-0.5, -0.5, 0]; o.max = [0.5, 0.5, 0];
    O[key + 'Obj'] = o;
    return o;
  };
  doc('calendar', TX.calendarTex(SOL.day), m4.trs([-2.32, 1.4, -0.62], PI / 2, [0.3, 0.41, 1], 0, 0.03));   // taped to the window glass
  doc('drawing', TX.drawingTex(IMG.drawing), m4.trs([2.186, 1.22, 0.56], -PI / 2, [0.42, 0.42, 1], 0, 0.04));
  doc('note', TX.noteTex(), m4.trs([1.95, 0.762, -0.1], 1.9, [0.15, 0.19, 1], -PI / 2));
  doc('news', TX.newsTex(IMG.newspaper), m4.trs([0.02, 0.006, 1.92], 0.5, [0.36, 0.27, 1], -PI / 2));
  const fb = O.nodes.item_frame[0].base;
  O.familyClean = TX.familyTex(IMG.family, 0); O.familyRuined = TX.familyTex(IMG.family, 1);
  const fz = Math.min(...O.nodes.item_frame.map(o => o.base[14] + o.min[2]));   // back of the frame, on the wall
  doc('photo', O.familyClean, m4.trs([fb[12], fb[13], fz + 0.006], 0, [0.3, 0.4, 1]));
  O.photoTex = O.photoObj.tex;
  O.photoRuinTex = R.texture(O.familyRuined);
  const sc = doc('scratch', TX.scratchTex(), m4.trs([0.62, 0.42, 2.527], PI, [0.34, 0.68, 1]), 'blend');
  sc.tint = [1, 1, 1, 0];
  O.docCanvas.childnote = TX.childNoteTex(SOL.day);
  O.led = (O.nodes.am_led || [])[0];

  // ---- rot that creeps in: scrawls and small bloody handprints (alpha driven by decay)
  const scrawlTex = R.texture(TX.scrawlTex('엄마', 4)), scrawl2 = R.texture(TX.scrawlTex('왜 안 와', 9));
  const handsTex = IMG.hands ? R.texture(IMG.hands) : scrawlTex;
  O.rot = [
    { o: add(R.object(quad, scrawlTex, { pipe: 'blend', model: m4.trs([-2.185, 1.5, 1.4], PI / 2, [1.4, 0.7, 1]), clamp: true, tint: [1, 1, 1, 0] })), at: 0.55 },
    { o: add(R.object(quad, scrawl2, { pipe: 'blend', model: m4.trs([1.2, 1.55, -2.486], 0, [1.2, 0.6, 1]), clamp: true, tint: [1, 1, 1, 0] })), at: 0.7 },
    { o: add(R.object(quad, handsTex, { pipe: 'blend', model: m4.trs([0, 2.595, 0.05], 0, [1.1, 1.1, 1], PI / 2), clamp: true, tint: [1, 1, 1, 0] })), at: 0.62 },
    { o: add(R.object(quad, handsTex, { pipe: 'blend', model: m4.trs([-0.25, 1.1, 2.486], PI, [0.7, 0.7, 1]), clamp: true, tint: [1, 1, 1, 0] })), at: 0.8 },
    { o: add(R.object(quad, handsTex, { pipe: 'blend', model: m4.trs([2.186, 1.0, -1.3], -PI / 2, [0.6, 0.6, 1], 0, 1.2), clamp: true, tint: [1, 1, 1, 0] })), at: 0.45 },
  ];
  // ash: flakes that peel off the walls and floor and drift up while the other world spreads
  {
    const N = 1100, v = new Float32Array(N * 4 * 12), idx = new Uint32Array(N * 6);
    for (let k = 0; k < N; k++) {
      const r = Math.random(), y = Math.random() * 2.5;
      const p = r < 0.3 ? [rnd(-2.1, 2.1), 0.02, rnd(-2.4, 2.4)] : r < 0.5 ? [pick([-2.17, 2.17]), y, rnd(-2.4, 2.4)] : r < 0.7 ? [rnd(-2.1, 2.1), y, pick([-2.47, 2.47])] : r < 0.85 ? [rnd(-2.1, 2.1), 2.55, rnd(-2.4, 2.4)] : [rnd(-1.8, 1.8), rnd(0.2, 2.2), rnd(-2.1, 2.1)];
      const nn = [Math.random(), Math.random(), Math.random()], hot = Math.random() < 0.35 ? rnd(0.5, 1) : 0, sz = Math.random(), ph = Math.random();
      [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, w], c) => v.set([...p, ...nn, u, w, hot, sz, ph, 1], (k * 4 + c) * 12));
      idx.set([0, 1, 2, 0, 2, 3].map(x => x + k * 4), k * 6);
    }
    O.ash = add(R.object(R.mesh({ v, i: idx }), null, { pipe: 'blend', extra: [0, 0, 0, 1], order: 5 }));
  }
  // trash builds up as the night goes on (each pile forms out of the ash when the other world reaches it)
  O.trash = [['trash_1', 0.3], ['trash_6', 0.4], ['trash_2', 0.5], ['trash_3', 0.62], ['trash_5', 0.72], ['trash_4', 0.82]]
    .map(([n, at]) => ({ list: O.nodes[n], at, shown: false }));
  for (const t of O.trash) setVisible(t.list, false);
  O.newsObj.visible = false;   // the clipping is from 2000 — it only shows up once the room has rotted

  // ---- things she can bring
  const nodeBox = (names) => {
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const n of names) for (const o of O.nodes[n] || []) {
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], o.min[k] + o.base[12 + k]); mx[k] = Math.max(mx[k], o.max[k] + o.base[12 + k]); }
    }
    return { min: mn.map(v => v - 0.03), max: mx.map(v => v + 0.03), c: mn.map((v, k) => (v + mx[k]) / 2) };
  };
  const docBox = (o, pad = 0.04) => {
    const m = o.model, c = [m[12], m[13], m[14]];
    const ex = [Math.abs(m[0]) + Math.abs(m[4]), Math.abs(m[1]) + Math.abs(m[5]), Math.abs(m[2]) + Math.abs(m[6])].map(v => v / 2 + pad);
    return { min: c.map((v, k) => v - ex[k]), max: c.map((v, k) => v + ex[k]), c };
  };
  const def = (id, cfg) => {
    const objs = cfg.objs || cfg.nodes.flatMap(n => O.nodes[n] || []);
    const box = cfg.objs ? docBox(cfg.objs[0]) : nodeBox(cfg.nodes);
    W[id] = { id, objs, ...box, ...cfg };
  };
  def('remote', { name: '리모컨', nodes: ['item_remote'], cost: 8, act: 0, item: 'remote' });
  def('musicbox', { name: '오르골', nodes: ['item_musicbox', 'item_musicbox_lid'], cost: 10, act: 0, item: 'musicbox', hidden: true });
  def('curtain', { name: '커튼', nodes: ['curtain_L', 'curtain_R'], cost: 6, act: 1, action: true });
  def('calendar', { name: '창문의 달력', objs: [O.calendarObj], cost: 5, act: 1, item: 'calendar', needs: () => S.curtainOpen > 0.6 });
  def('drawer', { name: '책상 서랍', nodes: ['drawer', 'drawer_lock'], cost: 16, act: 1, item: 'drawer', heavy: true });
  def('machine', { name: '자동응답기', nodes: ['answering_machine', 'am_led'], cost: 12, act: 1, item: 'machine' });
  def('note', { name: '쪽지', objs: [O.noteObj], cost: 4, act: 1, item: 'note' });
  def('drawing', { name: '크레용 그림', objs: [O.drawingObj], cost: 5, act: 1, item: 'drawing' });
  def('news', { name: '신문 조각', objs: [O.newsObj], cost: 4, act: 2, item: 'news', needs: () => O.newsObj.visible });
  def('frame', { name: '가족사진', nodes: ['item_frame'], objs2: [O.photoObj], cost: 9, act: 1, item: 'photo' });
  def('knife', { name: '부엌칼', nodes: ['item_knife'], cost: 30, act: 1, item: 'knife', knife: true });
  def('doll', { name: '인형', nodes: ['item_doll'], cost: 25, act: 2, item: 'doll', angry: true });
  W.frame.objs = [...W.frame.objs, O.photoObj];
  // items that only exist inside other things
  for (const n of ['item_scissors', 'item_crank']) setVisible(O.nodes[n], false);
  // chair padlock & ropes are use-targets, not fetchables
  O.lidBase = O.nodes.item_musicbox_lid[0].base; O.boxBase = O.nodes.item_musicbox[0].base;
  O.lid = 0;
}

// ---------------------------------------------------------------- items in the lap
const ITEMS = {
  remote: { name: '리모컨', icon: '📺' },
  musicbox: { name: '오르골', icon: '🎵', obj: 'musicbox', desc: '작은 나무 오르골. 태엽 구멍이 비어 있다.' },
  calendar: { name: '달력', icon: '📅', doc: 'calendar' },
  drawer: { name: '잠긴 서랍', icon: '🗄', obj: 'drawer', desc: '서랍째 뽑혀 왔다. 숫자 네 자리 자물쇠가 걸려 있다.' },
  scissors: { name: '가위', icon: '✂', nodes: ['item_scissors'], desc: '녹슨 가위. 날은 아직 선다.' },
  crank: { name: '태엽 열쇠', icon: '🗝', nodes: ['item_crank'], desc: '오르골 태엽을 감는 작은 열쇠.' },
  machine: { name: '자동응답기', icon: '📼', obj: 'machine', desc: '빨간 불이 깜빡인다. 메시지가 남아 있다.' },
  note: { name: '쪽지', icon: '📝', doc: 'note' },
  drawing: { name: '크레용 그림', icon: '🖍', doc: 'drawing' },
  news: { name: '신문 조각', icon: '📰', doc: 'news' },
  photo: { name: '가족사진', icon: '🖼', doc: 'photo' },
  knife: { name: '부엌칼', icon: '🔪', obj: 'knife', desc: '날 쪽을 쥐여 줬다. 손바닥이 베였다.' },
  doll: { name: '수아 인형', icon: '🧸', obj: 'doll', desc: '헝겊 인형. 배가 불룩하고, 서툴게 꿰매져 있다.' },
  anklekey: { name: '작은 열쇠', icon: '🔑', desc: '인형 배 속에 있던 열쇠. 젖니 하나가 같이 나왔다.' },
};
function invAdd(id) {
  if (S.inv.includes(id)) return;
  S.inv.push(id); renderTray(id);
}
function invRemove(id) { S.inv = S.inv.filter(x => x !== id); if (S.useItem === id) S.useItem = null; renderTray(); }
function renderTray(fresh) {
  ui.tray.innerHTML = S.inv.map(id => `<button data-item="${id}" class="${S.useItem === id ? 'sel' : ''} ${fresh === id ? 'new' : ''}">${ITEMS[id].icon}<small>${ITEMS[id].name}</small></button>`).join('');
  ui.tray.querySelectorAll('[data-item]').forEach(b => b.addEventListener('click', () => trayTap(b.dataset.item)));
}
function trayTap(id) {
  if (!S.started || S.ending) return;
  snd.play('click');
  if (S.useItem && S.useItem !== id) { combine(S.useItem, id); return; }
  if (S.useItem === id) { S.useItem = null; renderTray(); return; }
  if (id === 'remote') { togglePad(); return; }
  openInspect(id);
}


// ================================================================ chapter 1: 숨바꼭질 (hide and seek)
// One-sentence rule: "수아를 찾아 눌러요". Tap where she hides. Failure escalates in steps, never a cheap scare first.
const LOG = []; window.__log = LOG;
function log(ev, data = {}) { LOG.push({ t: +S.time.toFixed(2), ev, ...data }); TEL?.event('game', { ev, gt: +S.time.toFixed(1), ...data }); }
const HIDE = {
  curtain: { ghost: [-2.1, 0, -1.02], kind: 'stand', min: [-2.35, 0, -1.55], max: [-1.9, 2.2, 0.25], c: [-2.08, 0.9, -0.7], cue: 'curtain', name: '커튼 뒤' },
  desk: { ghost: [1.95, 0, 0.06], kind: 'crouch', min: [1.45, 0, -0.35], max: [2.2, 0.85, 0.4], c: [1.85, 0.4, 0.05], cue: 'desk', name: '책상 밑' },
  shelf: { ghost: [-2.0, 0, 1.92], kind: 'stand', min: [-2.2, 0, 1.55], max: [-1.15, 1.7, 2.5], c: [-1.8, 0.9, 2.0], cue: 'shelf', name: '책장 옆' },
  tvside: { ghost: [-0.84, 0, -2.18], kind: 'crouch', min: [-1.25, 0, -2.5], max: [-0.45, 0.95, -1.85], c: [-0.82, 0.45, -2.2], cue: 'tv', name: 'TV 옆' },
  door: { ghost: [0.7, 0, 2.22], kind: 'stand', min: [0.05, 0, 1.9], max: [1.35, 2.15, 2.6], c: [0.7, 1.0, 2.3], cue: 'door', name: '문 앞' },
  behind: { ghost: [0.05, 0, 1.02], kind: 'stand', min: [-0.45, 0, 0.62], max: [0.5, 1.7, 1.45], c: [0.05, 1.1, 1.0], cue: 'chair', name: '의자 뒤' },
  under: { ghost: [0.02, 0.12, 1.55], kind: 'stand', lying: true, min: [-0.35, 0, 0.1], max: [0.4, 0.45, 1.7], c: [0.02, 0.15, 0.8], cue: 'chair', name: '의자 밑' },
};
const HS = { on: false, round: 0, spot: null, decoys: [], t: 0, real: 0, penalty: 0, phase: 'idle', esc: 0, firstInput: false, turning: null, lastSpot: 'curtain', cctv: false };
let hsToken = 0;
function hsAfter(sec, fn) { const tok = hsToken; after(sec, () => { if (tok === hsToken) fn(); }); }
// one subtitle channel during the chapter: the newest line replaces the old one
function hsSay(text, dur) { sayNow(text, dur); }
function hsNewBeat() { hsToken++; snd.stopVoices(); subQueue = []; }
function hsTip(html) { const el = ui.hsTip || (ui.hsTip = $('#hsTip')); put(el, 'innerHTML', html || ''); cls(el, 'show', !!html); }
function hsStart() {
  HS.on = true; ui.hud.classList.add('hs');
  S.yaw = -1.0; S.pitch = -0.12;   // the curtain sits near the centre on phones too
  log('chapter_start', { ch: 1 });
  hsAfter(0.4, () => { voice('hs_start', HIDE.curtain.c, 2.2); hsSay('“엄마! 일어났다! 우리 숨바꼭질 하자. 엄마가 술래야!”', 4.2); });
  hsRound(1);
}
function hsRound(n, retry = false) {
  hsNewBeat();
  HS.round = n; HS.t = 0; HS.real = 0; HS.penalty = 0; HS.esc = 0; HS.decoys = []; HS.found = false; HS.cheatDone = false;
  ui.hud.classList.toggle('turnon', n >= 3);
  S.lampDim = 0;
  const pickSpot = (pool) => { const c = pool.filter(k => k !== HS.lastSpot); return c[Math.floor(Math.random() * c.length)]; };
  if (n === 1) { hsHide('curtain', []); HS.phase = 'seek'; hsTip('<b>수아</b>를 찾아 눌러요'); log('round_start', { n, spot: 'curtain' }); return; }
  let spot, decoys;
  if (n === 2) { spot = pickSpot(['shelf', 'desk']); decoys = ['curtain', spot === 'shelf' ? 'desk' : 'shelf']; }
  else if (n === 3) { spot = 'behind'; decoys = ['curtain']; }
  else if (n === 4) { spot = 'under'; decoys = []; }
  else { spot = pickSpot(['shelf', 'desk', 'tvside', 'door', 'behind', 'curtain']); decoys = ['curtain', 'door', 'desk'].filter(k => k !== spot).slice(0, 1 + (n > 4 ? 1 : 0)); }
  // eyes closed: she counts while you hear her run to the hiding place
  HS.phase = 'count'; hsTip('');
  S.blackoutTarget = 1; S.ghost = null;
  const d = retry ? 0.5 : n === 2 ? 1.6 : n === 3 ? 2.0 : 1.2;   // eyes closed: short, long only before the twist
  hsSay('(눈을 감는다) …타닥타닥, 뛰어가는 발소리', d + 0.6);
  const from = HIDE[HS.lastSpot].ghost, to = HIDE[n === 3 ? 'curtain' : spot].ghost;   // round 3: the footsteps lie
  for (let k = 1; k <= 4; k++) hsAfter(k * d / 4.5, () => snd.play('steps', v3.add(v3.scale(from, 1 - k / 4), v3.scale(to, k / 4))));
  hsAfter(d, () => {
    S.blackoutTarget = 0; hsHide(spot, decoys); HS.phase = 'seek'; HS.t = 0; HS.real = 0;
    voice('hs_ready', null, 1.8); hsSay('“다 숨었다! 찾아봐~”', 2);
    if (n === 4) hsCctvRound();
    log('round_start', { n, spot, decoys, retry });
    log('input_enabled', { n });
  });
}
function hsResetCues() {
  for (const n of ['bookshelf', 'drawer', 'curtain_L']) { const b = O.nodes[n]?.[0]?.base; if (b) setModel(O.nodes[n], b.slice()); }
}
function hsHide(spot, decoys) {
  hsResetCues();
  HS.spot = spot; HS.decoys = decoys; HS.lastSpot = spot;
  const h = HIDE[spot];
  S.ghost = { p: h.ghost.slice(), kind: h.kind, alpha: 1, target: 1, mode: 'hide' };
  if (spot === 'curtain') { S.curtainTarget = 0; }
}
// screen-space generous hit test (>= 56 css px around the spot's centre) plus the spot's box
function hsPick(px, py, dir) {
  const cand = [HS.spot, ...HS.decoys].filter(Boolean);
  const rect = ui.canvas.getBoundingClientRect();
  let best = null, bd = 1e9;
  for (const k of cand) {
    const h = HIDE[k];
    const tb = rayAABB(EYE, dir, h.min, h.max);
    const VP = G, c = h.c;
    const cw = VP[3] * c[0] + VP[7] * c[1] + VP[11] * c[2] + VP[15];
    let sd = 1e9;
    if (cw > 0.05) {
      const sx = ((VP[0] * c[0] + VP[4] * c[1] + VP[8] * c[2] + VP[12]) / cw * 0.5 + 0.5) * rect.width + rect.left;
      const sy = (0.5 - (VP[1] * c[0] + VP[5] * c[1] + VP[9] * c[2] + VP[13]) / cw * 0.5) * rect.height + rect.top;
      sd = Math.hypot(px - sx, py - sy);
    }
    const score = tb >= 0 ? tb : (sd < 64 ? 10 + sd / 100 : 1e9);
    if (score < bd) { bd = score; best = k; }
  }
  return bd < 1e8 ? best : null;
}
function hsTap(px, py, dir) {
  if (HS.phase === 'photo' || HS.phase === 'final') {
    const fb = O.nodes.item_frame[0].base, fc = [fb[12], fb[13], fb[14]];
    const hitPhoto = rayAABB(EYE, dir, [fc[0] - 0.3, fc[1] - 0.35, fc[2] - 0.1], [fc[0] + 0.3, fc[1] + 0.35, fc[2] + 0.2]) >= 0;
    if (HS.phase === 'photo' && hitPhoto) { log('valid_target', { round: 'photo' }); hsPhoto(); return true; }
    if (HS.phase === 'final') return true;   // the choice is made with its two labelled buttons
    log('false_tap', { where: HS.phase }); return true;
  }
  if (HS.phase === 'anom') return AN.on ? anTap(px, py, dir) : true;
  if (HS.phase !== 'seek') return false;
  if (!HS.firstInput) { HS.firstInput = true; log('first_input', { kind: 'tap' }); }
  if (HS.round === 4 && !HS.cctv) {
    const r = O.tvRect, tt = (r.z - EYE[2]) / dir[2];
    const x = EYE[0] + dir[0] * tt, y = EYE[1] + dir[1] * tt;
    if (tt > 0 && x > r.x0 - 0.15 && x < r.x1 + 0.15 && y > r.y0 - 0.15 && y < r.y1 + 0.15) { hsCctvView(true); return true; }
  }
  if (HS.cctv) {   // pick through the camera: generous — a tap near her on the CCTV counts
    const h = HIDE[HS.spot], cam = cctvBasis(), rect = ui.canvas.getBoundingClientRect();
    const d = v3.sub(h.c, CCTV.pos), z = v3.dot(d, cam.f);
    const sx = (v3.dot(d, cam.r) / z / (CCTV.tanHalf * (R.width / R.height)) * 0.5 + 0.5) * rect.width;
    const sy = (0.5 - v3.dot(d, cam.u) / z / CCTV.tanHalf * 0.5) * rect.height;
    if (Math.hypot(px - rect.left - sx, py - rect.top - sy) < Math.max(90, rect.width * 0.12)) { hsFound(); return true; }
    log('false_tap', { where: 'cctv' }); hsCctvView(false); return true;
  }
  const k = hsPick(px, py, dir);
  if (!k) { log('false_tap', { where: 'nothing' }); return true; }
  if (k === HS.spot) { hsFound(); return true; }
  // a decoy
  log('false_tap', { where: k });
  if (HS.round === 3 && k === 'curtain' && !HS.cheatDone) {
    HS.cheatDone = true;
    S.curtainTarget = 1; snd.play('curtain', HIDE.curtain.c);
    hsAfter(0.9, () => { voice('hs_cheat', HIDE.behind.c, 2.2); hsSay('“속았지? 커튼엔 아무도 없었어!”', 3); });
    hsAfter(3.2, () => { S.curtainTarget = 0; snd.play('creak', HIDE.behind.c); voice('hs_behind', HIDE.behind.c, 2.4); hsSay('…등 뒤에서, 의자가 삐걱.', 3); $('#turnBtn').classList.add('pulse'); log('hint_used', { hint: 'behind' }); });
    return true;
  }
  voice('hs_wrong', HIDE[HS.spot].c, 1.8); hsSay('“거기 아니야~”', 2);
  HS.t += 3; HS.penalty += 3;   // a wrong guess moves the warnings closer
  return true;
}
function hsFound() {
  hsNewBeat();
  HS.phase = 'found'; hsResetCues(); HS.found = true; hsTip('');
  $('#turnBtn').classList.remove('pulse');
  log('valid_target', { round: HS.round, spot: HS.spot, realTime: +HS.real.toFixed(1), penalty: HS.penalty });
  if (HS.cctv) hsCctvView(false);
  const h = HIDE[HS.spot];
  if (HS.spot === 'curtain') { S.curtainTarget = 1; snd.play('curtain', h.c); hsAfter(1.6, () => { S.curtainTarget = 0; }); }
  if (S.ghost) {
    S.ghost.mode = 'found';
    const to = v3.norm([EYE[0] - S.ghost.p[0], 0, EYE[2] - S.ghost.p[2]]);
    S.ghost.p = v3.add(S.ghost.p, v3.scale(to, 0.3));
    hsAfter(1.4, () => { if (S.ghost?.mode === 'found') S.ghost.target = 0; });
  }
  S.flash = 0.18; S.flashCol = [1, 0.95, 0.85];
  const line = HS.round === 1 ? ['hs_found1', '헤헤, 들켰다!'] : HS.round === 3 ? ['c_found', '찾았다…'] : ['hs_found2', '와, 엄마 잘 찾는다!'];
  voice(line[0], h.c, 2.2); hsSay(`“${line[1]}”`, 2.2);
  if (HS.round === 1) {   // the reward floats to your lap while you can still look around
    hsAfter(0.9, () => { S.job = { w: W.remote, t: 0, phase: 'lift', carry: false, from: W.remote.c.slice(), pos: W.remote.c.slice(), spin: 0, free: true }; });
    hsAfter(2.4, () => anStart(1));
  } else if (HS.round === 2) {   // one-line story fragment, 3 seconds
    hsAfter(1.6, () => { S.tape = Math.max(S.tape, 1); hsSay('📼 …책상 위 자동응답기에 빨간 불이 켜졌다. “수아야~ 엄마야…”', 3); snd.play('beep', [1.81, 0.8, 0.12]); });
    hsAfter(3.6, () => hsRound(3));
  } else if (HS.round === 3) {
    hsAfter(2.0, () => anStart(2));
  } else if (HS.round === 4) {
    hsAfter(2.0, () => anStart(3));
  }
}
function hsFail() {
  hsNewBeat();
  HS.phase = 'fail';
  log('fail_reason', { round: HS.round, spot: HS.spot, realTime: +HS.real.toFixed(1), penalty: HS.penalty, esc: HS.esc });
  if (HS.cctv) hsCctvView(false);
  // she steps out right in front of you — the only real scare, after two warnings
  const p = v3.add([EYE[0], 0, EYE[2]], v3.scale(flatFwd(), 0.7));
  S.ghost = { p, kind: 'stand', alpha: 0.2, target: 1, mode: 'close' };
  voice('hs_fail', [p[0], 1.1, p[2]], 2.4); hsSay('“엄마 바보~ 여기 있었지롱.”', 2.5);
  S.shake = 0.6; S.flash = 0.3; S.flashCol = [0.4, 0.05, 0.05];
  touch(12, 'hs_fail');
  hsAfter(1.6, () => { if (S.ghost) S.ghost.target = 0; log('retry', { round: HS.round }); hsRound(HS.round, true); });
}
// round 4: the one place your own eyes can't reach — the TV shows it
function hsCctvRound() {
  S.tv.on = true; S.tv.ch = 7; tvScreen.channel = 7; tvScreen.osd = 3; snd.play('static', O.tvCenter); S.glitch = 0.8;
  hsAfter(1.2, () => { hsTip('<b>TV</b>를 눌러 봐요'); hsSay('TV가 저절로 켜졌다. …방 구석 카메라 화면.', 3); });
}
function hsCctvView(on) {
  HS.cctv = on; $('#cctvOsd').classList.toggle('show', on);
  if (on) { snd.play('static'); S.glitch = 0.6; hsTip(''); log('cctv_view', {}); }
}
// ---- the story beat: one clue, one choice with the tap you already know
function hsStory() {
  hsNewBeat();
  S.insanity = 0; S.fear = 0;
  HS.phase = 'story'; log('story_start', {});
  S.tv.on = false; S.decayTarget = 0.55; S.lampDim = 0.35;
  const p = v3.add([EYE[0], 0, EYE[2]], [0.15, 0, -1.05]);
  S.ghost = { p, kind: 'stand', alpha: 0, target: 1, mode: 'close' };
  S.yaw = 0.05; S.pitch = -0.05;
  voice('c_rope', [p[0], 1.1, p[2]], 2.2); hsSay('“엄마… 이번엔 안 나갈 거지? 또 가지 마.”', 3.4);
  hsAfter(3.6, () => { hsSay('그 애가 벽의 가족사진을 가리킨다.', 3); S.flags.photoGlow = 1; });
  hsAfter(6.8, () => { hsTip('<b>가족사진</b>을 눌러 봐요'); HS.phase = 'photo'; log('input_enabled', { n: 'photo' }); });
}
function hsPhoto() {
  hsNewBeat();
  HS.phase = 'choice'; hsTip(''); S.flags.photoGlow = 0;
  showDoc('가족사진', S.decay > 0.5 ? O.familyRuined : O.familyClean,
    '생일 케이크 앞의 여자와 수아. …사진 속 여자의 얼굴을, 나는 안다. 매일 거울에서 보던 얼굴이다.');
  record('photo', '가족사진 — 사진 속 엄마는… 나였다.');
  const close = ui.card.querySelector('[data-close]');
  close.textContent = '사진을 들고 닫기';
  close.addEventListener('click', () => {
    hsAfter(0.6, () => {
      hsSay('“엄마… 이번엔 어디 안 갈 거지?”', 4);
      ui.hud.classList.add('choosing');
      HS.phase = 'final'; HS.choiceAt = performance.now(); log('input_enabled', { n: 'choice' });
      $('#choice').classList.add('show'); $('#chStay').classList.remove('confirm');
    });
  }, { once: true });
}
function hsChoiceReady() {
  const ok = HS.phase === 'final' && performance.now() - (HS.choiceAt || 0) > 450;
  if (!ok && (HS.phase === 'final' || HS.phase === 'choice')) { HS.blocked = (HS.blocked || 0) + 1; log('input_blocked', { count: HS.blocked }); }
  return ok;
}   // the finger that closed the photo must not choose
function hsGive() {
  if (!hsChoiceReady()) return;
  $('#choice').classList.remove('show'); ui.hud.classList.remove('choosing');
  hsNewBeat(); HS.phase = 'end'; hsTip(''); $('#turnBtn').classList.remove('pulse');
  log('choice', { give: 'photo' }); log('ending_choice', { type: 'release' });
  const g = S.ghost;
  voice('c_take', g ? [g.p[0], 1.1, g.p[2]] : null, 2.2); hsSay('“이거… 나야? 엄마랑… 나.”', 3.4);
  hsAfter(3.8, () => { voice('c_bye', g ? [g.p[0], 1.1, g.p[2]] : null, 2.2); hsSay('“엄마… 이제 가도 돼. 문 열어 줄게.”', 3.6); });
  hsAfter(5.5, () => { snd.play('creak', v3.add(EYE, [0.3, -0.5, 0])); hsSay('손목의 밧줄이 풀린다. …문을 잠근 손은, 내 손이었다.', 4); setVisible(O.nodes.rope_R, false); setVisible(O.nodes.rope_L || [], false); });
  hsAfter(8.2, () => { if (S.ghost) S.ghost.target = 0; snd.play('unlock', [0.7, 1, 2.45]); S.yaw = PI; S.pitch = -0.05; });
  hsAfter(9.4, () => { snd.play('creak', [0.7, 1, 2.45]); S.doorOpenT = 1; S.doorLight = 0.001; snd.stopMusic(3); });
  hsAfter(12.5, () => ui.fade.classList.add('white'));
  hsAfter(15.5, () => { HS.on = false; showEnding('good'); });
}
function hsStay() {
  if (!hsChoiceReady()) return;
  const b = $('#chStay');
  if (!b.classList.contains('confirm')) {   // tell the cost before it is paid
    b.classList.add('confirm'); b.innerHTML = '정말 남기<small>다시는 문이 열리지 않아도?</small>';
    hsSay('…다시는 문이 열리지 않아도?', 3); log('choice_warn', {}); HS.choiceAt = performance.now(); return;
  }
  hsPlayAgain();
}
function hsPlayAgain() {
  $('#choice').classList.remove('show'); ui.hud.classList.remove('choosing');
  hsNewBeat(); HS.phase = 'end'; hsTip(''); $('#turnBtn').classList.remove('pulse');
  log('choice', { give: 'play' }); log('ending_choice', { type: 'stay' });
  const g = S.ghost;
  voice('c_stay', g ? [g.p[0], 1.1, g.p[2]] : null, 2.2); hsSay('“같이 있자… 계속.”', 3);
  hsAfter(3, () => { S.blackoutTarget = 1; snd.stopMusic(2); });
  hsAfter(5.5, () => { HS.on = false; showEnding('doll'); });
}
function hsEnd() {
  HS.on = false; HS.phase = 'idle'; ui.hud.classList.remove('hs'); hsTip('');
  log('chapter_end', { ch: 1, t: +S.time.toFixed(1) });
  // hand over to the room-and-TV chapter
  objective('무릎 위 리모컨으로 TV를 켠다');
  hsSay('숨바꼭질이 끝났다. …무릎 위의 리모컨을 누른다.', 4);
}
function hsUpdate(dt) {
  if (!HS.on || S.paused) return;
  const h = HS.spot && HIDE[HS.spot];
  if (HS.phase === 'seek' && h) {
    if (HS.turning) return;
    HS.t += dt; HS.real += dt;
    if (HS.round === 1) {
      if (HS.t > 9 && !HS.hint1) { HS.hint1 = true; voice('hs_hint', h.c, 2.0); hsSay('“나 여기 있는데~”', 2.5); log('hint_used', { hint: 'voice' }); }
      return;   // no failure in the tutorial round
    }
    if (HS.t > 10 && HS.esc < 1) { HS.esc = 1; voice('hs_hint', h.c, 2.0); hsSay('“나 여기 있는데~”', 2.5); log('hint_used', { hint: 'voice' }); }
    if (HS.t > 20 && HS.esc < 2) { HS.esc = 2; snd.play('creak', v3.add(EYE, [0, 0, 0.6])); S.lampDim = 0.5; hsSay('…의자가 삐걱거린다. 불빛이 한 칸 어두워졌다.', 3); log('escalate', { level: 1 }); }
    if (HS.t > 30 && HS.esc < 3) { HS.esc = 3; voice('hs_closer', h.c, 2.2); hsSay('“가까이 왔다…”', 2.5); log('escalate', { level: 2 }); if (HS.round === 3) $('#turnBtn').classList.add('pulse'); }
    if (HS.t > 40) hsFail();
  }
}
// cue animation per hiding place (strong on the real spot, faint on decoys)
function hsCues(time) {
  if (!HS.on || HS.phase !== 'seek') return;
  const cues = [[HS.spot, 1], ...HS.decoys.map(d => [d, HS.round === 3 && d === 'curtain' && !HS.cheatDone ? 1.2 : 0.35])];
  for (const [k, amp] of cues) {
    const h = HIDE[k]; if (!h) continue;
    const pulse = Math.max(0, Math.sin(time * 2.3 + k.length)) ** 3 * amp;
    if (h.cue === 'curtain') {
      const base = O.nodes.curtain_L[0].base;
      if (S.curtainOpen < 0.05) setModel(O.nodes.curtain_L, m4.trs([base[12] + pulse * 0.05, base[13], base[14]], 0, [1 + pulse * 1.4, 1, 1 - pulse * 0.05]));
    }
    if (h.cue === 'shelf') { const b = O.nodes.bookshelf[0].base; setModel(O.nodes.bookshelf, m4.trs([b[12] + (Math.random() - 0.5) * 0.006 * pulse, b[13], b[14]], (Math.random() - 0.5) * 0.01 * pulse)); }
    if (h.cue === 'desk') { const b = O.nodes.drawer[0].base; setModel(O.nodes.drawer, m4.trs([b[12] - pulse * 0.03, b[13], b[14]])); }
    if (h.cue === 'tv' && pulse > 0.3) { S.glitch = Math.max(S.glitch, 0.4 * amp); }
    if (h.cue === 'door') { const b = O.nodes.door[0].base; setModel(O.nodes.door, m4.trs([b[12], b[13], b[14]], (Math.random() - 0.5) * 0.012 * pulse)); }
    if (Math.random() < 0.012 * amp) snd.play(h.cue === 'shelf' ? 'bang' : h.cue === 'desk' ? 'drawer' : h.cue === 'door' ? 'knock' : h.cue === 'chair' ? 'creak' : 'giggle', h.c);
  }
}
function turnAround() {
  if (HS.phase === 'final') return;
  if (HS.turning) return;
  // look straight back over the chair (nearest equivalent of yaw = PI)
  const target = S.yaw + ((((PI - S.yaw) % (2 * PI)) + 3 * PI) % (2 * PI) - PI);
  $('#turnBtn').classList.remove('pulse');
  HS.turning = { from: S.yaw, to: target, t: 0, p0: S.pitch };
  if (!HS.firstInput) { HS.firstInput = true; log('first_input', { kind: 'turn' }); }
  log('turn', {});
}

// ================================================================ the other world (Silent Hill, 2006): a front rolls through the room,
// the old surface chars and flakes away as ash, the rotten room is underneath. New things form out of the ash, never pop in.
const SHIFT = { on: false, o: [0, 1.2, -2.4], r: 99, from: 0, to: 0, burn: 0, speed: 1, t: 0, big: false, cr: 0 };
function startShift(to) {
  const from = S.decay, big = to - from > 0.16;   // the first stains creep in quietly; the siren is for the real shifts
  // it starts in front of you, so you watch it come
  let o = v3.add(EYE, v3.scale(flatFwd(), 2.4)); o = [clamp(o[0], -2.1, 2.1), 1.3, clamp(o[2], -2.4, 2.4)];
  if (S.ghost && S.ghost.alpha > 0.3 && !S.ghost.camOnly) o = [S.ghost.p[0], 1.1, S.ghost.p[2]];
  Object.assign(SHIFT, { on: true, o, r: 0, from, to, big, t: 0, speed: big ? 0.8 : 0.55, burn: 0, cr: 0 });
  log('shift', { from: +from.toFixed(2), to: +to.toFixed(2), big });
  if (big) { snd.play('siren'); snd.duck(0.35, 7); }
  snd.play('crackle', o);
}
function shiftUpdate(dt) {
  if (!SHIFT.on) {
    if (S.started && Math.abs(S.decayTarget - S.decay) > 0.004) startShift(S.decayTarget);
    return;
  }
  SHIFT.t += dt;
  SHIFT.r += SHIFT.speed * dt * (SHIFT.big && SHIFT.t < 2.5 ? 0.2 : 1);   // the siren first, then it comes
  SHIFT.burn = Math.min(1, SHIFT.t / 1.2) * (SHIFT.big ? 1 : 0.6) * (1 - smooth(6.2, 7.5, SHIFT.r));
  S.decay = lerp(SHIFT.from, SHIFT.to, clamp(SHIFT.r / 6.5, 0, 1));
  // the crackle follows the front
  SHIFT.cr -= dt;
  if (SHIFT.cr <= 0 && SHIFT.r < 6.5) {
    SHIFT.cr = rnd(1.4, 2.6);
    const d = v3.norm(v3.sub(EYE, SHIFT.o)), q = v3.add(SHIFT.o, v3.scale(d, Math.min(SHIFT.r, v3.len(v3.sub(EYE, SHIFT.o)) - 0.3)));
    snd.play('crackle', q);
  }
  if (SHIFT.r > 7.5) { SHIFT.on = false; S.decay = SHIFT.to; log('shift_end', {}); }
}
function levelAt(p) { return !SHIFT.on ? S.decay : v3.len(v3.sub(p, SHIFT.o)) < SHIFT.r ? SHIFT.to : SHIFT.from; }
const FORMING = new Set();
function formIn(list) { for (const o of list) { o.visible = true; o.extra[2] = 0.001; FORMING.add(o); } }
function formUpdate(dt) {
  for (const o of FORMING) { o.extra[2] += dt / 2.6; if (o.extra[2] >= 1) { o.extra[2] = 0; FORMING.delete(o); } }
}

// ================================================================ 이상현상 (the room turns wrong)
// One rule, same verb as hide and seek: "이상한 곳을 눌러 원래대로 돌려요". She changes things only where you are
// not looking; three wrong things at once gives you a few seconds to fix one, then she comes for you.
const AN = { on: false, phase: 0, goal: 0, fixed: 0, act: {}, next: 0, danger: 0, fails: 0, lock: 0, script: [], hintT: 0 };
const ANOM = {
  table: { node: 'lowtable', name: '탁자', sfx: 'bang', cue: '…무언가 둥실 떠오르는 소리.', lift: 0.45 },
  tv: { node: 'tv', name: 'TV', sfx: 'static', cue: '…TV가 저절로 켜졌다.' },
  doll: { node: 'item_doll', name: '인형', sfx: 'bang', cue: '…등 뒤에서, 작은 발소리.', to: [-0.7, 0, 2.2] },   // climbs down, grows, and stands behind you (clear of the chair back) facing you
  frame: { node: 'item_frame', name: '가족사진', sfx: 'creak', cue: '…액자가 삐걱삐걱 흔들리는 소리.', loopSfx: 3.5 },
  cushion: { node: 'cushion', name: '방석', sfx: 'whisper', cue: '…누가 속삭인다.', lift: 1.0 },
  lamp: { node: 'lamp', name: '전등', sfx: 'creak', cue: '…머리 위에서 끼익, 끼익.', loopSfx: 2.2, drop: 0.95 },   // drops on a longer cord to eye level, swings hard, the light turns red
  curtain: { name: '커튼', sfx: 'giggle', cue: '…커튼 쪽에서 킥킥.', ghost: true },
  crawl: { name: '기어오는 아이', sfx: 'steps', cue: '…바닥을 긁으며 기어오는 소리.', ghost: true },
};
function nodeBox(name, pad = 0.08) {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const o of O.nodes[name]) for (let q = 0; q < 3; q++) {
    mn[q] = Math.min(mn[q], o.base[12 + q] + o.min[q] - pad); mx[q] = Math.max(mx[q], o.base[12 + q] + o.max[q] + pad);
  }
  return { min: mn, max: mx, c: mn.map((v, q) => (v + mx[q]) / 2) };
}
function anBox(k) {
  const a = ANOM[k];
  if (k === 'curtain') return HIDE.curtain;
  if (k === 'crawl') { const p = AN.act.crawl?.p || [0, 0, -1.5]; return { min: [p[0] - 0.55, 0, p[2] - 0.55], max: [p[0] + 0.55, 0.75, p[2] + 0.55], c: [p[0], 0.35, p[2]] }; }
  if (!a.box) a.box = nodeBox(a.node, k === 'doll' ? 0.15 : 0.1);
  const b = a.box, s = AN.act[k];
  if (a.to && s && s.k > 0.5) { const t = a.to; return { min: [t[0] - 0.35, 0, t[2] - 0.35], max: [t[0] + 0.35, 0.7, t[2] + 0.35], c: [t[0], 0.35, t[2]] }; }
  if (a.drop && s) { const d = a.drop * smooth(0, 1, s.k); return { min: [b.min[0] - 0.3, b.min[1] - d, b.min[2] - 0.3], max: [b.max[0] + 0.3, b.max[1] - d, b.max[2] + 0.3], c: [b.c[0], b.c[1] - d, b.c[2]] }; }
  if (!a.lift || !s) return b;
  const up = a.lift * s.k;
  return { min: b.min, max: [b.max[0], b.max[1] + up, b.max[2]], c: [b.c[0], b.c[1] + up, b.c[2]] };
}
function anHud() {
  const n = Object.keys(AN.act).length;
  $('#anHud').classList.toggle('show', AN.on);
  $('#anHud').classList.toggle('danger', AN.danger > 0);
  document.querySelectorAll('#anHud .pips i').forEach((el, i) => el.classList.toggle('on', i < n));
  $('#anCount').innerHTML = `${Math.min(AN.fixed, AN.goal)} / ${AN.goal}` + (AN.fails ? ` <span class="fails">${'✕'.repeat(AN.fails)}</span>` : '');
}
function anStart(phase) {
  hsNewBeat();
  AN.on = true; AN.phase = phase; AN.fixed = 0; AN.act = {}; AN.danger = 0; AN.lock = 0;
  AN.goal = [0, 6, 8, 9][phase];
  AN.baseDim = phase === 3 ? 0.72 : 0; AN.streak = 0; AN.crawlShown = AN.crawlShown || false;
  HS.phase = 'anom'; HS.spot = null; S.ghost = null;
  ui.hud.classList.add('turnon');
  S.decayTarget = [0, 0.15, 0.35, 0.5][phase];
  const bigShift = S.decayTarget - S.decay > 0.16;
  log('anom_start', { phase });
  if (phase === 1) {
    AN.script = ['tv', 'doll'];   // taught in order after the table: in front, then behind you
    voice('an_intro', null, 2.0); hsSay('“이번엔 내가 방을 이상하게 바꿔 놓을게! 엄마가 원래대로 돌려놔~”', 3.6);
    hsAfter(1.2, () => { anSpawn('table', true); hsTip('<b>이상한 곳</b>을 눌러 원래대로 돌려요'); });
    AN.next = 1e9;
  } else if (phase === 2) {
    AN.script = ['crawl'];
    hsAfter(bigShift ? 7.5 : 0, () => { voice('an_more', null, 2.0); hsSay('“이번엔… 나도 움직일 거야.”', 3); });
    AN.next = bigShift ? 10 : 3;
  } else {   // the last night: the bulb dies, only the TV and the moon are left
    AN.script = ['curtain'];
    S.lampDim = AN.baseDim; snd.play('pop', [0, 2.2, -0.6]);
    voice('an_last', null, 2.0); hsSay('“불이 죽어 간다… 이제 엄마도 나처럼 어둠 속에서 찾아.”', 3.6);
    AN.next = bigShift ? 10 : 3.5;
  }
  anHud();
}
function anSpawn(k, force = false) {
  const a = ANOM[k];
  if (AN.act[k]) return false;
  if (a.ghost && (AN.act.curtain || AN.act.crawl)) return false;   // one of her at a time
  if (!force && k !== 'crawl' && inView(anBox(k).c, 1.15).visible) return false;    // never change what you are watching (she picks an unseen corner herself)
  const s = { k: 0, t: 0, seen: false };
  AN.act[k] = s;
  if (k === 'tv') { S.tv.on = true; S.tv.ch = 13; snd.play('static', O.tvCenter); S.glitch = 0.5; }
  if (k === 'door') S.doorOpenT = 0.2;
  if (k === 'curtain') S.ghost = { p: HIDE.curtain.ghost.slice(), kind: 'stand', alpha: 1, target: 1, mode: 'anom', clip: 0.3 };
  if (k === 'crawl') {
    const all = [[-0.85, 0, -2.0], [1.7, 0, -1.6], [-1.7, 0, 1.6], [1.5, 0, 1.9]];
    const starts = all.filter(p => !inView([p[0], 0.4, p[2]], 1.2).visible);
    if (!AN.crawlShown) {   // the first one crawls out where you can see her, to teach the rule
      AN.crawlShown = true; s.teach = true;
      s.p = all.map(p => [p, inView([p[0], 0.4, p[2]]).ang]).sort((x, y) => x[1] - y[1])[0][0].slice();
      hsAfter(1.4, () => { hsTip('보고 있으면 <b>멈춰요</b>. 눈을 떼면… 다가와요'); });
      hsAfter(5.5, () => { if (AN.act.crawl) hsTip('<b>기어 오는 아이</b>를 눌러 쫓아내요'); });
    } else {
      if (!starts.length) { delete AN.act[k]; return false; }
      s.p = pick(starts).slice();
    }
    s.stepT = 0;
    S.ghost = { p: s.p, kind: 'crouch', alpha: 0, target: 1, mode: 'crawl' };
  }
  const pos = anBox(k).c;
  snd.play(a.sfx, pos);
  log('anom_spawn', { k, n: Object.keys(AN.act).length });
  anHud();
  return true;
}
function anFix(k) {
  const s = AN.act[k]; if (!s) return;
  delete AN.act[k];
  const pos = anBox(k).c;
  AN.fixed++;
  log('anom_fix', { k, dur: +s.t.toFixed(1), fixed: AN.fixed });
  S.flash = 0.12; S.flashCol = [1, 0.95, 0.85];
  snd.play(k === 'tv' ? 'pop' : k === 'drawer' ? 'drawer' : k === 'door' ? 'bang' : k === 'curtain' ? 'curtain' : 'chime', pos);
  if (k === 'tv') { S.tv.on = false; }
  if (k === 'door') S.doorOpenT = 0;
  if (k === 'curtain') { S.curtainTarget = 1; hsAfter(1.4, () => { S.curtainTarget = 0; }); if (S.ghost) S.ghost.target = 0; snd.play('giggle', pos); }
  if (k === 'crawl') { if (S.ghost) { S.ghost.target = 0; S.ghost.twitch = 1; } S.glitch = 0.8; snd.play('whisper', pos); if (s.teach) hsTip(''); }
  // pending restore animation: s.k runs back to 0 in anApply
  AN.back = AN.back || {}; AN.back[k] = s;
  if (Object.keys(AN.act).length < 3 && AN.danger > 0) { AN.danger = 0; S.lampDim = AN.baseDim; hsTip(''); log('anom_rescue', {}); }
  // her reactions: short, never blocking
  const lines = [['an_fix1', '에이~ 들켰다.'], ['an_fix2', '엄마 눈 좋다~'], ['hs_found1', '헤헤, 들켰다!']];
  if (AN.fixed === 1 || Math.random() < 0.35) { const l = pick(lines); voice(l[0], pos, 1.8); hsSay(`“${l[1]}”`, 2); }
  if (s.nudged || (AN.fixed === 3 && AN.phase === 1)) hsTip(AN.phase === 1 && AN.fixed < 3 ? '<b>이상한 곳</b>을 눌러 원래대로 돌려요' : '');
  AN.streak++;
  if (!Object.keys(AN.act).length) AN.next = Math.min(AN.next, AN.script.length ? 1.2 : rnd(2, 3.5));
  if (AN.streak >= 2 && !AN.script.length) { AN.next = Math.max(AN.next, rnd(2.5, 3.5)); AN.streak = 0; }   // two in a row: a breath
  if (AN.fixed >= AN.goal && !Object.keys(AN.act).length) hsAfter(1.2, () => anEnd());
  anHud();
}
function anFail(why) {
  hsNewBeat();
  AN.fails++; AN.danger = 0; S.lampDim = AN.baseDim; hsTip('');
  log('anom_fail', { why, fails: AN.fails, active: Object.keys(AN.act) });
  const p = v3.add([EYE[0], 0, EYE[2]], v3.scale(flatFwd(), 0.65));
  S.ghost = { p, kind: 'stand', alpha: 0.3, target: 1, mode: 'close' };
  snd.play('scare'); S.shake = 0.7; S.flash = 0.35; S.flashCol = [0.45, 0.04, 0.04];
  voice('an_fail', [p[0], 1.1, p[2]], 2.4); hsSay('“엄마 바보~ 하나도 못 고쳤지롱.”', 2.5);
  touch(14, 'anom_fail');
  for (const k of Object.keys(AN.act)) { AN.back = AN.back || {}; AN.back[k] = AN.act[k]; if (k === 'tv') S.tv.on = false; if (k === 'door') S.doorOpenT = 0; }
  AN.act = {}; $('#anMark').className = '';
  hsAfter(1.8, () => { if (S.ghost?.mode === 'close') S.ghost.target = 0; });
  if (AN.fails >= 3) { hsAfter(2.4, () => { AN.on = false; HS.on = false; anHud(); showEnding('grab'); }); return; }
  AN.next = 4;
  anHud();
}
function anEnd() {
  if (!AN.on) return;
  AN.on = false; AN.act = {}; hsTip(''); anHud(); $('#anMark').className = '';
  log('anom_end', { phase: AN.phase, fails: AN.fails, t: +S.time.toFixed(1) });
  voice('an_done', null, 2.0); hsSay('“와~ 다 찾았다! 엄마 최고!”', 2.4);
  if (AN.phase === 1) hsAfter(2.6, () => { voice('hs_again', null, 2.0); hsSay('“이번엔 진짜 숨을게. 못 찾을걸?”', 2.2); hsAfter(1.6, () => hsRound(3)); });
  else if (AN.phase === 2) hsAfter(2.6, () => { voice('hs_under', null, 2.0); hsSay('“이번엔… 진짜 못 찾을걸.”', 2.4); hsAfter(2.4, () => hsRound(4)); });
  else hsAfter(2.8, () => { S.lampDim = 0; hsStory(); });
}
function anTap(px, py, dir) {
  if (AN.lock > 0) return true;
  if (!HS.firstInput) { HS.firstInput = true; log('first_input', { kind: 'tap' }); }
  const cands = Object.keys(ANOM).filter(k => AN.act[k] || (!ANOM[k].ghost && (k !== 'tv' || !S.tv.on)));
  const rect = ui.canvas.getBoundingClientRect();
  let best = null, bd = 1e9;
  for (const k of cands) {
    const b = anBox(k), c = b.c;
    const tb = rayAABB(EYE, dir, b.min, b.max);
    const cw = G[3] * c[0] + G[7] * c[1] + G[11] * c[2] + G[15];
    let sd = 1e9;
    if (cw > 0.05) {
      const sx = ((G[0] * c[0] + G[4] * c[1] + G[8] * c[2] + G[12]) / cw * 0.5 + 0.5) * rect.width + rect.left;
      const sy = (0.5 - (G[1] * c[0] + G[5] * c[1] + G[9] * c[2] + G[13]) / cw * 0.5) * rect.height + rect.top;
      sd = Math.hypot(px - sx, py - sy);
    }
    // anomalies win over normal things; a near miss on a real one still counts
    const score = (AN.act[k] ? 0 : 5) + (tb >= 0 ? tb : sd < 70 ? 3 + sd / 100 : 1e9);
    if (score < bd) { bd = score; best = k; }
  }
  if (!best || bd >= 1e8) { log('false_tap', { where: 'nothing' }); return true; }
  if (AN.act[best]) { anFix(best); return true; }
  // reported something that is fine: small, visible cost
  log('false_report', { k: best });
  AN.lock = 1.0; snd.play('click');
  hsSay(`…${ANOM[best].name}엔 이상이 없다.`, 1.6);
  return true;
}
function anUpdate(dt) {
  if (!AN.on || S.paused) return;
  AN.lock = Math.max(0, AN.lock - dt);
  const keys = Object.keys(AN.act), n = keys.length;
  for (const k of keys) {
    const s = AN.act[k];
    s.t += dt; s.k = Math.min(1, s.k + dt * 1.6);
    const c = anBox(k).c;
    if (!s.seen && inView(c, 0.9).visible) { s.seen = true; s.seenAt = s.t; log('anom_seen', { k, after: +s.t.toFixed(1) }); }
    // looked at it and did not notice: name it once (only while she is still teaching)
    if (s.seen && !s.nudged && AN.phase === 1 && s.t - s.seenAt > 8 && inView(c, 0.9).visible) { s.nudged = true; hsTip(`<b>${ANOM[k].name}</b>… 원래 저랬던가? 눌러서 돌려놔요`); log('hint_used', { hint: 'name_' + k }); }
    if (ANOM[k].loopSfx && s.k > 0.9 && (s.t - dt) % ANOM[k].loopSfx > s.t % ANOM[k].loopSfx) snd.play(ANOM[k].sfx, c);
    // she keeps reminding you of the ones you have not found
    if (!s.seen && s.t > 9 && (s.t - dt) % 9 > s.t % 9) { snd.play(ANOM[k].sfx, c); hsSay(ANOM[k].cue, 2.4); log('hint_used', { hint: k }); if (c[2] > EYE[2] + 0.2) $('#turnBtn').classList.add('pulse'); }
  }
  anHint();
  // the crawler moves only while you are not looking at her
  const cr = AN.act.crawl;
  if (cr && S.ghost?.mode === 'crawl') {
    const head = [cr.p[0], 0.4, cr.p[2]], seen = inView(head, 0.9).visible;
    cr.stepT += dt;
    const to = v3.sub([EYE[0], 0, EYE[2]], cr.p); to[1] = 0; const dist = v3.len(to);
    if (!seen && cr.stepT > 1.2) {
      cr.stepT = 0;
      if (dist < 0.8) { anFail('crawl'); return; }
      const step = v3.scale(v3.norm(to), Math.min(0.2, dist - 0.7));
      cr.p[0] += step[0]; cr.p[2] += step[2];
      snd.play('steps', [cr.p[0], 0.1, cr.p[2]]);
      if (dist < 1.4) { S.fear = Math.max(S.fear, 0.5); hsSay('…바로 뒤에서, 숨소리.', 1.6); }
    }
    if (seen) S.ghost.twitch = Math.max(S.ghost.twitch || 0, 0.3);
  }
  // three at once: a few seconds to fix one
  if (n >= 3) {
    if (AN.danger <= 0) { AN.danger = AN.phase === 1 ? 12 : 8; log('anom_danger', { active: keys }); snd.play('whisper'); }
    AN.danger -= dt; S.lampDim = Math.max(AN.baseDim, 0.45); S.fear = Math.max(S.fear, 0.4);
    hsTip(`이상한 곳이 <b>3개</b>! 하나라도 고쳐요 · ${Math.ceil(AN.danger)}`);
    if (AN.danger <= 0) { anFail('three'); return; }
  }
  // what to change next
  if (AN.fixed + n >= AN.goal) return;
  AN.next -= dt;
  if (AN.next <= 0) {
    if (AN.script.length) {
      const k = AN.script[0];
      if (anSpawn(k, (AN.phase === 1 && k !== 'doll') || k === 'crawl')) {
        AN.script.shift(); AN.recent = [...(AN.recent || []).filter(x => x !== k), k];
        if (k === 'doll') { hsAfter(0.4, () => { hsSay('…등 뒤, 책장 쪽에서 툭.', 2.6); $('#turnBtn').classList.add('pulse'); }); }
      }
      AN.next = !AN.act[k] ? 1.5 : AN.script.length ? 1e9 : 6;   // a taught one waits for its fix
      return;
    }
    AN.recent = AN.recent || [];
    const pool = Object.keys(ANOM).filter(k => !AN.act[k] && (k !== 'crawl' || AN.phase >= 2));
    // things she has not changed for a while first
    const order = pool.sort(() => Math.random() - 0.5).sort((x, y) => AN.recent.indexOf(x) - AN.recent.indexOf(y));
    let ok = false;
    for (const k of order) if (anSpawn(k)) { ok = true; AN.recent = [...AN.recent.filter(x => x !== k), k]; break; }
    const base = [0, rnd(6.5, 9), rnd(5.5, 8), rnd(5.5, 8)][AN.phase];
    AN.next = ok ? base * (n >= 1 ? 1.4 : 1) : 1.5;
    if (ok) AN.streak = 0;
  }
}
// not found for too long: first her sounds (above), then an arrow to it, then a ring on it
const HINT_AFTER = 15;
function anHint() {
  const el = $('#anMark');
  let best = null;
  for (const [k, s] of Object.entries(AN.act)) if (s.t > (k === 'crawl' ? 6 : HINT_AFTER) && (!best || s.t > best[1].t)) best = [k, s];
  if (!best || !AN.on) { put(el, 'className', ''); return; }
  const [k, s] = best;
  if (!s.hinted) { s.hinted = true; log('hint_used', { hint: 'mark_' + k, after: +s.t.toFixed(1) }); }
  const c = anBox(k).c, { f, r, u } = camBasis(), d = v3.sub(c, EYE);
  const z = v3.dot(d, f), th = tanHalfY(), rect = ui.canvas.getBoundingClientRect(), a = rect.width / rect.height;
  const nx = v3.dot(d, r) / Math.max(z, 1e-3) / (th * a), ny = v3.dot(d, u) / Math.max(z, 1e-3) / th;
  el.querySelector('span').textContent = ANOM[k].name;
  if (z > 0.15 && Math.abs(nx) < 0.85 && Math.abs(ny) < 0.85) {
    put(el, 'className', 'ring');
    el.style.left = `${(nx * 0.5 + 0.5) * rect.width}px`; el.style.top = `${(0.5 - ny * 0.5) * rect.height}px`; el.style.setProperty('--rot', '0deg');
  } else {
    let dx = v3.dot(d, r), dy = v3.dot(d, u);
    if (z < 0) { dx = dx >= 0 ? 1 : -1; dy = 0; }   // behind you: point the way to turn
    const ang = Math.atan2(-dy, dx), R0 = Math.min(rect.width, rect.height) * 0.36;
    put(el, 'className', 'arrow');
    el.style.left = `${rect.width / 2 + Math.cos(ang) * rect.width * 0.4}px`; el.style.top = `${rect.height / 2 + Math.sin(ang) * R0}px`;
    el.style.setProperty('--rot', `${ang}rad`);
  }
}
// what each wrong thing looks like (called every frame after the room's own animation)
function anApply(dt, time) {
  const all = { ...(AN.back || {}), ...AN.act };
  for (const [k, s] of Object.entries(all)) {
    if (!AN.act[k]) { s.k = Math.max(0, s.k - dt * 2.5); if (s.k <= 0) { delete AN.back[k]; } }
    const a = ANOM[k], e = smooth(0, 1, s.k);
    if (!a.node || k === 'tv' || k === 'lamp') continue;
    if (k === 'frame' && !O.photoObj.base) O.photoObj.base = O.photoObj.model.slice();
    const list = k === 'frame' ? [...O.nodes.item_frame, O.photoObj] : O.nodes[a.node], b = a.box || anBox(k), piv = b.c;
    let X;
    if (k === 'table') X = m4.trs([0, e * (a.lift + Math.sin(time * 2.1) * 0.03), 0], e * 0.35, [1, 1, 1], 0, e * PI);
    else if (k === 'cushion') X = m4.trs([0, e * (a.lift + Math.sin(time * 1.7) * 0.05), 0], e * time * 0.6, [1, 1, 1], e * 0.5, 0);
    else if (k === 'frame') {   // knocked off its nail: hangs crooked, lower, and keeps swinging
      const nail = [0, (a.box.max[1] - a.box.c[1]) + 0.02, 0];
      X = m4.mul(m4.mul(m4.trs([0, -0.18 * e, 0]), m4.trs(nail, 0, [1, 1, 1], 0, e * (0.75 + 0.3 * Math.sin(time * 2.6)))), m4.trs(v3.scale(nail, -1)));
    }
    else if (k === 'doll') {   // it is simply somewhere else, bigger than you remember, looking at you
      const b0 = list[0].base, sc = s.k > 0.5 ? 2.3 : 1, at = s.k > 0.5 ? [a.to[0], a.to[1] - list[0].min[1] * sc, a.to[2]] : [b0[12], b0[13], b0[14]];
      const yaw = s.k > 0.5 ? Math.atan2(EYE[0] - at[0], EYE[2] - at[2]) + PI : 0;   // the doll's face is its -z
      for (const o of list) o.model = m4.mul(m4.trs(at, yaw, [sc, sc, sc]), m4.mul(m4.trs([o.base[12] - b0[12], o.base[13] - b0[13], o.base[14] - b0[14]]), strip(o.base)));
      continue;
    }
    else if (k === 'drawer') X = m4.trs([-0.45 * e, 0.02 * e, 0], 0.12 * e);
    if (!X) continue;
    const M = m4.mul(m4.mul(m4.trs(piv), X), m4.trs(v3.scale(piv, -1)));
    for (const o of list) o.model = m4.mul(M, o.base);
  }
}

// ---------------------------------------------------------------- stages
const ACT_NAMES = ['1999년 12월, 저녁', '멈춘 시계', '기다림', '문'];
function setAct(a) {
  S.act = a;
  if (a === 1) {
    S.decayTarget = 0.28; S.rain = 0; snd.playMusic('music_room', 8);
    objective('오르골을 살펴본다');
  }
  if (a === 2) { S.decayTarget = 0.78; snd.playMusic('music_room', 4); }
  if (a === 3) { S.decayTarget = 1; S.warmth = Math.max(S.warmth, 75); }
  checkpoint();
}

const STORY = {
  intro() {
    S.blackout = 1; S.blackoutTarget = 0;
    after(1.2, () => say('…익숙한 방이다. 어디서 많이 본.', 4));
    after(5.4, () => say('몸이 의자에 묶여 있다. 고개만 돌릴 수 있다.', 4));
    after(9.8, () => say('밖엔 비가 온다. 시계는 7시 55분.', 3.5));
    after(14, () => {
      objective('TV 리모컨을 가만히 바라본다');
      const touch = matchMedia('(pointer: coarse)').matches;
      say(`손이 닿지 않는 물건은… 확대해서(${touch ? '👁 버튼' : '우클릭·휠'}) 오래 바라본다.`, 6);
    });
  },
  remoteArrived() {
    after(0.4, () => girl('c_first', '엄마, 이거 보고 싶었어? 내가 갖다 줄게.', [0.3, 1.0, -0.4]));
    after(4.5, () => say('…아이 목소리. 방에는 아무도 없다.', 3.5));
    after(8.5, () => say('손끝이 얼어붙는다. 무언가 닿을 때마다 온기가 빠져나간다. (❄ 온기)', 5.5));
    after(9, () => { objective('무릎 위 리모컨으로 TV를 켠다'); S.flags.trayTip = 1; say('아래의 물건을 눌러서 쓴다.', 4); });
  },
  tvOn() {
    if (S.flags.tvOnce) return;
    S.flags.tvOnce = 1;
    after(1.5, () => say('1999년의 어린이 방송… 채널을 돌려 본다.', 4));
    objective('채널을 돌려 본다');
  },
  cctvFirst() {
    if (S.flags.cctvOnce) return;
    S.flags.cctvOnce = 1;
    after(0.8, () => say('방 구석에서 찍는 화면. …의자에 아무도 없다?', 4.5));
    after(5.5, () => say('의자 밑에 무언가 있다. 화면 속 물건도… 바라보면 되지 않을까.', 5));
    after(6, () => objective('TV 화면 속, 의자 밑의 물건을 바라본다'));
  },
  musicboxArrived() {
    after(0.5, () => girl('c_bring1', '가져왔어.', [0.2, 0.6, 0.6]));
    after(2.5, () => {
      setAct(1);
      // the first sighting: only on the CCTV, right behind the chair
      S.ghost = { p: [0.15, 0, 0.72], kind: 'stand', alpha: 0, target: 1, mode: 'cctv', camOnly: true };
      snd.play('whisper', [0.2, 1.2, 0.8]);
      after(1.2, () => { if (S.tv.on && S.tv.ch === 7) girl('c_cctv', '엄마 뒤에 있어.', [0.2, 1.2, 0.8]); });
      after(4.5, () => { if (S.ghost?.mode === 'cctv') S.ghost.target = 0; S.bulbBurst = 1.2; snd.play('static', O.tvCenter); });
      after(5, () => { stopClock(); say('…시계가 멈췄다. 빗소리도.', 3.5); });
    });
  },
  noteFound() {
    objective('달력을 찾는다 — 엄마가 오는 날');
    after(18, () => { if (!S.fetched.has('curtain')) say('달력… 창문에 붙여 뒀었는데. 커튼 뒤에.', 4.5); });
  },
  calendarRead() {
    if (S.flags.calRead) return;
    S.flags.calRead = 1;
    objective(`서랍을 가져오게 하고, 자물쇠를 연다 (12월 ${SOL.day}일)`);
  },
  drawerOpened() {
    invAdd('scissors'); invAdd('crank');
    after(0.6, () => say('가위와… 태엽 열쇠.', 3));
    objective('태엽 열쇠를 오르골에 끼운다 (열쇠를 누른 뒤 오르골)');
  },
  musicPlayed() {
    // she comes to listen, sitting in front of the TV
    S.ghost = { p: [0.05, 0, -1.3], kind: 'crouch', alpha: 0, target: 1, mode: 'sit' };
    after(1.5, () => girl('c_song', '이 노래… 엄마가 불러 줬던 거.', [0.05, 0.7, -1.3]));
    after(15, () => { if (S.ghost?.mode === 'sit') { S.ghost.target = 0; } });
    after(16, () => {
      setAct(2);
      say('…방이, 썩어 간다.', 3.5);
      after(4, () => girl('c_wait', '나 착하게 기다렸어. 소리도 안 냈어.', null));
      after(10, () => { objective('가위로 오른손 밧줄을 끊는다 (가위를 누른 뒤 아래를 본다)'); });
    });
  },
  ropeCut() {
    S.flags.hand = 1;
  setVisible(O.nodes.rope_R, false);
    const p = v3.add(EYE, v3.add(v3.scale(flatFwd(), 0.7), [0, -1.15, 0]));
    S.ghost = { p, kind: 'stand', alpha: 0.6, target: 1, mode: 'close' };
    girl('c_rope', '가지 마… 또 가지 마.', [p[0], 1.2, p[2]]);
    touch(10, 'rope');
    after(2.5, () => { if (S.ghost?.mode === 'close') S.ghost.target = 0; });
    after(4, () => say('오른손이 풀렸다. …발목은 쇠사슬로 의자에 묶여 있다. 자물쇠가 달렸다.', 5));
    after(9.5, () => objective('발목 자물쇠의 열쇠를 찾는다'));
    after(30, () => { if (!S.inv.includes('anklekey') && !S.fetched.has('doll')) say('책장 위의 인형… 배가 불룩했던 것 같다.', 4.5); });
  },
  freed() {
    S.flags.feet = 1;
  setVisible(O.nodes.chain, false); setVisible(O.nodes.padlock, false);
    snd.play('unlock', [0, 0.1, 0.1]);
    say('철컥. …발이 자유롭다.', 3);
    after(3, () => STORY.final());
  },
  final() {
    setAct(3);
    S.standing = 0.001;
    snd.play('creak', [0, 0.5, 0.3]);
    after(2.5, () => {
      snd.play('pop', [0, 2.1, -0.6]); S.bulbDead = true; S.flash = 0.35; S.flashCol = [1, 0.8, 0.5];
      snd.playMusic('music_chase', 1.5);
      S.ghost = { p: [-1.65, 0, -0.6], kind: 'stand', alpha: 0, target: 1, mode: 'chase', stepT: 0 };
      after(1, () => girl('c_turn', '이번엔… 엄마가 기다려.', [-1.65, 1.2, -0.6]));
      after(4, () => {
        const touchUI = matchMedia('(pointer: coarse)').matches;
        objective(`문으로 간다 — ${touchUI ? '[걷기]를 누르고 있으면' : 'W 키/[걷기]를 누르고 있으면'} 앞으로. 그 애를 보면 멈춘다`);
        say('엄마…? 나를 보고 하는 말이다.', 3.5);
      });
    });
  },
  atDoor() {
    if (S.final) return;
    S.final = { t: 0 };
    say('문이… 밖에서 잠겨 있다.', 3);
    after(1.6, () => {
      const p = v3.add(EYE, v3.scale(flatFwd(), -0.8)); p[1] = 0;
      S.ghost = { p, kind: 'stand', alpha: 0, target: 1, mode: 'final' };
      girl('c_door', '문은… 밖에서 잠겼어. 엄마가 잠갔잖아.', [p[0], 1.2, p[2]]);
      after(5, () => { objective('뒤를 돌아, 그 애에게 무언가를 건넨다'); say('그 애에게… 돌려줘야 할 것이 있다.', 4); });
      after(40, () => { if (!S.ending) endingBad('grab'); });
    });
  },
};

function stopClock() { S.clockStopped = true; }

// ---------------------------------------------------------------- fetching ("she brings what you look at")
function available(w) {
  if (!w || S.fetched.has(w.id) || S.act < w.act) return false;
  if (w.needs && !w.needs()) return false;
  if (w.id === 'remote' && S.act > 0 && S.inv.includes('remote')) return false;
  return true;
}
function fetchTarget(dir) {
  // direct look
  let best = null, bd = 1e9;
  for (const id in W) {
    const w = W[id];
    if (!available(w) || w.hidden) continue;
    const t = rayAABB(EYE, dir, w.min, w.max);
    if (t >= 0 && t < bd) { bd = t; best = w; }
  }
  // looking at the TV while it shows the CCTV: stare "through" the camera
  if (S.tv.on && S.tv.ch === 7) {
    const r = O.tvRect;
    const tt = (r.z - EYE[2]) / dir[2];
    if (tt > 0) {
      const x = EYE[0] + dir[0] * tt, y = EYE[1] + dir[1] * tt;
      if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1 && tt < bd) {
        const nx = (x - r.x0) / (r.x1 - r.x0) * 2 - 1, ny = (y - r.y0) / (r.y1 - r.y0) * 2 - 1;
        const cam = cctvBasis();
        const cd = v3.norm(v3.add(cam.f, v3.add(v3.scale(cam.r, nx * CCTV.tanHalf * CCTV.aspect), v3.scale(cam.u, ny * CCTV.tanHalf))));
        let cb = null, cbd = 1e9;
        for (const id in W) {
          const w = W[id];
          if (!available(w)) continue;
          const t2 = rayAABB(CCTV.pos, cd, w.min, w.max);
          if (t2 >= 0 && t2 < cbd) { cbd = t2; cb = w; }
        }
        if (cb) return { w: cb, via: 'cctv' };
        return { w: null, via: 'screen' };
      }
    }
  }
  return best && bd < 7 ? { w: best, via: 'room' } : null;
}
function startFetch(w) {
  S.stareT = 0; S.stareId = null;
  if (w.action) {  // she does something instead of bringing it
    touch(w.cost, w.id);
    S.fetched.add(w.id);
    if (w.id === 'curtain') {
      snd.play('curtain', [-2.1, 1.5, -0.6]); S.curtainTarget = 1;
      if (S.act >= 2) ghostFlash([-1.7, 0, -0.1]);
      after(2.5, () => say('커튼이 스르르 걷혔다. 유리창에… 달력이 붙어 있다.', 4));
    }
    return;
  }
  const carry = S.act >= 2;
  S.job = {
    w, t: 0, phase: carry ? 'appear' : 'lift', carry,
    from: v3.add(w.c, [0, 0, 0]), pos: w.c.slice(), spin: 0,
  };
  if (!carry) snd.play('whisper', w.c);
  if (w.heavy) after(0.8, () => voice('c_heavy', w.c));
  if (w.angry) {
    girl('c_doll', '내 인형 만지지 마!', [w.c[0], 1.2, w.c[2]]);
    after(0.3, () => jumpscare());
  }
  if (w.knife) after(0.5, () => say('…칼날이 이쪽을 향해 날아온다.', 3));
}
function updateJob(dt) {
  const j = S.job; if (!j) return;
  j.t += dt;
  const lap = LAP();
  const place = (p) => {
    for (const o of j.w.objs) o.model = translated(o.base, v3.add(p, v3.sub([o.base[12], o.base[13], o.base[14]], j.w.c)), j.spin);
  };
  if (!j.carry) {
    if (j.phase === 'lift') {
      const k = smooth(0, 1, j.t / 0.8);
      j.pos = v3.add(j.from, [Math.sin(j.t * 30) * 0.004, 0.12 * k, 0]);
      if (j.t > 0.9) { j.phase = 'fly'; j.t = 0; j.start = j.pos.slice(); }
    } else if (j.phase === 'fly') {
      const k = smooth(0, 1, j.t / 1.5), mid = v3.add(v3.scale(v3.add(j.start, lap), 0.5), [0, 0.45, 0]);
      const a = v3.add(v3.scale(j.start, (1 - k) * (1 - k)), v3.add(v3.scale(mid, 2 * k * (1 - k)), v3.scale(lap, k * k)));
      j.pos = a; j.spin += dt * 1.5;
      if (j.t > 1.55) return arrive(j);
    }
  } else {
    const g = S.ghost;
    if (j.phase === 'appear') {
      // she appears beside the object, on the room side of it
      const toRoom = v3.norm([-j.from[0], 0, -j.from[2] + 0.3]);
      S.ghost = { p: [j.from[0] + toRoom[0] * 0.35, 0, j.from[2] + toRoom[2] * 0.35], kind: 'stand', alpha: 0, target: 1, mode: 'carry' };
      snd.play('steps', j.from);
      j.phase = 'pick'; j.t = 0;
    } else if (j.phase === 'pick') {
      if (j.t > 1.0) { j.phase = 'walk'; j.t = 0; snd.play('giggle', j.from); }
    } else if (j.phase === 'walk' && g) {
      const target = v3.add([EYE[0], 0, EYE[2]], v3.scale([flatFwd()[0], 0, flatFwd()[2]], 0.55));
      const to = v3.sub(target, g.p); to[1] = 0; const dist = v3.len(to);
      const seen = inView([g.p[0], 1.1, g.p[2]], 0.9).visible;
      const speed = seen ? 0.55 : 1.4;   // she moves faster while you're not looking
      if (dist > 0.05) g.p = v3.add(g.p, v3.scale(v3.norm(to), Math.min(dist, speed * dt)));
      j.pos = v3.add(g.p, [0, 0.72, 0]);
      const toEye = v3.norm([EYE[0] - g.p[0], 0, EYE[2] - g.p[2]]);
      j.pos = v3.add(j.pos, v3.scale(toEye, 0.22));
      if (dist < 0.08) { j.phase = 'give'; j.t = 0; addFear(0.25); }
    } else if (j.phase === 'give') {
      const k = smooth(0, 1, j.t / 0.9);
      const hand = v3.add(g ? g.p : lap, [0, 0.72, 0]);
      j.pos = v3.add(v3.scale(hand, 1 - k), v3.scale(lap, k));
      if (j.t > 1.0) { if (S.ghost?.mode === 'carry') S.ghost.target = 0; return arrive(j); }
    }
  }
  place(j.pos);
}
function arrive(j) {
  const w = j.w;
  S.job = null;
  setVisible(w.objs, false);
  S.fetched.add(w.id);
  if (!j.free) touch(w.cost, w.id);
  if (w.item) invAdd(w.item);
  const lines = [['c_bring1', '가져왔어.'], ['c_bring2', '이것도 줄게, 엄마.'], ['c_bring3', '엄마 거야. 만져 봐.']];
  if (w.id === 'remote' && !j.free) STORY.remoteArrived();
  else if (w.id === 'musicbox') STORY.musicboxArrived();
  else if (w.knife) say('손바닥이 베였다. 피가 무릎으로 떨어진다.', 4);
  else if (!w.angry && Math.random() < 0.6) after(0.3, () => { const [id, t] = pick(lines); girl(id, t, [EYE[0] + 0.4, 1.0, EYE[2] - 0.5]); });
  if (w.id === 'drawer') { snd.play('drawer', LAP()); }
  checkpoint();
}
// warmth drain from her touch
function touch(cost, why) {
  S.warmth = Math.max(0, S.warmth - cost);
  S.lastTouch = S.time; S.frost = Math.min(1, S.frost + 0.35 + cost / 50);
  snd.play('whisper', v3.add(EYE, [0, -0.2, -0.3]));
  if (S.warmth < 35 && !S.flags.coldLine) { S.flags.coldLine = 1; after(1, () => girl('c_cold', '엄마 손… 차갑다. 나처럼.', v3.add(EYE, [0.3, -0.1, -0.4]))); }
  if (S.warmth <= 0) collapse();
}
function collapse() {
  if (S.collapsing || S.ending) return;
  S.collapsing = true;
  if (S.act >= 3) { endingBad('cold'); return; }
  S.blackoutTarget = 1; S.job = null;
  say('…너무 춥다. 눈앞이 하얗게 얼어붙는다.', 3);
  after(4, () => {
    S.warmth = 50; S.frost = 0.4; S.decayTarget = Math.min(1, S.decayTarget + 0.08); S.blackoutTarget = 0; S.collapsing = false;
    say('…정신을 잃었었다. 방이 조금 더 변해 있다.', 4);
  });
}
function ghostFlash(p) { S.ghost = { p, kind: 'stand', alpha: 0.9, target: 0, mode: 'flash' }; }

// ---------------------------------------------------------------- inspect (3D item in hand)
function openInspect(id) {
  const it = ITEMS[id];
  if (it.doc) { openDocItem(id); return; }
  S.insp = { id, yaw: 0.5, pitch: 0.35, t: 0 };
  ui.inspTitle.textContent = it.name; ui.inspDesc.textContent = it.desc || '';
  ui.inspect.classList.add('show'); ui.hud.classList.add('inspecting');
  ui.inspUse.style.display = ['scissors', 'crank', 'anklekey', 'knife', 'doll'].includes(id) ? '' : 'none';
  if (id === 'doll') ui.inspUse.textContent = '건네기용으로 들기'; else ui.inspUse.textContent = '사용';
  S.lidTarget = 0;
}
function closeInspect() {
  if (!S.insp) return;
  const it = ITEMS[S.insp.id];
  const objs = inspectObjs(S.insp.id);
  setVisible(objs, false);
  S.insp = null; ui.inspect.classList.remove('show'); ui.hud.classList.remove('inspecting'); ui.hotspots.innerHTML = '';
  if (it) snd.play('click');
}
function inspectObjs(id) {
  const it = ITEMS[id];
  if (it.obj) return W[it.obj].objs;
  if (it.nodes) return it.nodes.flatMap(n => O.nodes[n]);
  return [];
}
const HOT = {
  musicbox: [
    { p: [0, -0.04, 0.05], label: '밑면', fn() { S.insp.pitch = -2.6; say('밑면에 새겨진 글씨 — “수아에게. 일곱 번째 생일 축하해. 엄마가.”', 5); } },
    { p: [0, 0.045, 0], label: '뚜껑', fn() { S.lidTarget = S.lidTarget ? 0 : 1; if (S.lidTarget) after(0.6, () => childNote()); } },
    { p: [0.076, 0, 0], label: '태엽', fn() { if (S.inv.includes('crank')) combine('crank', 'musicbox'); else say('태엽 구멍이 비어 있다. 감을 열쇠가 필요하다.', 3.5); } },
  ],
  drawer: [{ p: [-0.03, -0.03, 0.16], label: '자물쇠', fn: () => openDial() }],
  machine: [{ p: [0.0, 0.05, 0.04], label: '재생', fn: () => playTape() }],
  doll: [{ p: [0, -0.03, 0.045], label: '배의 실밥', fn() {
    if (S.inv.includes('scissors') || S.inv.includes('knife')) cutDoll();
    else say('서툴게 꿰맨 배 속에 딱딱한 게 만져진다. 자를 것이 필요하다.', 4);
  } }],
};
function childNote() {
  if (!S.flags.childNote) {
    S.flags.childNote = 1;
    addMemo('<b>오르골 속 쪽지</b> — “서랍 비밀번호는 엄마가 오는 날 (월 두 자리 + 일 두 자리)”');
    STORY.noteFound();
  }
  showDoc('오르골 속 쪽지', O.docCanvas.childnote, '아이 글씨. 뚜껑 안쪽 거울 뒤에 접혀 있었다.');
}
function cutDoll() {
  if (S.inv.includes('anklekey')) return;
  snd.play('creak', LAP()); S.glitch = 0.8;
  say('실밥을 끊자… 솜 사이로 작은 열쇠와, 젖니 하나가 떨어진다.', 5);
  invAdd('anklekey');
  addMemo('<b>인형 배 속</b> — 작은 열쇠, 그리고 젖니 하나.');
  objective('작은 열쇠를 발목 자물쇠에 쓴다 (열쇠를 누른 뒤 아래를 본다)');
}
function openDocItem(id) {
  const map = {
    calendar: ['1999년 12월', `4일부터 매일 크레용으로 X. ${SOL.day}일에 동그라미 — “엄마 오는 날?” 그 뒤로는 파란 X.`],
    note: ['엄마의 쪽지', '어른의 글씨. 맨 아래에 크레용으로 작게 — “안 두드릴게 빨리 와”'],
    drawing: ['크레용 그림', '의자에 앉아 우는 여자아이, TV, 자물쇠가 걸린 문. 문밖으로 걸어가는 빨간 옷의 여자.'],
    news: ['신문 조각', '2000년 1월 14일자. 사진 속 현관문의 번호는… 303.'],
    photo: ['가족사진', S.decay > 0.5 ? '엄마의 얼굴이 새까맣게 긁혀 있다. “거짓말쟁이”' : '생일 케이크 앞의 엄마와 수아. 둘 다 웃고 있다.'],
  };
  const [title, cap] = map[id];
  const canvas = id === 'photo' ? (S.decay > 0.5 ? O.familyRuined : O.familyClean) : O.docCanvas[id];
  showDoc(title, canvas, cap, id === 'news', id === 'photo' && S.act >= 3);
  if (id === 'calendar') { record('calendar', `달력 — 12월 ${SOL.day}일 “엄마 오는 날?”`); STORY.calendarRead(); }
  if (id === 'note') record('note', '엄마의 쪽지 — “문 두드리면 엄마 진짜 화낸다. 11번(뉴스)은 보지 마.”');
  if (id === 'drawing') record('drawing', '크레용 그림 — 자물쇠가 걸린 문, 떠나는 여자.');
  if (id === 'news') record('newspaper', '신문 — “빌라 303호 7세 여아 숨진 채 발견”');
}
function showDoc(title, canvas, caption, wide = false, give = false) {
  openModal(`<h2>${title}</h2><img class="docimg${wide ? ' wide' : ''}" src="${canvas.toDataURL('image/jpeg', 0.85)}" alt="">
    <p class="hint doc">${caption}</p><div class="row">${give ? '<button class="primary" id="docUse">들고 있기 (건네기)</button>' : ''}<button class="${give ? 'ghostbtn' : 'primary'}" data-close>닫기</button></div>`, 'docCard');
  if (give) $('#docUse').addEventListener('click', () => { closeModal(); S.useItem = 'photo'; renderTray(); say('사진을 든다. 그 애를 바라보고 누른다.', 3.5); });
}
function openDial() {
  const d = [0, 0, 0, 0];
  openModal(`<h2>서랍 자물쇠</h2><div class="dials">${d.map((_, i) => `<div><button data-u="${i}">▲</button><b id="dl${i}">0</b><button data-dn="${i}">▼</button></div>`).join('')}</div>
    <p class="hint">월 두 자리 + 일 두 자리</p><div class="row"><button class="ghostbtn" data-close>닫기</button><button class="primary" id="dialOk">열기</button></div>`, 'keypadCard');
  const draw = () => d.forEach((v, i) => { $('#dl' + i).textContent = v; });
  ui.card.querySelectorAll('[data-u]').forEach(b => b.addEventListener('click', () => { d[+b.dataset.u] = (d[+b.dataset.u] + 1) % 10; snd.play('tick'); draw(); }));
  ui.card.querySelectorAll('[data-dn]').forEach(b => b.addEventListener('click', () => { d[+b.dataset.dn] = (d[+b.dataset.dn] + 9) % 10; snd.play('tick'); draw(); }));
  $('#dialOk').addEventListener('click', () => {
    if (d.join('') === CODE.join('')) {
      closeModal(); snd.play('unlock', LAP()); closeInspect(); invRemove('drawer');
      say('딸깍. 자물쇠가 열렸다.', 2.5); after(1, () => STORY.drawerOpened());
    } else {
      snd.play('wrong'); ui.card.classList.remove('shake'); void ui.card.offsetWidth; ui.card.classList.add('shake');
      if (!S.flags.calRead) $('.keypadCard .hint').textContent = '…엄마가 오는 날. 어디에 적혀 있었을까.';
    }
  });
}

// ---------------------------------------------------------------- using items
function beginUse() {
  if (!S.insp) return;
  const id = S.insp.id;
  closeInspect();
  S.useItem = id; renderTray();
  const tip = { scissors: '가위 — 밧줄이나 인형에', crank: '태엽 열쇠 — 오르골에', anklekey: '열쇠 — 발목 자물쇠에', knife: '칼 — 밧줄에', doll: '인형 — 그 애에게' }[id] || ITEMS[id].name;
  say(`${tip}. 대상을 바라보고 누르거나, 아래 물건을 누른다.`, 4);
}
function combine(a, b) {
  const pair = [a, b].sort().join('+');
  S.useItem = null; renderTray();
  if (pair === 'crank+musicbox') { windMusicBox(); return; }
  if ((pair === 'doll+scissors') || (pair === 'doll+knife')) { cutDoll(); return; }
  say('…어울리지 않는다.', 2);
}
function windMusicBox() {
  if (S.flags.musicPlayed) { snd.musicBox(LAP(), 10); S.insanity = Math.max(0, S.insanity - 0.4); say('태엽을 감는다. 그 애가… 조용해진다.', 3); return; }
  S.flags.musicPlayed = 1;
  invRemove('crank');
  closeInspect();
  say('끼릭, 끼릭… 태엽을 감는다.', 2.5);
  after(1.6, () => { snd.musicBox(LAP(), 16); STORY.musicPlayed(); });
}
const USE_TARGETS = [
  { id: 'rope', label: '오른손 밧줄', min: [0.15, 0.58, 0.12], max: [0.3, 0.74, 0.42] },
  { id: 'padlock', label: '발목 자물쇠', min: [-0.12, 0, -0.1], max: [0.12, 0.14, 0.2] },
  { id: 'door', label: '문', min: [0.12, 0, 2.4], max: [1.28, 2.12, 2.62] },
];
function useTarget(dir) {
  if (S.ghost && ['final', 'chase'].includes(S.ghost.mode) && S.ghost.alpha > 0.5) {
    const g = S.ghost, t = rayAABB(EYE, dir, [g.p[0] - 0.3, 0, g.p[2] - 0.3], [g.p[0] + 0.3, 1.5, g.p[2] + 0.3]);
    if (t >= 0) return { id: 'ghost', label: '그 애' };
  }
  let best = null, bd = 1e9;
  for (const u of USE_TARGETS) { const t = rayAABB(EYE, dir, u.min, u.max); if (t >= 0 && t < bd) { bd = t; best = u; } }
  return best;
}
function applyUse(tgt) {
  const id = S.useItem; if (!id || !tgt) return;
  S.useItem = null; renderTray();
  if (tgt.id === 'rope' && (id === 'scissors' || id === 'knife') && !S.flags.hand) {
    snd.play('creak', v3.add(EYE, [0.3, -0.5, 0])); STORY.ropeCut(); return;
  }
  if (tgt.id === 'padlock' && id === 'anklekey' && S.flags.hand && !S.flags.feet) { invRemove('anklekey'); STORY.freed(); return; }
  if (tgt.id === 'padlock' && id === 'anklekey' && !S.flags.hand) { say('손이 묶여 있어서 닿지 않는다.', 3); return; }
  if (tgt.id === 'ghost' && S.final) { giveTo(id); return; }
  say('…아무 일도 일어나지 않는다.', 2);
}
function giveTo(id) {
  if (S.ending) return;
  if (id === 'photo') { endingGood(); return; }
  if (id === 'doll') { endingDoll(); return; }
  invRemove(id);
  touch(6, 'give');
  say('그 애는 고개를 젓는다. 그게 아니야.', 3);
}

// ---------------------------------------------------------------- remote control / TV
function togglePad(force) {
  const show = force ?? !ui.pad.classList.contains('show');
  ui.pad.classList.toggle('show', show);
  ui.padCh.textContent = S.tv.on ? String(S.tv.ch).padStart(2, '0') : '--';
}
function padPress(k) {
  snd.play('beep');
  if (k === 'power') { S.tv.on = !S.tv.on; if (S.tv.on) { STORY.tvOn(); } }
  else if (!S.tv.on) { say('TV가 꺼져 있다.', 2); return; }
  else if (k === 'up') S.tv.ch = S.tv.ch % 12 + 1;
  else if (k === 'down') S.tv.ch = (S.tv.ch + 10) % 12 + 1;
  else S.tv.ch = +k;
  ui.padCh.textContent = S.tv.on ? String(S.tv.ch).padStart(2, '0') : '--';
  tvScreen.osd = 2; tvScreen.channel = S.tv.ch;
  snd.play('static', O.tvCenter);
  if (S.tv.on && S.tv.ch === 7) STORY.cctvFirst();
  if (S.tv.on && S.tv.ch === 11 && S.act >= 2 && !S.flags.news) playNews();
}
function tvContent() {
  const ch = S.tv.ch;
  if (!S.tv.on) return { mode: 'off' };
  tvScreen.showFace = !!AN.act.tv;
  if (AN.act.tv) return { mode: 'text', lines: ['엄마', '보지 마'] };
  if (ch === 7) return { mode: 'cctv' };
  if (ch === 3) return { mode: 'kids', bad: S.act >= 2 };
  if (ch === 5) return { mode: 'text', lines: S.act >= 2 ? ['2000년 1월 14일', '(금)'] : ['1999년 12월 24일', '(금) 오후 7:55'] };
  if (ch === 11) return S.act >= 2 ? { mode: 'text', lines: ['뉴스 속보', '303호 여아…'] } : { mode: 'text', lines: ['정규 방송이', '끝났습니다'] };
  return { mode: 'static' };
}
function playNews() {
  S.flags.news = 1;
  const d = voice('n_news', O.tvCenter, 1.2);
  sayNow('📺 “…빌라 303호에서 일곱 살 여자아이가 숨진 채 발견됐습니다. 아이는 밖에서 잠긴 방 안에 혼자 있었으며, 경찰은 3주째 연락이 닿지 않는 아이의 어머니를 찾고 있습니다.”', Math.max(9, d + 1));
  record('news', 'TV 11번 뉴스 — 밖에서 잠긴 방, 연락이 끊긴 어머니.');
}
const TAPES = [
  ['m_tape0', '“수아야~ 엄마야. 오늘 일 끝나고 케이크 사 갈게. 저녁 꼭 챙겨 먹고, TV 보고 있어. 사랑해!”'],
  ['m_tape1', '“수아야, 엄마야. 엄마 오늘도 좀 늦어. TV 켜 놨지? 채널 돌리지 말고… 얌전히 보고 있어.”'],
  ['m_tape2', '“문 두드리지 말라고 했지. 옆집에서 또 뭐라 그러잖아. …금방 갈게. 금방.”'],
  ['m_tape3', '“수아야… 엄마 너무 힘들어. …조금만, 조금만 더 기다려. 미안해.”'],
];
function playTape() {
  const i = Math.min(S.tape, TAPES.length - 1);
  const [id, text] = TAPES[i];
  snd.play('click', LAP());
  after(0.4, () => { const d = voice(id, LAP(), 1.1); sayNow(`📼 ${i + 1}번째 메시지 — ${text}`, Math.max(5, d + 1)); });
  if (S.tape < TAPES.length) {
    S.tape++;
    if (S.tape === 1) record('tape', '자동응답기 — 케이크를 사 오겠다던 엄마의 목소리가, 메시지마다 무너져 간다.');
    if (S.tape === 4) after(11, () => say('…마지막 메시지의 날짜는 12월 24일.', 4));
  }
}

// ---------------------------------------------------------------- records (hidden backstory)
const RECORD_TOTAL = 7;
function record(key, html) {
  if (S.records.has(key)) return false;
  S.records.add(key);
  addMemo(`<b class="rec">기록 ${S.records.size}/${RECORD_TOTAL}</b> — ${html}`);
  return true;
}
// things you can only examine by looking closely
const EXAMINE = [
  { id: 'scratch', min: [0.4, 0.05, 2.4], max: [0.85, 0.85, 2.6], when: () => S.decay > 0.45, text: '문 안쪽, 아이 키 높이까지 손톱자국이 빼곡하다. …문은 밖에서 잠겨 있었다.',
    rec: ['scratch', '문 안쪽의 손톱자국 — 아이 키 높이.'] },
  { id: 'dollbelly', min: [-1.7, 1.18, 2.2], max: [-1.4, 1.5, 2.4], when: () => S.act >= 2 && !S.fetched.has('doll'), text: '책장 위의 헝겊 인형. 배가 불룩하고, 서툴게 꿰매져 있다.' },
  { id: 'photo0', min: [-0.98, 1.3, -2.5], max: [-0.58, 1.8, -2.4], when: () => S.decay < 0.5 && !S.fetched.has('frame'), text: '가족사진. 생일 케이크 앞에서 웃는 엄마와 여자아이.' },
  { id: 'photo1', min: [-0.98, 1.3, -2.5], max: [-0.58, 1.8, -2.4], when: () => S.decay >= 0.5 && !S.fetched.has('frame'), text: '사진 속 엄마의 얼굴이… 새까맣게 긁혀 있다.' },
  { id: 'clock', min: [2.05, 1.62, -0.53], max: [2.2, 2.08, -0.07], when: () => S.clockStopped, text: '시계가 7시 59분에서 멈춰 있다.' },
  { id: 'chain', min: [-0.3, 0, -0.1], max: [0.3, 0.2, 0.22], when: () => S.flags.hand && !S.flags.feet, text: '의자 다리에 감긴 쇠사슬. 작은 자물쇠가 달려 있다.' },
  { id: 'window', min: [-2.35, 0.9, -1.2], max: [-2.1, 2.0, 0.0], when: () => S.curtainOpen > 0.6 && S.act >= 2, text: '유리창 안쪽에 작은 손자국들. 밖에서가 아니라… 안에서.' },
];
let examineT = 0, examineId = null;

// ---------------------------------------------------------------- endings
function endingGood() {
  S.ending = true; objective(''); invRemove('photo');
  const g = S.ghost;
  say('사진을 내민다. 그 애가… 받아 든다.', 3.5);
  after(3, () => girl('c_take', '이거… 나야? 엄마랑… 나.', g ? [g.p[0], 1.1, g.p[2]] : null));
  after(8, () => girl('c_bye', '엄마… 이제 가도 돼. 문 열어 줄게.', g ? [g.p[0], 1.1, g.p[2]] : null));
  after(12, () => { if (S.ghost) S.ghost.target = 0; snd.play('unlock', [0.7, 1, 2.45]); snd.stopMusic(3); });
  after(13.5, () => { snd.play('creak', [0.7, 1, 2.45]); S.doorOpenT = 1; S.doorLight = 0.001; });
  after(16, () => ui.fade.classList.add('white'));
  after(19.5, () => showEnding('good'));
}
function endingDoll() {
  S.ending = true; objective(''); invRemove('doll');
  const g = S.ghost;
  say('인형을 내민다. 그 애가 웃는다.', 3);
  after(2.5, () => girl('c_stay', '같이 있자… 계속.', g ? [g.p[0], 1.1, g.p[2]] : null));
  after(5.5, () => { S.blackoutTarget = 1; snd.stopMusic(2); });
  after(8, () => showEnding('doll'));
}
function endingBad(kind) {
  if (S.ending) return;
  S.ending = true; objective('');
  jumpscare();
  after(1.3, () => { S.blackoutTarget = 1; snd.stopMusic(1); });
  after(3, () => showEnding(kind));
}
function showEnding(kind) {
  S.paused = true; clearSave();
  const mins = Math.floor(S.time / 60), secs = Math.floor(S.time % 60);
  const body = {
    good: `<p>1999년 12월 24일 밤, 이 문을 밖에서 잠근 손은 내 손이었다.</p>
      <p>그 애는 사진을 안고, 처음으로 먼저 문을 열어 주었다.</p>
      ${S.records.size >= RECORD_TOTAL ? '<p class="truth">1999년 12월 24일 밤, 나는 밖에서 문을 잠그고 나갔다. 금방 올 생각이었다.</p>' : ''}
      <p class="ch">CH 07</p><p class="whisper">“엄마… 또 와줘.”</p>`,
    doll: `<p>그 애가 내 무릎에 머리를 기댔다. 문은 다시 열리지 않았다.</p><p>이번에는, 내가 기다리기로 했다.</p>
      <p class="ch">CH 07</p><p class="whisper">화면 속 의자에, 늙은 여자가 묶여 있다.</p>`,
    grab: `<p>작은 손이 내 손목을 잡았다.</p><p>얼음처럼 차가웠다.</p><p class="ch">CH 07</p><p class="whisper">“이번엔 엄마가 기다려.”</p>`,
    cold: `<p>온기가 모두 빠져나갔다.</p><p>의자에 앉은 채로, 나는 TV를 바라보았다. 영원히.</p><p class="ch">CH 03</p><p class="whisper">“엄마가 오면은 문을 열어 줄 거야…”</p>`,
  }[kind];
  const title = { good: '엔딩 — 놓아주기', doll: '엔딩 — 함께 남기', grab: '엔딩 — 기다림', cold: '엔딩 — 차가운 손' }[kind];
  log('ending_shown', { type: kind });
  ui.sub.classList.remove('show'); subQueue = []; subTimer = 0; hsTip(''); ui.hud.classList.remove('show');
  ui.ending.innerHTML = `
    <div class="endtext">
      ${body}
      <h1>응시</h1>
      <p class="stat">${title} · ${mins}분 ${String(secs).padStart(2, '0')}초</p>
      <button class="primary again" onclick="localStorage.removeItem('${SAVE_KEY}'); location.reload()">↻ 다시 시작</button>
    </div>`;
  ui.ending.classList.add('show');
  snd.play('static');
  if (kind === 'good') setTimeout(() => voice('c_end', null, 2.2), 7200);
}

// ---------------------------------------------------------------- modals
function openModal(html, cls = '') {
  S.paused = true;
  ui.card.className = 'card ' + cls;
  ui.card.innerHTML = html;
  ui.modal.classList.add('show');
  ui.card.querySelectorAll('[data-close]').forEach(c => c.addEventListener('click', closeModal));
}
function closeModal() { ui.modal.classList.remove('show'); S.paused = !S.started; snd.play('click'); }
function openMemo() {
  ui.memoBtn.classList.remove('new');
  openModal(`<h2>메모</h2>${S.memo.length ? '<ul class="memo">' + S.memo.map(m => `<li>${m}</li>`).join('') + '</ul>' : '<p class="hint">아직 아무것도 없다.</p>'}
    <div class="row"><button class="primary" data-close>닫기</button></div>`, 'memoCard');
}
function openPause() {
  openModal(`<h2>일시정지</h2>
    <p class="hint">드래그 / 방향키 / 📱 자이로: 둘러보기 · ↻ 버튼: 뒤돌아보기<br>숨은 아이, 이상하게 바뀐 곳을 눌러 원래대로 돌려놓는다</p>
    <div class="gfx"><span>그래픽</span>${[['auto', '자동'], ['low', '낮음'], ['medium', '중간'], ['high', '높음']].map(([k, l]) =>
      `<button class="${k === gfxChoice ? 'on' : ''}" data-gfx="${k}">${l}</button>`).join('')}<small id="gfxFps"></small></div>
    <div class="vols">${[['master', '전체'], ['music', '음악'], ['sfx', '효과음']].map(([k, l]) =>
      `<label><span>${l}</span><input type="range" min="0" max="1" step="0.05" value="${snd.vol[k]}" data-vol="${k}"></label>`).join('')}</div>
    <div class="row"><button class="ghostbtn" id="restartBtn">처음부터</button><button class="primary" data-close>계속</button></div>`);
  $('#restartBtn').addEventListener('click', () => { clearSave(); location.reload(); });
  ui.card.querySelectorAll('[data-vol]').forEach(r => r.addEventListener('input', () => snd.setVolume(r.dataset.vol, +r.value)));
  ui.card.querySelectorAll('[data-gfx]').forEach(b => b.addEventListener('click', () => {
    const texBefore = gfxPreset().tex;
    applyGfx(b.dataset.gfx);
    ui.card.querySelectorAll('[data-gfx]').forEach(x => x.classList.toggle('on', x === b));
    if (gfxPreset().tex !== texBefore) $('#gfxFps').textContent = '텍스처 해상도는 다시 시작하면 적용';
  }));
}

function jumpscare() {
  if (S.time - S.lastScare < 3) return;
  S.lastScare = S.time;
  snd.play('scare');
  ui.scare.classList.remove('go', 'sub'); void ui.scare.offsetWidth; ui.scare.classList.add('go');
  S.shake = 1; S.flash = 0.6; S.flashCol = [0.5, 0.05, 0.05]; S.glitch = 1;
  S.fear = 0.45; S.insanity = Math.min(S.insanity, 0.35); S.stare = 0;
  if (navigator.vibrate) try { navigator.vibrate([80, 40, 200]); } catch { }
}

// ---------------------------------------------------------------- input
const pointers = new Map();
let pinchDist = 0, dragInfo = null;
const GYRO_KEY = 'gaze-gyro';
const gyro = { on: false, last: null, got: false };
function deviceForward(e) {
  const d = Math.PI / 180;
  const a = (e.alpha || 0) * d, b = (e.beta || 0) * d, g = (e.gamma || 0) * d;
  const orient = ((screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0) * d;
  const c1 = Math.cos(b / 2), c2 = Math.cos(a / 2), c3 = Math.cos(-g / 2);
  const s1 = Math.sin(b / 2), s2 = Math.sin(a / 2), s3 = Math.sin(-g / 2);
  let q = [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
  const qm = (p, r) => [
    p[3] * r[0] + p[0] * r[3] + p[1] * r[2] - p[2] * r[1],
    p[3] * r[1] - p[0] * r[2] + p[1] * r[3] + p[2] * r[0],
    p[3] * r[2] + p[0] * r[1] - p[1] * r[0] + p[2] * r[3],
    p[3] * r[3] - p[0] * r[0] - p[1] * r[1] - p[2] * r[2]];
  q = qm(q, [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
  q = qm(q, [0, 0, Math.sin(-orient / 2), Math.cos(-orient / 2)]);
  const [x, y, z, w] = q;
  const f = [-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y))];
  return { yaw: Math.atan2(f[0], -f[2]), pitch: Math.asin(clamp(f[1], -1, 1)) };
}
function onOrientation(e) {
  if (!gyro.on || e.alpha == null) return;
  gyro.got = true;
  const cur = deviceForward(e);
  if (gyro.last && !S.paused && !S.insp) {
    let dy = cur.yaw - gyro.last.yaw;
    if (dy > Math.PI) dy -= 2 * Math.PI; else if (dy < -Math.PI) dy += 2 * Math.PI;
    if (Math.abs(cur.pitch) < 1.35 && Math.abs(dy) < 1.2) S.yaw += dy;
    const dp = cur.pitch - gyro.last.pitch;
    if (Math.abs(dp) < 1.2) S.pitch = clamp(S.pitch + dp, -1.45, 1.1);
  }
  gyro.last = cur;
}
async function setGyro(on) {
  if (on && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      if (await DeviceOrientationEvent.requestPermission() !== 'granted') { say('자이로 센서 권한이 거부되었다.', 3); on = false; }
    } catch { say('자이로 센서를 켤 수 없다.', 3); on = false; }
  }
  gyro.on = on; gyro.last = null;
  ui.gyroBtn.classList.toggle('on', on); ui.gyroBtn.setAttribute('aria-pressed', String(on));
  try { localStorage.setItem(GYRO_KEY, on ? '1' : '0'); } catch { }
  if (on) {
    gyro.got = false;
    say('자이로 켜짐 — 폰을 움직여 둘러본다. 드래그도 함께 쓸 수 있다.', 3.5);
    setTimeout(() => { if (gyro.on && !gyro.got) { say('이 기기에서는 자이로 센서 값이 들어오지 않는다.', 3.5); setGyro(false); } }, 1500);
  }
}
function setupGyro() {
  const capable = typeof DeviceOrientationEvent !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  if (!capable) return;
  document.documentElement.classList.add('has-gyro');
  addEventListener('deviceorientation', onOrientation);
  ui.gyroBtn.addEventListener('click', () => setGyro(!gyro.on));
  addEventListener('orientationchange', () => { gyro.last = null; });
  screen.orientation?.addEventListener?.('change', () => { gyro.last = null; });
}

function worldTap(dir, px, py) {
  if (HS.on && hsTap(px, py, dir)) return;
  if (S.useItem) { applyUse(useTarget(dir)); return; }
  // a tap on something she could bring explains the rule
  const ft = fetchTarget(dir);
  if (ft?.w) say(`${ft.w.name} — 손이 닿지 않는다. 확대해서 오래 바라보면… (❄ -${ft.w.cost})`, 3.5);
}
function setupInput() {
  const cv = ui.canvas;
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.button === 2) { S.holdZoom = true; return; }
    if (pointers.size === 1) dragInfo = { x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false, id: e.pointerId };
    else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDist = Math.hypot(a.x - b.x, a.y - b.y); if (dragInfo) dragInfo.moved = true; }
  });
  cv.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) S.zoomTarget = clamp(S.zoomTarget * d / pinchDist, 1, 4.5);
      pinchDist = d; return;
    }
    if (dragInfo && dragInfo.id === e.pointerId) {
      if (Math.hypot(e.clientX - dragInfo.x0, e.clientY - dragInfo.y0) > 12) { if (!dragInfo.moved && HS.on && !HS.firstInput) { HS.firstInput = true; log('first_input', { kind: 'drag' }); } dragInfo.moved = true; }
      if (S.paused) return;
      const sens = (e.pointerType === 'touch' ? 0.0065 : 0.0045) * (tanHalfY() / Math.tan(31 * PI / 180)) ** 0.9;
      S.yaw += dx * sens; S.pitch = clamp(S.pitch - dy * sens, -1.45, 1.1);
    }
  });
  const up = e => {
    if (e.button === 2) S.holdZoom = false;
    const had = pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (had && dragInfo && dragInfo.id === e.pointerId) {
      if (!dragInfo.moved && performance.now() - dragInfo.t0 < 450 && !S.paused) worldTap(screenRay(e.clientX, e.clientY), e.clientX, e.clientY);
      dragInfo = null;
    }
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => { e.preventDefault(); S.zoomTarget = clamp(S.zoomTarget * Math.exp(-e.deltaY * 0.0015), 1, 4.5); }, { passive: false });

  // inspect: drag rotates the item
  let idrag = null;
  ui.inspect.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; idrag = { x: e.clientX, y: e.clientY }; ui.inspect.setPointerCapture(e.pointerId); });
  ui.inspect.addEventListener('pointermove', e => {
    if (!idrag || !S.insp) return;
    S.insp.yaw += (e.clientX - idrag.x) * 0.012; S.insp.pitch = clamp(S.insp.pitch + (e.clientY - idrag.y) * 0.012, -3.2, 3.2);
    idrag = { x: e.clientX, y: e.clientY };
  });
  ui.inspect.addEventListener('pointerup', () => { idrag = null; });
  ui.inspClose.addEventListener('click', closeInspect);
  ui.inspUse.addEventListener('click', beginUse);

  ui.pad.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => padPress(b.dataset.p)));
  $('#padClose').addEventListener('click', () => togglePad(false));

  const holdBtn = (el, on, off) => {
    el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); on(); });
    el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off);
    el.addEventListener('contextmenu', e => e.preventDefault());
  };
  holdBtn(ui.zoom, () => { S.holdZoom = true; ui.zoom.classList.add('on'); }, () => { S.holdZoom = false; ui.zoom.classList.remove('on'); });
  holdBtn(ui.action, () => {
    if (S.act >= 3 && S.standing >= 1 && !S.final) S.walking = true;
    else if (S.useItem) applyUse(useTarget(camBasis().f));
  }, () => { S.walking = false; });
  $('#turnBtn').addEventListener('click', turnAround);
  $('#chGive').addEventListener('click', hsGive);
  $('#chStay').addEventListener('click', hsStay);
  ui.memoBtn.addEventListener('click', () => { if (S.started && !ui.modal.classList.contains('show')) openMemo(); });
  ui.pauseBtn.addEventListener('click', () => { if (S.started && !ui.modal.classList.contains('show')) openPause(); });

  const keys = new Set();
  addEventListener('keydown', e => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Space') { S.holdZoom = true; e.preventDefault(); }
    if (e.code === 'KeyE' || e.code === 'Enter') { if (S.useItem) applyUse(useTarget(camBasis().f)); }
    if (e.code === 'Escape') { if (ui.modal.classList.contains('show')) closeModal(); else if (S.insp) closeInspect(); else if (S.useItem) { S.useItem = null; renderTray(); } else if (S.started) openPause(); }
    if (e.code === 'KeyM' || e.code === 'Tab') { e.preventDefault(); if (S.started) ui.modal.classList.contains('show') ? closeModal() : openMemo(); }
    if (e.code === 'KeyR' && S.inv.includes('remote')) togglePad();
  });
  addEventListener('keyup', e => {
    keys.delete(e.code);
    if (e.code === 'Space') S.holdZoom = false;
  });
  S.keys = keys;
}

// ---------------------------------------------------------------- update
function update(dt) {
  const k = S.keys, ks = 1.6 * dt / Math.sqrt(S.zoom);
  if (!S.paused && !S.insp) {
    if (k.has('ArrowLeft') || k.has('KeyA')) S.yaw -= ks;
    if (k.has('ArrowRight') || k.has('KeyD')) S.yaw += ks;
    if (k.has('ArrowUp')) S.pitch = clamp(S.pitch + ks, -1.45, 1.1);
    if (k.has('ArrowDown') || k.has('KeyS')) S.pitch = clamp(S.pitch - ks, -1.45, 1.1);
  }
  const walkKey = k.has('KeyW') && S.act >= 3;
  if (!walkKey && k.has('KeyW') && !S.paused && !S.insp) S.pitch = clamp(S.pitch + ks, -1.45, 1.1);
  const zt = S.holdZoom ? Math.max(S.zoomTarget, 3.2) : S.zoomTarget;
  S.zoom = damp(S.zoom, S.insp ? 1 : zt, 7, dt);

  if (!S.paused) {
    S.time += dt;
    const due = S.timers.filter(x => x.t <= S.time); S.timers = S.timers.filter(x => x.t > S.time);
    due.forEach(x => x.fn());
  }
  if (subTimer > 0) { subTimer -= dt; if (subTimer <= 0) nextSub(); }

  S.blackout = damp(S.blackout, S.blackoutTarget, S.blackoutTarget > S.blackout ? 14 : 3, dt);
  S.flash = damp(S.flash, 0, 4, dt); S.shake = damp(S.shake, 0, 3, dt); S.glitch = damp(S.glitch, 0, 2.5, dt);
  S.curtainOpen = damp(S.curtainOpen, S.curtainTarget, 0.9, dt);
  shiftUpdate(dt); formUpdate(dt);
  S.frost = damp(S.frost, Math.max(0, (45 - S.warmth) / 70), 0.8, dt);
  if (S.doorLight > 0) S.doorLight = Math.min(S.doorLight + dt * 0.5, 3);
  S.doorOpen = damp(S.doorOpen, S.doorOpenT, 0.7, dt);
  O.lid = damp(O.lid, S.lidTarget || 0, 5, dt);
  // warmth slowly returns when she leaves you alone
  if (!S.paused && S.time - S.lastTouch > 6 && S.warmth < 100 && !S.job) S.warmth = Math.min(100, S.warmth + dt * (S.act >= 3 ? 0.4 : 0.9));

  const { f } = camBasis();
  const live = S.started && !S.paused && !S.insp && !S.ending;

  // ---- stare to fetch
  let ringV = 0, hint = '', hintUse = false;
  if (live && !S.job && !S.useItem && S.act < 3 && !HS.on && S.flags.tvOnce !== undefined) {
    const ft = fetchTarget(f);
    if (ft?.w) {
      const w = ft.w;
      if (S.stareId !== w.id) { S.stareId = w.id; S.stareT = 0; }
      const zoomOK = S.zoom > 1.6;
      if (zoomOK) S.stareT += dt; else S.stareT = Math.max(0, S.stareT - dt);
      ringV = S.stareT / 1.4;
      hint = zoomOK ? `${w.name}… 그 애가 가져다준다 (❄ -${w.cost})` : `${w.name} — 확대해서 바라보면`;
      if (ft.via === 'cctv') hint = '📺 ' + hint;
      if (S.stareT >= 1.4) startFetch(w);
    } else { S.stareId = null; S.stareT = 0; }
  }
  if (live && S.useItem) {
    const t = useTarget(f);
    hint = t ? `${ITEMS[S.useItem].name} → ${t.label} (누르기)` : `${ITEMS[S.useItem].name} — 쓸 곳을 바라본다`;
    hintUse = true;
  }
  updateJob(dt);
  hsUpdate(dt);
  anUpdate(dt);
  if (HS.turning) { const tr = HS.turning; tr.t = Math.min(1, tr.t + dt / 0.55); S.yaw = lerp(tr.from, tr.to, smooth(0, 1, tr.t)); S.pitch = lerp(tr.p0, -0.12, smooth(0, 1, tr.t)); if (tr.t >= 1) HS.turning = null; }

  // ---- examine by looking closely
  if (live && S.zoom > 2 && !S.job) {
    let hitE = null;
    for (const e of EXAMINE) if (!S.examined.has(e.id) && e.when() && rayAABB(EYE, f, e.min, e.max) >= 0) { hitE = e; break; }
    if (hitE && hitE.id === examineId) {
      examineT += dt;
      if (examineT > 0.9) {
        S.examined.add(hitE.id); say(hitE.text, 5);
        if (hitE.rec) record(...hitE.rec);
        examineT = 0;
      }
    } else { examineId = hitE ? hitE.id : null; examineT = 0; }
  }

  // ---- the girl
  const g = S.ghost;
  let seeing = false;
  if (g) {
    g.alpha = damp(g.alpha, g.target, g.target > g.alpha ? 2.5 : 4, dt);
    const head = [g.p[0], g.kind === 'crouch' ? 0.62 : 1.2, g.p[2]];
    const v = inView(head, 0.95);
    seeing = v.visible && g.alpha > 0.3 && !g.camOnly && g.mode !== 'hide' && !HS.on;   // the game with her is not an attack: no insanity while playing
    if (seeing && !S.paused) addFear(dt * 0.04 * (0.6 + 0.45 * S.zoom));
    if (g.target === 0 && g.alpha < 0.02) S.ghost = null;
    // act 1: glimpses vanish when you look at them
    if (g.mode === 'glimpse' && seeing) { g.seenT = (g.seenT || 0) + dt; if (g.seenT > 0.35) { g.target = 0; g.alpha = Math.min(g.alpha, 0.4); snd.play('giggle', head); } }
    // final approach: she moves while unseen
    if (g.mode === 'chase' && !S.paused) {
      g.stepT += dt;
      const to = v3.sub([EYE[0], 0, EYE[2]], g.p); to[1] = 0; const dist = v3.len(to);
      if (!seeing && g.stepT > 1.25) {
        g.stepT = 0;
        if (dist < 0.7) caught();
        else { g.p = v3.add(g.p, v3.scale(v3.norm(to), Math.min(0.26, dist - 0.55))); snd.play('steps', [g.p[0], 0.2, g.p[2]]); }
      }
      if (seeing) g.twitch = 1;
    }
  }
  if (HS.on) S.events = Math.max(S.events, 8);
  // act 1-2 glimpses: she appears where you are not looking, then is gone when you look
  if (live && S.act >= 1 && S.act < 3 && !S.ghost && !S.job) {
    S.events -= dt;
    if (S.events <= 0) {
      S.events = rnd(16, 28) * (S.act >= 2 ? 0.7 : 1);
      const spots = [[-1.5, 0, -2.0], [1.5, 0, 1.75], [0.7, 0, 2.15], [-1.7, 0, 1.9], [1.05, 0, -2.05], [-1.6, 0, 0.3]];
      const cand = spots.filter(p => !inView([p[0], 1.1, p[2]], 1.3).visible);
      if (cand.length) {
        const p = pick(cand);
        S.ghost = { p, kind: Math.random() < 0.3 ? 'crouch' : 'stand', alpha: 0, target: 1, mode: 'glimpse' };
        snd.play(pick(['steps', 'giggle', 'whisper']), [p[0], 1, p[2]]);
        after(9, () => { if (S.ghost?.mode === 'glimpse') S.ghost.target = 0; });
      } else S.events = 3;
      // other small wrongnesses
      const ev = pick(['knock', 'burst', 'swing', 'tv', 'none']);
      if (ev === 'knock') snd.play('knock', [0.7, 1.4, 2.7]);
      if (ev === 'burst') S.bulbBurst = rnd(0.6, 1.8);
      if (ev === 'swing') S.lampSwing = 1;
      if (ev === 'tv' && S.tv.on) { S.glitch = 0.8; snd.play('static', O.tvCenter); }
    }
  }

  // ---- standing up and walking to the door (act 3)
  if (S.standing > 0 && S.standing < 1) {
    S.standing = Math.min(1, S.standing + dt / 2.2);
    EYE[1] = lerp(SEAT[1], 1.58, smooth(0, 1, S.standing));
    if (S.standing >= 1) { ui.action.textContent = '걷기 (길게)'; }
  }
  if (S.act >= 3 && S.standing >= 1 && !S.final && !S.paused) {
    if (S.walking || walkKey) {
      const path = [[0, 0.62], [0.35, 1.3], [0.62, 1.98]];
      S.walk = Math.min(1, S.walk + dt * 0.16);
      const k2 = S.walk * (path.length - 1), i = Math.min(path.length - 2, Math.floor(k2)), fr = k2 - i;
      EYE[0] = lerp(path[i][0], path[i + 1][0], fr); EYE[2] = lerp(path[i][1], path[i + 1][1], fr);
      if (Math.random() < dt * 1.8) snd.play('steps', [EYE[0], 0.1, EYE[2]]);
      if (S.walk >= 1) STORY.atDoor();
    }
  }
  if (S.act >= 3 && S.standing >= 1 && !S.final) { hint = hint || (S.walk < 1 ? '' : ''); }

  // ---- insanity from looking at her
  if (!S.paused) {
    S.stare = seeing ? S.stare + dt : Math.max(0, S.stare - dt * 2);
    const rate = seeing ? (0.03 + 0.05 * Math.min(S.stare / 5, 1)) * (0.7 + 0.3 * S.zoom) : -0.085;
    S.insanity = clamp(S.insanity + rate * dt, 0, 1);
    const I = S.insanity;
    if (I > 0.5 && S.started && !S.ending) {
      S.hallucT -= dt;
      if (S.hallucT <= 0) {
        S.hallucT = rnd(2, 4.5) * (1.4 - I);
        ui.halluc.textContent = pick(['보지 마', '뒤에 있어', '나를 봐', '같이 있자', '엄마', '수아야', '여기야', '왜 안 왔어']);
        ui.halluc.style.left = rnd(18, 82) + '%'; ui.halluc.style.top = rnd(18, 78) + '%';
        ui.halluc.classList.remove('go'); void ui.halluc.offsetWidth; ui.halluc.classList.add('go');
        if (Math.random() < 0.35) voice(pick(['c_look', 'c_stay']), v3.add(EYE, [rnd(-1, 1), 0, rnd(-1, 1)]), 1.8);
        else snd.play('whisper', v3.add(EYE, [rnd(-1, 1), 0, rnd(-1, 1)]));
      }
    }
    if (I > 0.78 && Math.random() < dt * 0.7) S.invert = 1;
    if (I > 0.85 && Math.random() < dt * 0.3) { ui.scare.classList.remove('sub', 'go'); void ui.scare.offsetWidth; ui.scare.classList.add('sub'); }
  }
  S.invert = damp(S.invert, 0, 14, dt);
  if (S.fear >= 1 && !S.paused) { if (S.act >= 3 && S.ghost?.mode === 'chase') caught(); else { jumpscare(); if (S.ghost && S.ghost.mode === 'glimpse') S.ghost.target = 0; } }
  if (!seeing && !S.paused) S.fear = Math.max(0, S.fear - dt * 0.06);

  // ---- the room rots (pop-ins happen only where you are not looking)
  for (const t of O.trash) {
    const at = t.list[0] ? [t.list[0].base[12], 0.3, t.list[0].base[14]] : [0, 0, 0];
    const want = levelAt(at) >= t.at;
    if (want && !t.shown) { t.shown = true; formIn(t.list); }
    else if (!want && t.shown) { t.shown = false; setVisible(t.list, false); }
  }
  for (const r of O.rot) {
    const m = r.o.model, want = levelAt([m[12], m[13], m[14]]) >= r.at;
    if (want && !r.shown) { r.shown = true; r.o.tint[3] = 0.92; formIn([r.o]); }
    else if (!want && r.shown) { r.shown = false; r.o.tint[3] = 0; }
  }
  { const want = levelAt([0.6, 0.45, 2.49]) > 0.45;
    if (want && !O.scratchShown) { O.scratchShown = true; O.scratchObj.tint[3] = 0.9; formIn([O.scratchObj]); } else if (!want && O.scratchShown) { O.scratchShown = false; O.scratchObj.tint[3] = 0; } }
  if (!S.fetched.has('news') && !(S.job && S.job.w.id === 'news') && !O.newsObj.visible && levelAt([0.02, 0.1, 1.92]) > 0.6) formIn([O.newsObj]);
  O.photoObj.emissive = S.flags.photoGlow ? [0.25 + 0.2 * Math.sin(S.time * 4), 0.22, 0.18, 0] : [0, 0, 0, 0];
  if (!S.fetched.has('frame')) {
    const ruined = S.decay > 0.5;
    if (ruined !== !!O.photoRuinedShown && !inView([-0.78, 1.55, -2.46], 1.2).visible) {
      O.photoRuinedShown = ruined;
      O.photoObj.tex = ruined ? O.photoRuinTex : O.photoTex;
      R.rebind(O.photoObj);
    }
  }

  // ---- lights
  S.bulbBurst = Math.max(0, S.bulbBurst - dt);
  S.lampSwing = Math.max(0, S.lampSwing - dt * 0.08);
  let bulb = 1;
  const t = S.time;
  // no flicker: the bulb only ever fades (the room gets darker as it rots)
  if (S.bulbDead) bulb = 0;
  S.bulb = damp(S.bulb ?? 1, bulb, 3, dt);
  snd.voiceFx = Math.min(0.55, S.decay * 0.6 + (S.insanity || 0) * 0.4);   // her voice decays with the room
  // clock runs in act 0, stops after
  if (!S.clockStopped && !S.paused) {
    S.clockSec = (S.clockSec || 0) + dt;
    if (S.clockSec > 60) { S.clockSec = 0; S.clock.m = Math.min(59, S.clock.m + 1); TX.clockFaceTex(clockCanvas, S.clock.h, S.clock.m); R.updateTexture(O.clockTex, clockCanvas); }
  }

  // ---- UI (every write is skipped when nothing changed: each DOM touch can cost a style pass on phones)
  cls(ui.ring, 'show', ringV > 0.01); cls(ui.ring, 'fetch', true);
  put(ui.ringArc.style, 'strokeDashoffset', String(Math.round(113 * (1 - clamp(ringV, 0, 1)))));
  put(ui.hint, 'textContent', hint); cls(ui.hint, 'show', !!hint); cls(ui.hint, 'use', hintUse);
  const showAct = live && ((S.act >= 3 && S.standing >= 1 && !S.final) || (S.useItem && useTarget(f)));
  cls(ui.action, 'show', !!showAct);
  if (showAct) put(ui.action, 'textContent', S.useItem ? `${ITEMS[S.useItem].name} 사용` : '걷기 (길게)');
  put(ui.fear.style, 'transform', `scaleX(${S.fear.toFixed(2)})`);
  put(ui.warm.style, 'transform', `scaleX(${(S.warmth / 100).toFixed(2)})`);
  cls(ui.hud, 'fear', S.fear > 0.65); cls(ui.hud, 'cold', S.warmth < 30); cls(ui.cross, 'hot', !!hint);
  S.seeing = seeing;
}
function caught() {
  if (S.time - S.lastScare < 3) return;
  jumpscare();
  touch(15, 'caught');
  S.walk = Math.max(0, S.walk - 0.3);
  if (S.ghost) { S.ghost.p = [-1.65, 0, -0.6]; S.ghost.alpha = 0; }
  after(1.3, () => say('작은 손이 목덜미를 스쳤다. …뒷걸음질쳤다. 그 애를 봐야 멈춘다.', 4.5));
}

// ---------------------------------------------------------------- render
const G = new Float32Array(80), PST = new Float32Array(32), GC = new Float32Array(80);
function cctvBasis() {
  const f = v3.norm(v3.sub(CCTV.target, CCTV.pos));
  const r = v3.norm(v3.cross(f, [0, 1, 0]));
  const u = v3.cross(r, f);
  return { f, r, u };
}
function frame(dt) {
  const time = performance.now() / 1000;
  const { f, r, u } = camBasis();
  let eye = EYE;
  if (S.shake > 0.01) eye = v3.add(EYE, [(Math.random() - 0.5) * 0.05 * S.shake, (Math.random() - 0.5) * 0.05 * S.shake, 0]);
  let view = m4.view(eye, r, u, v3.scale(f, -1));
  let proj = m4.persp(tanHalfY(), R.width / R.height, 0.03, 30);
  if (HS.cctv) {   // full-screen CCTV: the room seen from the corner camera
    const cb = cctvBasis();
    view = m4.view(CCTV.pos, cb.r, cb.u, v3.scale(cb.f, -1));
    proj = m4.persp(CCTV.tanHalf, R.width / R.height, 0.05, 20);
  }
  G.set(m4.mul(proj, view), 0);

  // lamp
  const lampK = smooth(0, 1, (AN.act.lamp || AN.back?.lamp)?.k || 0);
  const sw = 0.05 + S.lampSwing * 0.25 + lampK * 0.5;
  const ax = Math.sin(time * 1.3) * sw, az = Math.cos(time * 1.1) * sw * 0.7;
  const R0 = m4.trs([0, RH - lampK * ANOM.lamp.drop, -0.6], 0, [1, 1, 1], ax, az);
  setModel(O.nodes.lamp, R0); setModel(O.nodes.bulb, R0);
  const bulbPos = [R0[12] + R0[4] * -0.54, R0[13] + R0[5] * -0.54, R0[14] + R0[6] * -0.54];
  const B = (S.bulb ?? 1) * (1 - (S.lampDim || 0) * 0.6);
  O.bulb.emissive = [B * 7, B * 5.2 * (1 - lampK * 0.75), B * 3.2 * (1 - lampK * 0.85), 0]; O.bulb.tint = [0.08, 0.07, 0.06, 1];
  O.halo.model = billboard(bulbPos, 0.55 + B * 0.2, true);
  O.halo.tint[3] = B * 0.22;
  snd.bulbPan && snd.setPos(snd.bulbPan, bulbPos);

  // TV
  const tc = tvContent();
  tvScreen.mode = tc.mode === 'cctv' ? 'off' : tc.mode === 'kids' ? 'kids' : tc.mode === 'text' ? 'broadcast' : tc.mode;
  tvScreen.bad = !!tc.bad; tvScreen.lines = tc.lines || [];
  const tvI = !S.tv.on ? 0 : tc.mode === 'static' ? 0.85 + Math.random() * 0.3 : tc.mode === 'cctv' ? 0.7 : 0.75 + Math.random() * 0.08;
  // the CRT picture is a 2D canvas: redraw + upload it only when it can change and be seen (at 30 Hz)
  {
    const tj = performance.now(), key = tc.mode + (tc.bad ? 1 : 0) + (tc.lines || []).join('|');
    PERF.tvTick = (PERF.tvTick || 0) + 1;
    const moving = tc.mode !== 'off' && tc.mode !== 'cctv', seen = inView(O.tvCenter, 1.25).visible;
    if (tc.mode !== 'cctv' && (key !== PERF.tvKey || (moving && seen && PERF.tvTick % 2 === 0))) {
      R.updateTexture(O.tvTex, tvScreen.draw(moving ? dt * 2 : dt, 1)); PERF.tvKey = key;
    }
    PERF.part('tv', performance.now() - tj);
  }
  O.screen.visible = tc.mode !== 'cctv';
  O.cctvScreen.visible = tc.mode === 'cctv';
  O.screen.emissive = [0.9 * tvI, 0.95 * tvI, 1.15 * tvI, 1];
  O.cctvScreen.emissive = [0.9, 1.05, 0.95, 1].map((v, k) => k < 3 ? v * (0.85 + Math.random() * 0.15) : v);
  O.tvHalo.tint[3] = 0.08 * tvI;
  snd.tvSong(S.tv.on && tc.mode === 'kids' && !S.paused, tc.bad ? 0.82 : 1);

  // curtains
  const co = smooth(0, 1, S.curtainOpen), cw = lerp(1, 0.3, co);
  for (const k of ['curtain_L', 'curtain_R']) {
    const base = O.nodes[k][0].base;
    if (!(S.job && S.job.w.id === 'curtain')) setModel(O.nodes[k], m4.trs([base[12], base[13], base[14]], 0, [1 + co * 1.3, 1, cw]));
  }
  hsCues(time);
  // music box lid (in hand)
  if (O.led) { const on = S.tape < 4 && Math.sin(time * 5) > 0; O.led.emissive = on ? [3, 0.15, 0.08, 0] : [0.05, 0, 0, 0]; }
  if (O.scratchObj) O.scratchObj.visible = !(S.doorOpen > 0.02);
  { const b0 = O.nodes.door[0].base; setModel(O.nodes.door, m4.trs([b0[12], b0[13], b0[14]], -smooth(0, 1, S.doorOpen) * 1.3)); }
  const dl = Math.max(S.doorLight, S.act >= 3 ? 0.35 : 0);
  for (const o of O.nodes.corridor) o.emissive = [dl * 0.9, dl * 0.86, dl * 0.78, 0];
  // the doll turns its head towards you once the room has rotted
  if (!S.fetched.has('doll') && !(S.job && S.job.w.id === 'doll')) {
    const db = O.nodes.item_doll[0].base, want = S.decay > 0.6 ? Math.atan2(EYE[0] - db[12], EYE[2] - db[14]) : 0;
    if (!inView([db[12], db[13], db[14]], 1.2).visible || O.dollYaw === undefined) O.dollYaw = want;
    setModel(O.nodes.item_doll, m4.trs([db[12], db[13], db[14]], O.dollYaw ?? 0));
  }
  anApply(dt, time);

  // item in hand
  if (S.insp) {
    const objs = inspectObjs(S.insp.id);
    const ext = objs.reduce((m, o) => Math.max(m, ...o.max.map((v, k) => Math.abs(v)), ...o.min.map(v => Math.abs(v))), 0.02);
    const k = 0.11 / ext;
    const P = v3.add(EYE, v3.add(v3.scale(f, 0.42), v3.scale(u, -0.015)));
    const Rc = new Float32Array([r[0], r[1], r[2], 0, u[0], u[1], u[2], 0, -f[0], -f[1], -f[2], 0, 0, 0, 0, 1]);
    const M = m4.mul(m4.mul(m4.trs(P, 0, [k, k, k]), Rc), m4.trs([0, 0, 0], S.insp.yaw, [1, 1, 1], S.insp.pitch));
    const ref = [objs[0].base[12], objs[0].base[13], objs[0].base[14]];
    if (!S.insp.center) {   // centre of all parts, so the item turns around its middle
      let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      for (const o of objs) for (let q = 0; q < 3; q++) {
        const off = o.base[12 + q] - ref[q];
        mn[q] = Math.min(mn[q], o.min[q] + off); mx[q] = Math.max(mx[q], o.max[q] + off);
      }
      S.insp.center = mn.map((v, q) => (v + mx[q]) / 2);
    }
    for (const o of objs) {
      o.visible = true;
      const off = v3.sub(v3.sub([o.base[12], o.base[13], o.base[14]], ref), S.insp.center);
      if (o === O.nodes.item_musicbox_lid[0]) o.model = m4.mul(M, m4.trs(off, 0, [1, 1, 1], O.lid * 1.7));
      else o.model = m4.mul(M, m4.mul(m4.trs(off), strip(o.base)));
    }
    O.backdrop.visible = true;
    O.backdrop.model = m4.mul(m4.trs(v3.add(EYE, v3.scale(f, 0.75))), m4.mul(Rc, m4.trs([0, 0, 0], 0, [3, 3, 1])));
    // hotspots → screen
    const hs = HOT[S.insp.id] || [];
    const VP = G;
    ui.hotspots.innerHTML = '';
    hs.forEach((h, i) => {
      const p = m4Apply(M, v3.sub(h.p, S.insp.center));
      const cw2 = VP[3] * p[0] + VP[7] * p[1] + VP[11] * p[2] + VP[15];
      if (cw2 <= 0) return;
      const sx = (VP[0] * p[0] + VP[4] * p[1] + VP[8] * p[2] + VP[12]) / cw2, sy = (VP[1] * p[0] + VP[5] * p[1] + VP[9] * p[2] + VP[13]) / cw2;
      const b = document.createElement('button');
      b.style.left = `${(sx * 0.5 + 0.5) * 100}%`; b.style.top = `${(0.5 - sy * 0.5) * 100}%`;
      b.innerHTML = `●<span>${h.label}</span>`;
      b.addEventListener('pointerdown', ev => { ev.stopPropagation(); snd.play('click'); h.fn(); });
      ui.hotspots.appendChild(b);
    });
  }

  if (!S.insp) O.backdrop.visible = false;
  // the girl
  const g = S.ghost;
  setVisible(O.ghostStand, false); setVisible(O.ghostCrouch, false); O.ghostShadow.tint[3] = 0;
  let ghostLight = 0, gpos = [0, -10, 0];
  if (g) {
    const list = g.kind === 'crouch' ? O.ghostCrouch : O.ghostStand;
    setVisible(list, g.alpha > 0.005);
    const clipY = g.clip || (g.mode === 'hide' && HS.spot === 'curtain' ? 0.3 : 0);
    for (const o of list) { o.camOnly = !!g.camOnly; o.castShadow = false; o.extra[1] = clipY; }   // no cube-shadow for her (6 extra draws of a dense mesh); the blob on the floor stays
    let p = g.p;
    if (g.twitch > 0 || S.glitch > 0.3) {
      g.twitch = Math.max(0, (g.twitch || 0) - dt * 3);
      if (Math.random() < 0.15) p = v3.add(p, [(Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.5) * 0.04]);
    }
    const faceTo = g.mode === 'sit' ? O.tvCenter : g.camOnly ? CCTV.pos : EYE;
    if (g.mode === 'hide' && g.kind === 'crouch' && HS.spot === 'desk') { /* tucked under the desk */ }
    const yaw = Math.atan2(faceTo[0] - p[0], faceTo[2] - p[2]) + Math.sin(time * 0.7) * 0.03;
    if (g.mode === 'hide' && HS.spot && HIDE[HS.spot].lying) setModel(list, m4.trs([p[0], p[1], p[2]], 0, [1, 1, 1], -PI / 2));   // lying on her back, head under the seat
    else setModel(list, m4.trs([p[0], 0, p[2]], yaw, [1, 1, 1], 0, g.twitch > 0.5 && Math.random() < 0.3 ? (Math.random() - 0.5) * 0.12 : 0));
    setAlpha(list, g.alpha);
    O.ghostShadow.model = m4.trs([p[0], 0.006, p[2]], 0, [0.8, 0.6, 1], -PI / 2);
    O.ghostShadow.tint[3] = g.camOnly ? 0 : g.alpha * 0.6;
    ghostLight = g.camOnly ? 0 : g.alpha * (0.22 + 0.15 * Math.sin(time * 3));
    gpos = [p[0], g.kind === 'crouch' ? 0.7 : 1.3, p[2]];
  }

  // lights: warm homely evening → cold
  const warmK = 1 - S.decay;
  const moon = lerp(0.18, 2.2, co);
  const amb = 0.018 + warmK * 0.03 + (S.bulbDead ? 0.004 : 0);
  G.set([eye[0], eye[1], eye[2], time], 16);
  G.set([bulbPos[0], bulbPos[1], bulbPos[2], (2.8 + warmK * 1.4) * B], 20);
  G.set([1.0, (0.72 + warmK * 0.08) * (1 - lampK * 0.65), (0.45 + warmK * 0.05) * (1 - lampK * 0.75), 0], 24);
  G.set([O.tvCenter[0], O.tvCenter[1], O.tvCenter[2] + 0.15, 1.6 * tvI], 28);
  G.set([0.55, 0.7, 1.0, 0], 32);
  G.set([-2.6, 1.75, -0.6, moon], 36);
  G.set([0.35, 0.45, 0.85, 0], 40);
  G.set([amb * (1 + warmK * 0.5), amb * 1.05, amb * (1.35 - warmK * 0.4), 0.14 - warmK * 0.04], 44);
  G.set([S.fear, S.zoom, Math.max(S.glitch, S.fear > 0.7 ? (S.fear - 0.7) * 2 : 0, g?.twitch || 0), 0], 48);
  G.set([gpos[0], gpos[1], gpos[2], ghostLight], 52);
  const moonOwns = S.bulbDead;
  G.set([Math.max(S.doorLight, S.act >= 3 ? 0.18 : 0), S.shadowStrength ?? 1, S.decay, S.insp ? 5.0 : 0.25], 56);
  const shadowLight = moonOwns ? [-2.6, 1.75, -0.6] : [bulbPos[0], bulbPos[1] - 0.05, bulbPos[2]];
  G.set([...shadowLight, moonOwns ? 1 : 0], 60);
  G.set([...SHIFT.o, SHIFT.on ? SHIFT.r : 99], 64);
  G.set([SHIFT.on ? SHIFT.from : S.decay, SHIFT.on ? SHIFT.to : S.decay, SHIFT.on ? SHIFT.burn : 0, S.decay > 0.3 ? 0.18 + S.decay * 0.2 : 0], 68);

  // CCTV globals (only when it is on screen)
  let camG = null;
  if (O.cctvScreen.visible) {
    GC.set(G);
    const cb = cctvBasis();
    GC.set(m4.mul(m4.persp(CCTV.tanHalf, CCTV.aspect, 0.05, 20), m4.view(CCTV.pos, cb.r, cb.u, v3.scale(cb.f, -1))), 0);
    GC.set([...CCTV.pos, time], 16);
    GC[59] = 0;
    camG = GC;
  }

  // post
  const exposure = (1.45 + warmK * 0.25) * (1 + (S.zoom - 1) * 0.28) * (HS.cctv ? 1.25 : 1);
  let cueX = 0, cueY = 0, cueS = 0;
  if (g && !S.seeing && g.alpha > 0.3 && !g.camOnly && ['glimpse', 'chase', 'final'].includes(g.mode)) {
    const d = v3.norm(v3.sub(gpos, EYE));
    cueX = v3.dot(d, r); cueY = -v3.dot(d, u);
    const l = Math.hypot(cueX, cueY) || 1; cueX /= l; cueY /= l; cueS = 0.9;
  }
  const beat = snd.beatAt ? Math.max(0, 1 - (snd.ctx.currentTime - snd.beatAt) * 3) : 0;
  PST.set([R.width, R.height, time, R.width / R.height], 0);
  PST.set([exposure, S.fear, S.blackout, 0.016 + S.fear * 0.04 + (S.zoom - 1) * 0.008 + S.decay * 0.01 + (HS.cctv ? 0.07 : 0)], 4);
  PST.set([...S.flashCol, S.flash], 8);
  PST.set([cueX, cueY, cueS, beat], 12);
  PST.set([0.0025 + S.fear * 0.01 + S.glitch * 0.02, 0.07, 1.0 + S.fear * 0.35 - (S.zoom - 1) * 0.05 - warmK * 0.15, S.fear > 0.6 ? (S.fear - 0.6) * 2.5 + S.glitch : S.glitch], 16);
  let gsx = 0.5, gsy = 0.5, gOn = 0;
  if (g && g.alpha > 0.2 && !g.camOnly) {
    const VP = G, x = gpos[0], y = gpos[1], z = gpos[2];
    const cw2 = VP[3] * x + VP[7] * y + VP[11] * z + VP[15];
    if (cw2 > 0.05) {
      const cx = (VP[0] * x + VP[4] * y + VP[8] * z + VP[12]) / cw2, cy = (VP[1] * x + VP[5] * y + VP[9] * z + VP[13]) / cw2;
      if (Math.abs(cx) < 1.3 && Math.abs(cy) < 1.3) { gsx = cx * 0.5 + 0.5; gsy = 0.5 - cy * 0.5; gOn = 1; }
    }
  }
  PST.set([smooth(0.08, 1, S.insanity), gsx, gsy, gOn], 20);
  // ?diag: character on flat grey, post-processing stripped, layers switched on one by one
  const DG = window.__diag;
  if (DG) {
    PST.set([1.0, 0, 0, 0], 4); PST.set([0, 0, 0, 0], 8); PST.set([0, 0, 0, 0], 12); PST.set([0, 0, 0, 0], 16); PST.set([0, 0, 0, 0], 20); PST.set([0, 0, 0, 0], 24);
    if (DG.post) { PST.set([1.45, 0, 0, 0.016], 4); PST.set([0.0025, 0.07, 1.0, 0], 16); }
  }
  PST.set([S.invert * 0.85, S.stare, S.frost, S.insp ? 1 : 0], 24);
  if (DG) {
    for (const o of objects) if (!o.diagKeep) o.visible = false;
    for (const l of [O.ghostStand, O.ghostCrouch]) for (const o of l) {
      o.flags[1] = DG.lit ? 0 : (DG.ao ? 2 : 1);
      if (!o._t0) { o._t0 = o.tex; }
    }
    if (!O.diagBg) { O.diagBg = add(R.object(O.quad, null, { model: m4.ident(), flags: [0, 1, 0, 0], tint: [0.42, 0.42, 0.42, 1] })); O.diagBg.diagKeep = true; }
    O.diagBg.visible = true; O.diagBg.model = m4.trs(v3.add(EYE, v3.scale(f, 4)), S.yaw + PI, [8, 8, 1], -S.pitch);
    for (const o of (g?.kind === 'crouch' ? O.ghostCrouch : O.ghostStand)) o.visible = true;
  }
    // the swinging bulb moves slowly: on phones (or when frames run long) its shadow map is redrawn every other frame
    PERF.frame = (PERF.frame || 0) + 1;
    const skipShadow = (gfxPreset().skip || PERF.shadowSkip) && PERF.frame % 2 === 1 && !S.bulbBurst;
    const tr = performance.now();
    R.render(G, PST, objects, skipShadow ? null : shadowLight, camG);
    PERF.part('render', performance.now() - tr);

  // audio parameters at ~20 Hz: every setTargetAtTime is an automation event, 60 of them a second per param is wasteful
  PERF.audT = (PERF.audT || 0) + dt;
  if (PERF.audT >= 0.05) {
    const ta = performance.now();
    snd.listener(EYE, f, u);
    snd.update(PERF.audT, {
      bulb: B, tvStatic: S.tv.on && tc.mode === 'static' ? 1 : S.tv.on && tc.mode !== 'kids' ? 0.25 : 0, tvHum: S.tv.on ? 0.6 : 0,
      ghost: g && !g.camOnly ? g.alpha : 0, ghostPos: gpos, fear: S.fear, insanity: S.insanity, rain: S.rain,
    });
    PERF.audT = 0;
    PERF.part('audio', performance.now() - ta);
  }
}
function m4Apply(M, p) {
  return [M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14]];
}
function billboard(p, w, full = false, h = w) {
  const yaw = Math.atan2(EYE[0] - p[0], EYE[2] - p[2]);
  if (!full) return m4.trs(p, yaw, [w, h, 1]);
  const d = v3.sub(EYE, p), pitch = -Math.atan2(d[1], Math.hypot(d[0], d[2]));
  return m4.trs(p, yaw, [w, h, 1], pitch);
}

// ---------------------------------------------------------------- restore a checkpoint
function restore(sv) {
  S.memo = sv.memo || []; S.time = sv.time || 0; S.records = new Set(sv.records || []); S.tape = sv.tape || 0;
  S.flags = sv.flags || {}; S.tv = sv.tv || S.tv;
  for (const id of sv.fetched || []) { S.fetched.add(id); if (W[id] && !W[id].action) setVisible(W[id].objs, false); }
  if (S.fetched.has('curtain')) S.curtainTarget = S.curtainOpen = 1;
  if (S.flags.hand) setVisible(O.nodes.rope_R, false);
  (sv.inv || []).forEach(invAdd);
  S.act = sv.act;
  if (S.act >= 1) { S.rain = 0; stopClock(); }
  S.decayTarget = S.decay = [0, 0.28, 0.78, 1][S.act];
  snd.playMusic(S.act >= 1 ? 'music_room' : null, 4);
  S.blackout = 1; S.blackoutTarget = 0;
  say('…다시, 이 방이다.', 3);
  if (S.act === 0) objective(S.inv.includes('remote') ? '채널을 돌려 본다' : 'TV 리모컨을 가만히 바라본다');
  if (S.act === 1) objective(S.flags.calRead ? `서랍을 가져오게 하고, 자물쇠를 연다 (12월 ${SOL.day}일)` : S.flags.childNote ? '달력을 찾는다 — 엄마가 오는 날' : '오르골을 살펴본다');
  if (S.act === 2) objective(S.flags.hand ? '발목 자물쇠의 열쇠를 찾는다' : '가위로 오른손 밧줄을 끊는다');
  if (S.act >= 3) { S.act = 2; S.flags.feet = 0; objective('작은 열쇠를 발목 자물쇠에 쓴다'); if (!S.inv.includes('anklekey')) invAdd('anklekey'); }
}

// ---------------------------------------------------------------- main
function perfTick(dt) {
  PERF.acc += dt; PERF.n++;
  const target = gfxPreset().cap || 60;
  if (PERF.acc < 1) return;
  const avg = PERF.acc / PERF.n; PERF.fps = Math.round(1 / avg); PERF.acc = 0; PERF.n = 0;
  if (TEL && S.started) {
    const js = {}; for (const [k, [sum, n]] of Object.entries(PERF.parts)) js[k] = +(sum / Math.max(1, n)).toFixed(2);
    TEL.sample({ ...perfState(), js });
  }
  PERF.parts = {};
  if (!S.started || S.paused) return;
  // below ~48 fps for 2 s: fewer pixels; comfortably at 60 for 5 s: a little more
  if (avg > 1 / (target * 0.8)) { PERF.slow++; PERF.fast = 0; } else if (avg < 1 / (target * 0.95)) { PERF.fast++; PERF.slow = 0; } else { PERF.slow = PERF.fast = 0; }
  if (PERF.slow >= 2 && PERF.scale > PERF.min) { PERF.scale = Math.max(PERF.min, PERF.scale * 0.85); PERF.slow = 0; PERF.shadowSkip = true; resize(); TEL?.event('scale', { to: +PERF.scale.toFixed(2), fps: PERF.fps }); }
  else if (PERF.fast >= 5 && PERF.scale < 1) { PERF.scale = Math.min(1, PERF.scale * 1.08); PERF.fast = 0; resize(); TEL?.event('scale', { to: +PERF.scale.toFixed(2), fps: PERF.fps }); }
  window.__perf = { fps: PERF.fps, scale: +PERF.scale.toFixed(2), px: `${R.width}x${R.height}`, gfx: gfxChoice, shadow: R.shadowSize };
  const el = $('#gfxFps'); if (el) el.textContent = `${PERF.fps} fps · ${R.width}×${R.height}`;
}
// ---------------------------------------------------------------- performance log (per session, see js/telemetry.js)
// endpoint: ?perf=URL, or localStorage 'gaze-perf', or the default collector below; ?perf=off disables it
const PERF_DEFAULT = '';
let TEL = null;
function perfUrl() {
  const q = new URLSearchParams(location.search).get('perf');
  if (q === 'off') { try { localStorage.removeItem('gaze-perf'); } catch { } return ''; }
  if (q) { try { localStorage.setItem('gaze-perf', q); } catch { } return q; }
  try { return localStorage.getItem('gaze-perf') || PERF_DEFAULT; } catch { return PERF_DEFAULT; }
}
function startTelemetry() {
  const nav = navigator;
  TEL = new Telemetry(perfUrl(), {
    ua: nav.userAgent, platform: nav.userAgentData?.platform || nav.platform, mobile: nav.userAgentData?.mobile,
    dpr: devicePixelRatio, screen: `${screen.width}x${screen.height}`, viewport: `${innerWidth}x${innerHeight}`,
    cores: nav.hardwareConcurrency, memGB: nav.deviceMemory, coarse: matchMedia('(pointer: coarse)').matches,
    gpu: R.adapterInfo, timestamps: !!R.ts, gfx: gfxChoice, preset: Object.keys(GFX).find(k => GFX[k] === gfxPreset()),
    build: document.querySelector('meta[name=build]')?.content || '', page: location.pathname,
  });
  window.__tel = TEL;
}
function perfState() {
  const g = S.ghost, gm = R.gpuMs, r1 = (v) => v == null ? undefined : +v.toFixed(2);
  return {
    px: `${R.width}x${R.height}`, scale: +PERF.scale.toFixed(2), gfx: gfxChoice, shadowMap: R.shadowSize,
    gpu: gm ? { total: r1(gm.total), shadow: r1(gm.shadow), cctv: r1(gm.cctv), main: r1(gm.main), post: r1(gm.post) } : undefined,
    draws: R.stats.draws, tris: Math.round(R.stats.tris), sDraws: R.stats.shadowDraws, sTris: Math.round(R.stats.shadowTris),
    phase: HS.phase, round: HS.round, night: AN.on ? AN.phase : 0, anom: Object.keys(AN.act).join(','),
    ghost: g ? `${g.kind}:${g.mode}:${g.alpha.toFixed(2)}` : '', shift: SHIFT.on ? +SHIFT.r.toFixed(1) : 0,
    cctv: O.cctvScreen.visible ? 1 : 0, tv: S.tv.on ? 1 : 0, ins: +(S.insanity || 0).toFixed(2), fear: +S.fear.toFixed(2),
    decay: +S.decay.toFixed(2), zoom: +S.zoom.toFixed(2), insp: S.insp ? 1 : 0, paused: S.paused ? 1 : 0,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : undefined,
  };
}
// graphics presets: auto = low on phones/tablets, high on PC (dynamic resolution still guards the frame rate)
const GFX_KEY = 'gaze-gfx';
const GFX = {
  low: { name: '낮음', px: 0.9e6, shadow: 512, skip: true, aniso: 1, tex: 512, cap: 60, min: 0.5 },
  medium: { name: '중간', px: 1.6e6, shadow: 1024, skip: false, aniso: 4, tex: 1024, cap: 60, min: 0.6 },
  high: { name: '높음', px: 4.2e6, shadow: 2048, skip: false, aniso: 16, tex: 0, cap: 0, min: 0.75 },
};
let gfxChoice = 'auto';
try { gfxChoice = localStorage.getItem(GFX_KEY) || 'auto'; } catch { }
const gfxPreset = (c = gfxChoice) => GFX[c] || (matchMedia('(pointer: coarse)').matches ? GFX.low : GFX.high);
function applyGfx(choice) {
  gfxChoice = choice;
  TEL?.event('gfx', { choice });
  try { localStorage.setItem(GFX_KEY, choice); } catch { }
  const g = gfxPreset();
  PERF.scale = 1; PERF.min = g.min; PERF.shadowSkip = false;
  if (R.shadowSize !== g.shadow) R.setShadowSize(g.shadow);
  R.setAniso(g.aniso, objects);
  resize();
}
// dynamic resolution: the loop lowers PERF.scale when frames run long and raises it back when there is headroom
const PERF = { parts: {}, part(k, ms) { const p = this.parts[k] || (this.parts[k] = [0, 0]); p[0] += ms; p[1]++; }, scale: 1, min: 0.6, acc: 0, n: 0, slow: 0, fast: 0, fps: 60, shadowSkip: false, coarse: matchMedia('(pointer: coarse)').matches };
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  let w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  const g = gfxPreset(), dprMax = g === GFX.high ? 2.5 : 2;
  w = Math.round(innerWidth * Math.min(devicePixelRatio || 1, dprMax)); h = Math.round(innerHeight * Math.min(devicePixelRatio || 1, dprMax));
  const maxPx = g.px * PERF.scale * PERF.scale, s = Math.min(1, Math.sqrt(maxPx / (w * h)));
  w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
  R.resize(w, h);
}

async function main() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const gp = gfxPreset();
  try { R = await Renderer.create(ui.canvas, { shadowSize: gp.shadow, maxTex: gp.tex, aniso: gp.aniso }); }
  catch (e) { ui.nogpu.classList.add('show'); ui.title.classList.add('hidden'); console.error(e); return; }
  R.device.lost.then(info => { console.error('device lost', info); TEL?.event('device_lost', { reason: info.reason, msg: info.message }); TEL?.flush(); ui.nogpu.querySelector('p').textContent = 'GPU 장치가 초기화되었습니다. 새로고침 해주세요.'; ui.nogpu.classList.add('show'); });
  startTelemetry();
  const tl = performance.now();
  await loadAll();
  TEL.event('loaded', { ms: Math.round(performance.now() - tl) });
  buildScene();
  setupInput();
  setupGyro();
  resize(); addEventListener('resize', resize);
  ui.load.textContent = '헤드폰을 권장합니다';
  ui.start.disabled = false;
  ui.start.addEventListener('click', () => {
    snd.lite = matchMedia('(pointer: coarse)').matches; snd.init(); snd.decodeAll();
    let pref = null; try { pref = localStorage.getItem(GYRO_KEY); } catch { }
    if (document.documentElement.classList.contains('has-gyro') && pref === '1') setGyro(true);
    else if (document.documentElement.classList.contains('has-gyro') && pref === null) after(24, () => say('📱 위의 [자이로] 버튼을 누르면 폰을 움직여 둘러볼 수 있다.', 5));
    ui.title.classList.add('hidden'); ui.hud.classList.add('show');
    S.started = true; S.paused = false; TEL?.event('start', {});
    try { document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => { }); } catch { }
    if (SAVE && ui.start.dataset.resume === '1') restore(SAVE); else { clearSave(); hsStart(); }
  }, { once: true });
  if (SAVE) {
    ui.start.textContent = '이어하기'; ui.start.dataset.resume = '1';
    const nb = document.createElement('button');
    nb.className = 'ghostbtn newgame'; nb.textContent = '처음부터';
    nb.addEventListener('click', () => { clearSave(); location.reload(); });
    ui.start.after(nb);
  }
  let last = performance.now();
  const loop = (now) => {
    requestAnimationFrame(loop);
    // 60 fps is plenty: on 90/120 Hz phones skip the in-between frames (half the GPU work and heat)
    const cap = gfxPreset().cap;
    if (cap && now - last < 1000 / (cap + 4)) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    perfTick(dt);
    const t0 = performance.now();
    try { update(dt); PERF.part('update', performance.now() - t0); frame(dt); } catch (e) { if (!loop.err) { console.error(e); TEL?.event('exception', { msg: String(e.stack || e).slice(0, 500) }); } loop.err = e; window.__err = e.stack || String(e); }
    const js = performance.now() - t0;
    if (TEL && S.started) {
      TEL.frame(dt, js);
      if (dt > 0.06 && !document.hidden) TEL.event('long', { ms: Math.round(dt * 1000), js: +js.toFixed(1), ...perfState() });
    }
  };
  requestAnimationFrame(loop);
  // test hook: advance the game by hand (the automation tab may be in a hidden window where rAF does not run)
  window.__step = (n = 1, dt = 1 / 60) => { for (let k = 0; k < n; k++) { update(dt); frame(dt); } return R.stats; };
  window.__game = { applyGfx, PERF, hsStory, AN, ANOM, anSpawn, anFix, anTap, anBox, anStart, tanHalfY, O, R, objects, HS, HIDE, hsTap, hsPick, turnAround, LOG, S, SOL, CODE, W, ITEMS, EYE, STORY, snd, O, CCTV, cctvBasis, openInspect, closeInspect, combine, applyUse, useTarget, padPress, startFetch, giveTo, fetchTarget, camBasis, HOT, trayTap, USE_TARGETS };
}
main();
