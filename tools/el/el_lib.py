"""Open the Voice Library search in the ElevenLabs tab, collect shared-voices API responses and the fresh auth header."""
import sys, json, time, importlib.util
spec = importlib.util.spec_from_file_location('el', __file__.replace('el_lib.py', 'el.py')); el = importlib.util.module_from_spec(spec); spec.loader.exec_module(el)
SP = '/tmp/claude-1000/-mnt-d--AI-GENERATED-------2026-horror/ade6b511-f646-4ef8-a52c-feaabe89190d/scratchpad/'
el.ensure(); tab, ws = el.pick_tab(); s = el.Session(ws)
s.call('Network.enable', maxPostDataSize=65536)
voices, reqids, auth = {}, [], None
for q in sys.argv[1:]:
    s.call('Page.navigate', url='https://elevenlabs.io/app/voice-library?search=' + q)
    end = time.time() + 12; s.ws.settimeout(1)
    while time.time() < end:
        try: m = json.loads(s.ws.recv())
        except Exception: continue
        if m.get('method') == 'Network.requestWillBeSent':
            rq = m['params']['request']
            if 'api.' in rq['url'] and rq['headers'].get('Authorization'):
                auth = {k: v for k, v in rq['headers'].items() if k.lower() in ('authorization', 'x-generation-actor', 'x-generation-surface')}
            if 'shared-voices' in rq['url']: reqids.append(m['params']['requestId'])
        if m.get('method') == 'Network.loadingFinished' and m['params']['requestId'] in reqids:
            try:
                b = s.call('Network.getResponseBody', requestId=m['params']['requestId'])
                for v in json.loads(b['body']).get('voices', []): voices[v['voice_id']] = v
            except Exception as e: print('body err', e)
s.call('Page.navigate', url='https://elevenlabs.io/app/speech-synthesis/text-to-speech')
json.dump(list(voices.values()), open(SP + 'shared_voices.json', 'w'), ensure_ascii=False)
if auth: json.dump([{'url': 'https://api.us.elevenlabs.io/v1/text-to-dialogue/stream?', 'headers': auth, 'body': json.dumps({'model_id': 'eleven_v3'})}], open(SP + 'el_reqs.json', 'w'))
print('voices', len(voices), 'auth', bool(auth))
for v in voices.values():
    print(v['voice_id'], '|', v.get('name'), '|', v.get('age'), v.get('gender'), v.get('language'), v.get('accent'), '|', (v.get('description') or '')[:80].replace('\n', ' '), '| used', v.get('cloned_by_count'))
