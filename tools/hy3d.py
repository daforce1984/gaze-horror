"""Image -> 3D mesh with Hunyuan3D 2.1 on the user's ComfyUI (HTTP API).
usage: hy3d.py IMAGE.png OUT.glb [seed] [octree]   — image is composited on white, padded to square."""
import json, sys, time, uuid, urllib.request, urllib.parse, urllib.error, io, os
from PIL import Image
S = 'http://192.168.0.148:8188'
src, out = sys.argv[1], sys.argv[2]
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 1234
octree = int(sys.argv[4]) if len(sys.argv) > 4 else 256
im = Image.open(src).convert('RGBA')
if im.getextrema()[3][0] == 255:   # opaque studio background: remove the border-connected region close to the backdrop colour
    import numpy as np
    from PIL import ImageDraw, ImageFilter
    arr = np.asarray(im.convert('RGB')).astype(np.int16); H, W = arr.shape[:2]
    border = np.concatenate([arr[0], arr[-1], arr[:, 0], arr[:, -1]])
    bgc = np.median(border, axis=0)
    # local backdrop estimate: heavy blur of the image with the figure masked out would be ideal; a column/row gradient is enough here
    dist = np.abs(arr - bgc).max(axis=2)
    cand = (dist <= 30).astype(np.uint8) * 255
    m = Image.fromarray(cand, 'L')
    key = Image.new('L', (W + 2, H + 2), 255); key.paste(m, (1, 1))
    ImageDraw.floodfill(key, (0, 0), 128)
    bgmask = (np.asarray(key)[1:-1, 1:-1] == 128)
    alpha = Image.fromarray(np.where(bgmask, 0, 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    im.putalpha(alpha)
    im.save(out.replace('.glb', '_cut.png'))
bb = im.getbbox() if im.getextrema()[3][0] < 255 else None
if bb: im = im.crop(bb)
side = int(max(im.size) * 1.15)
bg = Image.new('RGBA', (side, side), (255, 255, 255, 255))
bg.alpha_composite(im, ((side - im.width) // 2, (side - im.height) // 2))
buf = io.BytesIO(); bg.convert('RGB').resize((1024, 1024), Image.LANCZOS).save(buf, 'PNG')
name = 'hy3d_' + uuid.uuid4().hex[:8] + '.png'
bnd = uuid.uuid4().hex
body = (f'--{bnd}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\nContent-Type: image/png\r\n\r\n').encode() + buf.getvalue() + f'\r\n--{bnd}--\r\n'.encode()
r = urllib.request.Request(S + '/upload/image', data=body, headers={'Content-Type': f'multipart/form-data; boundary={bnd}'})
up = json.load(urllib.request.urlopen(r)); print('uploaded', up)
g = {
 'c': {'class_type': 'ImageOnlyCheckpointLoader', 'inputs': {'ckpt_name': 'hunyuan_3d_v2.1.safetensors'}},
 'a': {'class_type': 'LoadImage', 'inputs': {'image': up['name']}},
 'e': {'class_type': 'CLIPVisionEncode', 'inputs': {'clip_vision': ['c', 1], 'image': ['a', 0], 'crop': 'none'}},
 'h': {'class_type': 'Hunyuan3Dv2Conditioning', 'inputs': {'clip_vision_output': ['e', 0]}},
 'l': {'class_type': 'EmptyLatentHunyuan3Dv2', 'inputs': {'resolution': 3072, 'batch_size': 1}},
 's': {'class_type': 'KSampler', 'inputs': {'model': ['c', 0], 'positive': ['h', 0], 'negative': ['h', 1], 'latent_image': ['l', 0], 'seed': seed, 'steps': 30, 'cfg': 5.0, 'sampler_name': 'euler', 'scheduler': 'normal', 'denoise': 1.0}},
 'd': {'class_type': 'VAEDecodeHunyuan3D', 'inputs': {'samples': ['s', 0], 'vae': ['c', 2], 'num_chunks': 8000, 'octree_resolution': octree}},
 'm': {'class_type': 'VoxelToMesh', 'inputs': {'voxel': ['d', 0], 'algorithm': 'surface net', 'threshold': 0.6}},
 'o': {'class_type': 'SaveGLB', 'inputs': {'mesh': ['m', 0], 'filename_prefix': 'mesh/horror_' + os.path.basename(out).replace('.glb', '')}},
}
# ComfyUI queues the job itself; submitting while another job runs avoids an idle-queue validation bug on this server
open('/tmp/claude-1000/-mnt-d--AI-GENERATED-------2026-horror/ade6b511-f646-4ef8-a52c-feaabe89190d/scratchpad/hy3d_last.json','w').write(json.dumps(g, indent=1))
r = urllib.request.Request(S + '/prompt', data=json.dumps({'prompt': g, 'client_id': uuid.uuid4().hex}).encode(), headers={'Content-Type': 'application/json'})
try:
    rec = json.load(urllib.request.urlopen(r))
except urllib.error.HTTPError as e:
    sys.exit('prompt rejected: ' + e.read().decode()[:1500])
pid = rec['prompt_id']; print('prompt', pid, rec.get('node_errors'), flush=True)
t0 = time.time()
while True:
    h = json.load(urllib.request.urlopen(S + '/history/' + pid)).get(pid)
    if h and h.get('status', {}).get('completed') is not None and (h['status'].get('completed') or h['status'].get('status_str') == 'error'): break
    if time.time() - t0 > 1800: sys.exit('timeout')
    time.sleep(5)
st = h['status']; print('status', st.get('status_str'), round(time.time() - t0), 's')
if st.get('status_str') != 'success':
    print(json.dumps(st.get('messages'))[:2000]); sys.exit(1)
files = [f for o in h['outputs'].values() for k in ('3d', 'meshes', 'glb', 'result') for f in o.get(k, [])] or [f for o in h['outputs'].values() for v in o.values() if isinstance(v, list) for f in v if isinstance(f, dict) and 'filename' in f]
print('outputs', json.dumps(h['outputs'])[:500])
f = files[0]
qs = urllib.parse.urlencode({k: f.get(k, '') for k in ('filename', 'subfolder', 'type')})
data = urllib.request.urlopen(S + '/view?' + qs, timeout=120).read()
open(out, 'wb').write(data); print('saved', out, len(data))
