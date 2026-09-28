import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('el', 'el.py'); el = importlib.util.module_from_spec(spec); spec.loader.exec_module(el)
t, ws = el.pick_tab(); s = el.Session(ws)
r = s.call('Runtime.evaluate', returnByValue=True, awaitPromise=True, expression=sys.argv[1])
print(json.dumps(r.get('result', {}).get('value', r), ensure_ascii=False)[:4000])
