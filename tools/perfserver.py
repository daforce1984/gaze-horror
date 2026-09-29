"""Collector for the game's performance log (js/telemetry.js).
POST /perf   text/plain JSON batch {session, seq, info?, samples[], events[]} -> design/perflogs/<day>/<session>.jsonl
GET  /       sessions seen (newest first)
python3 tools/perfserver.py [port]   (default 8798)"""
import json, os, sys, time, threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'design', 'perflogs')
LOCK = threading.Lock()
MAX = 2_000_000


class H(BaseHTTPRequestHandler):
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()

    def do_POST(self):
        if self.path.split('?')[0] not in ('/perf', '/'):
            self.send_response(404); self.cors(); self.end_headers(); return
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > MAX:
            self.send_response(413); self.cors(); self.end_headers(); return
        try:
            b = json.loads(self.rfile.read(n))
            sid = ''.join(c for c in str(b.get('session', 'unknown')) if c.isalnum() or c == '-')[:64] or 'unknown'
        except Exception:
            self.send_response(400); self.cors(); self.end_headers(); return
        day = time.strftime('%Y-%m-%d')
        os.makedirs(os.path.join(ROOT, day), exist_ok=True)
        b['recvAt'] = time.strftime('%Y-%m-%dT%H:%M:%S'); b['ip'] = self.client_address[0]
        with LOCK, open(os.path.join(ROOT, day, sid + '.jsonl'), 'a', encoding='utf-8') as f:
            f.write(json.dumps(b, ensure_ascii=False) + '\n')
        self.send_response(204); self.cors(); self.end_headers()

    def do_GET(self):
        rows = []
        for dp, _, fns in os.walk(ROOT):
            for fn in fns:
                p = os.path.join(dp, fn); rows.append((os.path.getmtime(p), os.path.relpath(p, ROOT), os.path.getsize(p)))
        rows.sort(reverse=True)
        out = json.dumps([{'file': r[1], 'bytes': r[2], 'updated': time.strftime('%H:%M:%S', time.localtime(r[0]))} for r in rows[:200]], indent=1)
        self.send_response(200); self.cors(); self.send_header('Content-Type', 'application/json'); self.end_headers()
        self.wfile.write(out.encode())

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8798
    os.makedirs(ROOT, exist_ok=True)
    print('perf collector on :%d -> %s' % (port, ROOT), flush=True)
    ThreadingHTTPServer(('0.0.0.0', port), H).serve_forever()
