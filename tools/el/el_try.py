"""Generate a test line with several voices (in-page, session auth), then transcribe each with Scribe to score Korean intelligibility."""
import sys, json, base64, importlib.util, difflib, re
spec = importlib.util.spec_from_file_location('el', __file__.replace('el_try.py', 'el.py')); el = importlib.util.module_from_spec(spec); spec.loader.exec_module(el)
SP = '/tmp/claude-1000/-mnt-d--AI-GENERATED-------2026-horror/ade6b511-f646-4ef8-a52c-feaabe89190d/scratchpad/'
cap = json.load(open(SP + 'el_reqs.json'))[0]
base = 'https://api.us.elevenlabs.io'
hdr = dict(cap['headers'])
el.ensure(); tab, ws = el.pick_tab(); s = el.Session(ws)
TEXT = sys.argv[1]
def run(js):
    r = s.call('Runtime.evaluate', expression=js, awaitPromise=True, returnByValue=True)
    return r.get('result', {}).get('value') or {}
for vid in sys.argv[2:]:
    body = json.dumps({'inputs': [{'text': TEXT, 'voice_id': vid}], 'model_id': 'eleven_v3', 'settings': {'stability': 0.5}})
    v = run("""(async()=>{const r=await fetch(%s,{method:'POST',headers:%s,body:%s});
      if(!r.ok) return {err:r.status+' '+(await r.text()).slice(0,200)};
      const b=new Uint8Array(await r.arrayBuffer()); let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode.apply(null,b.subarray(i,i+32768));
      const fd=new FormData(); fd.append('model_id','scribe_v1'); fd.append('language_code','kor'); fd.append('file', new Blob([b],{type:'audio/mpeg'}),'a.mp3');
      const h=Object.assign({}, %s); delete h['content-type']; delete h['Content-Type'];
      const t=await fetch(%s,{method:'POST',headers:h,body:fd}); const tj=t.ok? await t.json() : {text:'STT '+t.status+' '+(await t.text()).slice(0,120)};
      return {n:b.length,data:btoa(s),stt:tj.text}})()""" % (json.dumps(base + '/v1/text-to-dialogue/stream'), json.dumps({**hdr, 'content-type': 'application/json'}), json.dumps(body), json.dumps(hdr), json.dumps(base + '/v1/speech-to-text')))
    if 'err' in v: print(vid, 'ERR', v['err']); continue
    open(SP + f'try_{vid}.mp3', 'wb').write(base64.b64decode(v['data']))
    clean = lambda x: re.sub(r'\[[^\]]*\]|[^가-힣]', '', x or '')
    score = difflib.SequenceMatcher(None, clean(TEXT), clean(v['stt'])).ratio()
    print(vid, f'{score:.2f}', v['n'], '|', v['stt'])
