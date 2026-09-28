"""Pixabay SFX via the dedicated test Chrome tab over CDP (port of ~/.codex/skills/pixabay/scripts/pixabay-cdp.mjs).
  inspect "query" [query2 ...]           -> list titles/authors/durations
  download items.json OUT_DIR           -> [{name, query, match}] ; writes mp3 + manifest.json
Always returns the tab to the project URL afterwards. Never opens tabs."""
import base64, hashlib, json, os, re, sys, time, datetime, urllib.parse
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cdp.py')).read().replace('\nmain()\n', '\n')
ns = {'__file__': __file__}; exec(src, ns)
c = ns['CDP']()
PROJECT = 'http://localhost:8797/index.html'


def ev(js):
    r = c.call('Runtime.evaluate', expression=js, awaitPromise=True, returnByValue=True)
    if 'exceptionDetails' in r:
        raise RuntimeError(r['exceptionDetails'].get('exception', {}).get('description') or r['exceptionDetails'].get('text'))
    return r['result'].get('value')


def search(q):
    c.call('Page.navigate', url='https://pixabay.com/sound-effects/search/' + urllib.parse.quote(q) + '/')
    for _ in range(20):
        time.sleep(0.7)
        try:
            if ev("document.readyState") == 'complete' and ev("document.querySelectorAll('a[class*=\"title--\"]').length") > 0:
                break
        except Exception:
            pass
    ev("""(()=>{document.querySelector('#onetrust-reject-all-handler')?.click();
      for(const d of document.querySelectorAll('[role="dialog"]'))d.querySelector('[aria-label="Close"]')?.closest('button')?.click();})()""")


ROWS = """[...document.querySelectorAll('a[class*="title--"]')].slice(0,14).map(a=>{const row=a.closest('[class*="audioRow"]');
  const t=(row?.innerText||'').match(/\\b\\d{1,2}:\\d{2}\\b/);
  return {title:a.textContent.trim(), author:row?.querySelector('a[href*="/users/"]')?.textContent||'', dur:t?t[0]:'', url:a.href}})"""

try:
    if sys.argv[1] == 'inspect':
        for q in sys.argv[2:]:
            search(q)
            print('##', q)
            for r in ev(ROWS) or []:
                print(f"  {r['dur']:>5}  {r['title'][:60]:60}  by {r['author']}")
    elif sys.argv[1] == 'download':
        items = json.load(open(sys.argv[2])); out = sys.argv[3]; os.makedirs(out, exist_ok=True)
        mpath = os.path.join(out, 'manifest.json')
        manifest = json.load(open(mpath)) if os.path.exists(mpath) else []
        for it in items:
            dest = os.path.join(out, it['name'] + '.mp3')
            if os.path.exists(dest):
                print('skip existing', it['name']); continue
            search(it['query'])
            res = ev("""(async()=>{
              const a=[...document.querySelectorAll('a[class*="title--"]')].find(a=>new RegExp(%s,'i').test(a.textContent));
              if(!a) throw Error('Matching track not found');
              const row=a.closest('[class*="audioRow"]'); row.querySelector('[aria-label="Play"]')?.closest('button')?.click();
              row.scrollIntoView({block:"center"}); await new Promise(r=>setTimeout(r,1800));
              const audio=[...document.querySelectorAll('audio')].at(-1); audio?.pause(); const src=audio?.src;
              if(!src||new URL(src).hostname!=='cdn.pixabay.com') throw Error('No public Pixabay audio source');
              const resp=await fetch(src); if(!resp.ok) throw Error('HTTP '+resp.status);
              const bytes=new Uint8Array(await resp.arrayBuffer()); if(bytes.length>10000000) throw Error('too big');
              let bin=''; for(let i=0;i<bytes.length;i+=32768) bin+=String.fromCharCode(...bytes.subarray(i,i+32768));
              return {title:a.textContent.trim(), author:row.querySelector('a[href*="/users/"]')?.textContent||'', page:a.href, download:src, b64:btoa(bin)};
            })()""" % json.dumps(it['match']))
            data = base64.b64decode(res.pop('b64'))
            if any(m['download'] == res['download'] for m in manifest):
                raise RuntimeError('repeated audio source for ' + it['name'])
            if not (data[:3] == b'ID3' or (data[0] == 255 and (data[1] & 224) == 224)):
                raise RuntimeError('not an mp3: ' + it['name'])
            open(dest, 'xb').write(data)
            manifest.append({'name': it['name'], **res, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                             'downloadedAt': datetime.datetime.now().isoformat(), 'license': 'https://pixabay.com/service/license-summary/'})
            json.dump(manifest, open(mpath, 'w'), indent=2, ensure_ascii=False)
            print('saved', it['name'], len(data), res['title'], 'by', res['author'])
finally:
    c.call('Page.navigate', url=PROJECT)
