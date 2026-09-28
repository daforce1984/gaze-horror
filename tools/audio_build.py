"""Build runtime audio from sources (uv run --with soundfile --with numpy python tools/audio_build.py).
Sources: audio-source/pixabay (Pixabay Content License, see manifest.json) and audio-source/music (generated with MiniMax Music 3)."""
import os, json
import numpy as np, soundfile as sf
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PX, MU, OUT = [os.path.join(ROOT, p) for p in ('audio-source/pixabay', 'audio-source/music', 'assets/audio')]

# name: (start s, end s or None, peak, mono)
SFX = {
    'knock': (1.95, 2.95, 0.9, True), 'bang': (0.05, 0.9, 0.95, True), 'creak': (0.08, 2.2, 0.9, True),
    'drawer': (0.15, 2.6, 0.85, True), 'unlock': (0.3, 0.75, 0.9, True), 'pop': (0.12, 1.32, 0.95, True),
    'static': (0.05, 1.6, 0.8, True), 'steps': (0.55, 2.6, 0.9, True), 'chime': (0.1, 9.0, 0.8, True),
    'giggle': (0.1, 3.8, 0.9, True), 'giggle2': (0.03, 4.7, 0.9, True), 'whisper': (0.1, 5.5, 0.9, True),
    'whisper2': (0.55, 5.2, 0.9, True), 'scare': (0.1, 2.6, 0.95, False), 'scare2': (0.18, 2.6, 0.95, False),
    'curtain': (0.05, 3.2, 0.8, True),
}
LOOPS = {'buzz': (20.0, 30.0, 1.5, 0.8), 'tvloop': (1.0, 12.0, 1.5, 0.8)}  # start, end, crossfade, peak
MUSIC = {'music_room': ('ambient_take01/minimax_music_00012.flac', 4.0, 0.6), 'music_chase': ('chase_take01/minimax_music_00013.flac', 3.0, 0.62)}


def fade(x, sr, fin=0.008, fout=0.15):
    n1, n2 = int(sr * fin), min(int(sr * fout), len(x) // 2)
    x[:n1] *= np.linspace(0, 1, n1)[:, None]; x[-n2:] *= np.linspace(1, 0, n2)[:, None]
    return x


def loopify(x, sr, xf):
    n = int(sr * xf); body, tail, head = x[n:-n], x[-n:], x[:n]
    t = np.linspace(0, 1, n)[:, None]
    # equal-power crossfade of tail into head, placed at the end so file end meets body start
    return np.concatenate([body, tail * np.cos(t * np.pi / 2) + head * np.sin(t * np.pi / 2)])


def write(name, x, sr):
    path = os.path.join(OUT, name + '.mp3')
    sf.write(path, x.astype(np.float32), sr, format='MP3')
    y, sr2 = sf.read(path, always_2d=True)
    print(f'{name:12} {len(y) / sr2:6.2f}s ch={y.shape[1]} peak={np.abs(y).max():.2f} rms={np.sqrt((y ** 2).mean()):.3f} {os.path.getsize(path) // 1024}KB')
    return {'file': 'assets/audio/' + name + '.mp3', 'seconds': round(len(y) / sr2, 3)}


meta = {}
for name, (a, b, peak, mono) in SFX.items():
    x, sr = sf.read(os.path.join(PX, name + '.mp3'), always_2d=True)
    x = x[int(a * sr): int(b * sr) if b else None].copy()
    if mono: x = x.mean(1, keepdims=True)
    x = fade(x, sr); x *= peak / max(1e-6, np.abs(x).max())
    meta[name] = write(name, x, sr)
for name, (a, b, xf, peak) in LOOPS.items():
    x, sr = sf.read(os.path.join(PX, name + '.mp3'), always_2d=True)
    x = x[int(a * sr): int(b * sr)].mean(1, keepdims=True)
    x = loopify(x, sr, xf); x *= peak / np.abs(x).max()
    meta[name] = write(name, x, sr)
for name, (src, xf, peak) in MUSIC.items():
    x, sr = sf.read(os.path.join(MU, src), always_2d=True)
    x = loopify(x, sr, xf); x *= peak / np.abs(x).max()
    meta[name] = write(name, x, sr)
json.dump(meta, open(os.path.join(OUT, 'audio.json'), 'w'), indent=1)
