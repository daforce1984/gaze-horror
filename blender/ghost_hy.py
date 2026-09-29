"""Turn Hunyuan3D meshes into the game ghost: scale to a child's height, decimate, front-project the concept
image as UVs, bake AO into vertex colours, export assets/ghost.glb (nodes ghost_stand / ghost_crouch).
blender -b --python ghost_hy.py -- stand.glb [crouch.glb]"""
import bpy, bmesh, sys, os, math
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
bpy.ops.wm.read_factory_settings(use_empty=True)
MATS = {k: bpy.data.materials.new(k) for k in ('M_ghosttex', 'M_ghostcrawl')}

def load(path, name, height, target_faces, mat='M_ghosttex', tilt=0.0, rear=0.0):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    obs = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    if len(obs) > 1: bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    for o in list(bpy.data.objects):
        if o.type != 'MESH' and o not in before: bpy.data.objects.remove(o)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ob.parent = None
    # drop floating crumbs, keep the biggest connected pieces
    bm = bmesh.new(); bm.from_mesh(ob.data)
    islands, seen = [], set()
    for f in bm.faces:
        if f.index in seen: continue
        stack, isl = [f], []
        seen.add(f.index)
        while stack:
            x = stack.pop(); isl.append(x)
            for e in x.edges:
                for y in e.link_faces:
                    if y.index not in seen: seen.add(y.index); stack.append(y)
        islands.append(isl)
    islands.sort(key=len, reverse=True)
    keep = set(f.index for isl in islands if len(isl) > len(islands[0]) * 0.02 for f in isl)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context='FACES')
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.0008)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=0.0005)
    bm.to_mesh(ob.data); bm.free()
    # decimate
    n = len(ob.data.polygons)
    # remesh: the scan's triangle soup becomes one clean closed surface (even density, sane normals)
    r = ob.modifiers.new('rem', 'REMESH'); r.mode = 'VOXEL'; r.voxel_size = ob.dimensions.z / 230; r.adaptivity = 0.0
    bpy.context.view_layer.objects.active = ob; bpy.ops.object.modifier_apply(modifier=r.name)
    for _ in range(4):   # collapse stalls on non-manifold scans: repeat until near the budget
        cur = len(ob.data.polygons)
        if cur < target_faces * 1.15: break
        m = ob.modifiers.new('dec', 'DECIMATE'); m.ratio = target_faces / cur; m.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = ob; bpy.ops.object.modifier_apply(modifier=m.name)
        if len(ob.data.polygons) > cur * 0.9:   # stuck: rebuild the surface on a voxel grid, then decimate that
            r = ob.modifiers.new('rem', 'REMESH'); r.mode = 'VOXEL'; r.voxel_size = ob.dimensions.z / 220
            bpy.ops.object.modifier_apply(modifier=r.name)
    # scale to height, feet on z=0, centred in x/y
    bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
    mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
    s = height / (mx.z - mn.z)
    ob.data.transform(__import__('mathutils').Matrix.Translation(-Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))))
    ob.data.transform(__import__('mathutils').Matrix.Scale(s, 4))
    ob.location = (0, 0, 0)
    # front projection UVs: the concept image covers the mesh's x/z bounding box
    me = ob.data
    # the concept camera looks down at `tilt`: further back (+y) reads higher up in the picture
    ct, st = math.cos(tilt), math.sin(tilt)
    V = lambda co: co.z * ct + co.y * st
    xs = [v.co.x for v in me.vertices]; zs = [V(v.co) for v in me.vertices]
    x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
    if not me.uv_layers: me.uv_layers.new(name='UVMap')
    ys_ = [v.co.y for v in me.vertices]; y0, y1 = min(ys_), max(ys_)
    zr = [v.co.z for v in me.vertices]; zr0, zr1 = min(zr), max(zr)
    uv = me.uv_layers.active.data
    for li, loop in enumerate(me.loops):
        co = me.vertices[loop.vertex_index].co
        uv[li].uv = ((co.x - x0) / (x1 - x0), (V(co) - z0) / (z1 - z0))
        if rear:   # crawling: the picture only shows her front; hips and legs take the side of the gown on its left
            d = (co.y - y0) / (y1 - y0)
            if d > rear: uv[li].uv = (0.05 + 0.3 * (1 - d) / (1 - rear), 0.2 + 0.45 * (co.z - zr0) / (zr1 - zr0))
    me.materials.clear(); me.materials.append(MATS[mat])
    for p in me.polygons: p.use_smooth = True
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=0.0005)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me); bm.free()
    ob.name = name; me.name = name
    print('GHOST', name, n, '->', len(me.polygons), 'faces, dims', tuple(round(d, 3) for d in ob.dimensions))
    return ob

MV = os.path.join(ROOT, 'design', 'mv')
def load_baked(key, name):
    """a mesh textured from all sides (blender/multiview.py): already cleaned, sized, one UV, one material"""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(MV, key + '_baked.glb'))
    obs = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    for o in set(bpy.data.objects) - before:
        if o.type != 'MESH': bpy.data.objects.remove(o)
    ob = obs[0]; ob.name = name; ob.data.name = name
    ob.data.materials[0].name = 'M_' + name + '_mv'
    print('GHOST', name, 'multiview baked', len(ob.data.polygons), 'faces')
    return ob
if os.path.exists(os.path.join(MV, 'stand_baked.glb')):
    stand = load_baked('stand', 'ghost_stand')
else:
    stand = load(argv[0], 'ghost_stand', 1.36, 9000)
if os.path.exists(os.path.join(MV, 'crawl_baked.glb')):
    crouch = load_baked('crawl', 'ghost_crouch')
elif len(argv) > 1 and os.path.exists(argv[1]):
    crouch = load(argv[1], 'ghost_crouch', 0.5, 7000, 'M_ghostcrawl', math.radians(25), 0.5)   # on all fours, crawling towards you
else:   # keep the previous crouching mesh until a new one exists
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, 'assets', 'ghost_prev.glb'))
    for o in set(bpy.data.objects) - before:
        if o.name.startswith('ghost_crouch'): o.name = 'ghost_crouch'
        else: bpy.data.objects.remove(o)
# ---- bones: a simple skeleton sized to each mesh, bound with automatic weights, and keyframed actions
from mathutils import Euler
def build_rig(ob, name, bones):
    arm = bpy.data.armatures.new(name + '_arm'); rig = bpy.data.objects.new(name + '_rig', arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
    pre = name.split('_')[-1][0] + '_'   # bone names unique per rig (the exporter trips over two 'head' bones)
    for bn, head, tail, parent in bones:
        eb = arm.edit_bones.new(pre + bn); eb.head = Vector(head); eb.tail = Vector(tail)
        if parent: eb.parent = arm.edit_bones[pre + parent]; eb.use_connect = False
    rig['pre'] = pre
    bpy.ops.object.mode_set(mode='OBJECT')
    # the imported mesh is split along its UV seams: weld it (the UVs live on the loops and survive)
    bm = bmesh.new(); bm.from_mesh(ob.data); bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5); bm.to_mesh(ob.data); bm.free()
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    me = ob.data
    if sum(1 for v in me.vertices if any(g.weight > 0 for g in v.groups)) < len(me.vertices) * 0.9:
        # bone heat gave up on this scan: weight by distance to each bone segment (4 nearest, falloff 1/d^4)
        segs = [(b.name, rig.matrix_world @ b.head_local, rig.matrix_world @ b.tail_local) for b in rig.data.bones]
        groups = {n: ob.vertex_groups.get(n) or ob.vertex_groups.new(name=n) for n, _, _ in segs}
        for g in groups.values(): g.remove(range(len(me.vertices)))
        for v in me.vertices:
            p = ob.matrix_world @ v.co; ds = []
            for n, h, t in segs:
                ab = t - h; u = max(0.0, min(1.0, (p - h).dot(ab) / max(ab.length_squared, 1e-9)))
                ds.append((max((p - (h + ab * u)).length, 0.01), n))
            ds.sort(); ws = [(n, 1 / d ** 4) for d, n in ds[:4]]; tot = sum(w for _, w in ws)
            for n, w in ws: groups[n].add([v.index], w / tot, 'REPLACE')
        print('RIG', ob.name, 'distance weights')
    return rig

def keys(rig, action, frames, per_bone):
    """per_bone: {bone: fn(frame) -> (rx, ry, rz) in degrees}"""
    act = bpy.data.actions.new(action); rig.animation_data_create(); rig.animation_data.action = act
    for pb in rig.pose.bones: pb.rotation_mode = 'XYZ'
    for f in range(0, frames + 1, 2):
        for bn, fn in per_bone.items():
            pb = rig.pose.bones[rig['pre'] + bn]; r = fn(f)
            pb.rotation_euler = Euler([math.radians(v) for v in r]); pb.keyframe_insert('rotation_euler', frame=f)
    tr = rig.animation_data.nla_tracks.new(); tr.name = action; tr.strips.new(action, 0, act)
    rig.animation_data.action = None
    for pb in rig.pose.bones: pb.rotation_euler = (0, 0, 0)

def mesh_extent(ob, z0, z1):
    xs = [abs(v.co.x) for v in ob.data.vertices if z0 <= v.co.z <= z1]
    return max(xs) if xs else 0.15

S_, C_ = math.sin, math.cos
TAU = 2 * math.pi
st = bpy.data.objects['ghost_stand']
H = max(v.co.z for v in st.data.vertices)
k = H / 1.36
hx = mesh_extent(st, 0.5 * k, 0.72 * k); sx = mesh_extent(st, 1.0 * k, 1.07 * k)
R = []
for side, sg in (('L', 1), ('R', -1)):
    R += [('shoulder.' + side, (0.03 * sg, 0, 1.07 * k), (sx * 0.8 * sg, 0, 1.06 * k), 'chest'),
          ('upperarm.' + side, (sx * 0.8 * sg, 0, 1.06 * k), ((sx + hx) / 2 * sg, 0, 0.84 * k), 'shoulder.' + side),
          ('forearm.' + side, ((sx + hx) / 2 * sg, 0, 0.84 * k), (hx * 0.95 * sg, 0, 0.64 * k), 'upperarm.' + side),
          ('hand.' + side, (hx * 0.95 * sg, 0, 0.64 * k), (hx * sg, 0, 0.55 * k), 'forearm.' + side),
          ('thigh.' + side, (0.07 * sg, 0, 0.70 * k), (0.08 * sg, 0, 0.38 * k), 'hips'),
          ('shin.' + side, (0.08 * sg, 0, 0.38 * k), (0.08 * sg, 0, 0.05 * k), 'thigh.' + side)]
srig = build_rig(st, 'ghost_stand', [('hips', (0, 0, 0.70 * k), (0, 0, 0.82 * k), None), ('spine', (0, 0, 0.82 * k), (0, 0, 0.98 * k), 'hips'),
                                     ('chest', (0, 0, 0.98 * k), (0, 0, 1.10 * k), 'spine'), ('neck', (0, 0, 1.10 * k), (0, 0, 1.18 * k), 'chest'),
                                     ('head', (0, 0, 1.18 * k), (0, 0, 1.36 * k), 'neck')] + R)
F = 96   # idle: breathing, a slow head tilt, the hands never quite still
keys(srig, 'idle', F, {
    'spine': lambda f: (1.2 * S_(f / F * TAU * 2), 0, 0.8 * S_(f / F * TAU)),
    'chest': lambda f: (1.5 * S_(f / F * TAU * 2 + 0.5), 0, 0),
    'neck': lambda f: (4 + 3 * S_(f / F * TAU), 0, 6 * S_(f / F * TAU + 1)),
    'head': lambda f: (6 + 4 * S_(f / F * TAU + 0.3), 3 * S_(f / F * TAU * 3), 10 * S_(f / F * TAU)),
    'upperarm.L': lambda f: (2 * S_(f / F * TAU + 0.2), 0, 3 + 2 * S_(f / F * TAU)), 'upperarm.R': lambda f: (2 * S_(f / F * TAU + 1.4), 0, -3 - 2 * S_(f / F * TAU + 0.8)),
    'hand.L': lambda f: (6 * S_(f / F * TAU * 12), 0, 4 * S_(f / F * TAU * 9)), 'hand.R': lambda f: (6 * S_(f / F * TAU * 11 + 1), 0, -4 * S_(f / F * TAU * 10)),
})
F = 24   # twitch: the head snaps sideways and back, one arm jerks
snap = lambda f, a: a if 3 <= f <= 12 else a * max(0, 1 - abs(f - 7.5) / 12)
keys(srig, 'twitch', F, {
    'head': lambda f: (snap(f, -18), 0, snap(f, 38)), 'neck': lambda f: (0, 0, snap(f, 20)),
    'chest': lambda f: (snap(f, 6), 0, snap(f, -8)), 'upperarm.R': lambda f: (snap(f, -25), 0, snap(f, -12)),
    'forearm.R': lambda f: (snap(f, -30), 0, 0),
})
# crawling: on all fours, head towards -y (the viewer), hips at +y
cr = bpy.data.objects['ghost_crouch']
ys = [v.co.y for v in cr.data.vertices]; y0, y1 = min(ys), max(ys); L_ = y1 - y0
Hc = max(v.co.z for v in cr.data.vertices)
yy = lambda t: y0 + L_ * t   # 0 = head end, 1 = feet end
C = []
for side, sg in (('L', 1), ('R', -1)):
    C += [('upperarm.' + side, (0.12 * sg, yy(0.28), Hc * 0.8), (0.19 * sg, yy(0.2), Hc * 0.4), 'chest'),
          ('forearm.' + side, (0.19 * sg, yy(0.2), Hc * 0.4), (0.21 * sg, yy(0.14), Hc * 0.04), 'upperarm.' + side),
          ('thigh.' + side, (0.1 * sg, yy(0.7), Hc * 0.75), (0.14 * sg, yy(0.74), Hc * 0.1), 'hips'),
          ('shin.' + side, (0.14 * sg, yy(0.74), Hc * 0.1), (0.11 * sg, yy(0.97), Hc * 0.08), 'thigh.' + side)]
crig = build_rig(cr, 'ghost_crouch', [('hips', (0, yy(0.7), Hc * 0.8), (0, yy(0.5), Hc * 0.85), None), ('spine', (0, yy(0.5), Hc * 0.85), (0, yy(0.33), Hc * 0.85), 'hips'),
                                      ('chest', (0, yy(0.33), Hc * 0.85), (0, yy(0.22), Hc * 0.8), 'spine'), ('head', (0, yy(0.22), Hc * 0.8), (0, yy(0.02), Hc * 0.55), 'chest')] + C)
F = 32   # a crawl cycle: opposite arm and leg reach together, the spine rolls, the head bobs low
ph = lambda f, o=0: S_(f / F * TAU + o)
keys(crig, 'crawl', F, {
    'upperarm.L': lambda f: (-22 * ph(f), 0, 4 * ph(f)), 'upperarm.R': lambda f: (22 * ph(f), 0, -4 * ph(f)),
    'forearm.L': lambda f: (18 * max(0, ph(f, 0.6)), 0, 0), 'forearm.R': lambda f: (18 * max(0, -ph(f, 0.6)), 0, 0),
    'thigh.L': lambda f: (18 * ph(f), 0, 0), 'thigh.R': lambda f: (-18 * ph(f), 0, 0),
    'spine': lambda f: (0, 6 * ph(f), 3 * ph(f, 1.5)), 'chest': lambda f: (0, -5 * ph(f), 0),
    'head': lambda f: (8 * ph(f * 2, 0.4), 0, 6 * ph(f)),
})
# AO into vertex colours (lifted in the engine)
sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = 32
sc.world = bpy.data.worlds.new('W'); sc.world.light_settings.distance = 0.25
for o in [o for o in sc.objects if o.type == 'MESH']:
    ca = o.data.color_attributes.new('AO', 'BYTE_COLOR', 'CORNER'); o.data.color_attributes.active_color = ca
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    sc.render.bake.target = 'VERTEX_COLORS'; bpy.ops.object.bake(type='AO')
for o in bpy.data.objects:
bpy.ops.object.select_all(action='SELECT')
out = os.path.join(ROOT, 'assets', 'ghost.glb')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=False, export_image_format='WEBP', export_vertex_color='ACTIVE',
                          export_materials='EXPORT', export_yup=True, export_texcoords=True, export_normals=True,
                          export_skins=True, export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True)
print('EXPORTED', out, os.path.getsize(out))
