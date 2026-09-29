"""Generate every line in assets/voice/lines.json with ElevenLabs v3 through the signed-in page session.
Re-uses the request shape captured by el_capture.py (headers incl. the session bearer stay in /tmp, never printed).
usage: el_gen.py [id ...]   (default: all missing)   env VARIANTS=2 to make alternate takes (<id>_b.mp3)"""
import sys, os, json, base64, time, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('el', os.path.join(HERE, 'el.py')); el = importlib.util.module_from_spec(spec); spec.loader.exec_module(el)
VOICES = {'GIRL': 'Ss1VfT7ri4lqnvTDWII0',    # Luna - Soft, Clear, Bright (Korean, Seoul; chosen by the user); pitched up in the engine
          'MOTHER': 'JxIGrv4AVuvbo1Dxzryu',  # Park Hyun-mi - Korean female (Voice Library)
          'ANCHOR': 'lO4E4qxAvq4BhWUWF8Ci'}  # JasonK - Korean male, calm (Voice Library)
root = os.path.dirname(os.path.dirname(HERE))
out_dir = os.path.join(root, 'assets', 'voice')
data = json.load(open(os.path.join(out_dir, 'lines.json')))
cap = next(q for q in json.load(open('/tmp/claude-1000/-mnt-d--AI-GENERATED-------2026-horror/ade6b511-f646-4ef8-a52c-feaabe89190d/scratchpad/el_reqs.json')) if q['body'])
url = cap['url']; body0 = json.loads(json.loads(json.dumps(cap['body'])) or '{}') if cap['body'] else {}
hdr = {k: v for k, v in cap['headers'].items() if k.lower() in ('authorization', 'content-type', 'x-generation-actor', 'x-generation-surface')}
hdr['content-type'] = 'application/json'
model = body0.get('model_id', 'eleven_v3')
el.ensure(); tab, ws = el.pick_tab(); s = el.Session(ws)
want = set(sys.argv[1:])
for ln in data['lines']:
    if want and ln['id'] not in want: continue
    fn = os.path.join(out_dir, ln['id'] + '.mp3')
    if os.path.exists(fn) and not want: continue
    stab = ln.get('stability', 0.5)
    body = {'inputs': [{'text': ln['text'], 'voice_id': VOICES[ln['voice']]}], 'model_id': model, 'settings': {'stability': stab}}
    js = """(async()=>{const r=await fetch(%s,{method:'POST',headers:%s,body:%s});
      if(!r.ok) return {err:r.status+' '+(await r.text()).slice(0,300)};
      const b=new Uint8Array(await r.arrayBuffer()); let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode.apply(null,b.subarray(i,i+32768));
      return {n:b.length,data:btoa(s)}})()""" % (json.dumps(url), json.dumps(hdr), json.dumps(json.dumps(body)))
    r = s.call('Runtime.evaluate', expression=js, awaitPromise=True, returnByValue=True)
    v = r.get('result', {}).get('value') or {}
    if 'err' in v or 'data' not in v:
        print(ln['id'], 'ERROR', v.get('err', r)); continue
    open(fn, 'wb').write(base64.b64decode(v['data']))
    print(ln['id'], ln['voice'], v['n'], 'bytes')
