// Procedural horror soundscape (WebAudio). No audio files needed.
export class Sound {
  constructor() { this.ctx = null; this.enabled = true; }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) { this.enabled = false; return; }
    const ctx = this.ctx = new C();
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
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

    this.nextBeat = 0;
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
    this.set(this.buzzGain.gain, s.bulb * 0.035);
    this.set(this.tvGain.gain, s.tvStatic * 0.09);
    this.set(this.humGain.gain, s.tvHum * 0.01);
    this.set(this.ghostGain.gain, s.ghost * 0.55, 0.3);
    this.set(this.droneGain.gain, 0.15 + s.fear * 0.5, 0.5);
    this.setPos(this.ghostPan, s.ghostPos);
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
