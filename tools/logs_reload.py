import json, os, time
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cdp.py')).read().replace('\nmain()\n', '\n')
ns = {'__file__': __file__}; exec(src, ns); c = ns['CDP']()
c.call('Runtime.enable'); c.call('Log.enable'); c.call('Page.reload', ignoreCache=True)
end = time.time() + 9; c.ws.settimeout(1)
while time.time() < end:
    try: e = json.loads(c.ws.recv())
    except Exception: continue
    m = e.get('method')
    if m == 'Runtime.consoleAPICalled': print(e['params']['type'], ' '.join(str(a.get('value', a.get('description', ''))) for a in e['params']['args'])[:1500])
    elif m == 'Runtime.exceptionThrown': print('EXC', json.dumps(e['params']['exceptionDetails'])[:1500])
    elif m == 'Log.entryAdded': print('LOG', e['params']['entry']['level'], e['params']['entry']['text'][:1500])
