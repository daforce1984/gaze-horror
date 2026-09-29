"""Transcribe generated voice files with Scribe (in-page, session auth): el_stt.py id [id ...] -> expected vs heard"""
import sys, json, base64, importlib.util, os, re, difflib
spec = importlib.util.spec_from_file_location('el', __file__.replace('el_stt.py', 'el.py')); el = importlib.util.module_from_spec(spec); spec.loader.exec_module(el)
SP = '/tmp/claude-1000/-mnt-d--AI-GENERATED-------2026-horror/ade6b511-f646-4ef8-a52c-feaabe89190d/scratchpad/'
hdr = {k: v for k, v in json.load(open(SP + 'el_reqs.json'))[0]['headers'].items() if k.lower() == 'authorization'}
root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
lines = {l['id']: l['text'] for l in json.load(open(os.path.join(root, 'assets', 'voice', 'lines.json')))['lines']}
el.ensure(); tab, ws = el.pick_tab(); s = el.Session(ws)
for i in sys.argv[1:]:
    b64 = base64.b64encode(open(os.path.join(root, 'assets', 'voice', i + '.mp3'), 'rb').read()).decode()
    js = """(async()=>{const b=Uint8Array.from(atob(%s),c=>c.charCodeAt(0));
      const fd=new FormData(); fd.append('model_id','scribe_v1'); fd.append('language_code','kor'); fd.append('file', new Blob([b],{type:'audio/mpeg'}),'a.mp3');
      const r=await fetch('https://api.us.elevenlabs.io/v1/speech-to-text',{method:'POST',headers:%s,body:fd}); const j=await r.json(); return j.text||JSON.stringify(j).slice(0,200)})()""" % (json.dumps(b64), json.dumps(hdr))
    heard = s.call('Runtime.evaluate', expression=js, awaitPromise=True, returnByValue=True).get('result', {}).get('value')
    want = re.sub(r'\[[^\]]*\]', '', lines[i]).strip()
    sim = difflib.SequenceMatcher(None, re.sub(r'\W', '', want), re.sub(r'\W', '', heard or '')).ratio()
    print(f'{i:10} {sim:.2f} | want: {want} | heard: {heard}')
