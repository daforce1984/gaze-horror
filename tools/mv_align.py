"""Register each Codex-painted view onto its clay guide: foreground masks by distance from the border colour,
fit scale + offset from the masks' bounding boxes, warp the painting so its silhouette sits exactly on the guide's.
uv run --with pillow --with numpy python tools/mv_align.py KEY [KEY...]   (writes design/mv/KEY_VIEW_paint.png, reports IoU)"""
import sys, os
import numpy as np
from PIL import Image
MV = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'design', 'mv')
SRC = '/mnt/d/_AI_GENERATED/______2026/codex_image_generator/output/'

def mask(a, thr=28):
    b = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]]); bg = np.median(b, 0)
    return np.abs(a.astype(int) - bg).sum(-1) > thr

def bbox(m):
    ys, xs = np.where(m); return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1

def iou(a, b): return (a & b).sum() / max(1, (a | b).sum())

for key in sys.argv[1:]:
    for v in ['front', 'back', 'left', 'right', 'top']:
        g = np.asarray(Image.open(os.path.join(MV, f'{key}_{v}.png')).convert('RGB'))
        pim = Image.open(SRC + f'horror_mv_{key}_{v}.png').convert('RGB').resize((g.shape[1], g.shape[0]), Image.LANCZOS)
        p = np.asarray(pim)
        mg, mp = mask(g), mask(p)
        before = iou(mg, mp)
        gx0, gy0, gx1, gy1 = bbox(mg); px0, py0, px1, py1 = bbox(mp)
        sx, sy = (gx1 - gx0) / (px1 - px0), (gy1 - gy0) / (py1 - py0)
        # affine: guide pixel -> painting pixel
        W, H = g.shape[1], g.shape[0]
        a, b, c = 1 / sx, 0, px0 - gx0 / sx
        d, e, f = 0, 1 / sy, py0 - gy0 / sy
        out = pim.transform((W, H), Image.AFFINE, (a, b, c, d, e, f), resample=Image.BICUBIC, fillcolor=tuple(int(x) for x in np.median(np.concatenate([p[0], p[-1]]), 0)))
        # local, non-rigid: optical flow between the two silhouettes' signed distance fields pulls every
        # painted edge (arms, ears, hair) onto the model's own edge
        import cv2
        from scipy.ndimage import distance_transform_edt as dte
        mo = mask(np.asarray(out))
        sd = lambda m: np.clip(dte(m) - dte(~m), -60, 60)
        to8 = lambda d: ((d + 60) / 120 * 255).astype(np.uint8)
        flow = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_ULTRAFAST * 0 + 2).calc(to8(sd(mg)), to8(sd(mo)), None)
        flow = cv2.GaussianBlur(flow, (0, 0), 22)   # very smooth: shift whole limbs, never smear a face
        mag = np.linalg.norm(flow, axis=-1, keepdims=True); flow = flow * np.minimum(1, 12 / np.maximum(mag, 1e-6))
        gy, gx = np.mgrid[0:H, 0:W].astype(np.float32)
        warped = Image.fromarray(cv2.remap(np.asarray(out), gx + flow[..., 0], gy + flow[..., 1], cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE))
        after = iou(mg, mask(np.asarray(warped)))
        if after < before:   # never make it worse (thin, blurry silhouettes confuse the masks): keep the painting as delivered
            out, after = pim, before
        else:
            out = warped
        # the guide's silhouette wins: bleed the painting's colour outwards into any guide pixel it does not cover
        o = np.asarray(out).astype(np.float32); cov = mask(np.asarray(out)) & mg
        if (mg & ~cov).any():
            from scipy.ndimage import distance_transform_edt
            _, (iy, ix) = distance_transform_edt(~cov, return_indices=True)
            fill = mg & ~cov; o[fill] = o[iy[fill], ix[fill]]
        Image.fromarray(o.astype(np.uint8)).save(os.path.join(MV, f'{key}_{v}_paint.png'))
        print(f'{key:9} {v:5} IoU {before:.3f} -> {after:.3f}  scale {sx:.3f},{sy:.3f}')
