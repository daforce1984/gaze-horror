"""Call an ElevenLabs API endpoint inside the signed-in page using the captured session headers (never printed).
usage: el_api.py GET /v1/shared-voices?search=child  |  el_api.py POST /v1/... '{json}'"""
import sys, json, importlib.util
spec = importlib.util.spec_from_file_location('el', __file__.replace('el_api.py', 'el.py')); el = importlib.util.module_from_spec(spec); spec.loader.exec_module(el)
cap = next(q for q in json.load(open('/tmp/claude-1000/-mnt-d--AI-GENERATED-------2026-horror/ade6b511-f646-4ef8-a52c-feaabe89190d/scratchpad/el_reqs.json')) if q['body'])
base = cap['url'].split('/v1/')[0]
hdr = {k: v for k, v in cap['headers'].items() if k.lower() in ('authorization', 'x-generation-actor', 'x-generation-surface')}
method, path = sys.argv[1], sys.argv[2]
body = sys.argv[3] if len(sys.argv) > 3 else None
if body: hdr['content-type'] = 'application/json'
el.ensure(); tab, ws = el.pick_tab(); s = el.Session(ws)
js = """(async()=>{const r=await fetch(%s,{method:%s,headers:%s%s}); const t=await r.text(); return {status:r.status, text:t.slice(0,200000)}})()""" % (
    json.dumps(base + path), json.dumps(method), json.dumps(hdr), (',body:' + json.dumps(body)) if body else '')
r = s.call('Runtime.evaluate', expression=js, awaitPromise=True, returnByValue=True)
v = r.get('result', {}).get('value') or {}
print(v.get('status')); sys.stdout.write(v.get('text', str(r)))
