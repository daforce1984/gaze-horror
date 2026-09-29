"""Multi-view texturing for the Hunyuan3D meshes.
  blender -b --python multiview.py -- guides KEY SRC.glb HEIGHT FACES
      clean + remesh + decimate the scan, save design/mv/KEY_clean.glb, render clay guides from five
      orthographic views (front back left right top) -> design/mv/KEY_<view>.png (+ KEY_views.json)
  blender -b --python multiview.py -- bake KEY [RES]
      one UV atlas for the whole mesh; each painted view design/mv/KEY_<view>_paint.png is projected back
      through its own camera, blended by how squarely the surface faces that camera, and baked into
      design/mv/KEY_atlas.png; exports design/mv/KEY_baked.glb (single material, single UV, embedded texture)"""
import bpy, bmesh, sys, os, json, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
MV = os.path.join(ROOT, 'design', 'mv'); os.makedirs(MV, exist_ok=True)
VIEWS = {   # camera direction (from the object towards the camera) and image-up
    'front': ((0, -1, 0), (0, 0, 1)), 'back': ((0, 1, 0), (0, 0, 1)), 'left': ((-1, 0, 0), (0, 0, 1)),
    'right': ((1, 0, 0), (0, 0, 1)), 'top': ((0, 0, 1), (0, 1, 0)),
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_one(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    bpy.context.view_layer.update()
    for o in meshes:
        mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
    for o in new:
        if o not in meshes:
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.rotation_mode = 'XYZ'
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob


def bounds(ob):
    cs = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    mn = Vector((min(c.x for c in cs), min(c.y for c in cs), min(c.z for c in cs)))
    mx = Vector((max(c.x for c in cs), max(c.y for c in cs), max(c.z for c in cs)))
    return mn, mx


def clean(ob, height, faces):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    seen, islands = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        st, isl = [f], []
        seen.add(f.index)
        while st:
            x = st.pop(); isl.append(x)
            for e in x.edges:
                for y in e.link_faces:
                    if y.index not in seen:
                        seen.add(y.index); st.append(y)
        islands.append(isl)
    islands.sort(key=len, reverse=True)
    keep = set(f.index for isl in islands if len(isl) > len(islands[0]) * 0.03 for f in isl)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context='FACES')
    bm.to_mesh(ob.data); bm.free()
    bpy.context.view_layer.objects.active = ob
    r = ob.modifiers.new('rem', 'REMESH'); r.mode = 'VOXEL'; r.voxel_size = max(ob.dimensions) / 230; r.adaptivity = 0.0
    bpy.ops.object.modifier_apply(modifier=r.name)
    for _ in range(4):
        cur = len(ob.data.polygons)
        if cur < faces * 1.15:
            break
        m = ob.modifiers.new('dec', 'DECIMATE'); m.ratio = faces / cur
        bpy.ops.object.modifier_apply(modifier=m.name)
    mn, mx = bounds(ob)
    s = height / (mx.z - mn.z)
    ob.data.transform(Matrix.Translation(-Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))))
    ob.data.transform(Matrix.Scale(s, 4))
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.data.materials.clear()
    return ob


def cameras(ob):
    mn, mx = bounds(ob)
    ctr = (mn + mx) / 2
    size = max(mx - mn) * 1.12
    cams = {}
    for name, (d, up) in VIEWS.items():
        d = Vector(d); up = Vector(up)
        cam = bpy.data.objects.new('cam_' + name, bpy.data.cameras.new('cam_' + name))
        bpy.context.scene.collection.objects.link(cam)
        cam.data.type = 'ORTHO'; cam.data.ortho_scale = size
        cam.location = ctr + d * size * 3
        # camera looks along -Z local, up is +Y local
        z = d.normalized(); x = up.cross(z).normalized(); y = z.cross(x)
        cam.matrix_world = Matrix.Translation(cam.location) @ Matrix((x, y, z)).transposed().to_4x4()
        cams[name] = cam
    bpy.context.view_layer.update()
    return cams, ctr, size


def project_uv(ob, cam, size, layer):
    me = ob.data
    uvl = me.uv_layers.get(layer) or me.uv_layers.new(name=layer)
    inv = cam.matrix_world.inverted()
    for li, loop in enumerate(me.loops):
        q = inv @ (ob.matrix_world @ me.vertices[loop.vertex_index].co)
        uvl.data[li].uv = (q.x / size + 0.5, q.y / size + 0.5)


def guides(key, src, height, faces):
    reset()
    ob = clean(import_one(src), height, faces)
    ob.name = key
    bpy.ops.export_scene.gltf(filepath=os.path.join(MV, key + '_clean.glb'), export_format='GLB', export_materials='NONE', export_texcoords=False)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'SINGLE'
    sc.display.shading.single_color = (0.62, 0.62, 0.62); sc.display.shading.show_cavity = True
    sc.display.shading.background_type = 'VIEWPORT'; sc.display.shading.background_color = (0.74, 0.74, 0.74)
    sc.render.resolution_x = sc.render.resolution_y = 1024
    sc.render.film_transparent = False
    cams, ctr, size = cameras(ob)
    for name, cam in cams.items():
        sc.camera = cam
        sc.render.filepath = os.path.join(MV, f'{key}_{name}.png')
        bpy.ops.render.render(write_still=True)
    json.dump({'size': size, 'ctr': list(ctr)}, open(os.path.join(MV, key + '_views.json'), 'w'))
    print('GUIDES', key, len(ob.data.polygons), 'faces')


def bake(key, res=1024):
    reset()
    ob = import_one(os.path.join(MV, key + '_clean.glb'))
    ob.name = key
    for p in ob.data.polygons:
        p.use_smooth = True
    cams, ctr, size = cameras(ob)
    me = ob.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    atlas = me.uv_layers.new(name='UVMap')
    me.uv_layers.active = atlas
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    views = [v for v in VIEWS if os.path.exists(os.path.join(MV, f'{key}_{v}_paint.png'))]
    for v in views:
        project_uv(ob, cams[v], size, 'proj_' + v)
    me.uv_layers.active = atlas
    # blend material: sum(view colour * facing^p) / sum(facing^p)
    mt = bpy.data.materials.new('M_' + key + '_mv'); mt.use_nodes = True
    nt = mt.node_tree; N = nt.nodes; L = nt.links
    for n in list(N):
        N.remove(n)
    out = N.new('ShaderNodeOutputMaterial'); emi = N.new('ShaderNodeEmission'); L.new(emi.outputs[0], out.inputs['Surface'])
    geo = N.new('ShaderNodeNewGeometry')
    csum = wsum = None
    for v in views:
        d = Vector(VIEWS[v][0])
        uvn = N.new('ShaderNodeUVMap'); uvn.uv_map = 'proj_' + v
        tex = N.new('ShaderNodeTexImage'); tex.image = bpy.data.images.load(os.path.join(MV, f'{key}_{v}_paint.png')); tex.extension = 'EXTEND'
        L.new(uvn.outputs[0], tex.inputs[0])
        dot = N.new('ShaderNodeVectorMath'); dot.operation = 'DOT_PRODUCT'; dot.inputs[1].default_value = d
        L.new(geo.outputs['Normal'], dot.inputs[0])
        mx0 = N.new('ShaderNodeMath'); mx0.operation = 'MAXIMUM'; mx0.inputs[1].default_value = 0.0; L.new(dot.outputs['Value'], mx0.inputs[0])
        pw = N.new('ShaderNodeMath'); pw.operation = 'POWER'; pw.inputs[1].default_value = 4.0; L.new(mx0.outputs[0], pw.inputs[0])
        if v == 'front':   # the original concept is the best source: trust it a bit more
            k = N.new('ShaderNodeMath'); k.operation = 'MULTIPLY'; k.inputs[1].default_value = 1.6; L.new(pw.outputs[0], k.inputs[0]); pw = k
        col = N.new('ShaderNodeMix'); col.data_type = 'RGBA'; col.blend_type = 'MULTIPLY'; col.inputs['Factor'].default_value = 1.0
        L.new(tex.outputs['Color'], col.inputs[6])
        cm = N.new('ShaderNodeCombineColor'); L.new(pw.outputs[0], cm.inputs[0]); L.new(pw.outputs[0], cm.inputs[1]); L.new(pw.outputs[0], cm.inputs[2])
        L.new(cm.outputs[0], col.inputs[7])
        if csum is None:
            csum, wsum = col.outputs[2], pw.outputs[0]
        else:
            a = N.new('ShaderNodeMix'); a.data_type = 'RGBA'; a.blend_type = 'ADD'; a.inputs['Factor'].default_value = 1.0
            L.new(csum, a.inputs[6]); L.new(col.outputs[2], a.inputs[7]); csum = a.outputs[2]
            b = N.new('ShaderNodeMath'); b.operation = 'ADD'; L.new(wsum, b.inputs[0]); L.new(pw.outputs[0], b.inputs[1]); wsum = b.outputs[0]
    eps = N.new('ShaderNodeMath'); eps.operation = 'MAXIMUM'; eps.inputs[1].default_value = 1e-4; L.new(wsum, eps.inputs[0])
    dv = N.new('ShaderNodeMix'); dv.data_type = 'RGBA'; dv.blend_type = 'DIVIDE'; dv.inputs['Factor'].default_value = 1.0
    L.new(csum, dv.inputs[6])
    ce = N.new('ShaderNodeCombineColor'); L.new(eps.outputs[0], ce.inputs[0]); L.new(eps.outputs[0], ce.inputs[1]); L.new(eps.outputs[0], ce.inputs[2])
    L.new(ce.outputs[0], dv.inputs[7]); L.new(dv.outputs[2], emi.inputs['Color'])
    img = bpy.data.images.new(key + '_atlas', res, res, alpha=False)
    tgt = N.new('ShaderNodeTexImage'); tgt.image = img; N.active = tgt
    me.materials.clear(); me.materials.append(mt)
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = 4; sc.cycles.device = 'CPU'
    sc.render.bake.target = 'IMAGE_TEXTURES'; sc.render.bake.margin = 8
    bpy.ops.object.bake(type='EMIT')
    path = os.path.join(MV, key + '_atlas.png'); img.filepath_raw = path; img.file_format = 'PNG'; img.save()
    # final: one material with the baked atlas, one UV set
    for v in views:
        me.uv_layers.remove(me.uv_layers['proj_' + v])
    fin = bpy.data.materials.new('M_' + key + '_baked'); fin.use_nodes = True
    bs = fin.node_tree.nodes['Principled BSDF']; ti = fin.node_tree.nodes.new('ShaderNodeTexImage'); ti.image = img
    fin.node_tree.links.new(ti.outputs['Color'], bs.inputs['Base Color']); bs.inputs['Roughness'].default_value = 0.8
    me.materials.clear(); me.materials.append(fin)
    for c in cams.values():
        bpy.data.objects.remove(c, do_unlink=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(MV, key + '_baked.glb'), export_format='GLB', export_image_format='WEBP',
                              export_materials='EXPORT', export_texcoords=True, export_normals=True)
    print('BAKED', key, views, path)


if argv[0] == 'guides':
    guides(argv[1], argv[2], float(argv[3]), int(argv[4]))
elif argv[0] == 'bake':
    bake(argv[1], int(argv[2]) if len(argv) > 2 else 1024)
