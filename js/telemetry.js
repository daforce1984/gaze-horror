// Performance log: one session per page load. Every second a sample (frame times, JS / GPU time, what was
// on screen and what the game was doing); frames over 60 ms become events with a snapshot. Batches are posted
// every 10 s as text/plain JSON (a "simple" request: no CORS preflight) and once more when the page hides.
// Only performance and game-state data: no names, no input, no location.
export class Telemetry {
  constructor(url, info) {
    this.url = url;
    this.session = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)) ;
    this.t0 = performance.now();
    this.seq = 0;
    this.info = info;
    this.samples = []; this.events = [];
    this.frames = []; this.js = [];
    this.sent = 0; this.failed = 0;
    if (!url) return;
    setInterval(() => this.flush(), 10000);
    addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flush(true); });
    addEventListener('pagehide', () => this.flush(true));
    addEventListener('error', (e) => this.event('error', { msg: String(e.message).slice(0, 300), src: e.filename, line: e.lineno }));
  }
  get t() { return +((performance.now() - this.t0) / 1000).toFixed(2); }
  frame(dt, jsMs) { this.frames.push(dt * 1000); this.js.push(jsMs); }
  // called once a second with the state snapshot
  sample(state) {
    const f = this.frames.sort((a, b) => a - b), n = f.length;
    if (!n) return;
    const pct = (p) => +f[Math.min(n - 1, Math.floor(n * p))].toFixed(1);
    const js = this.js.reduce((a, b) => a + b, 0) / Math.max(1, this.js.length);
    this.samples.push({ t: this.t, frames: n, fps: +(1000 / (f.reduce((a, b) => a + b, 0) / n)).toFixed(1),
      p50: pct(0.5), p95: pct(0.95), max: +f[n - 1].toFixed(1), long: f.filter(x => x > 50).length, jsMs: +js.toFixed(2), ...state });
    this.frames = []; this.js = [];
  }
  event(type, data = {}) { this.events.push({ t: this.t, type, ...data }); }
  flush(final = false) {
    if (!this.url || (!this.samples.length && !this.events.length && this.seq > 0)) return;
    const body = JSON.stringify({ session: this.session, seq: this.seq++, final, sentAt: new Date().toISOString(),
      info: this.seq === 1 ? this.info : undefined, samples: this.samples, events: this.events });
    this.samples = []; this.events = [];
    try {
      if (final && navigator.sendBeacon) { navigator.sendBeacon(this.url, new Blob([body], { type: 'text/plain' })); return; }
      fetch(this.url, { method: 'POST', body, headers: { 'Content-Type': 'text/plain' }, keepalive: body.length < 60000, mode: 'cors' })
        .then(() => this.sent++).catch(() => this.failed++);
    } catch { this.failed++; }
  }
}
