# Convert generated PNGs into web-ready WebP assets (run with: uv run --with pillow python tools/convert.py)
import os
from PIL import Image
SRC = '/mnt/d/_AI_GENERATED/______2026/codex_image_generator/output/'
DST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets')
MAP = {  # out name: (src, max size, crop box as fractions or None, quality)
    'wall': ('horror_tex_wall', 1024, None, 82), 'floor': ('horror_tex_floor', 1024, None, 82),
    'ceiling': ('horror_tex_ceiling', 1024, None, 80), 'curtain': ('horror_tex_curtain', 1024, None, 82),
    'wood': ('horror_tex_wood', 1024, None, 82), 'fabric': ('horror_tex_fabric', 1024, None, 82),
    'plastic': ('horror_tex_plastic', 1024, None, 82), 'paper': ('horror_tex_paper', 1024, None, 80),
    'door': ('horror_door', 1024, (0.068, 0.018, 0.93, 1.0), 85), 'window': ('horror_window', 1024, None, 85),
    'ghost_face': ('horror_ghost_face', 768, None, 85), 'key': ('horror_key', 512, None, 85),
    'polaroid': ('horror_polaroid_v2', 768, None, 85),
    'child_drawing': ('horror_child_drawing', 768, None, 85), 'newspaper': ('horror_newspaper', 768, None, 82),
    'keyart_portrait': ('horror_keyart_portrait', 1200, None, 80), 'keyart_land': ('horror_keyart_land', 1600, None, 80),
}
for out, (src, mx, crop, q) in MAP.items():
    p = SRC + src + '.png'
    if not os.path.exists(p):
        print('missing', src); continue
    dst = os.path.join(DST, out + '.webp')
    if os.path.exists(dst) and os.path.getmtime(dst) > os.path.getmtime(p):
        continue
    im = Image.open(p)
    im = im.convert('RGBA') if im.mode in ('RGBA', 'LA', 'P') else im.convert('RGB')
    if crop:
        w, h = im.size
        im = im.crop((int(crop[0] * w), int(crop[1] * h), int(crop[2] * w), int(crop[3] * h)))
    im.thumbnail((mx, mx), Image.LANCZOS)
    im.save(dst, 'WEBP', quality=q, method=6)
    print(out, im.size, im.mode, os.path.getsize(dst) // 1024, 'KB')
