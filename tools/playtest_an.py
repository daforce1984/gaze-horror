"""Plays the whole chapter (hide and seek + both anomaly nights) like a player: drag to look, real taps; screenshots + event log.
modes: normal | slow (reacts late, lets three pile up) | phone"""
import json, math, sys, time, os, base64, random
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cdp.py')).read().replace('\nmain()\n', '\n')
ns = {'__file__': __file__}; exec(src, ns); c = ns['CDP']()
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
T0 = time.time(); shots = []
def ev(js):
    r = c.call('Runtime.evaluate', expression=js, awaitPromise=True, returnByValue=True)
    if 'exceptionDetails' in r: raise RuntimeError(json.dumps(r['exceptionDetails'])[:500])
    return r['result'].get('value')
def shot(name):
    t = time.time() - T0
    fn = f'{len(shots):02d}_{name}.png'
    open(os.path.join(OUT, fn), 'wb').write(base64.b64decode(c.call('Page.captureScreenshot', format='jpeg', quality=70)['data']))
    shots.append({'t': round(t, 1), 'file': fn, 'sub': ev("document.querySelector('#subtitle').textContent"), 'tip': ev("document.querySelector('#hsTip').textContent")})
def tap(x, y):
    for t in ('mousePressed', 'mouseReleased'):
        c.call('Input.dispatchMouseEvent', type=t, x=x, y=y, button='left', clickCount=1)
def drag(dx, steps=8):
    W = ev("innerWidth"); H = ev("innerHeight"); x, y = W / 2, H / 2
    c.call('Input.dispatchMouseEvent', type='mousePressed', x=x, y=y, button='left', clickCount=1)
    for k in range(1, steps + 1):
        c.call('Input.dispatchMouseEvent', type='mouseMoved', x=x + dx * k / steps, y=y, button='left'); time.sleep(0.03)
    c.call('Input.dispatchMouseEvent', type='mouseReleased', x=x + dx, y=y, button='left', clickCount=1)
def spot_screen(k):
    return ev(f"""(()=>{{const g=__game,h=g.HIDE['{k}'],c=h.c; const {{f,r,u}}=g.camBasis(); const e=g.EYE; const d=[c[0]-e[0],c[1]-e[1],c[2]-e[2]];
      const z=d[0]*f[0]+d[1]*f[1]+d[2]*f[2]; if(z<0.1) return null; const th=g.tanHalfY(), a=innerWidth/innerHeight;
      const nx=(d[0]*r[0]+d[1]*r[1]+d[2]*r[2])/z/(th*a), ny=(d[0]*u[0]+d[1]*u[1]+d[2]*u[2])/z/th;
      if(Math.abs(nx)>0.95||Math.abs(ny)>0.95) return null; return [(nx*0.5+0.5)*innerWidth,(0.5-ny*0.5)*innerHeight]}})()""")
def search_and_tap(k, wrong=None, max_turns=16):
    # sweep the view with drags until the spot is on screen, like a player would; optionally tap a wrong place first
    if wrong:
        for _ in range(max_turns):
            p = spot_screen(wrong)
            if p: tap(*p); time.sleep(1.5); break
            drag(-140); time.sleep(0.35)
    for _ in range(max_turns):
        p = spot_screen(k)
        if p: tap(*p); return True
        drag(-140); time.sleep(0.35)
    return False

def an_screen(k):
    return ev(f"""(()=>{{const g=__game,c=g.anBox('{k}').c; const {{f,r,u}}=g.camBasis(); const e=g.EYE; const d=[c[0]-e[0],c[1]-e[1],c[2]-e[2]];
      const z=d[0]*f[0]+d[1]*f[1]+d[2]*f[2]; if(z<0.1) return null; const th=g.tanHalfY(), a=innerWidth/innerHeight;
      const nx=(d[0]*r[0]+d[1]*r[1]+d[2]*r[2])/z/(th*a), ny=(d[0]*u[0]+d[1]*u[1]+d[2]*u[2])/z/th;
      if(Math.abs(nx)>0.9||Math.abs(ny)>0.9) return null; return [(nx*0.5+0.5)*innerWidth,(0.5-ny*0.5)*innerHeight]}})()""")
waited = set()
def play_anom(tag, react=0.8, limit=300):
    end = time.time() + limit; n = 0; t_night = time.time()
    while time.time() < end and ev("__game.AN.on"):
        act = ev("Object.keys(__game.AN.act)")
        if not act: time.sleep(0.3); continue
        k = act[0]
        if MODE == 'slow':   # a distracted player: lets things pile up once per night, then plays slowly
            if tag not in waited:
                if len(act) < 3 and time.time() - t_night < 45: time.sleep(0.5); continue
                waited.add(tag); shot(f'{tag}_three'); time.sleep(3)
            time.sleep(1.5)
        for _ in range(14):
            p = an_screen(k)
            if p:
                time.sleep(react)
                if n < 3 or n % 4 == 0: shot(f'{tag}_{k}')
                tap(*p); n += 1; time.sleep(0.4); break
            drag(-160); time.sleep(0.3)
            if k not in ev("Object.keys(__game.AN.act)"): break
    shot(f'{tag}_done')

MODE = sys.argv[2] if len(sys.argv) > 2 else 'normal'   # normal | idle | wrong3
def wait_phase(ph, rnd=None, timeout=90):
    end = time.time() + timeout
    while time.time() < end:
        if ev("__game.HS.phase") == ph and (rnd is None or ev("__game.HS.round") == rnd): return
        time.sleep(0.2)
    raise RuntimeError('timeout waiting ' + ph + str(rnd))
def face(p):
    ev(f"""(()=>{{const g=__game,e=g.EYE,p={json.dumps(p)};const d=[p[0]-e[0],p[1]-e[1],p[2]-e[2]];g.S.yaw=Math.atan2(d[0],-d[2]);g.S.pitch=Math.atan2(d[1],Math.hypot(d[0],d[2]));return 1}})()""")

if MODE == 'phone':
    c.call('Emulation.setDeviceMetricsOverride', width=390, height=844, deviceScaleFactor=2, mobile=True)
    c.call('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
ev("localStorage.clear(); location.reload()"); time.sleep(8)
ev("document.querySelector('#startBtn').click(), 1"); T0 = time.time()
time.sleep(0.5); shot('t0_start'); time.sleep(2.5); shot('t3_curtain')
time.sleep(1.5); p = spot_screen('curtain'); tap(*p); time.sleep(0.8); shot('r1_found')
time.sleep(1.5); shot('r1_reward_flying')
while not ev('__game.AN.on'): time.sleep(0.2)
time.sleep(1.6); play_anom('an1')
wait_phase('seek', 2); time.sleep(0.5); shot('r2_seek_start')
spot = ev("__game.HS.spot"); decoys = ev("__game.HS.decoys")
if MODE == 'idle':
    for k in range(9): time.sleep(5); shot(f'r2_idle_{(k+1)*5}s')
    wait_phase('seek', 2); time.sleep(0.5)
    spot = ev("__game.HS.spot"); decoys = ev("__game.HS.decoys"); shot('r2_retry')
if MODE == 'wrong3':
    for k in range(3):
        d = decoys[k % len(decoys)]
        for _ in range(16):
            q = spot_screen(d)
            if q: tap(*q); break
            drag(-140); time.sleep(0.35)
        time.sleep(1.2)
    shot('r2_after_3_wrong')
search_and_tap(spot, wrong=None if MODE != 'normal' else decoys[0]); time.sleep(0.8); shot('r2_found')
wait_phase('seek', 3); time.sleep(0.8); shot('r3_seek_start')
search_and_tap('curtain'); time.sleep(4.2); shot('r3_after_cheat')
ev("document.querySelector('#turnBtn').click(), 1"); time.sleep(0.9); shot('r3_turned')
p = spot_screen('behind')
if p: tap(*p)
time.sleep(0.8); shot('r3_found')
while not ev('__game.AN.on'): time.sleep(0.2)
time.sleep(1.0); play_anom('an2', 0.6)
wait_phase('seek', 4, 60); time.sleep(1.5); shot('r4_tv_on')
face(ev("__game.O.tvCenter")); time.sleep(0.4)
W_, H_ = ev("innerWidth"), ev("innerHeight"); tap(W_ / 2, H_ / 2); time.sleep(0.8); shot('r4_cctv_view')
q = ev("""(()=>{const g=__game,h=g.HIDE.under,cam=g.cctvBasis(),C=g.CCTV;const d=[h.c[0]-C.pos[0],h.c[1]-C.pos[1],h.c[2]-C.pos[2]];
  const z=d[0]*cam.f[0]+d[1]*cam.f[1]+d[2]*cam.f[2];const a=innerWidth/innerHeight;
  return [((d[0]*cam.r[0]+d[1]*cam.r[1]+d[2]*cam.r[2])/z/(C.tanHalf*a)*0.5+0.5)*innerWidth,(0.5-(d[0]*cam.u[0]+d[1]*cam.u[1]+d[2]*cam.u[2])/z/C.tanHalf*0.5)*innerHeight]})()""")
tap(*q); time.sleep(0.8); shot('r4_found')
while not ev('__game.AN.on'): time.sleep(0.2)
time.sleep(1.0); play_anom('an3', 0.6)
wait_phase('photo', None, 40); time.sleep(0.6); shot('story_point_photo')
fb = ev("__game.O.nodes ? null : null")
face([-0.78, 1.55, -2.49]); time.sleep(0.4); tap(ev("innerWidth") / 2, ev("innerHeight") / 2); time.sleep(1.0); shot('photo_doc')
ev("document.querySelector('#modal.show [data-close]').click(), 1")
if MODE == 'rapid':
    for k in range(8): ev("document.querySelector('#chGive').click(), 1"); time.sleep(0.08)
    print('rapid: phase after early taps =', ev("__game.HS.phase"))
wait_phase('final', None, 15); time.sleep(0.5)
g = ev("__game.S.ghost && __game.S.ghost.p"); face([g[0], 1.0, g[2]]); time.sleep(0.4); shot('choice')
if MODE == 'rapid':   # a stray tap right after the photo closes must not choose
    pass
if MODE == 'stay':
    ev("document.querySelector('#chStay').click(), 1"); time.sleep(0.8); shot('stay_warn')
    ev("document.querySelector('#chStay').click(), 1")
else:
    ev("document.querySelector('#chGive').click(), 1")
time.sleep(6); shot('after_choice')
end = time.time() + 25
while time.time() < end and not ev("!!document.querySelector('#ending.show')"): time.sleep(0.5)
time.sleep(10); shot('ending')
log = ev("__log")
json.dump({'mode': MODE, 'shots': shots, 'log': log}, open(os.path.join(OUT, 'playtest.json'), 'w'), ensure_ascii=False, indent=1)
print(json.dumps(log, ensure_ascii=False))
print('err:', ev("String(window.__err||'none')"))
if MODE == 'phone':
    c.call('Emulation.setTouchEmulationEnabled', enabled=False); c.call('Emulation.clearDeviceMetricsOverride')
