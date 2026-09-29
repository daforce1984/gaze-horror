"""Per-session performance report from design/perflogs (written by tools/perfserver.py).
python3 tools/perfreport.py [session-prefix | day] [--md out.md]
For each session: device, frame rate over time, GPU time per pass, and which game states go with slow frames."""
import json, os, sys, glob, statistics as st
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'design', 'perflogs')
args = [a for a in sys.argv[1:] if not a.startswith('--')]
md_out = sys.argv[sys.argv.index('--md') + 1] if '--md' in sys.argv else None


def load(path):
    info, samples, events = {}, [], []
    for line in open(path, encoding='utf-8'):
        try:
            b = json.loads(line)
        except Exception:
            continue
        info = info or (b.get('info') or {})
        samples += b.get('samples', []); events += b.get('events', [])
    samples.sort(key=lambda s: s['t']); events.sort(key=lambda e: e['t'])
    return info, samples, events


def mean(xs):
    xs = [x for x in xs if x is not None]
    return st.mean(xs) if xs else None


def f1(x, d=1):
    return '-' if x is None else f'{x:.{d}f}'


def buckets(samples):
    """average fps / GPU ms per game-state feature, to see what goes with slow seconds"""
    feats = {
        'ghost on screen': lambda s: bool(s.get('ghost')) and not s['ghost'].endswith(':0.00'),
        'ghost crawling': lambda s: 'crawl' in (s.get('ghost') or ''),
        'room shift (ash, burn)': lambda s: (s.get('shift') or 0) > 0,
        'CCTV rendering': lambda s: s.get('cctv') == 1,
        'TV on': lambda s: s.get('tv') == 1,
        'insanity > 0.3': lambda s: (s.get('ins') or 0) > 0.3,
        'zoomed in': lambda s: (s.get('zoom') or 1) > 1.5,
        'anomaly night': lambda s: (s.get('night') or 0) > 0,
        'inspecting item': lambda s: s.get('insp') == 1,
        'decay > 0.3': lambda s: (s.get('decay') or 0) > 0.3,
    }
    rows = []
    live = [s for s in samples if not s.get('paused')]
    for name, fn in feats.items():
        on = [s for s in live if fn(s)]; off = [s for s in live if not fn(s)]
        if not on:
            continue
        g_on = mean([(s.get('gpu') or {}).get('total') for s in on]); g_off = mean([(s.get('gpu') or {}).get('total') for s in off])
        rows.append((name, len(on), mean([s['fps'] for s in on]), mean([s['fps'] for s in off]) if off else None, g_on, g_off,
                     mean([s['p95'] for s in on]), mean([s['jsMs'] for s in on])))
    rows.sort(key=lambda r: (r[3] or r[2]) - r[2], reverse=True)   # biggest fps drop first
    return rows


def report(path):
    info, S, E = load(path)
    out = []
    sid = os.path.basename(path)[:-6]
    out.append(f'## Session {sid}')
    if info:
        g = info.get('gpu') or {}
        out.append(f"- device: {info.get('platform')} {'mobile' if info.get('mobile') or info.get('coarse') else 'desktop'}, "
                   f"screen {info.get('screen')} @{info.get('dpr')}x, {info.get('cores')} cores, {info.get('memGB')} GB")
        out.append(f"- GPU: {g.get('vendor')} {g.get('architecture')} {g.get('description') or ''} (timestamps: {info.get('timestamps')})")
        out.append(f"- graphics: {info.get('gfx')} -> {info.get('preset')}, build {info.get('build')}")
        out.append(f"- UA: {info.get('ua')}")
    if not S:
        out.append('- no samples'); return '\n'.join(out)
    live = [s for s in S if not s.get('paused')]
    fps = [s['fps'] for s in live] or [0]
    out.append(f"- played {S[-1]['t']:.0f} s, {len(live)} live seconds; fps mean {st.mean(fps):.1f}, "
               f"worst 10% {sorted(fps)[max(0, len(fps) // 10 - 1)]:.1f}, long frames (>50 ms) {sum(s.get('long', 0) for s in live)}")
    out.append(f"- render {live[-1].get('px')} scale {live[-1].get('scale')}, main draws ~{f1(mean([s.get('draws') for s in live]), 0)} "
               f"tris ~{f1(mean([s.get('tris') for s in live]), 0)}, shadow draws ~{f1(mean([s.get('sDraws') for s in live]), 0)} "
               f"tris ~{f1(mean([s.get('sTris') for s in live]), 0)}, JS {f1(mean([s.get('jsMs') for s in live]), 2)} ms/frame")
    gp = [s['gpu'] for s in live if s.get('gpu')]
    if gp:
        out.append('- GPU ms per frame (mean / max): ' + ', '.join(
            f"{k} {f1(mean([g.get(k) for g in gp]), 2)} / {f1(max((g.get(k) or 0) for g in gp), 2)}" for k in ('total', 'shadow', 'main', 'post', 'cctv')))
    out.append('\n| state | seconds | fps with | fps without | GPU ms with | GPU ms without | p95 frame ms | JS ms |\n|---|---|---|---|---|---|---|---|')
    for r in buckets(S):
        out.append(f'| {r[0]} | {r[1]} | {f1(r[2])} | {f1(r[3])} | {f1(r[4], 2)} | {f1(r[5], 2)} | {f1(r[6])} | {f1(r[7], 2)} |')
    # slowest seconds with their context
    worst = sorted(live, key=lambda s: s['fps'])[:6]
    out.append('\nslowest seconds:')
    for s in worst:
        out.append(f"- t={s['t']:.0f}s fps {s['fps']} p95 {s['p95']} ms, gpu {s.get('gpu')}, phase {s.get('phase')} night {s.get('night')} "
                   f"ghost '{s.get('ghost')}' shift {s.get('shift')} cctv {s.get('cctv')} ins {s.get('ins')} anom '{s.get('anom')}'")
    longs = [e for e in E if e['type'] == 'long']
    if longs:
        out.append(f'\nlong frames: {len(longs)} (ms: ' + ', '.join(str(e['ms']) for e in longs[:30]) + ')')
        # which game events came right before long frames (shader/pipeline warm-up, texture uploads ...)
        game = [e for e in E if e['type'] == 'game']
        near = defaultdict(int)
        for e in longs:
            prev = [g for g in game if 0 <= e['t'] - g['t'] < 1.0]
            for g in prev:
                near[g.get('ev')] += 1
        if near:
            out.append('- game events within 1 s before a long frame: ' + ', '.join(f'{k} x{v}' for k, v in sorted(near.items(), key=lambda x: -x[1])))
    for e in E:
        if e['type'] in ('exception', 'device_lost', 'error'):
            out.append(f"- {e['type']} at {e['t']}s: {e.get('msg') or e.get('reason')}")
    sc = [e for e in E if e['type'] == 'scale']
    if sc:
        out.append('- dynamic resolution: ' + ' -> '.join(f"{e['to']}@{e['t']:.0f}s" for e in sc))
    ld = [e for e in E if e['type'] == 'loaded']
    if ld:
        out.append(f"- load time {ld[0]['ms']} ms")
    return '\n'.join(out)


files = sorted(glob.glob(os.path.join(ROOT, '*', '*.jsonl')), key=os.path.getmtime)
if args:
    files = [f for f in files if any(a in f for a in args)]
text = '\n\n'.join(report(f) for f in files) or 'no sessions'
print(text)
if md_out:
    open(md_out, 'w', encoding='utf-8').write('# Performance sessions\n\n' + text + '\n')
