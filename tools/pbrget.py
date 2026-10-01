"""Poly Haven (CC0) PBR texture sets for the engine: pbrget.py RES id [id ...] -> assets/pbr/<id>_{d,n,a}.webp
d = albedo (sRGB), n = normal (OpenGL, +Y up), a = ARM (R ambient occlusion, G roughness, B metal) — the engine's mr layout."""
import io, json, os, sys, urllib.request
from PIL import Image
UA = {'User-Agent': 'gaze-horror-asset-fetch/1.0'}
get = lambda u: urllib.request.urlopen(urllib.request.Request(u, headers=UA)).read()
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'pbr')
res, ids = sys.argv[1], sys.argv[2:]
for i in ids:
    f = json.loads(get(f'https://api.polyhaven.com/files/{i}'))
    for key, suf in (('Diffuse', 'd'), ('nor_gl', 'n'), ('arm', 'a')):
        if key not in f:
            print(i, 'no', key); continue
        im = Image.open(io.BytesIO(get(f[key][res]['jpg']['url']))).convert('RGB')
        im.save(os.path.join(OUT, f'{i}_{suf}.webp'), quality=82 if suf == 'd' else 88, method=6)
    print(i, 'ok')
