import { Renderer } from './gpu.js';
import { plane } from './geometry.js';
import { loadGLB } from './gltf.js';
import { m4, v3, clamp, lerp, smooth, damp, rayAABB } from './math.js';
import { Sound } from './audio.js';
import * as TX from './textures.js';

// ---------------------------------------------------------------- constants
const EYE = [0, 1.15, 0.3];
const RX = 2.2, RZ = 2.5, RH = 2.6;
const PI = Math.PI;
const ASSETS = {
  wall: 'assets/wall.webp', floor: 'assets/floor.webp', ceiling: 'assets/ceiling.webp', curtain: 'assets/curtain.webp',
  wood: 'assets/wood.webp', door: 'assets/door.webp', face: 'assets/ghost_face.webp', window: 'assets/window.webp',
  fabric: 'assets/fabric.webp', plastic: 'assets/plastic.webp', paper: 'assets/paper.webp',
  drawing: 'assets/child_drawing.webp', newspaper: 'assets/newspaper.webp',
};
const GLB = {};

// Ghost haunting spots. decal: where the hint appears next to her
const SPOTS = {
  window: { p: [-1.7, 0, 0.2], kind: 'stand', decal: { p: [-2.185, 1.3, 0.78], yaw: PI / 2, w: 0.56, h: 0.28 } },
  A: { p: [-1.5, 0, -2.0], kind: 'stand', decal: { p: [-0.95, 1.3, -2.485], yaw: 0, w: 0.42, h: 0.42 } },
  B: { p: [1.5, 0, 1.75], kind: 'crouch', decal: { p: [2.185, 1.05, 1.15], yaw: -PI / 2, w: 0.42, h: 0.42 } },
  C: { p: [0.7, 0, 2.15], kind: 'stand', decal: { p: [-0.2, 1.35, 2.485], yaw: PI, w: 0.42, h: 0.42 } },
  D: { p: [1.3, 0, 0.8], kind: 'crouch', decal: { p: [2.185, 1.25, 1.25], yaw: -PI / 2, w: 0.38, h: 0.38 } },
  E: { p: [-1.7, 0, 2.0], kind: 'stand', decal: { p: [-2.185, 1.35, 1.35], yaw: PI / 2, w: 0.42, h: 0.42 } },
  F: { p: [1.05, 0, -2.05], kind: 'stand', decal: { p: [1.6, 1.4, -2.485], yaw: 0, w: 0.42, h: 0.42 } },
  glass: { p: [-1.65, 0, -0.6], kind: 'stand', decal: { p: [-2.17, 1.83, -0.6], yaw: PI / 2, w: 1.0, h: 0.5 } },
};

// ---------------------------------------------------------------- dom
const $ = (s) => document.querySelector(s);
const ui = {
  title: $('#title'), start: $('#startBtn'), load: $('#loadText'), hud: $('#hud'), sub: $('#subtitle'),
  action: $('#actionBtn'), zoom: $('#zoomBtn'), memoBtn: $('#memoBtn'), pauseBtn: $('#pauseBtn'), gyroBtn: $('#gyroBtn'),
  ring: $('#revealRing'), ringArc: $('#revealArc'), cross: $('#cross'), fear: $('#fearFill'),
  modal: $('#modal'), card: $('#modalCard'), scare: $('#scare'), ending: $('#ending'), fade: $('#fade'),
  nogpu: $('#nogpu'), canvas: $('#gl'), objective: $('#objective'), halluc: $('#halluc'),
};

// ---------------------------------------------------------------- state
const S = {
  yaw: 0, pitch: -0.05, zoom: 1, zoomTarget: 1, holdZoom: false,
  fear: 0, time: 0, paused: true, started: false,
  stage: 'intro', flags: {}, memo: [], inventory: [],
  shake: 0, flash: 0, flashCol: [1, 1, 1], blackout: 0, blackoutTarget: 0, glitch: 0,
  bulbDead: false, bulbFlicker: 0, bulbBurst: 0, lampSwing: 0,
  tv: { mode: 'static', channel: 3, on: true },
  curtainOpen: 0, curtainTarget: 0, drawerOpen: 0, doorLight: 0,
  ghost: null, // {spot, alpha, reveal, revealed, onReveal, lingering}
  decoys: [], pending: null, insanity: 0, stare: 0, invert: 0, hallucT: 3, records: new Set(), tape: 0,
  decals: {}, timers: [], unlock: 0, holding: false, chase: null, ending: false,
  lastScare: -99, clock: { h: 12, m: 0 }, events: 0,
};
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// puzzle solution, randomised each run
// checkpoint (same puzzle continues after a reload)
const SAVE_KEY = 'gaze-save-v1';
let SAVE = null;
try { SAVE = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { }
const SOL = SAVE?.sol || {
  channel: 4 + Math.floor(Math.random() * 6),
  code: Array.from({ length: 4 }, () => Math.floor(Math.random() * 10)),
  hour: 1 + Math.floor(Math.random() * 11),
  minute: 5 * (1 + Math.floor(Math.random() * 11)),
  spots: shuffle(['A', 'B', 'C', 'D', 'E', 'F']),
  order: shuffle([0, 1, 2, 3]),
};
const spotOrder = SOL.spots;
const digitSpots = spotOrder.slice(0, 4);
const digitOrder = SOL.order; // which code position each appearance reveals
const clockSpots = spotOrder.slice(4, 6);
function checkpoint(stage, i = 0) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ sol: SOL, stage, i, memo: S.memo, time: S.time, records: [...S.records], tape: S.tape })); } catch { }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch { } }
// rebuild the world state for a checkpoint and resume from it
function restore(sv) {
  S.memo = sv.memo || []; S.time = sv.time || 0; S.records = new Set(sv.records || []); S.tape = sv.tape || 0;
  const order = ['digits', 'drawer', 'clock', 'clockSet', 'real', 'chase'];
  const at = order.indexOf(sv.stage);
  S.tv.mode = 'broadcast'; tvScreen.mode = 'broadcast'; tvScreen.lines = ['찾아줘']; tvScreen.channel = SOL.channel;
  if (at >= 2) { S.flags.drawer = 1; S.flags.gotItems = 1; S.inventory.push('key', 'photo'); }
  if (at >= 4) {
    S.flags.clockDone = 1; S.clock = { h: SOL.hour, m: SOL.minute };
    TX.clockFaceTex(clockCanvas, SOL.hour, SOL.minute); R.updateTexture(O.clockTex, clockCanvas);
    S.curtainTarget = S.curtainOpen = 1;
  }
  S.blackout = 1; S.blackoutTarget = 0;
  say('…다시, 이 방이다.', 3);
  after(1.5, () => {
    if (sv.stage === 'digits') STAGES.digits(sv.i);
    else if (sv.stage === 'drawer') STAGES.digits(4);
    else if (sv.stage === 'clock') STAGES.clock(sv.i);
    else if (sv.stage === 'clockSet') STAGES.clock(2);
    else if (sv.stage === 'real') STAGES.real();
    else if (sv.stage === 'chase') STAGES.chase();
  });
}

let R, snd = new Sound(), IMG = {}, O = {}, tvScreen, clockCanvas;
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
function objective(t) { ui.objective.textContent = t; ui.objective.classList.toggle('show', !!t); }
function addMemo(html) { S.memo.push(html); ui.memoBtn.classList.add('new'); }
function addFear(v) { S.fear = clamp(S.fear + v, 0, 1); }

function camBasis() {
  const cp = Math.cos(S.pitch), sp = Math.sin(S.pitch), cy = Math.cos(S.yaw), sy = Math.sin(S.yaw);
  const f = [sy * cp, sp, -cy * cp];
  const r = [cy, 0, sy];
  const u = v3.cross(r, f);
  return { f, r, u };
}
function tanHalfY() {
  const a = R.width / R.height;
  const base = a >= 1 ? Math.tan(31 * PI / 180) : clamp(Math.tan(36 * PI / 180) / a, Math.tan(31 * PI / 180), 0.95);
  return base / S.zoom;
}
function screenRay(px, py) { // px,py in css pixels
  const rect = ui.canvas.getBoundingClientRect();
  const nx = ((px - rect.left) / rect.width) * 2 - 1, ny = 1 - ((py - rect.top) / rect.height) * 2;
  const th = tanHalfY(), a = R.width / R.height, { f, r, u } = camBasis();
  return v3.norm(v3.add(f, v3.add(v3.scale(r, nx * th * a), v3.scale(u, ny * th))));
}

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
  wall: [150, 150, 128], floor: [110, 85, 62], ceiling: [180, 175, 160], curtain: [120, 50, 45], wood: [120, 90, 64],
  door: [110, 80, 55], window: [20, 28, 40], fabric: [200, 195, 180], plastic: [30, 30, 32], paper: [170, 160, 130],
};
function tex(k, opt) {
  if (IMG[k]) return R.texture(IMG[k], opt);
  if (FALLBACK[k]) return R.texture(TX.noiseTex(FALLBACK[k], k.length), opt);
  return R.texture(TX.radialTex('rgba(200,200,210,0.9)', 'rgba(200,200,210,0)'), opt);
}

// ---------------------------------------------------------------- scene
function add(o) { objects.push(o); return o; }
function buildScene() {
  const T = {
    wall: tex('wall'), floor: tex('floor'), ceiling: tex('ceiling'), curtain: tex('curtain'), wood: tex('wood'),
    door: tex('door'), window: tex('window'), fabric: tex('fabric'), plastic: tex('plastic'), paper: tex('paper'),
    blob: R.texture(TX.radialTex('rgba(0,0,0,0.9)', 'rgba(0,0,0,0)')),
    halo: R.texture(TX.radialTex('rgba(255,210,150,1)', 'rgba(255,160,80,0)')),
    tvHalo: R.texture(TX.radialTex('rgba(150,190,255,1)', 'rgba(120,160,255,0)')),
  };
  const quad = R.mesh(plane(1, 1)), quadB = R.mesh(plane(1, 1, true));
  // dynamic textures
  tvScreen = new TX.TVScreen(IMG.face);
  O.tvTex = R.texture(tvScreen.draw(0, 1), { mips: false });
  clockCanvas = TX.canvas(256, 256);
  S.clock = { h: 12, m: 0 };
  TX.clockFaceTex(clockCanvas, S.clock.h, S.clock.m);
  O.clockTex = R.texture(clockCanvas);

  // material name -> texture / shading
  const MAT = {
    M_wall: { t: T.wall }, M_floor: { t: T.floor, spec: 0.25 }, M_ceiling: { t: T.ceiling }, M_wood: { t: T.wood, tint: [0.95, 0.9, 0.85], spec: 0.2 },
    M_wooddark: { t: T.wood, tint: [0.42, 0.36, 0.32], spec: 0.25 }, M_door: { t: T.door, spec: 0.12 }, M_curtain: { t: T.curtain, wrap: 0.4 },
    M_window: { t: T.window, unlit: true, tint: [0.3, 0.32, 0.4] }, M_tvscreen: { t: O.tvTex, unlit: true, key: 'screen' },
    M_clockface: { t: O.clockTex, key: 'clockface' }, M_bulb: { unlit: true, key: 'bulb' }, M_corridor: { unlit: true, key: 'corridor', tint: [0, 0, 0] },
    M_bag: { t: T.plastic, tint: [0.9, 0.9, 0.95], spec: 1.4 }, M_bagwhite: { spec: 0.9 }, M_paper: { t: T.paper, wrap: 0.3 }, M_cardboard: { t: T.paper, tint: [0.75, 0.6, 0.42] },
    M_dress: { t: T.fabric, wrap: 0.45, tint: [0.95, 0.95, 0.95], aoLift: 0.3 }, M_skin: { wrap: 0.35, spec: 0.3 }, M_hair: { spec: 1.6, wrap: 0.2, aoLift: 0.75 }, M_eye: { spec: 1.5, emissive: [0.05, 0.06, 0.06] },
    M_glassgreen: { spec: 2.0 }, M_can: { spec: 1.5 }, M_can2: { spec: 1.5 }, M_metal: { spec: 1.2 }, M_brass: { spec: 1.4 },
  };
  const NO_SHADOW = new Set(['floor', 'ceiling', 'wall_front', 'wall_back', 'wall_left', 'wall_right', 'trim', 'corridor', 'bulb', 'window_glass', 'clock_face', 'tv_screen']);
  O.nodes = {};
  const addNode = (node, pipe = 'opaque', ghost = false) => {
    const list = node.prims.map(pr => {
      const m = MAT[pr.material.name] || {};
      const c = pr.material.color;
      const tint = m.tint ? [...m.tint, 1] : m.t ? [1, 1, 1, 1] : [c[0], c[1], c[2], 1];
      const spec = m.spec ?? Math.min(1.2, (1 - pr.material.rough) ** 2 * 1.3);
      const o = add(R.object(R.mesh(pr.geo), m.t || null, {
        pipe, model: node.matrix.slice(), tint, emissive: [...(m.emissive || [0, 0, 0]), ghost ? (m.aoLift || 0) : 0],
        flags: [m.wrap ?? 0.1, m.unlit ? 1 : 0, spec, ghost ? 2 : 0], uvx: [1, 1, ghost && pr.material.name === 'M_hair' ? 1 : 0, 0],
        castShadow: !NO_SHADOW.has(node.name),
      }));
      o.matKey = m.key; o.base = node.matrix;
      if (m.key) O[m.key] = o;
      return o;
    });
    O.nodes[node.name] = list;
    return list;
  };
  for (const name in GLB.room) addNode(GLB.room[name]);
  O.ghostStand = addNode(GLB.ghost.ghost_stand, 'ghost', true);
  O.ghostCrouch = addNode(GLB.ghost.ghost_crouch, 'ghost', true);
  // decoys: extra copies without shadows
  O.decoys = [0, 1].map(() => {
    const st = addNode(GLB.ghost.ghost_stand, 'ghost', true), cr = addNode(GLB.ghost.ghost_crouch, 'ghost', true);
    [...st, ...cr].forEach(o => { o.castShadow = false; o.visible = false; });
    return { stand: st, crouch: cr };
  });
  O.nodes.ghost_stand = O.ghostStand; O.nodes.ghost_crouch = O.ghostCrouch;
  O.screen.flags = [0, 1, 0, 1]; O.screen.tint = [0.15, 0.15, 0.15, 1];
  // screen centre from its bounds
  const sp = GLB.room.tv_screen.prims[0];
  O.tvCenter = [(sp.min[0] + sp.max[0]) / 2, (sp.min[1] + sp.max[1]) / 2, sp.max[2]];
  O.tvHalo = add(R.object(quad, T.tvHalo, { pipe: 'add', model: m4.trs([O.tvCenter[0], O.tvCenter[1], -1.9], 0, [1.1, 0.9, 1]), flags: [0, 1, 0, 0], tint: [0.4, 0.5, 0.7, 0.12], clamp: true }));
  O.halo = add(R.object(quad, T.halo, { pipe: 'add', model: m4.ident(), flags: [0, 1, 0, 0], tint: [1, 0.8, 0.6, 0], clamp: true }));
  O.ghostShadow = add(R.object(quadB, T.blob, { pipe: 'blend', model: m4.ident(), tint: [1, 1, 1, 0], clamp: true, order: -1 }));

  // ---- decals (hints)
  const decal = (key, canvas, spot) => {
    const d = SPOTS[spot].decal;
    const o = add(R.object(quad, R.texture(canvas), { pipe: 'blend', model: m4.trs(d.p, d.yaw, [d.w, d.h, 1]), tint: [1, 1, 1, 0], clamp: true, emissive: [0.03, 0.0, 0.0, 0], flags: [0, 0, 0.3, 0] }));
    S.decals[key] = { o, alpha: 0, target: 0 };
  };
  decal('tally', TX.tallyTex(SOL.channel), 'window');
  digitSpots.forEach((sp, i) => decal('d' + i, TX.digitTex(SOL.code[digitOrder[i]], digitOrder[i], 17 + i * 13), sp));
  decal('hour', TX.clockHintTex(SOL.hour, SOL.minute, 'hour', 5), clockSpots[0]);
  decal('minute', TX.clockHintTex(SOL.hour, SOL.minute, 'minute', 8), clockSpots[1]);
  decal('glass', TX.glassTextTex(['나를 보면', '멈춰']), 'glass');
  decal('stop', TX.bloodTextTex(['나를 보면', '멈춰'], 21, 170), 'A');
  S.decals.glass.o.flags = [0, 1, 0, 0];

  // ---- story documents: the hidden backstory, told by objects
  const doc = (key, canvas, model, pipe = 'opaque') => {
    O.docCanvas = O.docCanvas || {}; O.docCanvas[key] = canvas;
    return (O[key + 'Obj'] = add(R.object(quad, R.texture(canvas), { pipe, model, clamp: true, flags: [0.3, 0, 0.15, 0], tint: [0.95, 0.95, 0.95, 1] })));
  };
  doc('calendar', TX.calendarTex(), m4.trs([0.85, 1.55, -2.486], 0, [0.38, 0.52, 1]));
  doc('drawing', TX.drawingTex(IMG.drawing), m4.trs([2.186, 1.22, 0.56], -PI / 2, [0.42, 0.42, 1], 0, 0.04));
  doc('note', TX.noteTex(), m4.trs([1.95, 0.762, -0.1], 1.9, [0.15, 0.19, 1], -PI / 2));
  doc('news', TX.newsTex(IMG.newspaper), m4.trs([0.02, 0.006, 1.92], 0.5, [0.36, 0.27, 1], -PI / 2));
  const sc = doc('scratch', TX.scratchTex(), m4.trs([0.62, 0.42, 2.527], PI, [0.34, 0.68, 1]), 'blend');
  sc.tint = [1, 1, 1, 0.9];
  O.led = (O.nodes.am_led || [])[0];
}

// ---- hidden backstory records
const RECORD_TOTAL = 7;
function record(key, html) {
  if (S.records.has(key)) return false;
  S.records.add(key);
  addMemo(`<b class="rec">기록 ${S.records.size}/${RECORD_TOTAL}</b> — ${html}`);
  return true;
}
function openDoc(key, title, caption, wide = false) {
  const src = O.docCanvas[key];
  openModal(`<h2>${title}</h2><img class="docimg${wide ? ' wide' : ''}" src="${src.toDataURL('image/jpeg', 0.85)}" alt="">
    <p class="hint doc">${caption}</p><div class="row"><button class="primary" data-close>닫기</button></div>`, 'docCard');
}
const TAPES = [
  ['m_tape1', '“수아야, 엄마야. 엄마 오늘도 좀 늦어. TV 켜 놨지? 채널 돌리지 말고… 얌전히 보고 있어.”'],
  ['m_tape2', '“문 두드리지 말라고 했지. 옆집에서 또 뭐라 그러잖아. …금방 갈게. 금방.”'],
  ['m_tape3', '“수아야… 엄마 너무 힘들어. …조금만, 조금만 더 기다려. 미안해.”'],
];
function playTape() {
  const i = Math.min(S.tape, TAPES.length - 1);
  const [id, text] = TAPES[i];
  snd.play('click', [1.81, 0.8, 0.12]);
  const n = ['첫', '두', '세'][i];
  after(0.4, () => {
    const d = snd.voice(id, [1.81, 0.8, 0.12], 1.1);
    sayNow(`📼 ${n} 번째 메시지 — ${text}`, Math.max(5, d + 1));
  });
  if (S.tape < TAPES.length) {
    S.tape++;
    if (S.tape === 1) record('tape', '자동응답기 — 엄마가 남긴 메시지들. 밤마다 “금방 갈게.”');
    if (S.tape === 3) after(10, () => say('…마지막 메시지의 날짜는 1999년 12월 24일.', 4));
  }
}
function playNews() {
  S.tv.mode = 'broadcast'; tvScreen.mode = 'broadcast'; tvScreen.showFace = false; tvScreen.lines = ['뉴스 속보', '303호 여아…'];
  const d = snd.voice('n_news', O.tvCenter, 1.2);
  sayNow('📺 “…빌라 303호에서 일곱 살 여자아이가 숨진 채 발견됐습니다. 아이는 밖에서 잠긴 방 안에 혼자 있었으며, 경찰은 3주째 연락이 닿지 않는 아이의 어머니를 찾고 있습니다.”', Math.max(8, d + 1));
  record('news', 'TV 11번 뉴스 — 밖에서 잠긴 방, 연락이 끊긴 어머니.');
  after(Math.max(8, d + 1), () => { if (S.stage === 'tv') { S.tv.mode = 'static'; tvScreen.mode = 'static'; } });
}

function placeDecal(key, spot) {
  const d = SPOTS[spot].decal, o = S.decals[key].o;
  o.model = m4.trs(d.p, d.yaw, [0.8, 0.4, 1]);
}
function setModel(list, m) { for (const o of list) o.model = m; }
function setVisible(list, v) { for (const o of list) o.visible = v; }
function setAlpha(list, a) { for (const o of list) o.tint[3] = a; }

// ---------------------------------------------------------------- ghost control
function showGhost(spot, opts = {}) {
  const s = SPOTS[spot];
  S.ghost = { spot, p: s.p.slice(), kind: s.kind, alpha: 0, target: 1, reveal: 0, revealed: false, seen: 0, twitch: 0, ...opts };
  snd.play('whisper', [s.p[0], 1.2, s.p[2]]);
}
function hideGhost(fast = false) {
  if (!S.ghost) return;
  S.ghost.target = 0; S.ghost.leaving = true;
  if (fast) S.ghost.alpha = 0;
}
// queue a ghost that only materialises where the player is NOT looking (forces a search)
function spawnHidden(spot, opts, minDelay = 0) {
  S.pending = { spot, opts, t: S.time + minDelay, give: S.time + minDelay + 14 };
}
function spotVisible(p, kind, margin = 1.05) {
  const { f } = camBasis();
  const head = [p[0], kind === 'crouch' ? 0.62 : 1.2, p[2]];
  const dir = v3.norm(v3.sub(head, EYE));
  const ang = Math.acos(clamp(v3.dot(dir, f), -1, 1));
  const th = tanHalfY(), a = R.width / R.height;
  return { ang, inView: ang < Math.atan(th * Math.min(a, 1.4)) * margin, centered: ang < Math.atan(th) * 0.55 };
}
function blink(dur = 0.6) { S.blackoutTarget = 1; after(dur, () => { S.blackoutTarget = 0; }); }

function jumpscare(after_) {
  if (S.time - S.lastScare < 3) return;
  S.lastScare = S.time;
  snd.play('scare');
  ui.scare.classList.remove('go'); void ui.scare.offsetWidth; ui.scare.classList.add('go');
  S.shake = 1; S.flash = 0.6; S.flashCol = [0.5, 0.05, 0.05]; S.glitch = 1;
  S.fear = 0.45; S.insanity = Math.min(S.insanity, 0.35); S.stare = 0;
  if (navigator.vibrate) try { navigator.vibrate([80, 40, 200]); } catch { }
  after_ && after(1.2, after_);
}

// ---------------------------------------------------------------- stages
const STAGES = {
  intro() {
    S.stage = 'intro';
    S.blackout = 1; S.blackoutTarget = 0;
    after(1.2, () => say('…어디지. 몸이 의자에 묶인 것처럼 무겁다.', 4));
    after(5.2, () => say('일어날 수가 없다. 고개만 돌릴 수 있다.', 3.5));
    after(9, () => { snd.voice('g_intro', [-2, 1.2, 0.3], 2.2); say('“엄마…? 왔어?” …왼쪽에서, 아이 목소리.', 4); });
    after(10, () => STAGES.tv());
  },
  tv() {
    S.stage = 'tv';
    objective('TV를 켜려면… 채널을 알아야 한다');
    blink(0.5);
    after(0.6, () => showGhost('window', { onReveal: () => {
      say(`벽에 긁힌 자국… ${SOL.channel >= 5 ? '다섯 개를 묶고, ' : ''}모두 ${SOL.channel}개.`, 4.5);
      addMemo(`<b>창가의 벽</b> — 긁힌 자국 <span class="tally">${'卌'.repeat(Math.floor(SOL.channel / 5))}${'|'.repeat(SOL.channel % 5)}</span>`);
      after(4, () => say('TV를 살펴보자.', 3));
      objective('TV 채널을 맞춘다');
    }, decal: 'tally' }));
    after(2, () => { if (!S.flags.zoomTip) { S.flags.zoomTip = 1; say('창가에 누군가 서 있다. 가까이 보려면 확대해서 응시하자.', 5); } });
    after(8, () => showZoomTip());
  },
  broadcast() {
    S.stage = 'broadcast'; objective('');
    after(14.5, () => snd.voice('g_wait', O.tvCenter, 2.0));
    hideGhost(); S.tv.mode = 'broadcast';
    tvScreen.mode = 'broadcast'; tvScreen.showFace = true; tvScreen.lines = ['…'];
    snd.play('sting');
    const seq = [['나를'], ['네 번'], ['찾아줘'], ['점이', '순서야'], ['서랍 속에', '내가 있어']];
    seq.forEach((l, i) => after(1.8 + i * 2.4, () => { tvScreen.lines = l; snd.play('static', O.tvCenter); }));
    after(1.8 + seq.length * 2.4 + 0.5, () => {
      addMemo('<b>TV 속 글자</b> — “나를 네 번 찾아줘. 점이 순서야. 서랍 속에 내가 있어.”');
      say('TV에 글자가… “나를 네 번 찾아줘. 점이 순서야.”', 5);
      tvScreen.lines = ['찾아줘']; tvScreen.showFace = false;
      STAGES.digits(0);
    });
  },
  digits(i) {
    S.stage = 'digits'; checkpoint(i >= 4 ? 'drawer' : 'digits', i);
    objective(`그 애를 찾는다 (${i}/4)`);
    if (i >= 4) {
      objective('책상 서랍의 자물쇠 (숫자 네 자리)');
      after(1.5, () => say('숫자 네 개… 서랍 자물쇠의 비밀번호다. 점이 자리를 가리킨다.', 5));
      S.stage = 'drawer';
      return;
    }
    const spot = digitSpots[i];
    if (i === 1) after(3, () => say('소리가 나는 쪽을 찾아야 한다. 화면 가장자리가 붉어지는 쪽에 그 애가 있다.', 5));
    spawnHidden(spot, { decal: 'd' + i, onReveal: () => {
      const pos = digitOrder[i], dots = [0, 1, 2, 3].map(k => k === pos ? '●' : '○').join('');
      addMemo(`<b>피로 쓴 숫자</b> — <span class="dots">${dots}</span> <span class="big">${SOL.code[pos]}</span>`);
      say(`피로 쓴 숫자 ${SOL.code[pos]}… 아래에 점 네 개. ${pos + 1}번째가 칠해져 있다.`, 4.5);
      if (i === 0) snd.voice('g_found', [S.ghost.p[0], 1.1, S.ghost.p[2]], 2.4);
      if (i === 2) after(3, () => { snd.voice('g_why', [S.ghost ? S.ghost.p[0] : 0, 1.1, S.ghost ? S.ghost.p[2] : 0], 2.2); say('“엄마… 왜 안 왔어?”', 3.5); });
      after(2.5, () => { hideGhost(); after(1.2, () => STAGES.digits(i + 1)); });
    } }, i === 0 ? 3 : rnd(6, 10));
  },
  drawerOpened() {
    S.stage = 'clockWait'; objective('');
    snd.play('drawer', [1.6, 0.65, -0.3]);
    S.flags.drawer = 1;
    after(0.9, () => openItem());
  },
  clock(i = 0) {
    S.stage = 'clock'; checkpoint(i >= 2 ? 'clockSet' : 'clock', i);
    objective(`멈춘 벽시계 — 그 애가 사라진 시각 (${i}/2)`);
    if (i >= 2) {
      objective('벽시계를 그 시각에 맞춘다');
      after(1, () => say('짧은 바늘과 긴 바늘… 벽시계를 그 시각으로 맞추자.', 4.5));
      S.stage = 'clockSet';
      return;
    }
    const spot = clockSpots[i], key = i === 0 ? 'hour' : 'minute';
    spawnHidden(spot, { decal: key, onReveal: () => {
      addMemo(`<b>벽에 그린 시계</b> — ${key === 'hour' ? '짧은 바늘' : '긴 바늘'}만 그려져 있다 <canvas class="mini" data-h="${SOL.hour}" data-m="${SOL.minute}" data-w="${key}"></canvas>`);
      say(key === 'hour' ? '벽에 시계가… 짧은 바늘만 그려져 있다.' : '이번엔 긴 바늘만 그려진 시계.', 4);
      after(2.5, () => { hideGhost(); after(1, () => STAGES.clock(i + 1)); });
    } }, rnd(6, 9));
  },
  clockDone() {
    S.stage = 'curtain'; objective('');
    snd.play('chime', [2.1, 1.85, -0.3]);
    say('시계가 다시 움직이기 시작했다…', 3.5);
    after(1.5, () => { snd.voice('g_clock', [2.0, 1.8, -0.3], 2.2); say('“시계가 멈췄을 때… 나도 멈췄어.”', 4); });
    after(4, () => { snd.play('curtain', [-2.1, 1.5, -0.6]); S.curtainTarget = 1; say('커튼이… 저절로 열린다.', 3.5); });
    after(10, () => STAGES.real());
  },
  real() {
    S.stage = 'real'; checkpoint('real');
    S.tv.mode = 'broadcast'; tvScreen.mode = 'broadcast'; tvScreen.showFace = false;
    snd.play('static', O.tvCenter);
    const lines = [['셋 중에'], ['하나만'], ['나야'], ['그림자 없는 건', '내가 아니야']];
    lines.forEach((l, k) => after(k * 2.2, () => { tvScreen.lines = l; snd.play('static', O.tvCenter); }));
    after(1, () => say('TV가 저절로 켜졌다… “셋 중에 하나만 나야. 그림자 없는 건 내가 아니야.”', 6));
    after(9, () => {
      addMemo('<b>TV 속 글자</b> — “셋 중에 하나만 나야. 그림자 없는 건 내가 아니야.”');
      objective('진짜 그 애를 찾는다 — 발밑에 그림자가 있는 쪽');
      blink(1.2); S.bulbBurst = 0;
      after(1.0, () => {
        const pool = shuffle(['A', 'B', 'C', 'D', 'E', 'F']);
        const real = pool[0];
        placeDecal('stop', real);
        showGhost(real, { decal: 'stop', onReveal: () => {
          addMemo('<b>진짜 그 애의 벽</b> — “나를 보면 멈춰”');
          say('벽에 피로… “나를 보면 멈춰.”', 5);
          S.decoys.forEach(d => { d.target = 0; });
          after(3, () => { hideGhost(); after(1.5, () => STAGES.chase()); });
        } });
        S.decoys = pool.slice(1, 3).map((sp, k) => ({ spot: sp, p: SPOTS[sp].p.slice(), kind: SPOTS[sp].kind, alpha: 0, target: 1, stare: 0, objs: O.decoys[k][SPOTS[sp].kind] }));
        snd.play('giggle', [SPOTS[pool[1]].p[0], 1, SPOTS[pool[1]].p[2]]);
        after(1.5, () => say('…셋이다. 방 안에 그 애가 셋.', 4));
        after(3.5, () => { snd.voice('g_three', null, 1.6); say('“누가 진짜 나게?”', 3); });
      });
    });
  },
  chase() {
    S.stage = 'chase'; checkpoint('chase'); S.flags.glassSeen = 1; S.decoys = [];
    snd.play('pop', [0, 2.1, -0.6]); S.bulbDead = true; S.flash = 0.4; S.flashCol = [1, 0.8, 0.5];
    snd.playMusic('music_chase', 1.5);
    S.tv.mode = 'static'; tvScreen.mode = 'static';
    objective('문을 연다 — 문을 향해 길게 눌러 열쇠를 돌린다');
    say('전구가 터졌다. 창가에… 그 애가 서 있다.', 3);
    after(2.5, () => { snd.voice('g_turn', SPOTS.glass.p.map((v, k) => k === 1 ? 1.2 : v), 2.4); say('“이번엔… 엄마가 기다려.”', 3.5); });
    after(6.5, () => say('엄마…? 나를 보고 하는 말이다. 문을 열어야 한다. 등 뒤를 조심해.', 5));
    S.chase = { p: SPOTS.glass.p.slice(), stepT: 0, steps: 0 };
    showGhost('glass', { chase: true });
  },
  end() {
    S.stage = 'end'; clearSave(); snd.stopMusic(3); S.ending = true; objective('');
    hideGhost(true); S.chase = null;
    snd.play('unlock', [0.7, 1, 2.4]); after(0.5, () => snd.play('creak', [0.7, 1, 2.4]));
    say('딸깍.', 2);
    S.doorLight = 0.001; S.doorOpenT = 1;
    after(3.2, () => { ui.fade.classList.add('white'); });
    after(6.5, () => showEnding());
  },
};

function showZoomTip() {
  if (S.flags.zoomTipShown || !S.ghost || S.ghost.revealed) return;
  S.flags.zoomTipShown = 1;
  const touch = matchMedia('(pointer: coarse)').matches;
  say(touch ? '오른쪽 아래 👁 버튼을 누르고 있거나, 두 손가락으로 벌려 확대한다.' : '마우스 오른쪽 버튼을 누르고 있거나 휠로 확대한다.', 6);
}

// ---------------------------------------------------------------- interactions
const INTERACT = [
  { id: 'tv', label: 'TV', min: [-0.45, 0.5, -2.47], max: [0.45, 1.1, -1.94] },
  { id: 'drawer', label: '책상 서랍', min: [1.5, 0.52, -0.56], max: [1.66, 0.74, -0.04] },
  { id: 'desk', label: '책상', min: [1.5, 0, -0.9], max: [2.2, 0.5, 0.3] },
  { id: 'machine', label: '자동응답기', min: [1.68, 0.74, 0.02], max: [1.94, 0.87, 0.22] },
  { id: 'note', label: '쪽지', min: [1.84, 0.74, -0.22], max: [2.06, 0.8, 0.02] },
  { id: 'calendar', label: '달력', min: [0.63, 1.27, -2.5], max: [1.07, 1.83, -2.4] },
  { id: 'drawing', label: '크레용 그림', min: [2.08, 0.99, 0.33], max: [2.2, 1.45, 0.79] },
  { id: 'news', label: '신문 조각', min: [-0.22, 0, 1.76], max: [0.26, 0.12, 2.08] },
  { id: 'clock', label: '벽시계', min: [2.05, 1.62, -0.53], max: [2.2, 2.08, -0.07] },
  { id: 'door', label: '문', min: [0.12, 0, 2.4], max: [1.28, 2.12, 2.62] },
  { id: 'curtain', label: '커튼', min: [-2.2, 0.55, -1.45], max: [-1.98, 2.2, 0.25] },
  { id: 'lamp', label: '전구', min: [-0.15, 1.9, -0.75], max: [0.15, 2.6, -0.45] },
  { id: 'trash', label: '쓰레기', min: [1.0, 0, -2.5], max: [2.2, 0.7, -1.5] },
  { id: 'trash', label: '쓰레기', min: [1.1, 0, 1.5], max: [2.2, 0.7, 2.5] },
  { id: 'trash', label: '쓰레기', min: [-2.2, 0, 0.5], max: [-1.3, 0.55, 1.4] },
  { id: 'trash', label: '쓰레기', min: [-2.2, 0, -2.5], max: [-0.6, 0.5, -1.7] },
  { id: 'trash', label: '쓰레기', min: [-0.8, 0, 1.85], max: [0.1, 0.5, 2.5] },
];
function hitTest(dir) {
  let best = null, bd = 1e9;
  for (const it of INTERACT) {
    const t = rayAABB(EYE, dir, it.min, it.max);
    if (t >= 0 && t < bd) { bd = t; best = it; }
  }
  // ghost blocks nothing, but walls do: ignore hits farther than 6m
  return best && bd < 6 ? best : null;
}

function interact(it) {
  if (!it || S.paused || S.ending) return;
  snd.play('click');
  switch (it.id) {
    case 'tv':
      if (S.stage === 'tv' || S.stage === 'intro') openChannel();
      else if (S.tv.mode === 'broadcast') say('화면 속 글자가 번져 있다. “찾아줘”', 3);
      else say('지직거리는 화면. 아무것도 나오지 않는다.', 3);
      break;
    case 'drawer': case 'desk':
      if (S.flags.drawer) say('서랍은 비어 있다. 바닥에 손톱자국이 있다.', 3.5);
      else if (S.stage === 'tv' || S.stage === 'intro' || S.stage === 'broadcast') say('작은 서랍. 숫자 네 자리 자물쇠가 걸려 있다.', 3.5);
      else openKeypad();
      break;
    case 'clock':
      if (S.stage === 'clockSet' || S.stage === 'clock') openClock();
      else if (S.flags.clockDone) say('시계가 다시 째깍거린다.', 2.5);
      else say(`멈춘 벽시계. ${S.clock.h}시 ${String(S.clock.m).padStart(2, '0')}분에서 움직이지 않는다.`, 3.5);
      break;
    case 'machine': playTape(); break;
    case 'note':
      openDoc('note', '책상 위의 쪽지', '어른의 글씨. 맨 아래에 크레용으로 작게 — “안 두드릴게 빨리 와”');
      record('note', '엄마의 쪽지 — “문 두드리면 엄마 진짜 화낸다. 11번(뉴스)은 보지 마.”');
      break;
    case 'calendar':
      openDoc('calendar', '1999년 12월', '4일부터 하루도 빠짐없이 X. 24일엔 동그라미 — “엄마 오는 날?” 25일부터는 파란 X.');
      record('calendar', '달력 — 12월 4일부터 매일 X. 24일 “엄마 오는 날?”');
      break;
    case 'drawing':
      openDoc('drawing', '크레용 그림', '의자에 앉은 여자아이, TV, 자물쇠가 달린 문. 문밖으로 걸어가는 얼굴 없는 여자.');
      record('drawing', '크레용 그림 — “엄마 언제 와?” 문에는 자물쇠, 문밖엔 떠나는 여자.');
      break;
    case 'news':
      openDoc('news', '신문 조각', '2000년 1월 14일자. 사진 속 현관문에… 이 방 번호가 보인다.', true);
      record('newspaper', '신문 — “빌라 303호 7세 여아 숨진 채 발견”');
      break;
    case 'door':
      if (!S.records.has('scratch') && S.stage !== 'chase') {
        say('문 안쪽, 아이 키 높이까지… 손톱자국이 빼곡하다. 밖에서 잠긴 문이었다.', 5);
        record('scratch', '문 안쪽의 손톱자국 — 아이 키 높이. 문은 밖에서 잠겨 있었다.');
        break;
      }
      if (S.stage === 'chase') say('문을 향한 채로 길게 누르고 있으면 열쇠를 돌린다.', 3);
      else if (S.inventory.includes('key')) { snd.play('knock', [0.7, 1.2, 2.6]); say('열쇠 구멍이 녹슬어 있다. 아직은… 무언가 문을 막고 있다.', 4); }
      else { snd.play('bang', [0.7, 1.2, 2.6]); say('잠긴 문. 반대편에서 누군가 쾅 쳤다.', 3.5); addFear(0.1); }
      break;
    case 'curtain':
      if (S.curtainOpen > 0.5) say('김 서린 창문. 작은 손자국들.', 3);
      else say('커튼이 꿈쩍도 않는다. 반대편에서 누가 붙잡고 있는 것처럼.', 3.5);
      break;
    case 'lamp': say(S.bulbDead ? '깨진 전구.' : '전구가 지직거리며 깜빡인다.', 2.5); break;
    case 'trash': say(pick(['썩은 냄새. 컵라면 용기와 소주병.', '팔 하나가 없는 인형이 섞여 있다.', '신문 날짜가… 20년 전이다.', '누군가 오래 여기 갇혀 있었던 것 같다.']), 3); break;
  }
}

// ---------------------------------------------------------------- modals
function openModal(html, cls = '') {
  S.paused = true;
  ui.card.className = 'card ' + cls;
  ui.card.innerHTML = html;
  ui.modal.classList.add('show');
  const close = ui.card.querySelector('[data-close]');
  close && close.addEventListener('click', closeModal);
}
function closeModal() { ui.modal.classList.remove('show'); S.paused = !S.started; if (S.started) S.paused = false; snd.play('click'); }

function openChannel() {
  let ch = S.tv.channel;
  openModal(`
    <h2>TV 채널</h2>
    <div class="dial"><button data-d="-1">◀</button><div class="num" id="chNum">${String(ch).padStart(2, '0')}</div><button data-d="1">▶</button></div>
    <p class="hint">채널을 돌린 뒤 [맞추기]</p>
    <div class="row"><button class="ghostbtn" data-close>닫기</button><button class="primary" id="chOk">맞추기</button></div>`, 'channel');
  ui.card.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => {
    ch = ((ch - 1 + (+b.dataset.d) + 12) % 12) + 1;
    $('#chNum').textContent = String(ch).padStart(2, '0'); snd.play('tick');
    S.tv.channel = ch; tvScreen.channel = ch; tvScreen.osd = 2; snd.play('static', O.tvCenter);
  }));
  $('#chOk').addEventListener('click', () => {
    closeModal();
    tvScreen.channel = ch; tvScreen.osd = 3;
    if (ch === SOL.channel && S.stage === 'tv') STAGES.broadcast();
    else if (ch === 11) playNews();
    else { snd.play('static', O.tvCenter); S.glitch = 0.6; addFear(0.08); say(pick(['지직… 아무것도 없다.', '화면 속에서 누가 웃은 것 같다.', '모래 폭풍 같은 화면뿐.']), 3); }
  });
}

function openKeypad() {
  let code = '';
  const render = () => { $('#kpDisp').innerHTML = [0, 1, 2, 3].map(i => `<span>${code[i] ?? '·'}</span>`).join(''); };
  openModal(`
    <h2>서랍 자물쇠</h2>
    <div class="kpdisp" id="kpDisp"></div>
    <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, '←'].map(k => `<button data-k="${k}">${k}</button>`).join('')}</div>
    <div class="row"><button class="ghostbtn" data-close>닫기</button><button class="primary" id="kpOk">열기</button></div>`, 'keypadCard');
  render();
  ui.card.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.k; snd.play('beep');
    if (k === 'C') code = ''; else if (k === '←') code = code.slice(0, -1); else if (code.length < 4) code += k;
    render();
  }));
  $('#kpOk').addEventListener('click', () => {
    if (code === SOL.code.join('') && S.stage === 'drawer') { closeModal(); STAGES.drawerOpened(); }
    else {
      snd.play('wrong'); addFear(0.07); ui.card.classList.remove('shake'); void ui.card.offsetWidth; ui.card.classList.add('shake');
      code = ''; render();
      if (S.stage !== 'drawer') $('#kpDisp').insertAdjacentHTML('afterend', '<p class="hint warn">아직 숫자를 다 모으지 못했다.</p>');
    }
  });
}

function openItem() {
  S.inventory.push('key', 'photo');
  openModal(`
    <h2>서랍 속</h2>
    <div class="items">
      <figure><img src="assets/polaroid.webp" alt=""><figcaption>빛바랜 폴라로이드. 얼굴이 긁혀 있다.<br>뒷면: <i>“수아 — 그 애가 사라진 시각에 시계가 멈췄다”</i></figcaption></figure>
      <figure><img src="assets/key.webp" alt=""><figcaption>녹슨 열쇠.</figcaption></figure>
    </div>
    <div class="row"><button class="primary" data-close>가져간다</button></div>`, 'itemCard');
  addMemo('<b>폴라로이드 뒷면</b> — “수아 — 그 애가 사라진 시각에 시계가 멈췄다”');
  ui.card.querySelector('[data-close]').addEventListener('click', () => {
    S.flags.gotItems = 1;
    after(1.5, () => { snd.play('tick', [2.1, 1.85, -0.3]); say('…째깍. 벽시계에서 한 번 소리가 났다.', 3.5); });
    after(4, () => STAGES.clock(0));
  }, { once: true });
}

function openClock() {
  let h = S.clock.h, m = S.clock.m;
  openModal(`
    <h2>벽시계</h2>
    <canvas id="clkPrev" width="220" height="220"></canvas>
    <div class="clockctl">
      <div><span>시</span><button data-a="h-">−</button><b id="clkH"></b><button data-a="h+">+</button></div>
      <div><span>분</span><button data-a="m-">−</button><b id="clkM"></b><button data-a="m+">+</button></div>
    </div>
    <div class="row"><button class="ghostbtn" data-close>닫기</button><button class="primary" id="clkOk">맞추기</button></div>`, 'clockCard');
  const draw = () => {
    TX.clockFaceTex($('#clkPrev'), h, m);
    $('#clkH').textContent = h; $('#clkM').textContent = String(m).padStart(2, '0');
  };
  draw();
  ui.card.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => {
    const a = b.dataset.a;
    if (a === 'h+') h = h % 12 + 1; if (a === 'h-') h = (h + 10) % 12 + 1;
    if (a === 'm+') m = (m + 5) % 60; if (a === 'm-') m = (m + 55) % 60;
    snd.play('tick'); draw();
  }));
  $('#clkOk').addEventListener('click', () => {
    S.clock = { h, m }; TX.clockFaceTex(clockCanvas, h, m); R.updateTexture(O.clockTex, clockCanvas);
    closeModal();
    if (h === SOL.hour && m === SOL.minute && S.stage === 'clockSet') { S.flags.clockDone = 1; STAGES.clockDone(); }
    else { snd.play('wrong'); addFear(0.08); say(S.stage === 'clock' ? '아직 무언가 부족하다. 그 애가 더 보여줄 것이다.' : '바늘이 제자리로 튕겨 돌아갔다… 틀렸다.', 3.5); }
  });
}

function openMemo() {
  ui.memoBtn.classList.remove('new');
  openModal(`<h2>메모</h2>${S.memo.length ? '<ul class="memo">' + S.memo.map(m => `<li>${m}</li>`).join('') + '</ul>' : '<p class="hint">아직 아무것도 없다.</p>'}
    <div class="row"><button class="primary" data-close>닫기</button></div>`, 'memoCard');
  ui.card.querySelectorAll('canvas.mini').forEach(c => {
    c.width = c.height = 120; const g = c.getContext('2d');
    const src = TX.clockHintTex(+c.dataset.h, +c.dataset.m, c.dataset.w, 3); g.drawImage(src, 0, 0, 120, 120);
  });
}
function openPause() {
  openModal(`<h2>일시정지</h2>
    <p class="hint">드래그: 둘러보기 · 길게 누르기/👁/우클릭/휠/두 손가락: 확대<br>물건을 탭하거나 가운데로 보고 버튼: 살펴보기</p>
    <div class="vols">${[['master', '전체'], ['music', '음악'], ['sfx', '효과음']].map(([k, l]) =>
      `<label><span>${l}</span><input type="range" min="0" max="1" step="0.05" value="${snd.vol[k]}" data-vol="${k}"></label>`).join('')}</div>
    <div class="row"><button class="ghostbtn" id="restartBtn">처음부터</button><button class="primary" data-close>계속</button></div>`);
  $('#restartBtn').addEventListener('click', () => { clearSave(); location.reload(); });
  ui.card.querySelectorAll('[data-vol]').forEach(r => r.addEventListener('input', () => snd.setVolume(r.dataset.vol, +r.value)));
}

function showEnding() {
  S.paused = true;
  const mins = Math.floor(S.time / 60), secs = Math.floor(S.time % 60);
  ui.ending.innerHTML = `
    <div class="endtext">
      <p>문밖 현관의 깨진 거울 속에, 스무 해만큼 늙은 여자가 서 있었다.</p>
      <p>수아의 엄마. — 나였다.</p>
      ${S.records.size >= RECORD_TOTAL ? '<p class="truth">1999년 12월 24일 밤, 나는 밖에서 문을 잠그고 나갔다. 금방 올 생각이었다.</p>' : ''}
      <p class="ch">CH ${String(SOL.channel).padStart(2, '0')}</p>
      <p class="whisper">“엄마… 또 와줘.”</p>
      <h1>응시</h1>
      <p class="stat">탈출 시간 ${mins}분 ${String(secs).padStart(2, '0')}초 · 찾은 기록 ${S.records.size}/${RECORD_TOTAL}${S.records.size < RECORD_TOTAL ? ' — 방 안엔 아직 숨겨진 것이 있다' : ''}</p>
      <button class="primary" onclick="localStorage.removeItem('gaze-save-v1'); location.reload()">다시 하기</button>
    </div>`;
  ui.ending.classList.add('show');
  snd.play('static');
  setTimeout(() => snd.voice('g_end', null, 2.2), 7200);
}

// ---------------------------------------------------------------- input
const pointers = new Map();
let pinchDist = 0, dragInfo = null;
// ---------------------------------------------------------------- gyroscope
// Device orientation is turned into a camera forward vector; only the change between events is
// applied, so gyro and finger dragging can be used together.
const GYRO_KEY = 'gaze-gyro';
const gyro = { on: false, last: null, got: false };
function deviceForward(e) {
  const d = Math.PI / 180;
  const a = (e.alpha || 0) * d, b = (e.beta || 0) * d, g = (e.gamma || 0) * d;
  const orient = ((screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0) * d;
  // quaternion from euler (b, a, -g) order YXZ
  const c1 = Math.cos(b / 2), c2 = Math.cos(a / 2), c3 = Math.cos(-g / 2);
  const s1 = Math.sin(b / 2), s2 = Math.sin(a / 2), s3 = Math.sin(-g / 2);
  let q = [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
  const qm = (p, r) => [
    p[3] * r[0] + p[0] * r[3] + p[1] * r[2] - p[2] * r[1],
    p[3] * r[1] - p[0] * r[2] + p[1] * r[3] + p[2] * r[0],
    p[3] * r[2] + p[0] * r[1] - p[1] * r[0] + p[2] * r[3],
    p[3] * r[3] - p[0] * r[0] - p[1] * r[1] - p[2] * r[2]];
  q = qm(q, [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);          // camera looks out of the back of the screen
  q = qm(q, [0, 0, Math.sin(-orient / 2), Math.cos(-orient / 2)]); // screen rotation
  // rotate (0,0,-1)
  const [x, y, z, w] = q;
  const f = [-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y))];
  return { yaw: Math.atan2(f[0], -f[2]), pitch: Math.asin(clamp(f[1], -1, 1)) };
}
function onOrientation(e) {
  if (!gyro.on || e.alpha == null) return;
  gyro.got = true;
  const cur = deviceForward(e);
  if (gyro.last && !S.paused) {
    let dy = cur.yaw - gyro.last.yaw;
    if (dy > Math.PI) dy -= 2 * Math.PI; else if (dy < -Math.PI) dy += 2 * Math.PI;
    // yaw is unstable when the phone points straight up/down
    if (Math.abs(cur.pitch) < 1.35 && Math.abs(dy) < 1.2) S.yaw += dy;
    const dp = cur.pitch - gyro.last.pitch;
    if (Math.abs(dp) < 1.2) S.pitch = clamp(S.pitch + dp, -1.2, 1.1);
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
  // re-anchor after rotating the screen so the view doesn't jump
  addEventListener('orientationchange', () => { gyro.last = null; });
  screen.orientation?.addEventListener?.('change', () => { gyro.last = null; });
}

function setupInput() {
  const cv = ui.canvas;
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.button === 2) { S.holdZoom = true; return; }
    if (pointers.size === 1) {
      dragInfo = { x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false, id: e.pointerId };
      if (S.stage === 'chase' && !S.paused) {
        const it = hitTest(screenRay(e.clientX, e.clientY));
        if (it && it.id === 'door') S.holding = true;
      }
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]; pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dragInfo) dragInfo.moved = true; S.holding = false;
    }
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
      if (Math.hypot(e.clientX - dragInfo.x0, e.clientY - dragInfo.y0) > 10) { dragInfo.moved = true; S.holding = false; }
      if (S.paused) return;
      const sens = (e.pointerType === 'touch' ? 0.0065 : 0.0045) * (tanHalfY() / Math.tan(31 * PI / 180)) ** 0.9;
      S.yaw += dx * sens; S.pitch = clamp(S.pitch - dy * sens, -1.2, 1.1);
    }
  });
  const up = e => {
    if (e.button === 2) S.holdZoom = false;
    const had = pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (had && dragInfo && dragInfo.id === e.pointerId) {
      if (!dragInfo.moved && performance.now() - dragInfo.t0 < 450 && !S.paused && S.stage !== 'chase') {
        interact(hitTest(screenRay(e.clientX, e.clientY)));
      }
      dragInfo = null;
    }
    S.holding = false;
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => { e.preventDefault(); S.zoomTarget = clamp(S.zoomTarget * Math.exp(-e.deltaY * 0.0015), 1, 4.5); }, { passive: false });

  const holdBtn = (el, on, off) => {
    el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); on(); });
    el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off);
    el.addEventListener('contextmenu', e => e.preventDefault());
  };
  holdBtn(ui.zoom, () => { S.holdZoom = true; ui.zoom.classList.add('on'); }, () => { S.holdZoom = false; ui.zoom.classList.remove('on'); });
  holdBtn(ui.action, () => {
    if (S.stage === 'chase' && S.target && S.target.id === 'door') S.holding = true;
    else interact(S.target);
  }, () => { S.holding = false; });
  ui.memoBtn.addEventListener('click', () => { if (S.started && !ui.modal.classList.contains('show')) openMemo(); });
  ui.pauseBtn.addEventListener('click', () => { if (S.started && !ui.modal.classList.contains('show')) openPause(); });

  const keys = new Set();
  addEventListener('keydown', e => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Space') { S.holdZoom = true; e.preventDefault(); }
    if (e.code === 'KeyE' || e.code === 'Enter') { if (S.stage === 'chase' && S.target?.id === 'door') S.holding = true; else interact(S.target); }
    if (e.code === 'Escape') { if (ui.modal.classList.contains('show')) closeModal(); else if (S.started) openPause(); }
    if (e.code === 'KeyM' || e.code === 'Tab') { e.preventDefault(); if (S.started) ui.modal.classList.contains('show') ? closeModal() : openMemo(); }
  });
  addEventListener('keyup', e => {
    keys.delete(e.code);
    if (e.code === 'Space') S.holdZoom = false;
    if (e.code === 'KeyE' || e.code === 'Enter') S.holding = false;
  });
  S.keys = keys;
}

// ---------------------------------------------------------------- update
function update(dt) {
  const t = S.time;
  // keyboard look
  const k = S.keys, ks = 1.6 * dt / Math.sqrt(S.zoom);
  if (!S.paused) {
    if (k.has('ArrowLeft') || k.has('KeyA')) S.yaw -= ks;
    if (k.has('ArrowRight') || k.has('KeyD')) S.yaw += ks;
    if (k.has('ArrowUp') || k.has('KeyW')) S.pitch = clamp(S.pitch + ks, -1.2, 1.1);
    if (k.has('ArrowDown') || k.has('KeyS')) S.pitch = clamp(S.pitch - ks, -1.2, 1.1);
  }
  const zt = S.holdZoom ? Math.max(S.zoomTarget, 3.2) : S.zoomTarget;
  S.zoom = damp(S.zoom, zt, 7, dt);

  // timers
  if (!S.paused) {
    S.time += dt;
    const due = S.timers.filter(x => x.t <= S.time); S.timers = S.timers.filter(x => x.t > S.time);
    due.forEach(x => x.fn());
  }
  if (subTimer > 0) { subTimer -= dt; if (subTimer <= 0) nextSub(); }

  S.blackout = damp(S.blackout, S.blackoutTarget, S.blackoutTarget > S.blackout ? 14 : 3, dt);
  S.flash = damp(S.flash, 0, 4, dt); S.shake = damp(S.shake, 0, 3, dt); S.glitch = damp(S.glitch, 0, 2.5, dt);
  S.curtainOpen = damp(S.curtainOpen, S.curtainTarget, 0.9, dt);
  S.drawerOpen = damp(S.drawerOpen, S.flags.drawer ? 1 : 0, 3, dt);
  if (S.doorLight > 0) S.doorLight = Math.min(S.doorLight + dt * 0.5, 3);
  S.doorOpen = damp(S.doorOpen || 0, S.doorOpenT || 0, 0.7, dt);

  // camera basis & targeting
  const { f } = camBasis();
  S.target = S.paused ? null : hitTest(f);
  const showAct = S.started && S.target && !S.paused && !S.ending;
  ui.action.classList.toggle('show', !!showAct);
  if (showAct) ui.action.textContent = S.stage === 'chase' && S.target.id === 'door' ? '길게 눌러 열쇠 돌리기' : `${S.target.label} 살펴보기`;

  // ---- ghost logic
  const g = S.ghost;
  let inView = false, centered = false, onScreen = 0;
  if (g) {
    const head = [g.p[0], g.kind === 'crouch' ? 0.62 : 1.2, g.p[2]];
    const dir = v3.norm(v3.sub(head, EYE));
    const cosA = v3.dot(dir, f), ang = Math.acos(clamp(cosA, -1, 1));
    const th = tanHalfY(), a = R.width / R.height;
    const halfDiag = Math.atan(th * Math.min(a, 1.4));
    inView = ang < halfDiag * 0.95 && g.alpha > 0.3;
    centered = ang < Math.atan(th) * 0.55;
    onScreen = inView ? 1 : 0;
    g.alpha = damp(g.alpha, g.target, g.target > g.alpha ? 2.5 : 5, dt);
    if (!S.paused && !g.leaving) {
      if (inView) {
        g.seen += dt;
        addFear(dt * (g.chase ? 0.06 : 0.045) * (0.6 + 0.45 * S.zoom));
      }
      // reveal the hint by staring zoomed
      if (g.decal && !g.revealed) {
        if (inView && centered && S.zoom > 2.1) {
          g.reveal += dt / 1.9;
          if (g.reveal >= 1) {
            g.revealed = true; snd.play('reveal'); S.flash = 0.15; S.flashCol = [0.4, 0.05, 0.05];
            g.onReveal && g.onReveal();
          }
        } else g.reveal = Math.max(0, g.reveal - dt * 0.15);
      }
    }
    if (g.decal) {
      const d = S.decals[g.decal];
      d.target = g.revealed ? 1 : smooth(0.05, 1, g.reveal) * 0.85;
    }
    if (g.leaving && g.alpha < 0.02) {
      if (g.decal) S.decals[g.decal].target = 0;
      S.ghost = null;
    }
  }
  for (const key in S.decals) {
    const d = S.decals[key];
    if (!S.ghost || S.ghost.decal !== key) d.target = key === 'glass' && S.flags.glassSeen ? 0.7 : 0;
    d.alpha = damp(d.alpha, d.target, d.target > d.alpha ? 3 : 0.5, dt);
    d.o.tint[3] = d.alpha;
  }
  if (S.ghost?.decal === 'glass' && S.ghost.revealed) S.flags.glassSeen = 1;

  // ---- pending hidden spawn
  if (S.pending && !S.paused && !S.ghost && S.time >= S.pending.t) {
    const pd = S.pending, sp = SPOTS[pd.spot];
    if (!spotVisible(sp.p, sp.kind, 1.25).inView || S.time > pd.give) {
      S.pending = null;
      blink(0.7);
      snd.play(pick(['knock', 'steps', 'giggle']), [sp.p[0], 1, sp.p[2]]);
      after(0.7, () => showGhost(pd.spot, pd.opts));
    }
  }
  // ---- help the player locate her: periodic sound from where she is
  if (S.ghost && !S.ghost.revealed && !S.ghost.leaving && !S.ghost.chase && !S.paused) {
    S.ghost.cueT = (S.ghost.cueT || 0) + dt * (inView ? 0 : 1);
    if (S.ghost.cueT > 6) { S.ghost.cueT = 0; snd.play(pick(['whisper', 'giggle', 'steps']), [S.ghost.p[0], 1, S.ghost.p[2]]); }
  }
  // ---- decoys dissolve when stared at
  for (const d of S.decoys) {
    d.alpha = damp(d.alpha, d.target, d.target > d.alpha ? 2.5 : 4, dt);
    if (S.paused || d.target === 0) continue;
    const v = spotVisible(d.p, d.kind, 0.95);
    if (v.inView && d.alpha > 0.3) addFear(dt * 0.035);
    if (v.centered && S.zoom > 2.1 && d.alpha > 0.5) {
      d.stare += dt;
      d.twitch = 1;
      if (d.stare > 1.1) {
        d.target = 0; S.glitch = 1.2; S.flash = 0.25; S.flashCol = [0.6, 0.6, 0.7];
        snd.play('static'); snd.play('giggle', [d.p[0], 1, d.p[2]]); addFear(0.2);
        say(pick(['…가짜다. 노이즈처럼 흩어졌다. 발밑에 그림자가 없었다.', '지지직— 그 애가 아니었다. 그림자가 없는 쪽이었다.']), 4);
      }
    } else d.stare = Math.max(0, d.stare - dt * 0.5);
  }
  S.decoys = S.decoys.filter(d => d.target > 0 || d.alpha > 0.02);

  // ---- insanity: staring at her slowly breaks the mind; looking away lets it heal
  if (!S.paused) {
    const seeing = inView || S.decoys.some(d => d.target > 0 && d.alpha > 0.3 && spotVisible(d.p, d.kind, 0.9).inView);
    S.stare = seeing ? S.stare + dt : Math.max(0, S.stare - dt * 2);
    const rate = seeing ? (0.03 + 0.05 * Math.min(S.stare / 5, 1)) * (0.7 + 0.3 * S.zoom) : -0.085;
    S.insanity = clamp(S.insanity + rate * dt, 0, 1);
    const I = S.insanity;
    if (I > 0.5 && S.started && !S.ending) {
      S.hallucT -= dt;
      if (S.hallucT <= 0) {
        S.hallucT = rnd(2, 4.5) * (1.4 - I);
        const w = pick(['보지 마', '뒤에 있어', '나를 봐', '같이 있자', '눈 감지 마', '수아야', '여기야', '왜 나를 봤어']);
        ui.halluc.textContent = w;
        ui.halluc.style.left = rnd(18, 82) + '%'; ui.halluc.style.top = rnd(18, 78) + '%';
        ui.halluc.classList.remove('go'); void ui.halluc.offsetWidth; ui.halluc.classList.add('go');
        if (Math.random() < 0.35) snd.voice(pick(['g_look', 'g_stay']), v3.add(EYE, [rnd(-1, 1), 0, rnd(-1, 1)]), 1.8);
        else snd.play('whisper', v3.add(EYE, [rnd(-1, 1), 0, rnd(-1, 1)]));
      }
    }
    if (I > 0.78 && Math.random() < dt * 0.7) S.invert = 1;
    if (I > 0.85 && Math.random() < dt * 0.3) { ui.scare.classList.remove('sub', 'go'); void ui.scare.offsetWidth; ui.scare.classList.add('sub'); }
  }
  S.invert = damp(S.invert, 0, 14, dt);

  // ---- chase: she steps closer whenever unseen
  if (S.stage === 'chase' && S.chase && S.ghost && !S.paused) {
    const c = S.chase;
    if (!inView) {
      c.stepT += dt;
      if (c.stepT > 1.1) {
        c.stepT = 0;
        const to = v3.sub([EYE[0], 0, EYE[2]], S.ghost.p); to[1] = 0;
        const dist = v3.len(to);
        if (dist < 0.75) { caught(); }
        else {
          const step = Math.min(0.26, dist - 0.6);
          S.ghost.p = v3.add(S.ghost.p, v3.scale(v3.norm(to), step));
          snd.play('steps', [S.ghost.p[0], 0.2, S.ghost.p[2]]);
          c.steps++;
        }
      }
    } else { c.stepT = Math.max(0, c.stepT - dt); S.ghost.twitch = 1; }
    // unlocking
    if (S.holding && S.target && S.target.id === 'door') {
      S.unlock += dt / 6;
      if (Math.random() < dt * 3) snd.play('click', [0.7, 1, 2.45]);
      if (S.unlock >= 1) { S.holding = false; STAGES.end(); }
    }
  }

  // fear overload
  if (S.fear >= 1 && !S.paused) {
    if (S.stage === 'chase') caught();
    else {
      jumpscare();
      if (S.ghost && !S.ghost.revealed) { const gg = S.ghost; hideGhost(true); after(3.5, () => { showGhost(gg.spot, { decal: gg.decal, onReveal: gg.onReveal, reveal: gg.reveal * 0.6 }); }); }
    }
  }
  if (!onScreen && !S.paused) S.fear = Math.max(0, S.fear - dt * (S.ghost && !S.ghost.chase ? 0.03 : 0.07));

  // ---- ambient events
  if (!S.paused && S.started && !S.ending) {
    S.events -= dt;
    if (S.events <= 0) {
      S.events = rnd(14, 26);
      const ev = pick(['knock', 'steps', 'burst', 'giggle', 'bang', 'swing', 'tv']);
      if (ev === 'knock') snd.play('knock', [0.7, 1.4, 2.7]);
      if (ev === 'steps') snd.play('steps', [rnd(-2, 2), 2.7, rnd(-2, 2)]);
      if (ev === 'burst') S.bulbBurst = rnd(0.6, 2);
      if (ev === 'giggle') snd.play('giggle', [rnd(-2, 2), 1, rnd(-2, 2)]);
      if (ev === 'bang' && S.stage !== 'chase') { snd.play('bang', [1.8, 0.6, -0.3]); }
      if (ev === 'swing') S.lampSwing = 1;
      if (ev === 'tv') { S.glitch = 0.8; snd.play('static', O.tvCenter); }
    }
  }

  // ---- lights
  S.bulbBurst = Math.max(0, S.bulbBurst - dt);
  S.lampSwing = Math.max(0, S.lampSwing - dt * 0.08);
  let bulb = 1;
  const flick = Math.sin(t * 13.1) * Math.sin(t * 7.3) + Math.sin(t * 29.7) * 0.3;
  if (flick > 0.93) bulb = 0.2;
  if (S.bulbBurst > 0) bulb = Math.random() < 0.45 ? 0.05 : rnd(0.4, 1.1);
  if (S.bulbDead) bulb = 0;
  S.bulb = damp(S.bulb ?? 1, bulb, 30, dt);
  // UI
  const rev = S.ghost && S.ghost.decal && !S.ghost.revealed ? S.ghost.reveal : 0;
  const chaseRing = S.stage === 'chase' ? S.unlock : 0;
  const ringV = Math.max(rev, chaseRing);
  ui.ring.classList.toggle('show', ringV > 0.01);
  ui.ringArc.style.strokeDashoffset = String(113 * (1 - ringV));
  ui.ring.classList.toggle('unlock', chaseRing > 0);
  ui.fear.style.transform = `scaleX(${S.fear})`;
  ui.hud.classList.toggle('fear', S.fear > 0.65);
  ui.cross.classList.toggle('hot', !!S.target);
  S.inView = inView;
}

function caught() {
  if (S.time - S.lastScare < 3) return;
  jumpscare(() => { say('…그 애는 창가로 돌아갔다. 열쇠가 조금 되감겼다. 가끔 뒤를 돌아봐야 한다.', 4.5); });
  S.unlock = Math.max(0, S.unlock - 0.25); S.holding = false;
  if (S.ghost) { S.ghost.p = SPOTS.glass.p.slice(); S.ghost.alpha = 0; }
  S.fear = 0.5;
}

// ---------------------------------------------------------------- render
const G = new Float32Array(80), PST = new Float32Array(32);
function frame(dt) {
  const t = S.time + performance.now() * 0; // eslint quiet
  const time = performance.now() / 1000;
  const { f, r, u } = camBasis();
  let eye = EYE;
  if (S.shake > 0.01) eye = v3.add(EYE, [(Math.random() - 0.5) * 0.05 * S.shake, (Math.random() - 0.5) * 0.05 * S.shake, 0]);
  const view = m4.view(eye, r, u, v3.scale(f, -1));
  const proj = m4.persp(tanHalfY(), R.width / R.height, 0.03, 30);
  G.set(m4.mul(proj, view), 0);

  // lamp swing (lamp + bulb nodes share the ceiling pivot as origin)
  const sw = 0.05 + S.lampSwing * 0.25;
  const ax = Math.sin(time * 1.3) * sw, az = Math.cos(time * 1.1) * sw * 0.7;
  const pivot = [0, RH, -0.6];
  const R0 = m4.trs(pivot, 0, [1, 1, 1], ax, az);
  setModel(O.nodes.lamp, R0); setModel(O.nodes.bulb, R0);
  const bulbPos = [R0[12] + R0[4] * -0.54, R0[13] + R0[5] * -0.54, R0[14] + R0[6] * -0.54];
  const B = S.bulb ?? 1;
  O.bulb.emissive = [B * 7, B * 5.2, B * 3.2, 0]; O.bulb.tint = [0.08, 0.07, 0.06, 1];
  O.halo.model = billboard(bulbPos, 0.55 + B * 0.2, true);
  O.halo.tint[3] = B * 0.22;
  snd.bulbPan && snd.setPos(snd.bulbPan, bulbPos);

  // TV
  const tvI = S.tv.mode === 'static' ? 0.85 + Math.random() * 0.3 : S.tv.mode === 'broadcast' ? 0.55 + Math.random() * 0.1 : 0;
  R.updateTexture(O.tvTex, tvScreen.draw(dt, S.tv.mode === 'broadcast' ? 0.5 : 1));
  O.screen.emissive = [0.9 * tvI, 0.95 * tvI, 1.15 * tvI, 1];
  O.tvHalo.tint[3] = 0.08 * tvI;

  // curtains gather towards their outer edge; folds bunch up
  const co = smooth(0, 1, S.curtainOpen);
  const cw = lerp(1, 0.3, co);
  for (const k of ['curtain_L', 'curtain_R']) {
    const base = O.nodes[k][0].base;
    setModel(O.nodes[k], m4.trs([base[12], base[13], base[14]], 0, [1 + co * 1.3, 1, cw]));
  }

  // drawer slides towards the player (-x)
  const dO = S.drawerOpen * 0.3;
  { const b0 = O.nodes.drawer[0].base; setModel(O.nodes.drawer, m4.trs([b0[12] - dO, b0[13], b0[14]])); }
  setVisible(O.nodes.drawer_lock, !S.flags.drawer);
  // answering machine LED blinks while messages are unheard
  if (O.led) { const on = S.tape < 3 && Math.sin(time * 5) > 0; O.led.emissive = on ? [3, 0.15, 0.08, 0] : [0.05, 0, 0, 0]; }
  if (O.scratchObj) O.scratchObj.visible = !(S.doorOpen > 0.02);

  // door swings outwards around the hinge
  { const b0 = O.nodes.door[0].base; setModel(O.nodes.door, m4.trs([b0[12], b0[13], b0[14]], -smooth(0, 1, S.doorOpen || 0) * 1.3)); }
  for (const o of O.nodes.corridor) o.emissive = [S.doorLight * 0.9, S.doorLight * 0.86, S.doorLight * 0.78, 0];

  // ghost (3D, always turns to face the player)
  const g = S.ghost;
  setVisible(O.ghostStand, false); setVisible(O.ghostCrouch, false); O.ghostShadow.tint[3] = 0;
  O.decoys.forEach(set => { setVisible(set.stand, false); setVisible(set.crouch, false); });
  S.decoys.forEach(d => {
    setVisible(d.objs, d.alpha > 0.005);
    let p = d.p;
    if (d.twitch > 0) { d.twitch = Math.max(0, d.twitch - dt * 2); if (Math.random() < 0.3) p = v3.add(p, [(Math.random() - 0.5) * 0.06, 0, (Math.random() - 0.5) * 0.06]); }
    const yaw = Math.atan2(EYE[0] - p[0], EYE[2] - p[2]) + Math.sin(time * 0.9 + p[0]) * 0.04;
    setModel(d.objs, m4.trs([p[0], 0, p[2]], yaw));
    setAlpha(d.objs, d.alpha * (0.85 + 0.15 * Math.sin(time * 23 + p[2] * 7)));
  });
  let ghostLight = 0, gpos = [0, -10, 0];
  if (g) {
    const list = g.kind === 'crouch' ? O.ghostCrouch : O.ghostStand;
    setVisible(list, g.alpha > 0.005);
    let p = g.p;
    if (g.twitch > 0 || S.glitch > 0.3) {
      g.twitch = Math.max(0, (g.twitch || 0) - dt * 3);
      if (Math.random() < 0.15) p = v3.add(p, [(Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.5) * 0.04]);
    }
    const yaw = Math.atan2(EYE[0] - p[0], EYE[2] - p[2]) + (g.kind === 'crouch' ? 0.2 : 0) + Math.sin(time * 0.7) * 0.03;
    const tilt = g.twitch > 0.5 && Math.random() < 0.3 ? (Math.random() - 0.5) * 0.12 : 0;
    setModel(list, m4.trs([p[0], 0, p[2]], yaw, [1, 1, 1], 0, tilt));
    setAlpha(list, g.alpha);
    O.ghostShadow.model = m4.trs([p[0], 0.006, p[2]], 0, [0.8, 0.6, 1], -PI / 2);
    O.ghostShadow.tint[3] = g.alpha * 0.6;
    ghostLight = g.alpha * (0.22 + 0.15 * Math.sin(time * 3));
    gpos = [p[0], g.kind === 'crouch' ? 0.7 : 1.3, p[2]];
  }

  const moon = lerp(0.18, 2.2, co);
  const amb = 0.018 + (S.bulbDead ? 0.004 : 0);
  G.set([eye[0], eye[1], eye[2], time], 16);
  G.set([bulbPos[0], bulbPos[1], bulbPos[2], 2.8 * B], 20);
  G.set([1.0, 0.72, 0.45, 0], 24);
  G.set([O.tvCenter[0], O.tvCenter[1], O.tvCenter[2] + 0.15, 1.6 * tvI], 28);
  G.set([0.55, 0.7, 1.0, 0], 32);
  G.set([-2.6, 1.75, -0.6, moon], 36);
  G.set([0.35, 0.45, 0.85, 0], 40);
  G.set([amb, amb * 1.05, amb * 1.35, 0.14], 44);
  G.set([S.fear, S.zoom, Math.max(S.glitch, S.fear > 0.7 ? (S.fear - 0.7) * 2 : 0, g?.twitch || 0), 0], 48);
  G.set([gpos[0], gpos[1], gpos[2], ghostLight], 52);
  const moonOwns = S.bulbDead;
  G.set([S.doorLight, S.shadowStrength ?? 1, 0, 0], 56);
  const shadowLight = moonOwns ? [-2.6, 1.75, -0.6] : [bulbPos[0], bulbPos[1] - 0.05, bulbPos[2]];
  G.set([...shadowLight, moonOwns ? 1 : 0], 60);

  // post
  const exposure = 1.45 * (1 + (S.zoom - 1) * 0.28);
  let cueX = 0, cueY = 0, cueS = 0;
  if (g && !S.inView && g.alpha > 0.3 && !g.leaving) {
    const d = v3.norm(v3.sub(gpos, EYE));
    cueX = v3.dot(d, r); cueY = -v3.dot(d, u);
    const l = Math.hypot(cueX, cueY) || 1; cueX /= l; cueY /= l; cueS = 0.9;
  }
  const beat = snd.beatAt ? Math.max(0, 1 - (snd.ctx.currentTime - snd.beatAt) * 3) : 0;
  PST.set([R.width, R.height, time, R.width / R.height], 0);
  PST.set([exposure, S.fear, S.blackout, 0.018 + S.fear * 0.04 + (S.zoom - 1) * 0.008], 4);
  PST.set([...S.flashCol, S.flash], 8);
  PST.set([cueX, cueY, cueS, beat], 12);
  PST.set([0.0025 + S.fear * 0.01 + S.glitch * 0.02, 0.07, 1.0 + S.fear * 0.35 - (S.zoom - 1) * 0.05, S.fear > 0.6 ? (S.fear - 0.6) * 2.5 + S.glitch : S.glitch], 16);
  // ghost head on screen, for the insanity swirl
  let gsx = 0.5, gsy = 0.5, gOn = 0;
  if (g && g.alpha > 0.2) {
    const VP = G, x = gpos[0], y = gpos[1], z = gpos[2];
    const cw = VP[3] * x + VP[7] * y + VP[11] * z + VP[15];
    if (cw > 0.05) {
      const cx = (VP[0] * x + VP[4] * y + VP[8] * z + VP[12]) / cw, cy = (VP[1] * x + VP[5] * y + VP[9] * z + VP[13]) / cw;
      if (Math.abs(cx) < 1.3 && Math.abs(cy) < 1.3) { gsx = cx * 0.5 + 0.5; gsy = 0.5 - cy * 0.5; gOn = 1; }
    }
  }
  const I = smooth(0.08, 1, S.insanity);
  PST.set([I, gsx, gsy, gOn], 20);
  PST.set([S.invert * 0.85, S.stare, 0, 0], 24);
  R.render(G, PST, objects, shadowLight);

  // audio listener
  snd.listener(EYE, f, u);
  snd.update(dt, {
    bulb: B, tvStatic: S.tv.mode === 'static' ? 1 : S.tv.mode === 'broadcast' ? 0.35 : 0, tvHum: S.tv.mode === 'broadcast' ? 1 : 0,
    ghost: g ? g.alpha : 0, ghostPos: gpos, fear: S.fear, insanity: S.insanity,
  });
}

// cylindrical billboard anchored at its bottom (or centred sphere-like halo)
function billboard(p, w, full = false, h = w) {
  const yaw = Math.atan2(EYE[0] - p[0], EYE[2] - p[2]);
  if (!full) return m4.trs(p, yaw, [w, h, 1]);
  const d = v3.sub(EYE, p), pitch = -Math.atan2(d[1], Math.hypot(d[0], d[2]));
  return m4.trs(p, yaw, [w, h, 1], pitch);
}

// ---------------------------------------------------------------- main
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  let w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  const maxPx = matchMedia('(pointer: coarse)').matches ? 1.5e6 : 2.4e6, s = Math.min(1, Math.sqrt(maxPx / (w * h)));
  w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
  R.resize(w, h);
}

async function main() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  try { R = await Renderer.create(ui.canvas, { shadowSize: coarse ? 512 : 1024 }); }
  catch (e) { ui.nogpu.classList.add('show'); ui.title.classList.add('hidden'); console.error(e); return; }
  R.device.lost.then(info => { console.error('device lost', info); ui.nogpu.querySelector('p').textContent = 'GPU 장치가 초기화되었습니다. 새로고침 해주세요.'; ui.nogpu.classList.add('show'); });
  await loadAll();
  buildScene();
  setupInput();
  setupGyro();
  resize(); addEventListener('resize', resize);
  ui.load.textContent = '헤드폰을 권장합니다';
  ui.start.disabled = false;
  ui.start.addEventListener('click', () => {
    snd.init(); snd.decodeAll(); snd.playMusic('music_room', 6);
    // the start tap is a user gesture, so iOS can ask for motion permission here
    let pref = null; try { pref = localStorage.getItem(GYRO_KEY); } catch { }
    if (document.documentElement.classList.contains('has-gyro') && pref === '1') setGyro(true);
    else if (document.documentElement.classList.contains('has-gyro') && pref === null) after(14, () => say('📱 위의 [자이로] 버튼을 누르면 폰을 움직여 둘러볼 수 있다.', 5));
    ui.title.classList.add('hidden'); ui.hud.classList.add('show');
    S.started = true; S.paused = false;
    try { document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => { }); } catch { }
    if (SAVE && ui.start.dataset.resume === '1') restore(SAVE); else { clearSave(); STAGES.intro(); }
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
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    requestAnimationFrame(loop);
    try { update(dt); frame(dt); } catch (e) { if (!loop.err) console.error(e); loop.err = e; window.__err = e.stack || String(e); }
  };
  requestAnimationFrame(loop);
  // debug hooks for automated checks
  window.__game = { S, SOL, STAGES, interact, showGhost, SPOTS, EYE, INTERACT, snd };
}
main();
