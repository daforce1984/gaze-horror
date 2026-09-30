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
        # a separate greyscale roughness map would be exported as a 1-channel image (WebP can't): use a constant
        for l in list(m.node_tree.links):
            src = l.from_node
            while src and src.type not in ('TEX_IMAGE',) and src.inputs and src.inputs[0].is_linked:
                src = src.inputs[0].links[0].from_node
            if l.to_socket.name == 'Roughness' and src and src.type == 'TEX_IMAGE' and src.image and '_arm' not in src.image.name:
                l.to_socket.default_value = 0.75
                m.node_tree.links.remove(l)
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


def ph_import_file(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    for o in new:
        if o not in meshes:
            bpy.data.objects.remove(o, do_unlink=True)
    ob = meshes[0]
    ob.rotation_mode = 'XYZ'
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob


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
    ob.rotation_mode = 'XYZ'   # the glTF importer leaves objects in quaternion mode (euler would be ignored)
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
             ]
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
    clk = ph_import('wall_clock', skip=('hand',), drop_mats=('glass',), res=512)
    ph_place(clk, 1.15, (RX - 0.03, 1.85, -0.3), rotz=-PI / 2, anchor='centre')   # dial towards the room (-x)
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

    # (the ceiling light is a flush fixture built in build.py; no hanging bulb any more)


# ---- props reconstructed with Hunyuan3D from Codex concept images (tools/hy3d.py), textured by projecting
# the concept image back onto them from the front (the view it was generated from)
HY = os.path.join(os.path.dirname(HERE), 'design', 'ghost3d')


def hy_item(key, name, height, faces=6000, color=None, up='z'):
    baked = os.path.join(os.path.dirname(HERE), 'design', 'mv', key.replace('_front', '') + '_baked.glb')
    if color is None and os.path.exists(baked):   # textured from all sides already (blender/multiview.py)
        ob = ph_import_file(baked)
        mn, mx = ph_bounds(ob)
        s = height / ((mx.z - mn.z) if up == 'z' else max(mx.x - mn.x, mx.y - mn.y))
        ob.data.transform(Matrix.Translation(-Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))))
        ob.data.transform(Matrix.Scale(s, 4))
        ob['ph'] = 'hy_' + key; ob.name = name
        print('HY', key, 'multiview baked', len(ob.data.polygons), 'faces')
        return ob
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
    r = ob.modifiers.new('rem', 'REMESH'); r.mode = 'VOXEL'; r.voxel_size = max(ob.dimensions) / 200; r.adaptivity = 0.0   # always remeshed
    bpy.ops.object.modifier_apply(modifier=r.name)
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


def add_props():
    """lived-in detail (Poly Haven CC0): things a mother and a seven-year-old leave around"""
    dx, dz, dtop = 1.86, -0.3, 0.74 + 0.018
    def put(pid, name, s, pt, rotz=0.0, faces=2000, res=512, **kw):
        ob = ph_import(pid, res=res, faces=faces, **kw)
        ph_place(ob, s, pt, rotz=rotz)
        ob.name = name; ob.data.name = name
        return ob
    put('desk_lamp_arm_01', 'deco_desklamp', 0.62, (dx + 0.14, dtop, dz - 0.46), rotz=-PI / 2 - 0.4, faces=3000)
    sf = put('standing_picture_frame_01', 'deco_standframe', 0.85, (dx + 0.12, dtop, dz + 0.12), rotz=PI + 0.25, faces=1000, drop_mats=('glass',))   # this model faces +x
    pol = bpy.data.images.load(os.path.join(os.path.dirname(HERE), 'assets', 'polaroid.webp'))
    for m in sf.data.materials:   # the stock artwork becomes the polaroid of the empty chair
        if m and 'artwork' in m.name:
            for n in m.node_tree.nodes:
                if n.type == 'TEX_IMAGE' and n.image and ('diff' in n.image.name or 'col' in n.image.name.lower()):
                    n.image = pol
    put('stationery_supplies', 'deco_pencils', 0.9, (dx - 0.12, dtop, dz - 0.12), rotz=0.5, faces=1500)
    # the birthday cake on the tray of the low table (the bowl goes)
    lt = bpy.data.objects['lowtable']
    ttop = ph_bounds(lt)[1].z
    put('strawberry_chocolate_cake', 'deco_cake', 0.8, (-0.85, 0.31 + 0.028 + 0.006, -0.95), rotz=0.3, faces=3000)
    # a basket of toys by the desk, the duck inside; the mother's suitcase by the door
    put('wicker_basket_01', 'deco_basket', 1.0, (1.12, 0.0, 0.95), rotz=0.4, faces=2500)
    put('rubber_duck_toy', 'deco_duck', 0.45, (1.1, 0.03, 0.93), rotz=2.3, faces=1500)
    put('vintage_suitcase', 'deco_suitcase', 0.85, (1.95, 0.0, 1.35), rotz=-PI / 2, faces=3000, keep=['suitcase_01'])


def add_kid_things():
    """a seven-year-old's things (Hunyuan3D from Codex front views): the room is hers too"""
    cu = bpy.data.objects.get('cushion')
    ctop = ph_bounds(cu)[1].z if cu else 0.08
    for key, name, h, pt, rotz, faces in (
            ('teddy', 'deco_teddy', 0.3, (-1.2, ctop - 0.01, 0.2), PI / 2 + 0.2, 3500),            # sitting on the cushion, looking at you
            ('backpack', 'deco_backpack', 0.36, (1.42, 0.0, 0.5), -PI / 2 + 0.3, 3000),          # leaning by the desk
            ('shoes', 'deco_shoes', 0.075, (0.45, 0.0, 2.28), PI + 0.15, 2000),                   # little red shoes at the door
            ('musicbox_front', 'deco_musicbox', 0.15, (-0.36, None, -2.12), 0.25, 3000)):          # open on the TV stand
        ob = hy_item(key, name, h, faces=faces)
        if not ob:
            continue
        if pt[1] is None:
            pt = (pt[0], ph_bounds(bpy.data.objects['tv_cabinet'])[1].z, pt[2])
        ph_place(ob, 1.0, pt, rotz=rotz)
        ob.name = name; ob.data.name = name


def add_modern():
    """the clean modern studio the game starts in: white, minimal furniture and electronics, each one in the
    place of the 1999 piece that burns in when the other world reaches it (engine: MODERN pairs in main.js)"""
    W = mat('M_mod_white', (0.86, 0.86, 0.84), 0.35)
    Wm = mat('M_mod_matte', (0.8, 0.8, 0.78), 0.8)
    OAK = mat('M_mod_oak', (0.62, 0.47, 0.32), 0.55)
    BLK = mat('M_mod_black', (0.015, 0.015, 0.017), 0.15)
    SIL = mat('M_mod_silver', (0.62, 0.63, 0.65), 0.3, 0.8)
    GRN = mat('M_mod_leaf', (0.16, 0.3, 0.14), 0.7)

    def group(name, parts):
        ob = join(name, parts)
        item_origin(ob)
        return ob

    # TV console + wall-sized flat TV
    cz = -2.3
    ctop = ph_bounds(bpy.data.objects['tv_cabinet'])[1].z   # same height as the old chest: the remote and music box sit on it
    tvs = [box('mc_body', (0, (0.1 + ctop) / 2, cz), (1.4, ctop - 0.1, 0.38), W, 0.01),
           box('mc_gap', (0, (0.1 + ctop) / 2, cz + 0.191), (0.004, ctop - 0.14, 0.004), BLK)]
    for x in (-0.62, 0.62):
        for z in (cz - 0.14, cz + 0.14):
            tvs.append(cyl('mc_leg', (x, 0.05, z), 0.012, 0.1, OAK, seg=10))
    group('mod_tvstand', tvs)
    tv = [box('mt_panel', (0, ctop + 0.02 + 0.33, cz - 0.02), (1.1, 0.64, 0.025), BLK, 0.004),
          box('mt_neck', (0, ctop + 0.035, cz - 0.02), (0.18, 0.03, 0.12), SIL, 0.004),
          box('mt_logo', (0, ctop + 0.075, cz - 0.004), (0.05, 0.006, 0.002), SIL)]
    group('mod_tv', tv)
    # round coffee table (white top, oak legs)
    tb = [cyl('mt_top', (-0.95, 0.34, -1.0), 0.36, 0.025, W, seg=40)]
    for a in (0.3, 2.4, 4.5):
        tb.append(cyl('mt_leg', (-0.95 + math.cos(a) * 0.22, 0.165, -1.0 + math.sin(a) * 0.22), 0.014, 0.33, OAK, seg=10))
    tb.append(cyl('mt_mug', (-0.85, 0.395, -0.95), 0.035, 0.085, Wm, seg=18))
    group('mod_table', tb)
    # white open shelf, as tall as the old bookshelf (the doll sits on top)
    bx, bz = -1.55, 2.33
    top = ph_bounds(bpy.data.objects['bookshelf'])[1].z
    sh = [box('ms_side1', (bx - 0.33, top / 2, bz), (0.02, top, 0.3), W), box('ms_side2', (bx + 0.33, top / 2, bz), (0.02, top, 0.3), W)]
    for y in (0.02, top * 0.34, top * 0.67, top - 0.01):
        sh.append(box('ms_board', (bx, y, bz), (0.66, 0.02, 0.3), W))
    for k, (x, w, h, c) in enumerate(((-0.2, 0.18, 0.2, Wm), (0.05, 0.12, 0.16, OAK), (0.18, 0.16, 0.12, Wm))):
        sh.append(box('ms_box%d' % k, (bx + x, top * 0.34 + 0.01 + h / 2, bz), (w, h, 0.22), c, 0.004))
    sh.append(cyl('ms_pot', (bx - 0.15, top * 0.67 + 0.07, bz), 0.06, 0.12, Wm, seg=20))
    sh.append(sphere('ms_plant', (bx - 0.15, top * 0.67 + 0.2, bz), 0.1, GRN, scale=(1, 1, 1.2)))
    group('mod_shelf', sh)
    # white desk with slim legs, laptop, smart speaker
    dx, dz, dt = 1.86, -0.3, 0.74
    dk = [box('md_top', (dx, dt, dz), (0.6, 0.025, 1.15), W, 0.004)]
    for lx in (-0.26, 0.26):
        for lz in (-0.52, 0.52):
            dk.append(box('md_leg', (dx + lx, (dt - 0.012) / 2, dz + lz), (0.025, dt - 0.012, 0.025), SIL))
    group('mod_desk', dk)
    # a proper thin laptop facing the room (-x): bevelled aluminium base, keyboard well with keys, trackpad,
    # hinge barrel, and a lid tilted back 20 degrees with a bezel round a dark glossy screen
    KEY = mat('M_mod_key', (0.03, 0.03, 0.035), 0.55)
    PAD = mat('M_mod_pad', (0.5, 0.51, 0.53), 0.22, 0.8)
    bxc, bzc, D, Wd, T = dx - 0.1, dz - 0.08, 0.215, 0.31, 0.013    # base centre (forward: the tilted lid clears the frames by the wall), depth (x), width (z), thickness
    by = dt + 0.0125 + T / 2
    lp = [box('ml_base', (bxc, by, bzc), (D, T, Wd), SIL, 0.003)]
    ytop = by + T / 2
    lp.append(box('ml_well', (bxc + 0.035, ytop + 0.0002, bzc), (0.105, 0.0006, 0.27), KEY))   # keyboard well
    rows = [(14, 0.0165), (14, 0.0165), (13, 0.0165), (13, 0.0165), (12, 0.0165)]
    for r, (n, kw) in enumerate(rows):
        xk = bxc + 0.075 - r * 0.0195
        span = n * (kw + 0.0025)
        for c in range(n):
            w = kw * (3.2 if (r == 4 and c == n // 2) else 1)
            if r == 4 and c > n // 2 and c <= n // 2 + 2: continue            # the space bar takes three places
            zk = bzc - span / 2 + (c + 0.5) * (kw + 0.0025) + (w - kw) / 2
            lp.append(box('ml_key', (xk, ytop + 0.0012, zk), (0.0155, 0.0014, w), KEY))
    lp.append(box('ml_pad', (bxc - 0.068, ytop + 0.0002, bzc), (0.068, 0.0006, 0.115), PAD, 0.001))   # trackpad
    hx = bxc + D / 2 - 0.004
    lp.append(cyl('ml_hinge', (hx, ytop + 0.002, bzc), 0.0055, Wd * 0.8, SIL, seg=12, axis='z'))
    a, H, L = 0.35, 0.205, 0.006                                   # lid tilt back from vertical, height, thickness
    cx, cy = hx + math.sin(a) * H / 2, ytop + 0.002 + math.cos(a) * H / 2
    lid = box('ml_lid', (cx, cy, bzc), (L, H, Wd), SIL, 0.002)
    fx = -L / 2 - 0.0006                                           # the screen side faces -x
    bez = box('ml_bezel', (cx + fx * math.cos(a), cy - fx * math.sin(a), bzc), (0.0012, H - 0.006, Wd - 0.006), BLK)
    scr_m = mat('M_mod_screen', (0.012, 0.014, 0.02), 0.08)
    fx2 = fx - 0.0008
    scr = box('ml_screen', (cx + fx2 * math.cos(a) - 0.004 * math.sin(a), cy - fx2 * math.sin(a) - 0.004 * math.cos(a), bzc), (0.0008, H - 0.026, Wd - 0.02), scr_m)
    for ob in (lid, bez, scr): ob.rotation_euler = (0, a, 0)
    lp += [lid, bez, scr]
    group('mod_laptop', lp)
    group('mod_speaker', [cyl('mk_body', (dx - 0.05, dt + 0.07, dz + 0.42), 0.05, 0.13, Wm, seg=24),
                          cyl('mk_top', (dx - 0.05, dt + 0.138, dz + 0.42), 0.048, 0.006, SIL, seg=24)])


def add_props2():
    """twenty more things (Poly Haven CC0). They belong to the 1999 room: the engine forms them in as the fire
    reaches them, and several become anomalies of their own. Placed clear of the furniture and the trash piles."""
    def put(pid, name, s, pt, rotz=0.0, faces=2000, anchor='bottom', rotx=0.0, **kw):
        ob = ph_import(pid, res=512, faces=faces, **kw)
        ph_place(ob, s, pt, rotz=rotz, rotx=rotx, anchor=anchor)
        ob.name = name; ob.data.name = name
        item_origin(ob)
        return ob
    top = lambda n: ph_bounds(bpy.data.objects[n])[1].z
    crate = put('wooden_crate_01', 'p_crate', 0.8, (0.85, 0, -2.3), faces=1500)
    put('boombox', 'p_boombox', 0.62, (0.85, top('p_crate'), -2.3), faces=2500)
    put('vintage_telephone_wall_clock', 'p_phone', 0.9, (2.2 - 0.1, 1.05, 0.95), rotz=-PI / 2, faces=2500)
    put('side_table_01', 'p_sidetable', 1.0, (-1.85, 0, 1.55), rotz=PI / 2, faces=1500)
    st = top('p_sidetable')
    put('mantel_clock_01', 'p_mclock', 0.9, (-1.85, st, 1.42), rotz=PI / 2, faces=2000, drop_mats=('glass',))
    put('wooden_candlestick', 'p_candle', 1.0, (-1.85, st, 1.74), faces=800)
    put('vintage_video_camera', 'p_camera', 1.0, (-1.3, top('bookshelf'), 2.3), rotz=PI + 0.4, faces=2000)
    put('street_rat', 'p_rat', 1.3, (0.3, 0, -1.3), rotz=0.7, faces=1200)
    put('standing_chalkboard_01', 'p_chalk', 0.72, (-0.95, 0, 1.82), rotz=PI - 0.3, faces=1500)
    put('wooden_stool_01', 'p_stool', 1.0, (1.25, 0, -0.6), faces=1500)
    put('vintage_oil_lamp', 'p_oillamp', 0.6, (1.45, 0, 2.25), faces=1500, drop_mats=('glass',))
    put('alarm_clock_01', 'p_alarm', 1.0, (-1.6, 0, 0.62), rotz=PI / 2 + 0.3, faces=1500)
    put('wicker_basket_02', 'p_basket2', 1.0, (-0.75, 0, 0.98), rotz=0.6, faces=1500)
    put('wooden_bowl_01', 'p_bowl', 1.0, (-1.5, 0, -0.35), faces=1000)
    put('tea_set_01', 'p_teaset', 0.6, (-0.3, 0, -1.55), rotz=0.3, faces=2500)
    put('hanging_picture_frame_02', 'p_frame2', 0.8, (-2.2 + 0.03, 1.55, 1.15), rotz=PI / 2, faces=1000, anchor='centre')
    put('book_encyclopedia_set_01', 'p_books', 1.0, (-0.9, 0, 2.38), rotz=PI, faces=2500)
    put('vintage_flashlight', 'p_flashlight', 1.0, (0.55, 0, -0.1), rotz=1.1, faces=1200)
    put('sungka_board', 'p_sungka', 1.0, (-0.7, 0, 0.35), faces=1500)
    put('vintage_pocket_watch', 'p_watch', 1.0, (-1.15, top('lowtable'), -0.8), rotx=-PI / 2, faces=1000)


def globe_floor_lamp(name, pt, height=1.45, globe=0.36):
    """a modern globe floor lamp: Poly Haven's modern_ceiling_lamp_01 shade (opal globe + metal cap, the cord,
    canopy and bulb cut away; the glass made opaque opal) on a slim black pole with a round weighted base"""
    import bmesh
    ob = ph_import('modern_ceiling_lamp_01', res=1024)
    me = ob.data
    names = [m.name for m in me.materials]
    bm = bmesh.new(); bm.from_mesh(me)
    zmin = min(v.co.z for v in bm.verts)
    cut = zmin + 0.38   # just above the globe's metal cap (globe 0.22-0.53, cap to ~0.6 in the source)
    kill = [f for f in bm.faces if 'globe' in names[f.material_index] and 'glass' not in names[f.material_index]
            or any(v.co.z > cut for v in f.verts)]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(me); bm.free()
    OPAL = mat('M_mod_opal', (0.93, 0.92, 0.88), 0.45)
    for i, n in enumerate(names):
        if 'glass' in n: me.materials[i] = OPAL
    # the ceiling globe hangs under its cap: turn it over so the cap is the fitting on top of the pole
    me.transform(Matrix.Rotation(PI, 4, 'X'))
    # the pendant's globe is open where the light falls out (now the top): close it with a spherical cap
    # fitted to the globe (centre at its widest ring, radius = that ring)
    oi = [i for i, m in enumerate(me.materials) if m and m.name == 'M_mod_opal']
    gi = {i for p in me.polygons if p.material_index in oi for i in p.vertices}
    gv = [me.vertices[i].co.copy() for i in gi]
    if gv:
        cx = sum(v.x for v in gv) / len(gv); cy = sum(v.y for v in gv) / len(gv)
        rad = lambda v: math.hypot(v.x - cx, v.y - cy)
        wide = max(gv, key=rad); R, zc = rad(wide), wide.z
        ztop = max(v.z for v in gv)
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=24, radius=R * 0.995)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < ztop - zc - 0.004], context='VERTS')
        bmesh.ops.translate(bm, verts=bm.verts, vec=Vector((cx, cy, zc)))
        cap = bpy.data.meshes.new('yl_cap'); bm.to_mesh(cap); bm.free()
        for p in cap.polygons: p.use_smooth = True
        cob = bpy.data.objects.new('yl_cap', cap); bpy.context.collection.objects.link(cob); cap.materials.append(OPAL)
        ob = join(ob.name, [ob, cob]); me = ob.data
    bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    w = max(c.x for c in bb) - min(c.x for c in bb)
    ob.scale = (globe / w,) * 3
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    bpy.ops.object.transform_apply(scale=True)
    bb = [Vector(c) for c in ob.bound_box]
    cz = (min(c.z for c in bb) + max(c.z for c in bb)) / 2
    cxy = ((min(c.x for c in bb) + max(c.x for c in bb)) / 2, (min(c.y for c in bb) + max(c.y for c in bb)) / 2)
    top = height - globe / 2
    ob.location = E(pt[0], top, pt[2]) - Vector((cxy[0], cxy[1], cz))
    bpy.ops.object.transform_apply(location=True)
    BLK = mat('M_mod_lampblack', (0.02, 0.02, 0.022), 0.35, 0.6)
    pole = cyl('yl_pole', (pt[0], (top - globe * 0.45) / 2 + 0.02, pt[2]), 0.011, top - globe * 0.45, BLK, seg=12)
    base = cyl('yl_base', (pt[0], 0.012, pt[2]), 0.14, 0.024, BLK, seg=32)
    foot = cyl('yl_collar', (pt[0], 0.03, pt[2]), 0.03, 0.02, BLK, seg=16)
    lamp = join(name, [ob, pole, base, foot])
    lamp.name = name; lamp.data.name = name
    item_origin(lamp)
    return lamp


def add_young_woman():
    """the modern studio's own things: a young woman living alone. Poly Haven pieces + Hunyuan3D meshes
    (Codex product images, remeshed, front-projected). The engine dissolves each when the fire reaches it."""
    def ph(pid, name, sc, pt, rotz=0.0, faces=2500, **kw):
        ob = ph_import(pid, res=512, faces=faces, **kw); ph_place(ob, sc, pt, rotz=rotz)
        ob.name = name; ob.data.name = name; item_origin(ob); return ob
    def hy(key, name, h, pt, rotz=0.0, faces=3000, up='z'):
        ob = hy_item(key, name, h, faces=faces, up=up)
        if not ob: return None
        ph_place(ob, 1.0, pt, rotz=rotz); ob.name = name; ob.data.name = name; item_origin(ob); return ob
    top = lambda n: ph_bounds(bpy.data.objects[n])[1].z if bpy.data.objects.get(n) else 0.4
    ph('modern_arm_chair_01', 'yw_armchair', 0.9, (-1.6, 0, 1.05), rotz=PI / 2 - 0.5)
    ph('potted_plant_02', 'yw_plant', 1.0, (1.45, 0, -2.15), faces=4000)
    ph('potted_plant_04', 'yw_succulent', 1.0, (-1.55, top('mod_shelf'), 2.33), faces=1500)   # on top of her shelf (the doll comes later)
    ph('ceramic_vase_01', 'yw_vase1', 0.6, (-0.55, top('mod_tvstand'), -2.25), faces=1500)
    ph('ceramic_vase_03', 'yw_vase2', 0.6, (-0.42, top('mod_tvstand'), -2.2), faces=1500)
    ph('standing_picture_frame_02', 'yw_frame', 0.9, (1.95, 0.74 + 0.013, -0.62), rotz=PI + 0.3, faces=1000)
    hy('mod_bed', 'yw_bed', 0.8, (1.72, 0, 1.45), rotz=-PI / 2, faces=4000)
    hy('mod_mirror', 'yw_mirror', 1.6, (-2.05, 0, 0.72), rotz=PI / 2, faces=2500)
    hy('mod_rack', 'yw_rack', 1.45, (-0.35, 0, 2.28), rotz=PI, faces=4000)
    globe_floor_lamp('yw_lamp', (-1.5, 0, -2.2))
    hy('mod_monstera', 'yw_monstera', 0.95, (-1.35, 0, -1.75), faces=4000)
    hy('mod_bag', 'yw_bag', 0.28, (1.35, 0, 0.45), rotz=-PI / 2 + 0.3, faces=2500)
    hy('mod_candle', 'yw_candle', 0.2, (-0.8, 0.34 + 0.012, -0.95), faces=2000)
