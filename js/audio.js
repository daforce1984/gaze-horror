// Procedural horror soundscape (WebAudio). No audio files needed.
const SAMPLES = ['knock', 'bang', 'creak', 'drawer', 'unlock', 'pop', 'static', 'steps', 'chime', 'giggle', 'giggle2',
  'whisper', 'whisper2', 'scare', 'scare2', 'curtain', 'buzz', 'tvloop', 'music_room', 'music_chase', 'song'];

const VOICES = ['c_intro', 'c_first', 'c_bring1', 'c_bring2', 'c_bring3', 'c_heavy', 'c_cold', 'c_cctv', 'c_doll', 'c_song',
  'c_wait', 'c_why', 'c_rope', 'c_turn', 'c_look', 'c_stay', 'c_found', 'c_clock', 'c_door', 'c_take', 'c_bye', 'c_end',
  'm_tape0', 'm_tape1', 'm_tape2', 'm_tape3', 'n_news',
  'hs_start', 'hs_count', 'hs_ready', 'hs_found1', 'hs_found2', 'hs_again', 'hs_hint', 'hs_wrong', 'hs_fail', 'hs_behind', 'hs_cheat', 'hs_closer', 'hs_under', 'hs_eyes', 'hs_song'];

export class Sound {
  constructor() {
    this.ctx = null; this.enabled = true; this.buf = {}; this.raw = {};
    this.vol = { master: 0.9, music: 0.55, sfx: 1 };
    try { Object.assign(this.vol, JSON.parse(localStorage.getItem('gaze-vol') || '{}')); } catch { }
  }

  // fetch the encoded files early (during the loading screen); decoding needs the AudioContext
  prefetch() {
    const list = [...SAMPLES.map(n => [n, `assets/audio/${n}.mp3`]), ...VOICES.map(n => [n, `assets/voice/${n}.mp3`])];
    return Promise.all(list.map(async ([n, url]) => {
      try { const r = await fetch(url); if (r.ok) this.raw[n] = await r.arrayBuffer(); } catch { }
    }));
  }
  stopVoices() {
    if (!this.ctx) return;
    for (const v of this.voices || []) { try { v.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); v.s.stop(this.ctx.currentTime + 0.2); } catch { } }
    this.voices = [];
  }
  // ElevenLabs voice line; positional when pos is given. Returns duration (s) or 0.
  voice(id, pos, gain = 1.6) {
    if (!this.ctx || !this.buf[id]) return 0;
    const dest = pos ? (() => { const p = this.panner(pos); p.connect(this.master); return p; })() : this.master;
    const s = this.ctx.createBufferSource(); s.buffer = this.buf[id];
    const g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(g).connect(dest); s.start();
    (this.voices = this.voices || []).push({ s, g });
    s.onended = () => { this.voices = this.voices.filter(v => v.s !== s); };
    this.duck(0.45, this.buf[id].duration + 0.5);
    return this.buf[id].duration;
  }
  async decodeAll() {
    await Promise.all(Object.entries(this.raw).map(async ([n, ab]) => {
      try { this.buf[n] = await this.ctx.decodeAudioData(ab.slice(0)); } catch (e) { console.warn('audio decode failed', n, e); }
    }));
    this.raw = {};
    this.startLoops();
  }
  setVolume(k, v) {
    this.vol[k] = v;
    try { localStorage.setItem('gaze-vol', JSON.stringify(this.vol)); } catch { }
    if (!this.ctx) return;
    this.main.gain.value = this.vol.master; this.master.gain.value = this.vol.sfx; this.musicBus.gain.value = this.vol.music;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) { this.enabled = false; return; }
    const ctx = this.ctx = new C();
    // buses: sfx (this.master) + music -> main -> compressor
    this.main = ctx.createGain(); this.main.gain.value = this.vol.master;
    this.master = ctx.createGain(); this.master.gain.value = this.vol.sfx;
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.vol.music;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(this.main); this.musicBus.connect(this.main); this.main.connect(comp); comp.connect(ctx.destination);
    document.addEventListener('visibilitychange', () => { document.hidden ? ctx.suspend() : ctx.resume(); });
    this.white = this.noiseBuf('white'); this.brown = this.noiseBuf('brown');

    // room tone + drone
    const room = this.loop(this.brown); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
    this.roomGain = ctx.createGain(); this.roomGain.gain.value = 0.35;
    room.connect(lp).connect(this.roomGain).connect(this.master);
    this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0.0;
    const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 400;
    for (const f of [43.6, 44.1, 65.4, 92.5]) {
      const o = ctx.createOscillator(); o.type = f > 60 ? 'triangle' : 'sawtooth'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = f > 60 ? 0.05 : 0.08; o.connect(g).connect(dl); o.start();
    }
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 180;
    lfo.connect(lg).connect(dl.frequency); lfo.start();
    dl.connect(this.droneGain).connect(this.master);

    // bulb buzz (positional)
    this.bulbPan = this.panner([0, 2.1, -0.6]);
    const buzz = ctx.createOscillator(); buzz.type = 'sawtooth'; buzz.frequency.value = 120;
    const bb = ctx.createBiquadFilter(); bb.type = 'bandpass'; bb.frequency.value = 1400; bb.Q.value = 3;
    this.buzzGain = ctx.createGain(); this.buzzGain.gain.value = 0;
    buzz.connect(bb).connect(this.buzzGain).connect(this.bulbPan).connect(this.master); buzz.start();

    // TV static (positional)
    this.tvPan = this.panner([0, 0.8, -2.0]);
    const st = this.loop(this.white); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    this.tvGain = ctx.createGain(); this.tvGain.gain.value = 0;
    st.connect(hp).connect(this.tvGain).connect(this.tvPan).connect(this.master);
    // TV hum/tone for broadcast
    const hum = ctx.createOscillator(); hum.type = 'sine'; hum.frequency.value = 15625 / 16;
    this.humGain = ctx.createGain(); this.humGain.gain.value = 0;
    hum.connect(this.humGain).connect(this.tvPan); hum.start();

    // ghost breathing / whisper (positional)
    this.ghostPan = this.panner([0, 1, 0]);
    const wn = this.loop(this.white); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 6;
    const wl = ctx.createOscillator(); wl.frequency.value = 3.1; const wlg = ctx.createGain(); wlg.gain.value = 500;
    wl.connect(wlg).connect(bp.frequency); wl.start();
    const breath = this.loop(this.brown); const bl = ctx.createBiquadFilter(); bl.type = 'bandpass'; bl.frequency.value = 500; bl.Q.value = 0.8;
    const bAmp = ctx.createGain(); bAmp.gain.value = 0;
    const bLfo = ctx.createOscillator(); bLfo.frequency.value = 0.28; const bLg = ctx.createGain(); bLg.gain.value = 0.6;
    bLfo.connect(bLg).connect(bAmp.gain); bLfo.start();
    this.ghostGain = ctx.createGain(); this.ghostGain.gain.value = 0;
    const wg = ctx.createGain(); wg.gain.value = 0.25;
    wn.connect(bp).connect(wg).connect(this.ghostGain);
    breath.connect(bl).connect(bAmp).connect(this.ghostGain);
    this.ghostGain.connect(this.ghostPan).connect(this.master);

    // rain on the window (act 1 only)
    const rain = this.loop(this.white); const rf = ctx.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 2400; rf.Q.value = 0.4;
    const rl = ctx.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 6000;
    this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0;
    this.rainPan = this.panner([-2.4, 1.5, -0.6]);
    rain.connect(rf).connect(rl).connect(this.rainGain).connect(this.rainPan).connect(this.master);
    this.nextDrop = 0;
    // tinnitus + warped drone for the insanity effect
    const tin = ctx.createOscillator(); tin.type = 'sine'; tin.frequency.value = 6900;
    const tl = ctx.createOscillator(); tl.frequency.value = 0.3; const tlg = ctx.createGain(); tlg.gain.value = 40;
    tl.connect(tlg).connect(tin.frequency); tl.start();
    this.tinGain = ctx.createGain(); this.tinGain.gain.value = 0;
    tin.connect(this.tinGain).connect(this.master); tin.start();
    const warp = ctx.createOscillator(); warp.type = 'sawtooth'; warp.frequency.value = 55;
    const wlfo = ctx.createOscillator(); wlfo.frequency.value = 0.17; const wlg2 = ctx.createGain(); wlg2.gain.value = 9;
    wlfo.connect(wlg2).connect(warp.frequency); wlfo.start();
    const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 300;
    this.warpGain = ctx.createGain(); this.warpGain.gain.value = 0;
    warp.connect(wf).connect(this.warpGain).connect(this.master); warp.start();
    this.nextBeat = 0;
  }

  // recorded loops replace the synthetic bulb buzz / TV hiss once decoded
  startLoops() {
    const ctx = this.ctx;
    if (this.buf.buzz) {
      const s = ctx.createBufferSource(); s.buffer = this.buf.buzz; s.loop = true;
      this.buzzRec = ctx.createGain(); this.buzzRec.gain.value = 0;
      s.connect(this.buzzRec).connect(this.bulbPan); s.start();
    }
    if (this.buf.tvloop) {
      const s = ctx.createBufferSource(); s.buffer = this.buf.tvloop; s.loop = true;
      this.tvRec = ctx.createGain(); this.tvRec.gain.value = 0;
      s.connect(this.tvRec).connect(this.tvPan); s.start();
    }
    if (this.wantMusic) this.playMusic(this.wantMusic);
  }
  playMusic(name, fade = 3) {
    this.wantMusic = name;
    if (!this.ctx || !this.buf[name]) return;
    if (this.musicName === name) return;
    const t = this.ctx.currentTime;
    if (this.musicNode) {
      const old = this.musicNode; old.g.gain.cancelScheduledValues(t); old.g.gain.setTargetAtTime(0, t, fade / 3); old.s.stop(t + fade * 2);
    }
    this.musicName = name;
    if (!name) { this.musicNode = null; this.music = null; return; }
    const s = this.ctx.createBufferSource(); s.buffer = this.buf[name]; s.loop = true;
    const g = this.ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(1, t, fade / 3);
    s.connect(g).connect(this.musicBus); s.start();
    this.musicNode = { s, g }; this.music = { rate: s.playbackRate };
  }
  // TV speaker: the children's song (rate < 1 makes it drag and sag)
  tvSong(on, rate = 1) {
    if (!this.ctx || !this.buf.song) return;
    if (on && !this.songNode) {
      const s = this.ctx.createBufferSource(); s.buffer = this.buf.song; s.loop = true;
      const g = this.ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(0.55, this.ctx.currentTime, 0.3);
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1600; f.Q.value = 0.5;  // small CRT speaker
      s.connect(f).connect(g).connect(this.tvPan); s.start();
      this.songNode = { s, g };
    } else if (!on && this.songNode) {
      const n = this.songNode; n.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); n.s.stop(this.ctx.currentTime + 0.5); this.songNode = null;
    }
    if (this.songNode) this.songNode.s.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.4);
  }
  // music box: plucked metal comb notes; `slow` stretches the tempo as the spring unwinds
  musicBox(pos, sec = 14) {
    if (!this.ctx) return;
    const dest = this.panner(pos); dest.connect(this.master);
    const mel = [76, 79, 81, 79, 76, 74, 72, 74, 76, 76, 74, 72, 71, 72, 74, 76, 79, 77, 76, 74, 72, 72];
    let t = this.ctx.currentTime + 0.1, k = 0;
    while (t < this.ctx.currentTime + sec) {
      const note = mel[k % mel.length], f = 440 * Math.pow(2, (note - 69) / 12) * (1 + (Math.random() - 0.5) * 0.004);
      for (const [mul, v] of [[1, 0.22], [4.0, 0.05], [2.01, 0.06]]) {
        const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * mul;
        const g = this.ctx.createGain(); this.env(g, t, 0.003, v, 1.3 / mul);
        o.connect(g).connect(dest); o.start(t); o.stop(t + 1.5);
      }
      const prog = (t - this.ctx.currentTime) / sec;
      t += 0.32 + prog * prog * 0.5 + (k % 4 === 3 ? 0.18 : 0);
      k++;
    }
    this.duck(0.3, sec);
    return sec;
  }
  stopMusic(fade = 2) { this.wantMusic = null; if (this.ctx) this.playMusic(null, fade); }
  duck(amount = 0.25, sec = 2) {
    if (!this.ctx) return;
    const g = this.musicBus.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setTargetAtTime(this.vol.music * amount, t, 0.03); g.setTargetAtTime(this.vol.music, t + sec, 0.8);
  }
  sample(name, dest, { gain = 1, rate = 1 } = {}) {
    const b = this.buf[name]; if (!b) return false;
    const s = this.ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate * (0.96 + Math.random() * 0.08);
    const g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(g).connect(dest); s.start();
    return true;
  }

  noiseBuf(kind) {
    const ctx = this.ctx, len = ctx.sampleRate * 3, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }
  loop(buf) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 2); return s; }
  panner(p) {
    const n = this.ctx.createPanner(); n.panningModel = 'HRTF'; n.distanceModel = 'inverse'; n.refDistance = 1; n.rolloffFactor = 0.8;
    this.setPos(n, p); return n;
  }
  setPos(n, p) {
    if (n.positionX) { n.positionX.value = p[0]; n.positionY.value = p[1]; n.positionZ.value = p[2]; } else n.setPosition(...p);
  }
  set(param, v, k = 0.08) { if (this.ctx) param.setTargetAtTime(v, this.ctx.currentTime, k); }

  listener(pos, fwd, up) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    if (L.positionX) {
      L.positionX.value = pos[0]; L.positionY.value = pos[1]; L.positionZ.value = pos[2];
      L.forwardX.value = fwd[0]; L.forwardY.value = fwd[1]; L.forwardZ.value = fwd[2];
      L.upX.value = up[0]; L.upY.value = up[1]; L.upZ.value = up[2];
    } else { L.setPosition(...pos); L.setOrientation(...fwd, ...up); }
  }

  update(dt, s) {
    if (!this.ctx) return;
    this.set(this.rainGain.gain, (s.rain || 0) * 0.16, 0.8);
    if ((s.rain || 0) > 0.1 && this.ctx.currentTime > this.nextDrop) {  // heavy drops on the glass
      this.nextDrop = this.ctx.currentTime + 0.05 + Math.random() * 0.25;
      this.noiseHit(this.ctx.currentTime, { freq: 1800 + Math.random() * 2500, q: 6, v: 0.05 * s.rain, d: 0.03, dest: this.rainPan });
    }
    const recBuzz = !!this.buzzRec, recTv = !!this.tvRec;
    this.set(this.buzzGain.gain, recBuzz ? s.bulb * 0.008 : s.bulb * 0.035);
    recBuzz && this.set(this.buzzRec.gain, s.bulb * 0.22, 0.03);
    this.set(this.tvGain.gain, s.tvStatic * (recTv ? 0.03 : 0.09));
    recTv && this.set(this.tvRec.gain, s.tvStatic * 0.5);
    this.set(this.humGain.gain, s.tvHum * 0.01);
    this.set(this.ghostGain.gain, s.ghost * 0.55, 0.3);
    this.set(this.droneGain.gain, 0.15 + s.fear * 0.5, 0.5);
    this.setPos(this.ghostPan, s.ghostPos);
    const ins = s.insanity || 0;
    this.set(this.tinGain.gain, Math.max(0, ins - 0.35) ** 2 * 0.05, 0.4);
    this.set(this.warpGain.gain, ins * ins * 0.12, 0.4);
    if (this.music) this.set(this.music.rate, 1 - ins * 0.06, 0.5);
    // heartbeat
    const t = this.ctx.currentTime;
    if (s.fear > 0.25 && t > this.nextBeat) {
      const bpm = 60 + s.fear * 90;
      this.thump(t + 0.02, 0.25 + s.fear * 0.5); this.thump(t + 0.24, 0.15 + s.fear * 0.35);
      this.nextBeat = t + 60 / bpm;
      this.beatAt = t;
    }
  }

  env(g, t, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  thump(t, v) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.15);
    this.env(g, t, 0.01, v, 0.18); o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.3);
  }
  noiseHit(t, { freq = 1000, q = 1, type = 'bandpass', v = 0.5, a = 0.005, d = 0.2, dest = this.master, rate = 1 } = {}) {
    const s = this.ctx.createBufferSource(); s.buffer = this.white; s.playbackRate.value = rate;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); this.env(g, t, a, v, d);
    s.connect(f).connect(g).connect(dest); s.start(t, Math.random()); s.stop(t + a + d + 0.05);
  }

  play(name, pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const dest = pos ? (() => { const p = this.panner(pos); p.connect(this.master); return p; })() : this.master;
    // recorded Pixabay samples first; synthetic versions remain as fallbacks and layers
    const REC = {
      knock: ['knock', 1.2], bang: ['bang', 1.1], creak: ['creak', 1.0], drawer: ['drawer', 1.2], unlock: ['unlock', 1.3],
      pop: ['pop', 1.2], static: ['static', 0.45], steps: ['steps', 1.1], chime: ['chime', 1.0], curtain: ['curtain', 1.0],
      giggle: [Math.random() < 0.5 ? 'giggle' : 'giggle2', 0.9], whisper: [Math.random() < 0.5 ? 'whisper' : 'whisper2', 0.9],
    };
    if (REC[name] && this.sample(REC[name][0], dest, { gain: REC[name][1] })) return;
    if (name === 'scare' && this.buf.scare2) {
      this.sample(Math.random() < 0.6 ? 'scare2' : 'scare', this.master, { gain: 1.1 }); this.thump(t, 1.4); this.duck(0.15, 2.5);
      this.noiseHit(t, { freq: 2500, q: 0.5, v: 0.6, d: 0.9 });
      return;
    }
    switch (name) {
      case 'scare': {
        for (const [f, det] of [[180, 0], [187, 30], [260, -20], [523, 10]]) {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 2.2, t);
          o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 1.3); o.detune.value = det;
          const g = ctx.createGain(); this.env(g, t, 0.01, 0.22, 1.3); o.connect(g).connect(this.master); o.start(t); o.stop(t + 1.5);
        }
        this.noiseHit(t, { freq: 2500, q: 0.5, v: 1.2, d: 1.2 });
        this.thump(t, 1.4);
        break;
      }
      case 'sting': {
        for (const f of [311, 329.6, 466]) {
          const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
          const g = ctx.createGain(); this.env(g, t, 0.4, 0.06, 2.4); o.connect(g).connect(this.master); o.start(t); o.stop(t + 3);
        }
        this.noiseHit(t, { freq: 6000, type: 'highpass', v: 0.08, a: 0.6, d: 1.5 });
        break;
      }
      case 'reveal': {
        this.noiseHit(t, { freq: 400, q: 2, v: 0.5, a: 0.3, d: 0.9, rate: 0.5 });
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(820, t + 2);
        const g = ctx.createGain(); this.env(g, t, 0.05, 0.08, 2); o.connect(g).connect(this.master); o.start(t); o.stop(t + 2.2);
        break;
      }
      case 'knock': for (let i = 0; i < 3; i++) { this.noiseHit(t + i * 0.32 + Math.random() * 0.04, { freq: 180, q: 2, v: 1.3, d: 0.12, dest }); this.thump(t + i * 0.32, 0.25); } break;
      case 'bang': this.noiseHit(t, { freq: 120, q: 1, v: 2, d: 0.4, dest }); this.thump(t, 0.9); break;
      case 'click': this.noiseHit(t, { freq: 3500, q: 4, v: 0.35, d: 0.03, dest }); break;
      case 'beep': { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 660; const g = ctx.createGain(); this.env(g, t, 0.005, 0.05, 0.08); o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.1); break; }
      case 'wrong': { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 90; const g = ctx.createGain(); this.env(g, t, 0.005, 0.15, 0.35); o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.4); this.noiseHit(t, { freq: 800, v: 0.3, d: 0.3 }); break; }
      case 'static': this.noiseHit(t, { freq: 3000, type: 'highpass', v: 0.6, a: 0.01, d: 0.7, dest }); break;
      case 'drawer': this.noiseHit(t, { freq: 300, q: 0.7, v: 0.6, a: 0.05, d: 0.5, rate: 0.4, dest }); this.noiseHit(t + 0.5, { freq: 200, q: 2, v: 0.7, d: 0.1, dest }); break;
      case 'unlock': this.noiseHit(t, { freq: 2600, q: 6, v: 0.5, d: 0.05, dest }); this.noiseHit(t + 0.12, { freq: 1600, q: 5, v: 0.6, d: 0.08, dest }); break;
      case 'creak': {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(110, t + 1.2); o.frequency.linearRampToValueAtTime(60, t + 2);
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 8;
        const g = ctx.createGain(); this.env(g, t, 0.2, 0.25, 1.8); o.connect(f).connect(g).connect(dest); o.start(t); o.stop(t + 2.2); break;
      }
      case 'chime': for (let i = 0; i < 4; i++) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = [523, 415, 466, 311][i];
        const g = ctx.createGain(); this.env(g, t + i * 0.7, 0.01, 0.12, 2.2); o.connect(g).connect(dest); o.start(t + i * 0.7); o.stop(t + i * 0.7 + 2.4);
      } break;
      case 'tick': this.noiseHit(t, { freq: 4200, q: 8, v: 0.25, d: 0.02, dest }); break;
      case 'steps': for (let i = 0; i < 4; i++) this.noiseHit(t + i * 0.55, { freq: 160, q: 1.5, v: 0.8, d: 0.15, dest }); break;
      case 'giggle': for (let i = 0; i < 5; i++) {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(700 + i * 20, t + i * 0.13); o.frequency.exponentialRampToValueAtTime(520, t + i * 0.13 + 0.1);
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 2;
        const g = ctx.createGain(); this.env(g, t + i * 0.13, 0.01, 0.07, 0.1); o.connect(f).connect(g).connect(dest); o.start(t + i * 0.13); o.stop(t + i * 0.13 + 0.15);
      } break;
      case 'whisper': this.noiseHit(t, { freq: 1500, q: 4, v: 0.5, a: 0.3, d: 1.2, dest }); this.noiseHit(t + 0.8, { freq: 1100, q: 5, v: 0.4, a: 0.2, d: 0.9, dest }); break;
      case 'curtain': this.noiseHit(t, { freq: 2000, q: 0.5, type: 'bandpass', v: 0.35, a: 0.3, d: 1.4, dest }); break;
      case 'pop': this.noiseHit(t, { freq: 5000, type: 'highpass', v: 0.9, d: 0.08, dest }); this.thump(t, 0.3); break;
    }
  }
}
