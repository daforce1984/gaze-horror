# Poly Haven (CC0) props for the room: imported from design/ph/<id>/ (tools/phget.py), fitted to the
# places the procedural pieces occupied, textures downsized and shipped inside room.glb as WebP PBR maps.
# exec()'d from build.py, so it shares its helpers (E, join, set_origin, item_origin, box, cyl, mat, ...).
import glob

PH = os.path.join(os.path.dirname(HERE), 'design', 'ph')
RX, RH = 2.2, 2.6
_TEMPLATES = {}


def ph_import(pid, keep=None, drop_mats=(), res=512, skip=(), faces=None, flat=False):
    """import a Poly Haven glTF as one mesh object (parts filtered by name), textures scaled to <= res"""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glob.glob(os.path.join(PH, pid, '*.gltf'))[0])
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH' and (keep is None or any(k in o.name for k in keep)) and not any(k in o.name for k in skip)]
    bpy.context.view_layer.update()
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    for o in new:
        if o not in meshes:
            bpy.data.objects.remove(o, do_unlink=True)
    ob = join(pid, meshes) if len(meshes) > 1 else meshes[0]
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if flat:   # modelled leaning against something: turn its thinnest axis (PCA) upright so it lies down
        import numpy as np
        co = np.array([v.co for v in ob.data.vertices]); co -= co.mean(0)
        w, vec = np.linalg.eigh(co.T @ co)
        thin = Vector(vec[:, 0])
        if thin.z < 0:
            thin = -thin
        ob.data.transform(thin.rotation_difference(Vector((0, 0, 1))).to_matrix().to_4x4())
    if faces and len(ob.data.polygons) > faces:   # scans are dense; the room is seen from one chair
        m = ob.modifiers.new('dec', 'DECIMATE')
        m.ratio = faces / len(ob.data.polygons)
        bpy.ops.object.modifier_apply(modifier=m.name)
    if drop_mats:   # glass panes and stock artwork: our own screen / photo / clock face go there
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        names = [m.name if m else '' for m in ob.data.materials]
        kill = [f for f in bm.faces if any(d in names[f.material_index] for d in drop_mats)]
        bmesh.ops.delete(bm, geom=kill, context='FACES')
        bm.to_mesh(ob.data)
        bm.free()
    for m in ob.data.materials:
        if not m or not m.use_nodes:
            continue
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image and max(n.image.size) > res:
                n.image.scale(res, res)
            if n.type == 'TEX_IMAGE' and n.image and n.image.channels == 1:   # WebP can't hold 1-channel images
                n.image = _rgb(n.image)
    while len(ob.data.uv_layers) > 1:   # second UV set (lightmaps) is never used: drop it
        ob.data.uv_layers.remove(ob.data.uv_layers[-1])
    ob['ph'] = pid
    return ob


_RGB = {}
def _rgb(img):
    if img.name not in _RGB:
        import numpy as np
        w, h = img.size
        px = np.empty(w * h * img.channels, dtype=np.float32)
        img.pixels.foreach_get(px)
        g = px.reshape(-1, img.channels)[:, 0]
        out = bpy.data.images.new(img.name + '_rgb', w, h, alpha=False)
        out.colorspace_settings.name = img.colorspace_settings.name
        rgba = np.stack([g, g, g, np.ones_like(g)], 1).ravel()
        out.pixels.foreach_set(rgba)
        out.pack()
        _RGB[img.name] = out
    return _RGB[img.name]


def ph_bounds(ob):
    bpy.context.view_layer.update()
    cs = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    mn = Vector((min(c.x for c in cs), min(c.y for c in cs), min(c.z for c in cs)))
    mx = Vector((max(c.x for c in cs), max(c.y for c in cs), max(c.z for c in cs)))
    return mn, mx


def ph_place(ob, s, engine_pt, rotz=0.0, rotx=0.0, anchor='bottom'):
    """scale, turn (rotz: 0 = front faces the viewer at +z engine), then put the bbox bottom-centre
    (or centre / back-centre) on an engine-space point"""
    ob.scale = (s, s, s)
    ob.rotation_euler = (rotx, 0, rotz)
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    mn, mx = ph_bounds(ob)
    c = (mn + mx) / 2
    ref = Vector((c.x, c.y, mn.z)) if anchor == 'bottom' else c
    ob.location += E(*engine_pt) - ref
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    return ob


def replace(name, ob, origin=None):
    """ob takes over the node name (and the old origin, which the engine animates around)"""
    old = bpy.data.objects.get(name)
    if old:
        bpy.context.view_layer.update()
        o_origin = old.matrix_world.translation.copy()
        bpy.data.objects.remove(old, do_unlink=True)
    else:
        o_origin = None
    ob.name = name
    ob.data.name = name
    if origin is not None:
        set_origin(ob, origin)
    elif o_origin is not None:
        set_origin(ob, (o_origin.x, o_origin.z, -o_origin.y))
    return ob


def ph_template(pid, **kw):
    """one hidden copy per trash kind; the rigid-body sim gets linked duplicates"""
    if pid not in _TEMPLATES:
        t = ph_import(pid, **kw)
        t.location = (0, 0, -50)
        _TEMPLATES[pid] = t
    return _TEMPLATES[pid]


def ph_trash_item(kind, rnd):
    pid, s = {'bag': ('trashbag', 0.62), 'can': ('can_rusted', 0.62), 'can2': ('russian_food_cans_01', 1.0),
              'bottle': ('plastic_bottle_gallon', 0.75), 'pizza': ('cardboard_box_01', 0.75)}.get(kind, (None, 1))
    if not pid:
        return None
    t = ph_template(pid, res=512, faces=500)
    ob = t.copy()
    ob.data = t.data
    link(ob)
    k = s * rnd.uniform(0.85, 1.1)
    ob.scale = (k, k, k * (rnd.uniform(0.5, 0.8) if kind == 'bag' else 1))
    ob.name = 'trash_' + kind
    return ob


def ph_cleanup():
    for t in _TEMPLATES.values():
        bpy.data.objects.remove(t, do_unlink=True)
    _TEMPLATES.clear()
    # WebP can't hold 1-channel images: remap every grey image to an RGB copy
    for img in list(bpy.data.images):
        if img.source == 'FILE' and img.size[0] > 0 and len(img.pixels) == img.size[0] * img.size[1]:
            img.user_remap(_rgb(img))


def upgrade_props(M):
    # ---- TV stand: an old chest of drawers
    cab = ph_import('vintage_wooden_drawer_01', res=512, faces=2500)
    ph_place(cab, 1.1, (0, 0, -2.235))
    replace('tv_cabinet', cab)
    top = ph_bounds(cab)[1].z

    # ---- CRT: screen quad moved onto the model's picture tube
    s = 1.1
    tv = ph_import('Television_01', res=1024)
    ph_place(tv, s, (0.0, top, -2.225))
    mn, mx = ph_bounds(tv)
    front = -mn.y   # engine z of the front face
    # picture tube measured on the model's front view: x -0.272..0.136, height 0.100..0.418 (unit scale)
    sx0, sx1, sy0, sy1 = -0.272 * s, 0.136 * s, 0.100 * s, 0.418 * s
    scr = bpy.data.objects['tv_screen']
    cx = (mn.x + mx.x) / 2
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    nx, ny, sv = 20, 16, {}
    for i in range(nx + 1):
        for j in range(ny + 1):
            u, v = i / nx, j / ny
            bulge = 0.012 * (1 - (2 * u - 1) ** 2) * (1 - (2 * v - 1) ** 2)
            sv[i, j] = bm.verts.new(E(cx + sx0 + (sx1 - sx0) * u, top + sy0 + (sy1 - sy0) * v, front - 0.018 + bulge))
    for i in range(nx):
        for j in range(ny):
            f = bm.faces.new((sv[i, j], sv[i + 1, j], sv[i + 1, j + 1], sv[i, j + 1]))
            for l, (a, b) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                l[uvl].uv = (a / nx, b / ny)
    scr.data.clear_geometry()
    bm.to_mesh(scr.data)
    bm.free()
    scr.location = (0, 0, 0)
    replace('tv', tv)

    # ---- low folding table (밥상) with the mug, tray and bowl back on top
    old = bpy.data.objects['lowtable']
    bpy.data.objects.remove(old, do_unlink=True)
    tbl = ph_import('chinese_tea_table', res=512)
    ph_place(tbl, 0.65, (-0.95, 0, -1.0))
    ttop = ph_bounds(tbl)[1].z
    items = [cyl('lt_mug', (-1.08, ttop + 0.0425, -1.05), 0.038, 0.085, M['ceramic'], seg=18),
             box('lt_tray', (-0.85, ttop + 0.006, -0.95), (0.26, 0.012, 0.2), mat('M_tray', (0.55, 0.12, 0.1), 0.35), 0.004),
             cyl('lt_bowl', (-0.85, ttop + 0.031, -0.95), 0.06, 0.04, M['ceramic'], seg=18, r2=0.045)]
    world_uv(items[1], 0.5)
    lt = join('lowtable', [tbl] + items)
    lt['ph'] = 'chinese_tea_table'

    # ---- bookshelf with the books on its real shelf boards
    bx, bz = -1.55, 2.33
    old = bpy.data.objects['bookshelf']
    bpy.data.objects.remove(old, do_unlink=True)
    shf = ph_import('wooden_bookshelf_worn', res=512, faces=2500)
    ph_place(shf, 0.58, (bx, 0, bz), rotz=PI)
    smn, smx = ph_bounds(shf)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    boards, y = [], smx.z - 0.05
    while y > 0.05 and len(boards) < 4:
        hit, loc, *_ = bpy.context.scene.ray_cast(dg, E(bx, y, bz - 0.02), Vector((0, 0, -1)))
        if not hit:
            break
        if loc.z < smx.z - 0.08:
            boards.append(loc.z)
        y = loc.z - 0.04
    rnd = random.Random(8)
    cols = [(0.35, 0.1, 0.08), (0.1, 0.2, 0.35), (0.55, 0.45, 0.2), (0.15, 0.3, 0.15), (0.6, 0.55, 0.5), (0.3, 0.15, 0.3)]
    books = []
    inner = (smx.x - smn.x) / 2 - 0.05
    for y0 in sorted(boards)[:3]:
        x = bx - inner
        while x < bx + inner - 0.05:
            w = rnd.uniform(0.02, 0.045); h = rnd.uniform(0.17, 0.24)
            if rnd.random() < 0.12:
                x += rnd.uniform(0.04, 0.1)
                continue
            b = box('book', (x + w / 2, y0 + h / 2 + 0.001, bz - 0.01 + rnd.uniform(-0.02, 0.02)), (w, h, rnd.uniform(0.14, 0.18)),
                    mat('M_book%d' % rnd.randrange(6), cols[rnd.randrange(6)], 0.8), 0.002)
            books.append(b)
            x += w + 0.003
    bs = join('bookshelf', [shf] + books)
    bs['ph'] = 'wooden_bookshelf_worn'
    doll = bpy.data.objects.get('item_doll')
    if doll:   # sits on top of the new shelf
        bpy.context.view_layer.update()
        dmn = min((doll.matrix_world @ Vector(c)).z for c in doll.bound_box)
        doll.location.z += smx.z - dmn + 0.002

    # ---- wall clock: rim and dial of the model, our stopped face in front of it
    clk = ph_import('wall_clock', skip=('hand',), drop_mats=('glass',), res=512, faces=1200)
    ph_place(clk, 1.15, (RX - 0.03, 1.85, -0.3), rotz=-PI / 2, anchor='centre')
    replace('clock_body', clk)

    # ---- family photo frame (our photo quad sits in its opening)
    fr = ph_import('hanging_picture_frame_01', drop_mats=('glass', 'artwork'), res=512, faces=700)
    ph_place(fr, 0.6, (-0.78, 1.55, -2.49), anchor='centre')
    replace('item_frame', fr)
    item_origin(fr)

    # ---- the mother's answering machine: an old tape recorder on the desk, its LED on the front
    dx, dz, dtop = 1.86, -0.3, 0.74 + 0.018
    am = ph_import('cassette_player', res=512, faces=1500)
    ph_place(am, 1.0, (dx - 0.05, dtop, dz + 0.42), rotz=-PI / 2)
    amn, amx = ph_bounds(am)
    replace('answering_machine', am)
    led = bpy.data.objects['am_led']
    led.location = Vector((amn.x - 0.003, (amn.y + amx.y) / 2 + 0.03, amx.z - 0.03)) - Vector(led.matrix_world.translation - led.location)
    led.scale = (0.5, 0.5, 0.5)

    # ---- floor cushion: one of the throw pillows, lying down
    cu = ph_import('throw_pillows_01', keep=['pillow01'], res=512, flat=True, faces=1200)
    for m in cu.data.materials:   # its roughness map is 1-channel (WebP can't); fabric is uniformly rough anyway
        for l in list(m.node_tree.links):
            if l.to_socket.name == 'Roughness':
                l.to_socket.default_value = 0.9
                m.node_tree.links.remove(l)
    ph_place(cu, 0.9, (-1.25, 0.0, 0.2), rotz=0.4)
    replace('cushion', cu)

    # ---- kitchen knife on the desk
    kold = bpy.data.objects['item_knife']
    bpy.context.view_layer.update()
    kc = kold.matrix_world.translation.copy()
    kn = ph_import('fish_knife', res=512, faces=700)
    ph_place(kn, 0.95, (kc.x, 0.759, -kc.y), rotx=PI / 2, rotz=0.6 + PI / 2)
    replace('item_knife', kn)
    item_origin(kn)

    # ---- bulb: real glass bulb shape, glowing material (the engine drives it)
    bpy.context.view_layer.update()
    bulb_old = bpy.data.objects['bulb']
    bb = ph_bounds(bulb_old)
    bc = (bb[0] + bb[1]) / 2
    bl = ph_import('lightbulb_01', res=256, faces=700)
    ph_place(bl, 1.25, (bc.x, bc.z - 0.02, -bc.y), rotx=PI, anchor='centre')
    bl.data.materials.clear()
    bl.data.materials.append(M['bulb'])
    replace('bulb', bl, origin=(0, RH, -0.6))


# ---- props reconstructed with Hunyuan3D from Codex concept images (tools/hy3d.py), textured by projecting
# the concept image back onto them from the front (the view it was generated from)
HY = os.path.join(os.path.dirname(HERE), 'design', 'ghost3d')


def hy_item(key, name, height, faces=6000, color=None, up='z'):
    path = os.path.join(HY, 'obj_%s.glb' % key)
    tex = os.path.join(HY, 'obj_%s_tex.png' % key)
    if not os.path.exists(path) or (color is None and not os.path.exists(tex)):
        print('HY missing', key)
        return None
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
    ob = join('hy_' + key, meshes) if len(meshes) > 1 else meshes[0]
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # keep the biggest piece only (voxel crumbs), then thin it out
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
    keep = set(f.index for isl in islands if len(isl) > len(islands[0]) * 0.05 for f in isl)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context='FACES')
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.0008)
    bm.to_mesh(ob.data); bm.free()
    for _ in range(4):
        cur = len(ob.data.polygons)
        if cur < faces * 1.15:
            break
        m = ob.modifiers.new('dec', 'DECIMATE'); m.ratio = faces / cur
        bpy.ops.object.modifier_apply(modifier=m.name)
        if len(ob.data.polygons) > cur * 0.9:
            r = ob.modifiers.new('rem', 'REMESH'); r.mode = 'VOXEL'; r.voxel_size = ob.dimensions.z / 160
            bpy.ops.object.modifier_apply(modifier=r.name)
    # size (height, or length for things lying down), bottom on z = 0
    mn, mx = ph_bounds(ob)
    s = height / ((mx.z - mn.z) if up == 'z' else max(mx.x - mn.x, mx.y - mn.y))
    ob.data.transform(Matrix.Translation(-Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))))
    ob.data.transform(Matrix.Scale(s, 4))
    # front projection of the concept image
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    uv = me.uv_layers.active.data
    xs = [v.co.x for v in me.vertices]; zs = [v.co.z for v in me.vertices]
    x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
    for li, loop in enumerate(me.loops):
        co = me.vertices[loop.vertex_index].co
        uv[li].uv = ((co.x - x0) / (x1 - x0), (co.z - z0) / (z1 - z0))
    mt = bpy.data.materials.new('M_hy_' + key); mt.use_nodes = True
    bsdf = mt.node_tree.nodes['Principled BSDF']
    if color is None:
        img = bpy.data.images.load(tex)
        tn = mt.node_tree.nodes.new('ShaderNodeTexImage'); tn.image = img
        mt.node_tree.links.new(tn.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.75
    else:
        bsdf.inputs['Base Color'].default_value = (*color, 1)
        bsdf.inputs['Roughness'].default_value = 0.45
    me.materials.clear(); me.materials.append(mt)
    for p in me.polygons:
        p.use_smooth = True
    ob['ph'] = 'hy_' + key
    ob.name = name
    print('HY', key, len(me.polygons), 'faces')
    return ob


def upgrade_hy():
    # the doll on top of the bookshelf, facing the room (its face is -z in the engine, like before)
    old = bpy.data.objects.get('item_doll')
    if old:
        bpy.context.view_layer.update()
        omn, omx = ph_bounds(old)
        d = hy_item('doll', 'hy_doll', 0.34, faces=3500)
        if d:
            ph_place(d, 1.0, ((omn.x + omx.x) / 2, omn.z, -(omn.y + omx.y) / 2), rotz=PI)
            replace('item_doll', d)
            item_origin(d)
    # the remote on the TV stand, next to the set
    old = bpy.data.objects.get('item_remote')
    if old:
        r = hy_item('remote', 'hy_remote', 0.2, color=(0.025, 0.025, 0.028), up='len', faces=1500)
        if r:
            cab = bpy.data.objects['tv_cabinet']
            top = ph_bounds(cab)[1].z
            ph_place(r, 1.0, (0.4, top, -2.1), rotz=0.35)
            replace('item_remote', r)
            item_origin(r)
