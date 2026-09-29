"""PBR sets from the Codex albedo textures: make the tile seamless, then derive a normal map and an
occlusion/roughness/metal map (R = cavity AO, G = roughness, B = metal) from its luminance.
uv run --with pillow --with numpy --with scipy python tools/pbrmaps.py [name ...]"""
import os, sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

SRC = '/mnt/d/_AI_GENERATED/______2026/codex_image_generator/output/'
DST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets')
# out: (source, size, normal strength, roughness base, roughness from darkness, metal, maps?)
SETS = {
    'wall_clean': ('horror_pbr_wallpaper', 1024, 1.6, 0.82, 0.1, 0.0, True),
    'wall': ('horror_pbr_wallpaper_rot', 1024, 3.0, 0.7, 0.2, 0.0, False),
    'floor_clean': ('horror_pbr_floor', 1024, 3.0, 0.5, 0.35, 0.0, True),
    'floor': ('horror_pbr_floor_rot', 1024, 3.5, 0.45, 0.3, 0.0, False),
    'ceiling': ('horror_pbr_ceiling', 1024, 1.2, 0.9, 0.05, 0.0, True),
    'curtain': ('horror_pbr_curtain', 1024, 2.0, 0.95, 0.0, 0.0, True),
    'rug': ('horror_pbr_rug', 1024, 2.5, 0.95, 0.0, 0.0, True),
    'door': ('@door', 1024, 2.5, 0.6, 0.3, 0.0, True),   # keeps the whole-door picture, maps only
    'wood': ('horror_pbr_wood_dark', 1024, 2.2, 0.45, 0.35, 0.0, True),
    'wood_light': ('horror_pbr_wood_light', 1024, 2.0, 0.5, 0.3, 0.0, True),
    'rope': ('horror_pbr_rope', 512, 4.0, 0.9, 0.05, 0.0, True),
    'rust': ('horror_pbr_rust', 512, 3.0, 0.7, 0.2, 0.35, True),
}


def seamless(a, frac=0.18):
    """cross-fade the image with itself shifted by half, weighted towards the shifted copy near the edges"""
    h, w = a.shape[:2]
    b = np.roll(np.roll(a, h // 2, 0), w // 2, 1)
    ramp = lambda n: np.clip(np.minimum(np.arange(n), np.arange(n)[::-1]) / (n * frac), 0, 1)
    m = np.minimum.outer(ramp(h), ramp(w))[..., None]
    return a * m + b * (1 - m)


def build(out, src, size, strength, r0, rdark, metal, maps):
    own = src.startswith('@')   # an existing asset: derive maps only
    path = os.path.join(DST, src[1:] + '.webp') if own else os.path.join(SRC, src + '.png')
    if not os.path.exists(path):
        print('missing', src); return
    im = Image.open(path).convert('RGB')
    a = np.asarray(im if own else im.resize((size, size), Image.LANCZOS), dtype=np.float32) / 255
    if not own:
        a = seamless(a)
        Image.fromarray((a * 255 + 0.5).clip(0, 255).astype(np.uint8)).save(os.path.join(DST, out + '.webp'), quality=84)
    size = a.shape[1]
    if not maps:
        print(out, 'albedo'); return
    lum = a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    # height: fine detail minus the broad shading, wrapped so the tile stays seamless
    h = gaussian_filter(lum, 1.0, mode='wrap') - gaussian_filter(lum, size / 40, mode='wrap')
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength * size / 256
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength * size / 256
    n = np.stack([-gx, gy, np.ones_like(h)], -1)   # +y up (glTF / OpenGL convention), v runs down the image
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    Image.fromarray(((n * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8)).save(os.path.join(DST, out + '_n.webp'), quality=90)
    cav = np.clip(1 + (h - gaussian_filter(h, 3, mode='wrap')) * 4, 0.55, 1)
    rough = np.clip(r0 + rdark * (1 - lum / max(lum.mean() * 1.6, 1e-3)), 0.05, 1)
    orm = np.stack([cav, rough, np.full_like(h, metal)], -1)
    Image.fromarray((orm * 255 + 0.5).astype(np.uint8)).save(os.path.join(DST, out + '_m.webp'), quality=90)
    print(out, 'albedo + normal + orm', size)


for k, v in SETS.items():
    if len(sys.argv) > 1 and k not in sys.argv[1:]:
        continue
    build(k, *v)
