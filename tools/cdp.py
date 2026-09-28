"""CDP helper for the dedicated horror WebGPU test Chrome. Reuses ONE tab (saved target id). Never opens new tabs.
  uv run -q --with websocket-client tools/cdp.py start URL
  ... nav URL | eval JS | shot out.png [w h] | logs | reload
"""
import json, os, subprocess, sys, time, urllib.request, base64
import websocket

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, '.tab.json')
DEBUG_PORT, RELAY_PORT = 9021, 9022
WIN_PY = "/mnt/c/Users/dafor/AppData/Local/Python/bin/python.exe"
RELAY = os.path.expanduser('~/.claude/skills/chatgpt-image/scripts/cdp_relay.py')


def gw():
    for line in open('/proc/net/route'):
        f = line.split()
        if f[1] == '00000000':
            g = f[2]
            return '.'.join(str(int(g[i:i + 2], 16)) for i in (6, 4, 2, 0))


BASE = f'http://{gw()}:{RELAY_PORT}'


def http(path):
    with urllib.request.urlopen(BASE + path, timeout=5) as r:
        return json.loads(r.read().decode())


def reachable():
    try:
        http('/json/version'); return True
    except Exception:
        return False


def winpath(p):
    return subprocess.check_output(['wslpath', '-w', p]).decode().strip()


def win_listening(port):
    out = subprocess.run(['powershell.exe', '-NoProfile', '-Command',
                          f'(Get-NetTCPConnection -State Listen -LocalPort {port} -ErrorAction SilentlyContinue | Measure-Object).Count'],
                         capture_output=True, text=True).stdout.strip()
    return out not in ('', '0')


def start(url):
    if not win_listening(DEBUG_PORT):
        subprocess.Popen(['cmd.exe', '/c', winpath(os.path.join(HERE, 'horror_chrome.bat')), url], cwd='/mnt/c',
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        for _ in range(30):
            time.sleep(1)
            if win_listening(DEBUG_PORT):
                break
    if not win_listening(RELAY_PORT):
        subprocess.Popen([WIN_PY, winpath(RELAY), str(RELAY_PORT), str(DEBUG_PORT)], cwd='/mnt/c',
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    for _ in range(20):
        if reachable():
            break
        time.sleep(1)
    else:
        sys.exit('relay unreachable ' + BASE)
    print(json.dumps(tab(url), ensure_ascii=False))


def tab(url_hint='horror'):
    pages = [t for t in http('/json/list') if t['type'] == 'page']
    saved = json.load(open(STATE)) if os.path.exists(STATE) else {}
    for t in pages:
        if t['id'] == saved.get('id'):
            return t
    for t in pages:  # the project tab (by URL) — never an unrelated tab
        if ':8797' in t['url'] or 'horror' in t['url'] or 'github.io/eunggaze' in t['url'] or t['url'] in ('about:blank', 'chrome://newtab/', 'chrome://intro/'):
            json.dump({'id': t['id']}, open(STATE, 'w'))
            return t
    sys.exit('no suitable test tab (will not create one)')


class CDP:
    def __init__(self):
        t = tab()
        ws = t['webSocketDebuggerUrl'].replace('127.0.0.1:%d' % DEBUG_PORT, '%s:%d' % (gw(), RELAY_PORT)).replace('localhost:%d' % DEBUG_PORT, '%s:%d' % (gw(), RELAY_PORT))
        self.ws = websocket.create_connection(ws, timeout=60, suppress_origin=True)
        self.i = 0
        self.events = []

    def call(self, method, **params):
        self.i += 1
        self.ws.send(json.dumps({'id': self.i, 'method': method, 'params': params}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get('id') == self.i:
                if 'error' in m:
                    raise RuntimeError(m['error'])
                return m.get('result', {})
            self.events.append(m)


def main():
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == 'start':
        return start(args[0])
    c = CDP()
    if cmd == 'nav':
        c.call('Page.navigate', url=args[0])
    elif cmd == 'reload':
        c.call('Page.reload', ignoreCache=True)
    elif cmd == 'eval':
        r = c.call('Runtime.evaluate', expression=args[0], awaitPromise=True, returnByValue=True)
        print(json.dumps(r.get('result', {}).get('value', r), ensure_ascii=False, indent=1)[:6000])
    elif cmd == 'shot':
        if len(args) >= 3:
            c.call('Emulation.setDeviceMetricsOverride', width=int(args[1]), height=int(args[2]), deviceScaleFactor=1, mobile=int(args[1]) < int(args[2]))
            time.sleep(1.5)
        r = c.call('Page.captureScreenshot', format='png')
        open(args[0], 'wb').write(base64.b64decode(r['data']))
        print('saved', args[0])
    elif cmd == 'clearsize':
        c.call('Emulation.clearDeviceMetricsOverride')
    elif cmd == 'logs':
        c.call('Runtime.enable'); c.call('Log.enable')
        time.sleep(float(args[0]) if args else 2)
        c.ws.settimeout(0.5)
        try:
            while True:
                c.events.append(json.loads(c.ws.recv()))
        except Exception:
            pass
        for e in c.events:
            if e.get('method') == 'Runtime.consoleAPICalled':
                print(e['params']['type'], ' '.join(str(a.get('value', a.get('description', ''))) for a in e['params']['args'])[:500])
            elif e.get('method') == 'Runtime.exceptionThrown':
                print('EXC', json.dumps(e['params']['exceptionDetails'])[:800])
            elif e.get('method') == 'Log.entryAdded':
                print('LOG', e['params']['entry']['level'], e['params']['entry']['text'][:300])


main()
