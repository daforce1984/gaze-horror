"""Download Poly Haven (CC0) models as glTF at a given texture resolution: phget.py RES id [id ...] -> design/ph/<id>/"""
import json, os, sys, urllib.request
UA = {'User-Agent': 'gaze-horror-asset-fetch/1.0'}
open_ = lambda u: urllib.request.urlopen(urllib.request.Request(u, headers=UA))
res, ids = sys.argv[1], sys.argv[2:]
root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'design', 'ph')
def get(url, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if not os.path.exists(path): open(path, 'wb').write(open_(url).read())
for i in ids:
    f = json.load(open_(f'https://api.polyhaven.com/files/{i}'))
    g = f['gltf'][res]['gltf']
    get(g['url'], os.path.join(root, i, os.path.basename(g['url'])))
    for rel, inc in g.get('include', {}).items(): get(inc['url'], os.path.join(root, i, rel))
    print(i, 'ok', sum(os.path.getsize(os.path.join(dp, fn)) for dp, _, fns in os.walk(os.path.join(root, i)) for fn in fns) // 1024, 'KB')
