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

stand = load(argv[0], 'ghost_stand', 1.36, 9000)
if len(argv) > 1 and os.path.exists(argv[1]):
    crouch = load(argv[1], 'ghost_crouch', 0.5, 7000, 'M_ghostcrawl', math.radians(25), 0.5)   # on all fours, crawling towards you
else:   # keep the previous crouching mesh until a new one exists
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, 'assets', 'ghost_prev.glb'))
    for o in set(bpy.data.objects) - before:
        if o.name.startswith('ghost_crouch'): o.name = 'ghost_crouch'
        else: bpy.data.objects.remove(o)
# AO into vertex colours (lifted in the engine)
sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = 32
sc.world = bpy.data.worlds.new('W'); sc.world.light_settings.distance = 0.25
for o in [o for o in sc.objects if o.type == 'MESH']:
    ca = o.data.color_attributes.new('AO', 'BYTE_COLOR', 'CORNER'); o.data.color_attributes.active_color = ca
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    sc.render.bake.target = 'VERTEX_COLORS'; bpy.ops.object.bake(type='AO')
bpy.ops.object.select_all(action='SELECT')
out = os.path.join(ROOT, 'assets', 'ghost.glb')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_image_format='NONE', export_vertex_color='ACTIVE',
                          export_materials='EXPORT', export_yup=True, export_texcoords=True, export_normals=True)
print('EXPORTED', out, os.path.getsize(out))
