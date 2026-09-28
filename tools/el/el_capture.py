"""Type one line in the ElevenLabs v3 editor, click Generate, and record the TTS request the page sends (URL, headers, body)."""
import sys, json, time, importlib.util
spec = importlib.util.spec_from_file_location('el', __file__.replace('el_capture.py', 'el.py')); el = importlib.util.module_from_spec(spec); spec.loader.exec_module(el)
el.ensure(); tab, ws = el.pick_tab(); s = el.Session(ws)
s.call('Input.dispatchKeyEvent', type='keyDown', key='Escape', code='Escape', windowsVirtualKeyCode=27)
s.call('Input.dispatchKeyEvent', type='keyUp', key='Escape', code='Escape', windowsVirtualKeyCode=27)
time.sleep(0.5)
s.call('Network.enable', maxPostDataSize=65536)
r = s.call('Runtime.evaluate', returnByValue=True, expression="""(()=>{const t=document.querySelector('textarea, [contenteditable=true]');t.focus();const r=t.getBoundingClientRect();return [r.x+30,r.y+15]})()""")
x, y = r['result']['value']
s.call('Input.dispatchMouseEvent', type='mousePressed', x=x, y=y, button='left', clickCount=1)
s.call('Input.dispatchMouseEvent', type='mouseReleased', x=x, y=y, button='left', clickCount=1)
for mod, key, code, vk in ((2, 'a', 'KeyA', 65),):
    s.call('Input.dispatchKeyEvent', type='keyDown', modifiers=mod, key=key, code=code, windowsVirtualKeyCode=vk)
    s.call('Input.dispatchKeyEvent', type='keyUp', modifiers=mod, key=key, code=code, windowsVirtualKeyCode=vk)
s.call('Input.dispatchKeyEvent', type='keyDown', key='Backspace', code='Backspace', windowsVirtualKeyCode=8)
s.call('Input.dispatchKeyEvent', type='keyUp', key='Backspace', code='Backspace', windowsVirtualKeyCode=8)
time.sleep(0.4)
s.call('Input.insertText', text=sys.argv[1])
time.sleep(0.8)
r = s.call('Runtime.evaluate', returnByValue=True, expression="""(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()=='Generate speech');const r=b.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2,b.disabled]})()""")
x, y, dis = r['result']['value']
print('generate button', x, y, 'disabled', dis)
for t in ('mouseMoved', 'mousePressed', 'mouseReleased'):
    s.call('Input.dispatchMouseEvent', type=t, x=x, y=y, button='left', clickCount=1)
end = time.time() + 40
s.ws.settimeout(2)
reqs = []
while time.time() < end:
    try: m = json.loads(s.ws.recv())
    except Exception: continue
    if m.get('method') == 'Network.requestWillBeSent':
        rq = m['params']['request']
        if 'api.' in rq['url'] and rq['method'] == 'POST':
            reqs.append({'url': rq['url'], 'headers': rq['headers'], 'body': rq.get('postData', '')[:3000]})
            print('POST', rq['url'][:160])
json.dump(reqs, open('/tmp/claude-1000/-mnt-d--AI-GENERATED-------2026-horror/ade6b511-f646-4ef8-a52c-feaabe89190d/scratchpad/el_reqs.json', 'w'), indent=1)
