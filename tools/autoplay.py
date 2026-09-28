"""Scripted playthrough over CDP (real time). Aims at the ghost, zooms, solves each puzzle through the real UI."""
import json, math, sys, time, os, functools
print = functools.partial(print, flush=True)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.argv = [sys.argv[0], 'noop']
import importlib.util
spec = importlib.util.spec_from_file_location('cdp', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cdp.py'))
src = open(spec.origin).read().replace('\nmain()\n', '\n')
ns = {'__file__': spec.origin}
exec(compile(src, spec.origin, 'exec'), ns)
c = ns['CDP']()


def ev(js):
    r = c.call('Runtime.evaluate', expression=js, awaitPromise=True, returnByValue=True)
    if 'exceptionDetails' in r:
        raise RuntimeError(r['exceptionDetails'])
    return r['result'].get('value')


def click(sel):
    return ev(f"(()=>{{const e=document.querySelector({json.dumps(sel)}); if(!e) return false; e.click(); return true}})()")


def aim(p):
    ev(f"""(()=>{{const g=__game, e=g.EYE, p={json.dumps(p)}; const d=[p[0]-e[0],p[1]-e[1],p[2]-e[2]];
    g.S.yaw=Math.atan2(d[0],-d[2]); g.S.pitch=Math.atan2(d[1],Math.hypot(d[0],d[2])); return 1}})()""")


def state():
    return ev("""(()=>{const S=__game.S; return {stage:S.stage, t:S.time, fear:S.fear, ghost:S.ghost?{spot:S.ghost.spot,p:S.ghost.p,kind:S.ghost.kind,rev:S.ghost.reveal,revealed:S.ghost.revealed,leaving:!!S.ghost.leaving,alpha:S.ghost.alpha}:null,
      modal:document.querySelector('#modal').classList.contains('show'), unlock:S.unlock, ending:S.ending, sub:document.querySelector('#subtitle').textContent}})()""")


ev("localStorage.clear(); location.reload()")
time.sleep(7)
click('#startBtn')
SOL = ev("__game.SOL")
print('SOL', SOL)
t0 = time.time()
last_stage, scares = None, 0
done = set()
while time.time() - t0 < 1500:
    s = state()
    if s['stage'] != last_stage:
        print(f"[{time.time() - t0:6.1f}s game {s['t']:6.1f}] stage -> {s['stage']}  sub='{s['sub']}'")
        last_stage = s['stage']
    if s['ending']:
        print('ENDING reached at', round(time.time() - t0, 1), 's; game time', round(s['t'], 1))
        break
    if s['modal']:
        click('#modalCard [data-close]'); time.sleep(0.3); continue
    g = s['ghost']
    st = s['stage']
    if st == 'chase':
        door = [0.7, 1.0, 2.5]
        if g and not g['leaving']:
            gp = g['p']; dist = math.hypot(gp[0], gp[2] - 0.3)
            if dist < 1.35:  # glance back at her to freeze her, then return
                aim([gp[0], 1.1, gp[2]]); ev("__game.S.holding=false"); time.sleep(0.9)
                continue
        aim(door); ev("__game.S.target && __game.S.target.id==='door' ? (__game.S.holding=true) : 0")
        time.sleep(0.25); continue
    if g and not g['revealed'] and not g['leaving'] and g['alpha'] > 0.2:
        if s['fear'] > 0.8:  # look away to calm down
            ev("__game.S.zoomTarget=1"); aim([0, 1.5, -2.5]); time.sleep(2.5); continue
        h = 0.62 if g['kind'] == 'crouch' else 1.2
        aim([g['p'][0], h, g['p'][2]]); ev("__game.S.zoomTarget=3.2")
        time.sleep(0.3); continue
    ev("__game.S.zoomTarget=1")
    if st == 'tv' and 'tv' not in done and ev("__game.S.memo.length") >= 1:
        ev("__game.interact(__game.INTERACT.find(i=>i.id==='tv'))"); time.sleep(0.5)
        cur = ev("__game.S.tv.channel")
        while cur != SOL['channel']:
            click('.dial [data-d="1"]'); time.sleep(0.15); cur = ev("__game.S.tv.channel")
        click('#chOk'); done.add('tv'); time.sleep(0.5); continue
    if st == 'drawer' and 'drawer' not in done:
        ev("__game.interact(__game.INTERACT.find(i=>i.id==='drawer'))"); time.sleep(0.5)
        for d in SOL['code']:
            click(f'.keypad [data-k="{d}"]'); time.sleep(0.15)
        click('#kpOk'); done.add('drawer'); time.sleep(2.5)
        print('   items modal:', ev("document.querySelector('#modalCard h2')?.textContent"))
        click('#modalCard [data-close]'); continue
    if st == 'clockSet' and 'clock' not in done:
        ev("__game.interact(__game.INTERACT.find(i=>i.id==='clock'))"); time.sleep(0.5)
        while int(ev("+document.querySelector('#clkH').textContent")) != SOL['hour']:
            click('[data-a="h+"]'); time.sleep(0.08)
        while int(ev("+document.querySelector('#clkM').textContent")) != SOL['minute']:
            click('[data-a="m+"]'); time.sleep(0.08)
        click('#clkOk'); done.add('clock'); time.sleep(0.5); continue
    # idle: sweep the room slowly
    ev("__game.S.yaw += 0.35"); time.sleep(0.35)
print('memo:', ev("__game.S.memo.join(' | ').replace(/<[^>]+>/g,'')"))
print('err:', ev("String(window.__err||'none')"))
