"""v2 scripted playthrough: fetch by staring (incl. through the CCTV), inspect, combine, use, walk, give. Screenshots at key beats."""
import json, math, sys, time, os, base64, functools
print = functools.partial(print, flush=True)
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cdp.py')).read().replace('\nmain()\n', '\n')
ns = {'__file__': __file__}; exec(src, ns); c = ns['CDP']()
SP = '/tmp/claude-1000/-mnt-d--AI-GENERATED-------2026-horror/ade6b511-f646-4ef8-a52c-feaabe89190d/scratchpad/'
SHOTS = '--shots' in sys.argv
T0 = time.time()

def ev(js):
    r = c.call('Runtime.evaluate', expression=js, awaitPromise=True, returnByValue=True)
    if 'exceptionDetails' in r: raise RuntimeError(json.dumps(r['exceptionDetails'])[:600])
    return r['result'].get('value')
def shot(name):
    if SHOTS:
        open(SP + 'p2_' + name + '.png', 'wb').write(base64.b64decode(c.call('Page.captureScreenshot', format='png')['data']))
def log(msg):
    st = ev("({t:__game.S.time.toFixed(1), act:__game.S.act, warm:Math.round(__game.S.warmth), inv:__game.S.inv.join(','), sub:document.querySelector('#subtitle').textContent, err:String(window.__err||'')})")
    print(f"[{time.time()-T0:6.1f}s g{st['t']:>6}] act{st['act']} ❄{st['warm']:>3} [{st['inv']}] {msg} | {st['sub'][:60]}", '| ERR ' + st['err'][:200] if st['err'] else '')
def aim(p):
    ev(f"""(()=>{{const g=__game,e=g.EYE,p={json.dumps(p)};const d=[p[0]-e[0],p[1]-e[1],p[2]-e[2]];
      g.S.yaw=Math.atan2(d[0],-d[2]);g.S.pitch=Math.atan2(d[1],Math.hypot(d[0],d[2]));return 1}})()""")
def wait(cond, timeout=40, poll=0.25):
    end = time.time() + timeout
    while time.time() < end:
        if ev(cond): return True
        if ev("!!document.querySelector('#modal.show')") and 'modal' not in cond: pass
        time.sleep(poll)
    raise RuntimeError('timeout: ' + cond)
def closeModal():
    ev("document.querySelector('#modal.show [data-close]')?.click(), 1")
def fetch(id, timeout=30):
    c_ = ev(f"__game.W.{id}.c")
    aim(c_); ev("__game.S.zoomTarget=3.2, 1")
    wait(f"__game.S.fetched.has('{id}')", timeout)
    ev("__game.S.zoomTarget=1, 1")
    log('fetched ' + id)
def aimCCTV(id):
    # project the object through the CCTV camera onto the TV screen, then look at that spot
    ev(f"""(()=>{{const g=__game, w=g.W.{id}, cam=g.cctvBasis(), C=g.CCTV, r=g.O.tvRect;
      const d=[w.c[0]-C.pos[0],w.c[1]-C.pos[1],w.c[2]-C.pos[2]]; const z=d[0]*cam.f[0]+d[1]*cam.f[1]+d[2]*cam.f[2];
      const nx=(d[0]*cam.r[0]+d[1]*cam.r[1]+d[2]*cam.r[2])/z/(C.tanHalf*C.aspect), ny=(d[0]*cam.u[0]+d[1]*cam.u[1]+d[2]*cam.u[2])/z/C.tanHalf;
      const p=[r.x0+(nx+1)/2*(r.x1-r.x0), r.y0+(ny+1)/2*(r.y1-r.y0), r.z]; const e=g.EYE; const dd=[p[0]-e[0],p[1]-e[1],p[2]-e[2]];
      g.S.yaw=Math.atan2(dd[0],-dd[2]); g.S.pitch=Math.atan2(dd[1],Math.hypot(dd[0],dd[2])); return [nx,ny]}})()""")

ev("localStorage.clear(); location.reload()"); time.sleep(8)
ev("document.querySelector('#startBtn').click(), 1"); time.sleep(1)
log('start')
time.sleep(15); shot('01_room'); log('intro done')
# ---- act 0: remote, TV, CCTV, music box
c_ = ev("__game.W.remote.c"); aim(c_); ev("__game.S.zoomTarget=3.2, 1")
time.sleep(2.2); shot('02_remote_flying')
wait("__game.S.fetched.has('remote')"); ev("__game.S.zoomTarget=1, 1"); log('remote')
time.sleep(9)
ev("__game.trayTap('remote'), 1"); ev("__game.padPress('power'), 1"); time.sleep(2)
aim(ev("__game.O.tvCenter")); shot('03_kids_show'); log('tv on ch3')
ev("__game.padPress('7'), 1"); time.sleep(2); shot('04_cctv'); log('cctv')
aimCCTV('musicbox'); ev("__game.S.zoomTarget=2.2, 1"); time.sleep(0.6)
print('   cctv target:', ev("(()=>{const t=__game.fetchTarget(__game.camBasis().f); return t&&(t.w?t.w.id:'screen')+':'+t.via})()"))
wait("__game.S.fetched.has('musicbox')", 30); ev("__game.S.zoomTarget=1, 1"); log('musicbox via cctv')
time.sleep(3.5); shot('05_cctv_ghost')
wait("__game.S.act===1", 10); log('ACT 1')
# ---- act 1
ev("__game.padPress('power'), 1"); ev("document.querySelector('#padClose').click(), 1")
ev("__game.openInspect('musicbox'), 1"); time.sleep(1); shot('06_inspect_musicbox')
ev("__game.HOT.musicbox[1].fn(), 1"); time.sleep(1.5); shot('07_childnote'); closeModal(); ev("__game.closeInspect(), 1")
log('child note')
fetch('curtain'); time.sleep(3); shot('08_curtain')
fetch('calendar'); ev("__game.trayTap('calendar'), 1"); time.sleep(1); shot('09_calendar'); closeModal()
fetch('frame')
fetch('machine'); ev("__game.openInspect('machine'), 1"); ev("__game.HOT.machine[0].fn(), 1"); time.sleep(10); ev("__game.closeInspect(), 1")
fetch('drawer', 40); ev("__game.openInspect('drawer'), 1"); time.sleep(1); shot('10_inspect_drawer')
ev("__game.HOT.drawer[0].fn(), 1"); time.sleep(0.5)
code = ev("__game.CODE")
for i, d in enumerate(code):
    for _ in range(d): ev(f"document.querySelector('[data-u=\"{i}\"]').click(), 1")
shot('11_dial'); ev("document.querySelector('#dialOk').click(), 1"); time.sleep(2)
log('drawer open')
ev("__game.combine('crank','musicbox'), 1"); time.sleep(4)
aim([0.05, 0.6, -1.3]); time.sleep(2); shot('12_musicbox_ghost'); log('music box playing')
wait("__game.S.act===2", 40); log('ACT 2'); time.sleep(12)
aim([0, 1.4, -2.5]); time.sleep(1); shot('13_rot_front')
aim([-2.2, 1.4, 1.2]); time.sleep(1); shot('14_rot_left')
# ---- act 2
ev("__game.S.useItem='scissors', 1"); aim([0.3, 0.66, 0.26]); time.sleep(0.4)
print('   use target:', ev("(()=>{const t=__game.useTarget(__game.camBasis().f); return t&&t.id})()"))
ev("__game.applyUse(__game.useTarget(__game.camBasis().f)), 1"); time.sleep(1.2); shot('15_rope_cut'); time.sleep(6); log('rope cut')
fetch('news', 20) if ev("__game.O.newsObj.visible") else None
c_ = ev("__game.W.doll.c"); aim(c_); ev("__game.S.zoomTarget=3.2, 1"); time.sleep(2.5)
ev("__game.S.zoomTarget=1, 1")
for k in range(40):
    time.sleep(0.5)
    if ev("__game.S.job && __game.S.job.phase==='walk'"):
        g = ev("__game.S.ghost && __game.S.ghost.p"); aim([g[0], 1.0, g[2]]); time.sleep(0.6); shot('16_ghost_carry'); break
wait("__game.S.fetched.has('doll')", 40); log('doll')
ev("__game.openInspect('doll'), 1"); time.sleep(1); shot('17_inspect_doll'); ev("__game.HOT.doll[0].fn(), 1"); time.sleep(1); ev("__game.closeInspect(), 1")
ev("__game.S.useItem='anklekey', 1"); aim([0, 0.07, 0.05]); time.sleep(0.4)
print('   use target:', ev("(()=>{const t=__game.useTarget(__game.camBasis().f); return t&&t.id})()"))
ev("__game.applyUse(__game.useTarget(__game.camBasis().f)), 1"); log('freed')
wait("__game.S.act===3 && __game.S.standing>=1", 20); time.sleep(4); log('ACT 3 standing')
aim([0.7, 1.3, 2.4]); shot('18_standing')
# walk, glancing back when she gets close
while not ev("!!__game.S.final"):
    g = ev("__game.S.ghost && __game.S.ghost.p")
    if g and math.hypot(g[0] - ev("__game.EYE[0]"), g[2] - ev("__game.EYE[2]")) < 1.3:
        ev("__game.S.walking=false, 1"); aim([g[0], 1.1, g[2]]); time.sleep(0.8)
    else:
        aim([0.7, 1.3, 2.4]); ev("__game.S.walking=true, 1"); time.sleep(0.4)
    if ev("__game.S.ending"): break
ev("__game.S.walking=false, 1"); log('at door')
wait("__game.S.ghost && __game.S.ghost.mode==='final' && __game.S.ghost.alpha>0.6", 15)
g = ev("__game.S.ghost.p"); aim([g[0], 1.1, g[2]]); time.sleep(1); shot('19_final')
ev("__game.S.useItem='photo', 1"); ev("__game.applyUse(__game.useTarget(__game.camBasis().f)), 1"); log('gave photo')
wait("!!document.querySelector('#ending.show')", 90); time.sleep(12); shot('20_ending'); log('ENDING')
print('records', ev("[...__game.S.records]"), 'total', round(time.time() - T0), 's')
