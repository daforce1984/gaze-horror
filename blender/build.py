# Blender 5.x build script for "응시" — models the room, props, trash piles and the ghost,
# bakes ambient occlusion into vertex colours and exports GLB files for the WebGPU engine.
#   blender -b --python build.py -- [room|ghost|all] [--preview]
# Coordinates: helper E() takes ENGINE coords (x right, y up, z towards the viewer; the player
# faces -z) and converts to Blender (x, -z, y). glTF export converts back to engine space.
import bpy, bmesh, math, random, sys, os
from mathutils import Vector, Matrix, Euler, noise

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'assets')
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
MODE = argv[0] if argv and not argv[0].startswith('--') else 'all'
PREVIEW = '--preview' in argv
NOBAKE = '--nobake' in argv
PI = math.pi


def E(x, y, z):
    return Vector((x, -z, y))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()


MATS = {}


def mat(name, color=(0.8, 0.8, 0.8), rough=0.8, metal=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    m.diffuse_color = (*color, 1)
    MATS[name] = m
    return m


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def from_bm(name, bm, material=None, loc=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    link(ob)
    if material:
        me.materials.append(material)
    if loc is not None:
        ob.location = loc
    return ob


def add_mod(ob, kind, **kw):
    m = ob.modifiers.new(kind.lower(), kind)
    for k, v in kw.items():
        setattr(m, k, v)
    return m


def apply_mods(ob):
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def box(name, c, s, material, bevel=0.0, rot=0.0, cuts=0):
    """engine centre c, engine size s=(w,h,d)"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    if cuts:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for v in bm.verts:
        v.co = Vector((v.co.x * s[0], v.co.y * s[2], v.co.z * s[1]))
    ob = from_bm(name, bm, material, E(*c))
    ob.rotation_euler = (0, 0, rot)
    if bevel > 0:
        add_mod(ob, 'BEVEL', width=bevel, segments=2, limit_method='ANGLE')
    return ob


def cyl(name, c, r, h, material, seg=24, axis='y', r2=None, cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    ob = from_bm(name, bm, material, E(*c))
    if axis == 'x':
        ob.rotation_euler = (0, PI / 2, 0)
    elif axis == 'z':  # engine z = blender -y
        ob.rotation_euler = (PI / 2, 0, 0)
    return ob


def sphere(name, c, r, material, seg=16, ring=10, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=ring, radius=r)
    for v in bm.verts:
        v.co = Vector((v.co.x * scale[0], v.co.y * scale[2], v.co.z * scale[1]))
    return from_bm(name, bm, material, E(*c))


def world_uv(ob, tile=1.2):
    """box-project UVs in world metres so tiled textures keep a constant density"""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    uv = me.uv_layers.active.data
    mw = ob.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    for poly in me.polygons:
        n = (nm @ poly.normal).normalized()
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            p = mw @ me.vertices[me.loops[li].vertex_index].co
            if ax == 0:
                u, v = p.y * (1 if n.x < 0 else -1), p.z
            elif ax == 1:
                u, v = p.x * (1 if n.y > 0 else -1), p.z
            else:
                u, v = p.x, p.y
            uv[li].uv = (u / tile, v / tile)


def fill_missing_uvs(tile=1.0):
    """procedural parts (and procedural pieces joined into textured models) have no UVs: every polygon whose
    loops all sit at (0, 0) gets a world box projection, so tiled PBR textures and normal maps work on it"""
    n = 0
    for ob in bpy.data.objects:
        if ob.type != 'MESH' or ob.name.startswith('ghost'):
            continue
        me = ob.data
        if not me.uv_layers:
            me.uv_layers.new(name='UVMap')
            for d in me.uv_layers.active.data: d.uv = (0.0, 0.0)
        uv = me.uv_layers.active.data
        mw = ob.matrix_world; nm = mw.to_3x3().inverted().transposed()
        for poly in me.polygons:
            if any(abs(uv[li].uv.x) + abs(uv[li].uv.y) > 1e-7 for li in poly.loop_indices):
                continue
            nrm = (nm @ poly.normal).normalized(); ax = max(range(3), key=lambda i: abs(nrm[i])); n += 1
            for li in poly.loop_indices:
                p = mw @ me.vertices[me.loops[li].vertex_index].co
                u, v = (p.y, p.z) if ax == 0 else (p.x, p.z) if ax == 1 else (p.x, p.y)
                uv[li].uv = (u / tile, v / tile)
    print('UV filled', n, 'polygons')


def plane_uv01(ob):
    """planar 0..1 UVs from local bounds (u along local x, v along local z or y)"""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    uv = me.uv_layers.active.data
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    spans = [max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)]
    flat = spans.index(min(spans))
    axes = [i for i in range(3) if i != flat]
    lo = [min(c) for c in (xs, ys, zs)]
    hi = [max(c) for c in (xs, ys, zs)]
    for li, loop in enumerate(me.loops):
        co = me.vertices[loop.vertex_index].co
        a, b = axes
        u = (co[a] - lo[a]) / max(1e-6, hi[a] - lo[a])
        v = (co[b] - lo[b]) / max(1e-6, hi[b] - lo[b])
        uv[li].uv = (u, v)


def join(name, obs):
    obs = [o for o in obs if o]
    for o in obs:
        if o.modifiers:
            apply_mods(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def set_origin(ob, engine_pt):
    """move the object origin to an engine-space point without moving geometry"""
    bpy.context.view_layer.update()   # matrix_world is stale right after setting a location
    target = E(*engine_pt)
    delta = target - ob.matrix_world.translation
    ob.data.transform(Matrix.Translation(-(ob.matrix_world.inverted().to_3x3() @ delta)))
    ob.location = target


def grid_wall(name, origin, uax, vax, U, V, cell, holes, inward, material):
    """wall as a grid (for vertex AO) with rectangular holes (u0,u1,v0,v1)"""
    bm = bmesh.new()
    nu, nv = round(U / cell), round(V / cell)
    verts = {}
    o, ua, va = Vector(origin), Vector(uax), Vector(vax)
    for i in range(nu + 1):
        for j in range(nv + 1):
            p = o + ua * (i * cell) + va * (j * cell)
            verts[i, j] = bm.verts.new(E(*p))
    for i in range(nu):
        for j in range(nv):
            cu, cv = (i + 0.5) * cell, (j + 0.5) * cell
            if any(h[0] <= cu <= h[1] and h[2] <= cv <= h[3] for h in holes):
                continue
            bm.faces.new((verts[i, j], verts[i + 1, j], verts[i + 1, j + 1], verts[i, j + 1]))
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.normal_update()
    bm.faces.ensure_lookup_table()
    want = E(*inward)
    if bm.faces and bm.faces[0].normal.dot(want) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    return from_bm(name, bm, material)


# ------------------------------------------------------------------------------------------
def build_room():
    RX, RZ, RH = 2.2, 2.5, 2.6
    M = dict(
        wall=mat('M_wall', (0.55, 0.55, 0.47)), floor=mat('M_floor', (0.4, 0.3, 0.22), 0.6),
        ceil=mat('M_ceiling', (0.7, 0.68, 0.62)), wood=mat('M_wood', (0.45, 0.32, 0.22), 0.55),
        wooddark=mat('M_wooddark', (0.22, 0.15, 0.1), 0.5), door=mat('M_door', (0.4, 0.3, 0.2), 0.6),
        plastic=mat('M_plastic', (0.03, 0.03, 0.03), 0.35), metal=mat('M_metal', (0.45, 0.42, 0.38), 0.4, 1.0),
        brass=mat('M_brass', (0.55, 0.42, 0.18), 0.35, 1.0), screen=mat('M_tvscreen', (0.05, 0.05, 0.05), 0.1),
        clockface=mat('M_clockface', (0.8, 0.76, 0.62), 0.5), window=mat('M_window', (0.1, 0.12, 0.2), 0.2),
        curtain=mat('M_curtain', (0.35, 0.15, 0.13), 0.9), bulb=mat('M_bulb', (1, 0.9, 0.7), 0.2),
        shade=mat('M_shade', (0.25, 0.3, 0.22), 0.45, 0.3), cord=mat('M_cord', (0.02, 0.02, 0.02), 0.6),
        paper=mat('M_paper', (0.62, 0.58, 0.48), 0.9), glass=mat('M_glassgreen', (0.05, 0.22, 0.1), 0.08),
        ceramic=mat('M_ceramic', (0.6, 0.58, 0.55), 0.3), bag=mat('M_bag', (0.02, 0.02, 0.025), 0.25),
        bagw=mat('M_bagwhite', (0.55, 0.55, 0.5), 0.35), can=mat('M_can', (0.5, 0.08, 0.06), 0.3, 0.8),
        can2=mat('M_can2', (0.55, 0.55, 0.58), 0.3, 0.9), cup=mat('M_cup', (0.75, 0.72, 0.62), 0.7),
        cardboard=mat('M_cardboard', (0.45, 0.33, 0.2), 0.9), cloth=mat('M_rag', (0.25, 0.28, 0.32), 0.95),
        rope=mat('M_rope', (0.45, 0.38, 0.25), 0.95), corridor=mat('M_corridor', (0.8, 0.8, 0.78), 0.8),
        doll=mat('M_doll', (0.75, 0.6, 0.55), 0.6), dollhair=mat('M_hair', (0.02, 0.018, 0.017), 0.3),
    )
    cell = 0.1
    # ---- shell
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=44, y_subdivisions=50, size=1)
    fl = bpy.context.active_object
    fl.name = 'floor'
    fl.scale = (2 * RX, 2 * RZ, 1)
    bpy.ops.object.transform_apply(scale=True)
    fl.data.materials.append(M['floor'])
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=22, y_subdivisions=25, size=1)
    ce = bpy.context.active_object
    ce.name = 'ceiling'
    ce.scale = (2 * RX, 2 * RZ, 1)
    ce.location = (0, 0, RH)
    ce.rotation_euler = (PI, 0, 0)
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    ce.data.materials.append(M['ceil'])
    DOOR = (0.2, 1.2, 0.0, 2.1)  # x0,x1,y0,y1
    WIN = (-1.2, 0.0, 0.9, 2.0)  # z0,z1,y0,y1
    walls = [
        grid_wall('wall_front', (-RX, 0, -RZ), (1, 0, 0), (0, 1, 0), 2 * RX, RH, cell, [], (0, 0, 1), M['wall']),
        grid_wall('wall_back', (-RX, 0, RZ), (1, 0, 0), (0, 1, 0), 2 * RX, RH, cell,
                  [(DOOR[0] + RX, DOOR[1] + RX, DOOR[2], DOOR[3])], (0, 0, -1), M['wall']),
        grid_wall('wall_left', (-RX, 0, -RZ), (0, 0, 1), (0, 1, 0), 2 * RZ, RH, cell,
                  [(WIN[0] + RZ, WIN[1] + RZ, WIN[2], WIN[3])], (1, 0, 0), M['wall']),
        grid_wall('wall_right', (RX, 0, -RZ), (0, 0, 1), (0, 1, 0), 2 * RZ, RH, cell, [], (-1, 0, 0), M['wall']),
    ]
    for w in walls + [fl, ce]:
        world_uv(w, 2.0 if w.name.startswith('wall') else 1.5)

    # baseboards
    bbs = [box('bb_f', (0, 0.05, -RZ + 0.012), (2 * RX, 0.1, 0.024), M['wooddark']),
           box('bb_l', (-RX + 0.012, 0.05, 0), (0.024, 0.1, 2 * RZ), M['wooddark']),
           box('bb_r', (RX - 0.012, 0.05, 0), (0.024, 0.1, 2 * RZ), M['wooddark']),
           box('bb_b1', ((-RX + DOOR[0] - 0.08) / 2, 0.05, RZ - 0.012), (DOOR[0] - 0.08 + RX, 0.1, 0.024), M['wooddark']),
           box('bb_b2', ((DOOR[1] + 0.08 + RX) / 2, 0.05, RZ - 0.012), (RX - DOOR[1] - 0.08, 0.1, 0.024), M['wooddark'])]
    # crown moulding
    bbs += [box('cm_f', (0, RH - 0.03, -RZ + 0.015), (2 * RX, 0.06, 0.03), M['ceil']),
            box('cm_b', (0, RH - 0.03, RZ - 0.015), (2 * RX, 0.06, 0.03), M['ceil']),
            box('cm_l', (-RX + 0.015, RH - 0.03, 0), (0.03, 0.06, 2 * RZ), M['ceil']),
            box('cm_r', (RX - 0.015, RH - 0.03, 0), (0.03, 0.06, 2 * RZ), M['ceil'])]
    trim = join('trim', bbs)
    world_uv(trim, 0.8)

    # ---- door opening: reveal, casing, slab, corridor
    D0, D1, DH = DOOR[0], DOOR[1], DOOR[3]
    parts = [box('rev_l', (D0 - 0.01, DH / 2, RZ + 0.075), (0.02, DH, 0.15), M['wall']),
             box('rev_r', (D1 + 0.01, DH / 2, RZ + 0.075), (0.02, DH, 0.15), M['wall']),
             box('rev_t', ((D0 + D1) / 2, DH + 0.01, RZ + 0.075), (D1 - D0 + 0.04, 0.02, 0.15), M['wall'])]
    parts += [box('cas_l', (D0 - 0.04, DH / 2 + 0.02, RZ - 0.012), (0.08, DH + 0.04, 0.024), M['wooddark'], 0.006),
              box('cas_r', (D1 + 0.04, DH / 2 + 0.02, RZ - 0.012), (0.08, DH + 0.04, 0.024), M['wooddark'], 0.006),
              box('cas_t', ((D0 + D1) / 2, DH + 0.05, RZ - 0.012), (D1 - D0 + 0.16, 0.08, 0.024), M['wooddark'], 0.006)]
    doorframe = join('doorframe', parts)
    world_uv(doorframe, 0.8)
    # slab: hinge at x=D1 (knob on the viewer's right when facing the door)
    slab = box('door', ((D0 + D1) / 2, DH / 2, RZ + 0.05), (D1 - D0 - 0.01, DH - 0.01, 0.04), M['wooddark'], 0.004, cuts=3)
    apply_mods(slab)
    # front face gets 0..1 UV for the door image, the rest world uv
    world_uv(slab, 0.8)
    me = slab.data
    uvd = me.uv_layers.active.data
    front = []
    for poly in me.polygons:
        n = poly.normal
        if n.y > 0.9:  # blender +y == engine -z == facing the room
            front.append(poly)
    xs = [(slab.matrix_world @ me.vertices[vi].co).x for p in front for vi in p.vertices]
    zs = [(slab.matrix_world @ me.vertices[vi].co).z for p in front for vi in p.vertices]
    for p in front:
        p.material_index = 1
        for li in p.loop_indices:
            co = slab.matrix_world @ me.vertices[me.loops[li].vertex_index].co
            # viewer faces +z (engine); viewer's right is engine -x
            u = (max(xs) - co.x) / (max(xs) - min(xs))
            v = (co.z - min(zs)) / (max(zs) - min(zs))
            uvd[li].uv = (u, v)
    me.materials.append(M['door'])
    knob = sphere('knob', (D0 + 0.09, 1.0, RZ + 0.005), 0.032, M['brass'])
    rose = cyl('rose', (D0 + 0.09, 1.0, RZ + 0.025), 0.028, 0.012, M['brass'], axis='z')
    keyhole = cyl('keyh', (D0 + 0.09, 0.88, RZ + 0.028), 0.018, 0.008, M['brass'], axis='z')
    door = join('door', [slab, knob, rose, keyhole])
    set_origin(door, (D1, 0, RZ + 0.05))
    # corridor behind the door (seen only at the end)
    cor = box('corridor', ((D0 + D1) / 2, 1.2, RZ + 2.2), (1.4, 2.4, 4.1), M['corridor'], cuts=4)
    bpy.context.view_layer.objects.active = cor
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.flip_normals()
    bpy.ops.object.mode_set(mode='OBJECT')
    world_uv(cor, 1.3)

    # ---- window niche, glass picture, sill, casing, curtains, rod
    Z0, Z1, Y0, Y1 = WIN
    zc, yc = (Z0 + Z1) / 2, (Y0 + Y1) / 2
    wparts = [box('wr_t', (-RX - 0.075, Y1 + 0.01, zc), (0.15, 0.02, Z1 - Z0 + 0.04), M['wall']),
              box('wr_b', (-RX - 0.075, Y0 - 0.01, zc), (0.15, 0.02, Z1 - Z0 + 0.04), M['wall']),
              box('wr_l', (-RX - 0.075, yc, Z0 - 0.01), (0.15, Y1 - Y0, 0.02), M['wall']),
              box('wr_r', (-RX - 0.075, yc, Z1 + 0.01), (0.15, Y1 - Y0, 0.02), M['wall'])]
    wparts += [box('sill', (-RX + 0.02, Y0 - 0.02, zc), (0.2, 0.04, Z1 - Z0 + 0.2), M['wooddark'], 0.01),
               box('wc_t', (-RX + 0.012, Y1 + 0.04, zc), (0.024, 0.08, Z1 - Z0 + 0.16), M['wooddark'], 0.006),
               box('wc_l', (-RX + 0.012, yc, Z0 - 0.04), (0.024, Y1 - Y0, 0.08), M['wooddark'], 0.006),
               box('wc_r', (-RX + 0.012, yc, Z1 + 0.04), (0.024, Y1 - Y0, 0.08), M['wooddark'], 0.006)]
    niche = join('window_niche', wparts)
    world_uv(niche, 0.8)
    bpy.ops.mesh.primitive_plane_add(size=1)
    wp = bpy.context.active_object
    wp.name = 'window_glass'
    wp.scale = (Z1 - Z0 + 0.02, Y1 - Y0 + 0.02, 1)
    wp.rotation_euler = (PI / 2, 0, PI / 2)  # face +x (engine) = into the room
    wp.location = E(-RX - 0.14, yc, zc)
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    wp.data.materials.append(M['window'])
    # uv: viewer (inside, facing -x engine) sees engine +z on the left
    me = wp.data
    uvd = me.uv_layers.active.data
    cy, cz = (sum(v.co.y for v in me.vertices) / len(me.vertices), sum(v.co.z for v in me.vertices) / len(me.vertices))
    for li, loop in enumerate(me.loops):
        co = me.vertices[loop.vertex_index].co
        u = 0.5 + (co.y - cy) / (Z1 - Z0 + 0.02)  # blender y = -engine z
        v = 0.5 + (co.z - cz) / (Y1 - Y0 + 0.02)
        uvd[li].uv = (u, v)
    rod = cyl('rod', (-RX + 0.22, Y1 + 0.18, zc), 0.012, Z1 - Z0 + 0.7, M['metal'], axis='z')
    fin1 = sphere('fin1', (-RX + 0.22, Y1 + 0.18, Z0 - 0.35), 0.025, M['metal'])
    fin2 = sphere('fin2', (-RX + 0.22, Y1 + 0.18, Z1 + 0.35), 0.025, M['metal'])
    for side, z_outer, sgn in (('curtain_L', Z0 - 0.3, 1), ('curtain_R', Z1 + 0.3, -1)):
        W, H = 0.9, Y1 + 0.17 - 0.3   # nearly floor-length: ankles and bare feet show under the hem
        bm = bmesh.new()
        cols, rows = 60, 22
        vs = {}
        seed = 0.3 if sgn > 0 else 2.1
        for r in range(rows + 1):
            for c in range(cols + 1):
                t = c / cols
                y = -r / rows * H
                amp = 0.05 * (0.8 + 0.4 * (r / rows))
                x = math.sin(t * 7 * 2 * PI + seed) * amp + math.sin(t * 23 + seed * 2) * amp * 0.25
                x += (noise.noise(Vector((t * 6, r / rows * 3, seed))) * 0.02)
                # engine coords relative to origin: x out of the wall, z along the rod
                vs[r, c] = bm.verts.new(E(x, y - 0.03 * (1 - math.cos(t * PI * 2)) * (r / rows) * 0.3, sgn * t * W))
        for r in range(rows):
            for c in range(cols):
                bm.faces.new((vs[r, c], vs[r, c + 1], vs[r + 1, c + 1], vs[r + 1, c]))
        ob = from_bm(side, bm, M['curtain'], E(-RX + 0.22, Y1 + 0.17, z_outer))
        add_mod(ob, 'SOLIDIFY', thickness=0.008)
        apply_mods(ob)
        world_uv(ob, 0.9)
    rodj = join('curtain_rod', [rod, fin1, fin2])

    # ---- TV cabinet + CRT
    cab = [box('cab', (0, 0.26, -2.2), (1.15, 0.46, 0.5), M['wood'], 0.012, cuts=2),
           box('cab_top', (0, 0.505, -2.2), (1.19, 0.03, 0.54), M['wood'], 0.008),
           box('cab_d1', (-0.28, 0.26, -1.945), (0.52, 0.36, 0.012), M['wooddark'], 0.004),
           box('cab_d2', (0.28, 0.26, -1.945), (0.52, 0.36, 0.012), M['wooddark'], 0.004),
           sphere('cab_k1', (-0.05, 0.3, -1.935), 0.012, M['brass']),
           sphere('cab_k2', (0.05, 0.3, -1.935), 0.012, M['brass'])]
    for lx in (-0.52, 0.52):
        for lz in (-2.4, -2.0):
            cab.append(box('cab_leg', (lx, 0.015, lz), (0.05, 0.03, 0.05), M['wooddark']))
    cabinet = join('tv_cabinet', cab)
    world_uv(cabinet, 0.7)
    # CRT body: bezel + tapered back
    TY = 0.52 + 0.29
    bez = box('tv_bezel', (0, TY, -2.03), (0.8, 0.58, 0.12), M['wooddark'], 0.02)
    panel = box('tv_panel', (0, TY, -1.967), (0.76, 0.54, 0.01), M['plastic'], 0.004)
    bm = bmesh.new()
    fr = [(-0.38, -0.27), (0.38, -0.27), (0.38, 0.27), (-0.38, 0.27)]
    bk = [(-0.24, -0.17), (0.24, -0.17), (0.24, 0.19), (-0.24, 0.19)]
    vf = [bm.verts.new(E(x, TY + y, -2.09)) for x, y in fr]
    vb = [bm.verts.new(E(x, TY + y - 0.02, -2.46)) for x, y in bk]
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((vf[i], vf[j], vb[j], vb[i]))
    bm.faces.new(vb[::-1])
    back = from_bm('tv_back', bm, M['plastic'])
    # screen: slightly domed grid
    SW, SH, SX = 0.5, 0.38, -0.1
    bm = bmesh.new()
    nx, ny = 20, 16
    sv = {}
    for i in range(nx + 1):
        for j in range(ny + 1):
            u, v = i / nx, j / ny
            x, y = (u - 0.5) * SW, (v - 0.5) * SH
            bulge = 0.022 * (1 - (2 * u - 1) ** 2) * (1 - (2 * v - 1) ** 2)
            sv[i, j] = bm.verts.new(E(SX + x, TY + y, -1.96 + bulge))
    uvl = bm.loops.layers.uv.new('UVMap')
    for i in range(nx):
        for j in range(ny):
            f = bm.faces.new((sv[i, j], sv[i + 1, j], sv[i + 1, j + 1], sv[i, j + 1]))
            for l, (a, b) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                l[uvl].uv = (a / nx, b / ny)
    screen = from_bm('tv_screen', bm, M['screen'])
    # screen surround (rounded mask frame)
    surround = [box('ss_t', (SX, TY + SH / 2 + 0.02, -1.962), (SW + 0.06, 0.04, 0.012), M['plastic'], 0.006),
                box('ss_b', (SX, TY - SH / 2 - 0.02, -1.962), (SW + 0.06, 0.04, 0.012), M['plastic'], 0.006),
                box('ss_l', (SX - SW / 2 - 0.02, TY, -1.962), (0.04, SH + 0.06, 0.012), M['plastic'], 0.006),
                box('ss_r', (SX + SW / 2 + 0.02, TY, -1.962), (0.04, SH + 0.06, 0.012), M['plastic'], 0.006)]
    ctrl = []
    for k, ky in enumerate((TY + 0.16, TY + 0.06)):
        ctrl.append(cyl('knob%d' % k, (0.27, ky, -1.955), 0.028, 0.03, M['metal'], seg=20, axis='z'))
    for r in range(7):
        ctrl.append(box('grille', (0.27, TY - 0.06 - r * 0.022, -1.96), (0.09, 0.008, 0.008), M['metal']))
    ctrl.append(box('power', (0.27, TY - 0.23, -1.958), (0.05, 0.02, 0.014), M['metal'], 0.003))
    ant = []
    for a in (0.5, -0.4):
        c = cyl('ant', (0, 0, 0), 0.004, 0.45, M['metal'], seg=6)
        c.location = E(0.05, TY + 0.2 + 0.22 * math.cos(a), -2.3) + Vector((0.22 * math.sin(a), 0, 0))
        c.rotation_euler = (0, a, 0)
        ant.append(c)
    ant.append(sphere('antbase', (0.05, TY + 0.2, -2.3), 0.04, M['plastic'], scale=(1.4, 0.5, 1)))
    tv = join('tv', [bez, panel, back] + surround + ctrl + ant)
    world_uv(tv, 0.5)

    # ---- desk + drawer
    dx, dz, top = 1.86, -0.3, 0.74
    dparts = [box('desk_top', (dx, top, dz), (0.62, 0.035, 1.15), M['wood'], 0.006, cuts=2)]
    for lx, lz in ((-0.27, -0.52), (0.27, -0.52), (-0.27, 0.52), (0.27, 0.52)):
        dparts.append(box('leg', (dx + lx, (top - 0.02) / 2, dz + lz), (0.04, top - 0.02, 0.04), M['wood']))
    dparts += [box('apron_b', (dx + 0.29, top - 0.08, dz), (0.02, 0.12, 1.05), M['wood']),
               box('apron_f1', (dx - 0.29, top - 0.07, dz + 0.4), (0.02, 0.1, 0.25), M['wood']),
               box('apron_f2', (dx - 0.29, top - 0.07, dz - 0.4), (0.02, 0.1, 0.25), M['wood']),
               box('dr_side1', (dx, top - 0.08, dz - 0.25), (0.56, 0.14, 0.02), M['wood']),
               box('dr_side2', (dx, top - 0.08, dz + 0.25), (0.56, 0.14, 0.02), M['wood']),
               box('dr_bottom', (dx, top - 0.16, dz), (0.56, 0.015, 0.52), M['wood']),
               box('stretch', (dx, 0.12, dz), (0.02, 0.03, 1.0), M['wood'])]
    desk = join('desk', dparts)
    world_uv(desk, 0.8)
    drw = [box('drawer_body', (dx + 0.02, 0.63, dz), (0.5, 0.11, 0.46), M['wood']),
           box('drawer_front', (dx - 0.285, 0.63, dz), (0.02, 0.135, 0.48), M['wooddark'], 0.004),
           sphere('drawer_knob', (dx - 0.305, 0.63, dz), 0.017, M['brass'])]
    drawer = join('drawer', drw)
    world_uv(drawer, 0.6)
    set_origin(drawer, (dx - 0.285, 0.63, dz))
    lk = [box('lock_body', (dx - 0.31, 0.6, dz + 0.16), (0.018, 0.05, 0.04), M['metal'], 0.003),
          cyl('shackle', (dx - 0.31, 0.64, dz + 0.16), 0.014, 0.004, M['metal'], seg=12, axis='z')]
    for i in range(4):
        lk.append(box('dial', (dx - 0.321, 0.595, dz + 0.146 + i * 0.009), (0.006, 0.02, 0.007), M['brass']))
    join('drawer_lock', lk)
    # clutter on the desk
    clutter = []
    for i, (px, pz, rot) in enumerate(((dx - 0.05, dz + 0.22, 0.3), (dx + 0.06, dz + 0.3, -0.5), (dx - 0.1, dz - 0.05, 1.2))):
        p = box('paper%d' % i, (px, top + 0.019 + i * 0.001, pz), (0.21, 0.001, 0.297), M['paper'], rot=rot)
        clutter.append(p)
    clutter.append(cyl('mug', (dx + 0.12, top + 0.06, dz - 0.3), 0.04, 0.09, M['ceramic'], seg=20))
    clutter.append(cyl('bottle', (dx - 0.1, top + 0.11, dz - 0.4), 0.035, 0.19, M['glass'], seg=16))
    clutter.append(cyl('bneck', (dx - 0.1, top + 0.24, dz - 0.4), 0.013, 0.08, M['glass'], seg=12, r2=0.012))
    clutter.append(cyl('candle', (dx + 0.15, top + 0.04, dz + 0.05), 0.025, 0.05, M['cup'], seg=16))
    cl = join('desk_clutter', clutter)
    world_uv(cl, 0.3)

    # answering machine (mother's messages) — LED is its own node so the engine can blink it
    ax, ay, az = dx - 0.05, top + 0.018, dz + 0.42
    am = [box('am_body', (ax, ay + 0.03, az), (0.2, 0.06, 0.15), M['plastic'], 0.008),
          box('am_top', (ax, ay + 0.061, az), (0.19, 0.004, 0.14), mat('M_amtop', (0.12, 0.12, 0.13), 0.4), 0.002),
          box('am_window', (ax + 0.01, ay + 0.064, az - 0.02), (0.1, 0.004, 0.06), mat('M_amglass', (0.02, 0.025, 0.03), 0.05)),
          cyl('am_reel1', (ax - 0.015, ay + 0.066, az - 0.02), 0.012, 0.004, M['metal'], seg=12),
          cyl('am_reel2', (ax + 0.035, ay + 0.066, az - 0.02), 0.012, 0.004, M['metal'], seg=12)]
    for k in range(4):
        am.append(box('am_btn', (ax - 0.06 + k * 0.03, ay + 0.066, az + 0.045), (0.022, 0.008, 0.018), M['metal'], 0.002))
    am.append(box('am_cord', (ax + 0.08, ay + 0.004, az + 0.1), (0.006, 0.006, 0.14), M['cord']))
    join('answering_machine', am)
    box('am_led', (ax + 0.07, ay + 0.066, az - 0.045), (0.012, 0.006, 0.012), mat('M_led', (0.8, 0.05, 0.03), 0.3))

    # ---- wall clock
    cb = cyl('clock_body', (RX - 0.03, 1.85, dz), 0.2, 0.05, M['wooddark'], seg=40, axis='x')
    world_uv(cb, 0.4)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    seg = 40
    ctr = bm.verts.new(E(RX - 0.056, 1.85, dz))
    ring = []
    for i in range(seg):
        a = i / seg * 2 * PI
        ring.append(bm.verts.new(E(RX - 0.056, 1.85 + math.sin(a) * 0.17, dz + math.cos(a) * 0.17)))
    for i in range(seg):
        f = bm.faces.new((ctr, ring[i], ring[(i + 1) % seg]))
        for l in f.loops:
            co = l.vert.co  # blender: y = -engine z, z = engine y
            # viewer faces +x (engine); viewer's right is engine -z = blender +y
            l[uvl].uv = (0.5 - (co.y - ctr.co.y) / 0.34, 0.5 + (co.z - ctr.co.z) / 0.34)
    bm.normal_update()
    face = from_bm('clock_face', bm, M['clockface'])
    if face.data.polygons[0].normal.x > 0:
        face.data.flip_normals()

    # ---- ceiling light: a flush fixture set into the ceiling (the engine only dims / tints it)
    PV = (0, RH, -0.6)
    lp = [cyl('fx_base', (0, RH - 0.012, -0.6), 0.2, 0.024, M['ceil'], seg=40, axis='y'),
          cyl('fx_rim', (0, RH - 0.03, -0.6), 0.185, 0.014, M['brass'], seg=40, axis='y')]
    lamp = join('lamp', lp)
    set_origin(lamp, PV)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=12, radius=0.17)
    for v in list(bm.verts):   # keep the lower half, flattened into a shallow dome
        if v.co.z > 0.001:
            bm.verts.remove(v)
    for v in bm.verts:
        v.co.z *= 0.42
    bulb = from_bm('bulb', bm, M['bulb'], E(0, RH - 0.035, -0.6))
    set_origin(bulb, PV)

    # ---- lived-in furniture: rug, folding low table (밥상) with a mug and a tray, floor cushion
    rug = box('rug', (0.0, 0.004, -0.75), (1.9, 0.008, 2.1), mat('M_rug', (0.42, 0.2, 0.16), 0.95), 0.002, cuts=4)
    world_uv(rug, 0.9)
    tb = [box('lt_top', (-0.95, 0.31, -1.0), (0.72, 0.028, 0.48), M['wood'], 0.01)]
    for lx in (-0.3, 0.3):
        for lz in (-0.19, 0.19):
            tb.append(box('lt_leg', (-0.95 + lx, 0.15, -1.0 + lz), (0.03, 0.3, 0.03), M['wooddark']))
    tb.append(cyl('lt_mug', (-1.1, 0.37, -1.05), 0.038, 0.085, M['ceramic'], seg=18))
    tb.append(box('lt_tray', (-0.82, 0.33, -0.95), (0.3, 0.012, 0.22), mat('M_tray', (0.55, 0.12, 0.1), 0.35), 0.004))
    tb.append(cyl('lt_bowl', (-0.82, 0.355, -0.95), 0.06, 0.04, M['ceramic'], seg=18, r2=0.045))
    table = join('lowtable', tb)
    world_uv(table, 0.5)
    cu = box('cushion', (-1.25, 0.04, 0.2), (0.5, 0.07, 0.5), mat('M_cushion', (0.55, 0.42, 0.25), 0.9), 0.03, cuts=2)
    world_uv(cu, 0.5)

    # ---- the player's chair: no backrest (seat, four legs, armrests on front and back posts); ropes and chain are separate nodes
    W_ = M['wooddark']
    FX, FZ, BZ = 0.22, 0.16, 0.56        # leg positions (front z, back z)
    ch = [box('seat', (0, 0.4475, 0.36), (0.5, 0.045, 0.48), W_, 0.01, cuts=1)]
    for lx in (-FX, FX):
        ch.append(box('leg_f', (lx, 0.2125, FZ), (0.042, 0.425, 0.042), W_, 0.004))       # under the seat
        ch.append(box('leg_b', (lx, 0.2125, BZ), (0.042, 0.425, 0.042), W_, 0.004))       # no back post: the leg stops at the seat
        ch.append(box('rail_s', (lx, 0.12, (FZ + BZ) / 2), (0.026, 0.03, BZ - FZ), W_))   # side stretcher
    ch += [box('rail_f', (0, 0.12, FZ), (2 * FX, 0.03, 0.026), W_), box('rail_b', (0, 0.12, BZ), (2 * FX, 0.03, 0.026), W_),
           box('apron_f', (0, 0.4, FZ), (2 * FX, 0.05, 0.022), W_)]
    AX = 0.225
    for sx in (-AX, AX):
        ch.append(box('armpost', (sx, 0.5575, 0.19), (0.036, 0.175, 0.036), W_))              # front post on the seat
        ch.append(box('armpost_b', (sx, 0.5575, BZ - 0.03), (0.036, 0.175, 0.036), W_))       # rear post on the seat
        ch.append(box('arm', (sx, 0.66, (0.15 + BZ) / 2), (0.056, 0.036, BZ - 0.15 + 0.02), W_, 0.008))
    chair = join('chair', ch)
    world_uv(chair, 0.4)

    def tube(name, pts, r, material, seg=7):
        bm = bmesh.new()
        rings = []
        for i, p in enumerate(pts):
            d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            a = d.orthogonal().normalized(); b2 = d.cross(a)
            rings.append([bm.verts.new(p + (a * math.cos(t) + b2 * math.sin(t)) * r) for t in [k / seg * 2 * PI for k in range(seg)]])
        for ra, rb in zip(rings, rings[1:]):
            for k in range(seg):
                bm.faces.new((ra[k], ra[(k + 1) % seg], rb[(k + 1) % seg], rb[k]))
        return from_bm(name, bm, material)

    def coil(sx, name, loose):
        parts = []
        for k in range(6):  # rope wound around the armrest
            pts = [E(sx + math.cos(t) * 0.038, 0.66 + math.sin(t) * 0.03, 0.2 + k * 0.017 + t / (2 * PI) * 0.017) for t in [q / 16 * 2 * PI for q in range(17)]]
            parts.append(tube('coil', pts, 0.006, M['rope']))
        if loose:  # the free end hangs to the floor and curls there
            pts = [E(sx + 0.03, 0.64, 0.3), E(sx + 0.05, 0.5, 0.31), E(sx + 0.06, 0.3, 0.3), E(sx + 0.07, 0.1, 0.28),
                   E(sx + 0.08, 0.015, 0.22), E(sx + 0.1, 0.012, 0.14), E(sx + 0.16, 0.012, 0.1), E(sx + 0.2, 0.012, 0.14)]
            parts.append(tube('ropeend', pts, 0.007, M['rope']))
        rp = join(name, parts)
        return rp
    coil(AX, 'rope_R', True)
    coil(-AX, 'rope_L', False)

    # ---- trash piles by rigid body simulation
    build_trash(M)
    build_props(M)
    upgrade_props(M)   # Poly Haven pieces take over (blender/props_ph.py)
    upgrade_hy()       # Hunyuan3D doll / remote
    add_props()        # more lived-in detail
    add_kid_things()   # teddy, backpack, shoes, music box
    add_modern()       # the white modern studio the game starts in
    add_props2()       # twenty more 1999 things
    add_young_woman()  # the modern studio's own things
    ph_cleanup()


def crumple(bm, amt, freq, seed):
    for v in bm.verts:
        n = noise.noise(v.co * freq + Vector((seed, seed * 1.3, seed * 0.7)))
        v.co += v.co.normalized() * n * amt


def trash_item(kind, M, rnd):
    bm = bmesh.new()
    if kind == 'bag':
        bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1)
        s = rnd.uniform(0.17, 0.26)
        for v in bm.verts:
            v.co = Vector((v.co.x * s, v.co.y * s * rnd.uniform(0.8, 1.1), v.co.z * s * 0.75))
            if v.co.z > s * 0.55:  # gathered knot
                v.co.x *= 0.35
                v.co.y *= 0.35
                v.co.z += s * 0.25
        crumple(bm, s * 0.14, 9, rnd.random() * 50)
        mt = M['bag'] if rnd.random() < 0.7 else M['bagw']
    elif kind in ('can', 'can2'):
        bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.033, radius2=0.033, depth=0.12)
        if rnd.random() < 0.6:
            crumple(bm, 0.012, 30, rnd.random() * 50)
        mt = M[kind]
    elif kind == 'bottle':
        bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=0.036, radius2=0.036, depth=0.17)
        top = [v for v in bm.verts if v.co.z > 0]
        for v in top:
            v.co.z += 0.02
        mt = M['glass']
    elif kind == 'cup':
        bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.035, radius2=0.052, depth=0.1)
        mt = M['cup']
    elif kind == 'paper':
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=rnd.uniform(0.04, 0.07))
        crumple(bm, 0.03, 25, rnd.random() * 50)
        mt = M['paper']
    elif kind == 'pizza':
        bmesh.ops.create_cube(bm, size=1)
        for v in bm.verts:
            v.co = Vector((v.co.x * 0.36, v.co.y * 0.36, v.co.z * 0.045))
        mt = M['cardboard']
    elif kind == 'rag':
        bmesh.ops.create_grid(bm, x_segments=10, y_segments=10, size=0.22)
        for v in bm.verts:
            v.co.z = noise.noise(v.co * 8 + Vector((rnd.random() * 9, 0, 0))) * 0.05
        mt = M['cloth']
    else:
        return None
    return bm, mt


def build_trash(M):
    rnd = random.Random(11)
    scene = bpy.context.scene
    bpy.ops.rigidbody.world_add()
    scene.rigidbody_world.point_cache.frame_start = 1
    scene.rigidbody_world.point_cache.frame_end = 140
    scene.frame_start, scene.frame_end = 1, 140
    # colliders: floor & walls
    col = []
    for c, s in (((0, -0.05, 0), (6, 0.1, 6)), ((0, 1, -2.55), (6, 2, 0.1)), ((0, 1, 2.55), (6, 2, 0.1)),
                 ((-2.25, 1, 0), (0.1, 2, 6)), ((2.25, 1, 0), (0.1, 2, 6))):
        b = box('col', c, s, None)
        bpy.context.view_layer.objects.active = b
        bpy.ops.rigidbody.object_add(type='PASSIVE')
        b.rigid_body.friction = 0.9
        col.append(b)
    piles = [  # name, centre (engine x,z), radius, counts
        ('trash_1', (1.62, -1.98), 0.42, dict(bag=5, can=4, can2=3, bottle=3, cup=3, paper=6, pizza=1, rag=1)),
        ('trash_2', (1.7, 1.95), 0.4, dict(bag=4, can=3, can2=2, bottle=2, cup=2, paper=5, rag=2)),
        ('trash_3', (-1.78, 0.95), 0.3, dict(bag=2, can=2, bottle=2, cup=1, paper=5, rag=1)),
        ('trash_4', (-0.4, 2.15), 0.25, dict(bag=1, can=3, can2=1, cup=2, paper=4)),
        ('trash_5', (-1.0, -2.15), 0.22, dict(bag=1, can=2, bottle=1, paper=4, pizza=1)),
        ('trash_6', (-1.8, -1.95), 0.32, dict(bag=3, can2=2, bottle=2, cup=2, paper=4, rag=1)),
    ]
    groups = {}
    for name, (cx, cz), rad, counts in piles:
        items = []
        order = [k for k, n in counts.items() for _ in range(n)]
        order.sort(key=lambda k: 0 if k in ('pizza', 'rag') else 1 if k == 'bag' else 2)
        for i, kind in enumerate(order):
            a, d = rnd.uniform(0, 2 * PI), rad * math.sqrt(rnd.random())
            h = 0.12 + i * 0.07
            ob = ph_trash_item(kind, rnd)   # scanned bags, cans, bottles, boxes
            if ob:
                ob.location = E(cx + math.cos(a) * d, h + (0.15 if kind == 'bag' else 0), cz + math.sin(a) * d)
            else:
                r = trash_item(kind, M, rnd)
                if not r:
                    continue
                bm, mt = r
                ob = from_bm('%s_%s%d' % (name, kind, i), bm, mt, E(cx + math.cos(a) * d, h, cz + math.sin(a) * d))
                world_uv(ob, 0.35)
            ob.rotation_euler = (rnd.uniform(0, 2 * PI), rnd.uniform(0, 2 * PI), rnd.uniform(0, 2 * PI)) if kind not in ('pizza', 'rag') else (rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), rnd.uniform(0, PI))
            bpy.context.view_layer.objects.active = ob
            bpy.ops.rigidbody.object_add(type='ACTIVE')
            ob.rigid_body.collision_shape = 'CONVEX_HULL'
            ob.rigid_body.mass = {'bag': 2.0, 'pizza': 0.3, 'rag': 0.2}.get(kind, 0.15)
            ob.rigid_body.friction = 0.95
            ob.rigid_body.linear_damping = 0.4
            ob.rigid_body.angular_damping = 0.6
            items.append(ob)
        groups[name] = items
    for f in range(1, 141):
        scene.frame_set(f)
    allitems = [o for g in groups.values() for o in g]
    bpy.ops.object.select_all(action='DESELECT')
    for o in allitems:
        o.select_set(True)
    bpy.context.view_layer.objects.active = allitems[0]
    bpy.ops.object.visual_transform_apply()
    for o in allitems:
        bpy.context.view_layer.objects.active = o
        bpy.ops.rigidbody.object_remove()
    for c in col:
        bpy.data.objects.remove(c, do_unlink=True)
    bpy.ops.rigidbody.world_remove()
    # anything that rolled into the middle of the room (or fell through the floor) is not part of a pile
    centres = {name: (E(cx, 0, cz), rad) for name, (cx, cz), rad, _ in piles}
    for name in groups:
        c, rad = centres[name]
        keep = []
        for o in groups[name]:
            w = o.matrix_world.translation
            if (Vector((w.x, w.y, 0)) - Vector((c.x, c.y, 0))).length > rad + 0.45 or w.z < -0.05:
                bpy.data.objects.remove(o, do_unlink=True)
            else:
                keep.append(o)
        groups[name] = keep
    scene.frame_set(1)
    for name, items in groups.items():
        for o in items:   # linked duplicates of the scanned pieces: give each its own mesh before joining
            if o.data.users > 1:
                o.data = o.data.copy()
        ob = join(name, items)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


# ------------------------------------------------------------------------------------------
def torus(name, c, R, r, material, seg=24, rseg=8, rot=(0, 0, 0)):
    bm = bmesh.new()
    rings = []
    for i in range(seg):
        a = i / seg * 2 * PI
        ring = []
        for j in range(rseg):
            b = j / rseg * 2 * PI
            ring.append(bm.verts.new(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b))))
        rings.append(ring)
    for i in range(seg):
        for j in range(rseg):
            a, b = rings[i], rings[(i + 1) % seg]
            bm.faces.new((a[j], b[j], b[(j + 1) % rseg], a[(j + 1) % rseg]))
    ob = from_bm(name, bm, material, E(*c))
    ob.rotation_euler = rot
    return ob


def item_origin(ob, engine_pt=None):
    """put an item's origin at its bounding-box centre (or a given engine point)"""
    bpy.context.view_layer.update()
    if engine_pt is None:
        mw = ob.matrix_world
        cs = [mw @ Vector(v) for v in ob.bound_box]
        mn = Vector((min(c.x for c in cs), min(c.y for c in cs), min(c.z for c in cs)))
        mx = Vector((max(c.x for c in cs), max(c.y for c in cs), max(c.z for c in cs)))
        c = (mn + mx) / 2
        engine_pt = (c.x, c.z, -c.y)
    set_origin(ob, engine_pt)
    return ob


def build_props(M):
    rnd = random.Random(5)
    wood, dark, plastic, metal, brass = M['wood'], M['wooddark'], M['plastic'], M['metal'], M['brass']
    red = mat('M_redbtn', (0.5, 0.04, 0.03), 0.4)
    rubber = mat('M_rubber', (0.08, 0.08, 0.09), 0.7)
    # ---- TV remote on the cabinet
    rx, ry, rz = 0.36, 0.53, -2.06
    parts = [box('rm_body', (rx, ry, rz), (0.052, 0.02, 0.17), plastic, 0.008),
             box('rm_ir', (rx, ry + 0.004, rz - 0.084), (0.03, 0.012, 0.006), mat('M_irglass', (0.1, 0.02, 0.02), 0.1))]
    parts.append(cyl('rm_power', (rx + 0.012, ry + 0.011, rz - 0.06), 0.006, 0.004, red, seg=10))
    for r_ in range(4):
        for c_ in range(3):
            parts.append(cyl('rm_btn', (rx - 0.014 + c_ * 0.014, ry + 0.011, rz - 0.03 + r_ * 0.018), 0.0048, 0.004, rubber, seg=8))
    for k in range(2):
        parts.append(box('rm_rocker', (rx - 0.012 + k * 0.024, ry + 0.011, rz + 0.055), (0.012, 0.004, 0.03), rubber, 0.002))
    item_origin(join('item_remote', parts))
    # ---- music box (hidden under the player's chair; seen only on the CCTV)
    mx, my, mz = 0.05, 0.0, 0.42
    parts = [box('mb_body', (mx, my + 0.035, mz), (0.15, 0.07, 0.1), wood, 0.004),
             box('mb_inner', (mx, my + 0.068, mz), (0.13, 0.006, 0.08), mat('M_velvet', (0.35, 0.03, 0.05), 0.9)),
             cyl('mb_drum', (mx - 0.02, my + 0.06, mz), 0.012, 0.07, brass, seg=16, axis='x'),
             box('mb_comb', (mx + 0.02, my + 0.06, mz), (0.03, 0.004, 0.06), metal),
             cyl('mb_hole', (mx + 0.076, my + 0.035, mz), 0.006, 0.004, mat('M_hole', (0.01, 0.01, 0.01), 0.9), seg=10, axis='x')]
    for fx in (-0.06, 0.06):
        for fz in (-0.04, 0.04):
            parts.append(sphere('mb_foot', (mx + fx, my + 0.004, mz + fz), 0.006, brass, seg=8, ring=6))
    item_origin(join('item_musicbox', parts))
    lid = box('item_musicbox_lid', (mx, my + 0.078, mz), (0.152, 0.014, 0.102), wood, 0.004)
    lid = join('item_musicbox_lid', [lid, box('mb_mirror', (mx, my + 0.0705, mz), (0.12, 0.002, 0.07), mat('M_mirror', (0.6, 0.62, 0.65), 0.05, 1.0))])
    set_origin(lid, (mx, my + 0.071, mz + 0.051))  # hinge on the back edge
    # ---- winding key for the music box (in the drawer)
    parts = [cyl('ck_shaft', (0, 0, 0), 0.003, 0.03, brass, seg=8, axis='x'),
             box('ck_wing', (-0.02, 0, 0), (0.004, 0.028, 0.012), brass, 0.002)]
    ck = join('item_crank', parts)
    ck.location = E(1.84, 0.62, -0.3)
    # ---- scissors (in the drawer)
    sc = []
    for side in (1, -1):
        bm = bmesh.new()
        pts = [(0.0, 0.004 * side), (0.09, 0.002 * side), (0.095, -0.001 * side), (0.0, -0.006 * side)]
        v = [bm.verts.new((x, y, 0)) for x, y in pts]
        bm.faces.new(v)
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.002)
        b = from_bm('sc_blade', bm, metal, E(1.84, 0.62, -0.3))
        b.rotation_euler = (0, 0, 0.12 * side)
        sc.append(b)
        t = torus('sc_ring', (1.84 - 0.03, 0.62, -0.3 + 0.018 * side), 0.013, 0.0035, mat('M_redplastic', (0.45, 0.03, 0.03), 0.4), seg=16, rseg=6)
        sc.append(t)
    sc.append(cyl('sc_pivot', (1.84, 0.62, -0.3), 0.003, 0.006, metal, seg=8))
    join('item_scissors', sc)
    # ---- kitchen knife (bait: she brings it blade first)
    bm = bmesh.new()
    v = [bm.verts.new(E(x, 0, z)) for x, z in ((0, -0.012), (0.17, -0.004), (0.2, 0.0), (0.17, 0.008), (0, 0.016))]
    bm.faces.new(v)
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.0025)
    blade = from_bm('kn_blade', bm, metal, E(1.95, 0.76, -0.62))
    blade.rotation_euler = (PI / 2, 0, 0.6)
    handle = box('kn_handle', (1.95 - 0.06 * math.cos(0.6), 0.768, -0.62 - 0.06 * math.sin(0.6)), (0.1, 0.018, 0.024), dark, 0.004, rot=0.6)
    item_origin(join('item_knife', [blade, handle]))
    # ---- bookshelf (back-left corner) with books and the rag doll on top
    bx, bz = -1.55, 2.33
    sh = [box('bs_side1', (bx - 0.34, 0.6, bz), (0.03, 1.2, 0.3), wood, 0.004), box('bs_side2', (bx + 0.34, 0.6, bz), (0.03, 1.2, 0.3), wood, 0.004),
          box('bs_back', (bx, 0.6, bz + 0.14), (0.7, 1.2, 0.015), dark)]
    for k, y in enumerate((0.02, 0.4, 0.8, 1.19)):
        sh.append(box('bs_shelf', (bx, y, bz), (0.66, 0.025, 0.28), wood, 0.003))
    cols = [(0.35, 0.1, 0.08), (0.1, 0.2, 0.35), (0.55, 0.45, 0.2), (0.15, 0.3, 0.15), (0.6, 0.55, 0.5), (0.3, 0.15, 0.3)]
    for y0 in (0.035, 0.415):
        x = bx - 0.3
        while x < bx + 0.28:
            w = rnd.uniform(0.02, 0.045); h = rnd.uniform(0.2, 0.3)
            b = box('book', (x + w / 2, y0 + h / 2, bz + rnd.uniform(-0.02, 0.03)), (w, h, rnd.uniform(0.16, 0.2)), mat('M_book%d' % rnd.randrange(6), cols[rnd.randrange(6)], 0.8), 0.002)
            if rnd.random() < 0.15:
                b.rotation_euler = (0, 0.25, 0)
            sh.append(b)
            x += w + 0.003
    shelf = join('bookshelf', sh)
    world_uv(shelf, 0.6)
    build_doll(M, (bx, 1.2, bz - 0.02))
    # ---- family photo frame on the front wall
    fr = [box('pf_back', (-0.78, 1.55, -2.49), (0.36, 0.44, 0.012), dark)]
    for (cx, cy, w, h) in ((0, 0.21, 0.4, 0.04), (0, -0.21, 0.4, 0.04), (-0.18, 0, 0.04, 0.46), (0.18, 0, 0.04, 0.46)):
        fr.append(box('pf_bar', (-0.78 + cx, 1.55 + cy, -2.478), (w, h, 0.03), mat('M_gilt', (0.45, 0.33, 0.12), 0.35, 0.8), 0.006))
    item_origin(join('item_frame', fr))
    # ---- ankle chain: a loop round each front leg, a sagging run between, a padlock pulled to the front
    ch = []
    def link(p, k, tilt=0.0):
        return torus('link', p, 0.011, 0.0028, metal, seg=10, rseg=5, rot=((PI / 2 if k % 2 else 0) + tilt, 0, 0))
    for lx in (-0.22, 0.22):
        ch.append(torus('legloop', (lx, 0.1, 0.16), 0.03, 0.004, metal, seg=18, rseg=5))
    n = 28
    for k in range(n + 1):  # front run with a sag, bending forward to meet the padlock
        t = k / n
        x = -0.19 + 0.38 * t
        sag = math.sin(t * PI)
        ch.append(link((x, 0.1 - 0.05 * sag, 0.15 - 0.19 * sag), k))
    join('chain', ch)
    pl = [box('pl_body', (0.0, 0.03, -0.045), (0.05, 0.045, 0.02), brass, 0.005),
          torus('pl_shackle', (0.0, 0.057, -0.045), 0.016, 0.004, metal, seg=14, rseg=5, rot=(PI / 2, 0, 0)),
          cyl('pl_hole', (0.0, 0.023, -0.056), 0.004, 0.004, mat('M_hole', (0.01, 0.01, 0.01), 0.9), seg=8, axis='z')]
    item_origin(join('padlock', pl))
    # ---- ankle key (hidden inside the doll) and door key are engine-side small meshes


def build_doll(M, seat):
    cloth = mat('M_dollcloth', (0.62, 0.52, 0.45), 0.9)
    dress = mat('M_dolldress', (0.45, 0.12, 0.14), 0.85)
    sx, sy, sz = seat
    V = [(0, 0, 0.06), (0, 0, 0.12), (0, 0, 0.17), (0.035, -0.01, 0.055), (0.04, -0.09, 0.05), (0.045, -0.12, 0.03),
         (0.05, 0, 0.15), (0.075, -0.02, 0.1), (0.08, -0.05, 0.07)]
    Rr = [(0.045, 0.035), (0.04, 0.03), 0.02, 0.022, 0.018, 0.016, 0.017, 0.015, 0.014]
    Ed = [(0, 1), (1, 2), (0, 3), (3, 4), (4, 5), (1, 6), (6, 7), (7, 8)]
    mirror_limb(V, Rr, Ed, [3, 4, 5], 0)
    mirror_limb(V, Rr, Ed, [6, 7, 8], 1)
    body = skin_body('dl_body', V, Ed, Rr, cloth)
    head = sphere('dl_head', (0, 0, 0), 0.045, cloth, seg=18, ring=12)
    head.location = (0, 0, 0.215)
    head.rotation_euler = (0.1, 0.25, 0)
    dr = dress_mesh('dl_dress', [(0.16, 0.035, 0.03, 0), (0.12, 0.05, 0.04, 0), (0.06, 0.075, 0.06, -0.01)], dress, 4, folds=7)
    eyes = [sphere('dl_eye', (0, 0, 0), 0.006, M['plastic'], seg=8, ring=6) for _ in range(2)]
    eyes[0].location = (0.016, -0.042, 0.225); eyes[1].location = (-0.016, -0.042, 0.225)
    st = []
    for k in range(5):  # stitched belly (X marks)
        for sgn in (1, -1):
            b = box('dl_stitch', (0, 0, 0), (0.012, 0.0025, 0.0025), mat('M_thread', (0.05, 0.02, 0.02), 0.9))
            b.location = (0.0, -0.043, 0.075 + k * 0.012)
            b.rotation_euler = (0, 0.8 * sgn, 0)
            st.append(b)
    hr = hair('dl_hair', (0, 0, 0.215), (0.045, 0.045, 0.045), [((0, 0, 0.12), (0.06, 0.05, 0.07))], M['dollhair'], 13, count=90,
              length=(0.08, 0.16), front_len=(0.03, 0.05))
    doll = join('item_doll', [body, head, dr, hr] + eyes + st)
    doll.location = E(sx, sy, sz)
    doll.rotation_euler = (0, 0, 0)
    item_origin(doll)


def skin_body(name, verts, edges, radii, material):
    me = bpy.data.meshes.new(name)
    me.from_pydata([Vector(v) for v in verts], edges, [])
    ob = bpy.data.objects.new(name, me)
    link(ob)
    ob.modifiers.new('skin', 'SKIN')
    sv = me.skin_vertices[0].data
    for i, r in enumerate(radii):
        sv[i].radius = (r[0], r[1]) if isinstance(r, tuple) else (r, r)
    sv[0].use_root = True
    add_mod(ob, 'SUBSURF', levels=2, render_levels=2)
    add_mod(ob, 'SMOOTH', factor=0.5, iterations=4)
    me.materials.append(material)
    apply_mods(ob)
    return ob


def mirror_limb(verts, radii, edges, chain, parent):
    """duplicate a chain of vertices mirrored on x"""
    base = len(verts)
    prev = parent
    for k, idx in enumerate(chain):
        x, y, z = verts[idx]
        verts.append((-x, y, z))
        radii.append(radii[idx])
        edges.append((prev, base + k))
        prev = base + k


def dress_mesh(name, rings, material, seed, folds=9):
    """rings: list of (z, rx, ry, cy) from top to bottom; builds a flared gown"""
    bm = bmesh.new()
    seg = 56
    rows = []
    rnd = random.Random(seed)
    for k, (z, rx, ry, cy) in enumerate(rings):
        t = k / (len(rings) - 1)
        row = []
        for i in range(seg):
            a = i / seg * 2 * PI
            fold = 1 + (0.03 + 0.09 * t) * math.sin(a * folds + seed + t * 2.0) + 0.03 * noise.noise(Vector((a * 2, t * 4, seed)))
            zz = z + (0.03 * t * noise.noise(Vector((a * 3, seed, 1.0))) if k == len(rings) - 1 else 0)
            row.append(bm.verts.new((math.cos(a) * rx * fold, cy + math.sin(a) * ry * fold, zz)))
        rows.append(row)
    uvl = bm.loops.layers.uv.new('UVMap')
    for k in range(len(rows) - 1):
        for i in range(seg):
            j = (i + 1) % seg
            f = bm.faces.new((rows[k][i], rows[k][j], rows[k + 1][j], rows[k + 1][i]))
            for l, (a, b) in zip(f.loops, ((i, k), (i + 1, k), (i + 1, k + 1), (i, k + 1))):
                l[uvl].uv = (a / seg * 3, -b * 0.35)
    ob = from_bm(name, bm, material)
    add_mod(ob, 'SUBSURF', levels=1)   # single layer: a solidified shell z-fights with itself at distance
    apply_mods(ob)
    return ob


def hair(name, head_c, head_r, colliders, material, seed, count=260, length=(0.42, 0.62), front_len=None, gap=None):
    """long wet hair: ribbons dropped under gravity with ellipsoid collisions.
    head_c: blender coords, head_r: (rx, ry, rz); colliders: list of (centre, radii)"""
    rnd = random.Random(seed)
    bm = bmesh.new()
    hc = Vector(head_c)
    cols = [(hc, Vector(head_r) * 1.06)] + [(Vector(c), Vector(r)) for c, r in colliders]

    def push(p):
        for c, r in cols:
            d = Vector(((p.x - c.x) / r.x, (p.y - c.y) / r.y, (p.z - c.z) / r.z))
            l = d.length
            if l < 1.0:
                d = d.normalized()
                p = Vector((c.x + d.x * r.x, c.y + d.y * r.y, c.z + d.z * r.z))
        return p

    made = 0
    tries = 0
    while made < count and tries < count * 10:
        tries += 1
        # scalp point on upper head, parting at the middle
        th = rnd.uniform(0, 2 * PI)
        el = rnd.uniform(-0.15, 1.2)
        n = Vector((math.cos(th) * math.cos(el), math.sin(th) * math.cos(el), math.sin(el)))
        front = n.y < -0.3
        if front and el < 0.35:
            el = rnd.uniform(0.35, 1.2)
            n = Vector((math.cos(th) * math.cos(el), math.sin(th) * math.cos(el), math.sin(el)))
        root = hc + Vector((n.x * head_r[0], n.y * head_r[1], n.z * head_r[2])) * 1.02
        L = rnd.uniform(*length) * rnd.uniform(0.92, 1.0)
        if front and front_len:
            L = rnd.uniform(*front_len)
        steps = 16
        step = L / steps
        d = (n + Vector((0, 0, -0.4))).normalized()
        pts = [root]
        p = root.copy()
        for s in range(steps):
            d = (d + Vector((0, 0, -0.55))).normalized()
            wob = Vector((noise.noise(p * 12 + Vector((seed, 0, 0))), noise.noise(p * 12 + Vector((0, seed, 0))), 0)) * 0.25
            p = push(p + (d + wob * 0.3) * step)
            if gap and abs(p.x - gap[0]) < gap[2] and abs(p.z - gap[1]) < gap[3] and p.y < hc.y:
                p.x += math.copysign(gap[2] * 0.9, p.x - gap[0])
            pts.append(p.copy())
        w = rnd.uniform(0.05, 0.085)   # thick clumps: reads as a mass of hair with a few locks, not strips
        prev = None
        for i, q in enumerate(pts):
            t = i / steps
            out = Vector((q.x - hc.x, q.y - hc.y, 0))
            if out.length < 1e-4:
                out = Vector((1, 0, 0))
            side = Vector((0, 0, 1)).cross(out).normalized() * (w * (1 - 0.7 * t)) / 2
            a = bm.verts.new(q - side)
            b = bm.verts.new(q + side)
            if prev:
                bm.faces.new((prev[0], prev[1], b, a))
            prev = (a, b)
        made += 1
    ob = from_bm(name, bm, material)
    return ob


def build_ghost():
    M = dict(skin=mat('M_skin', (0.55, 0.6, 0.62), 0.55), dress=mat('M_dress', (0.62, 0.6, 0.55), 0.85),
             hair=mat('M_hair', (0.012, 0.012, 0.014), 0.22), eye=mat('M_eye', (0.9, 0.92, 0.9), 0.1))
    # ---------------- standing girl (faces blender -y)
    V = [(0, 0, 0.80), (0, 0, 0.93), (0, 0.005, 1.06), (0, 0, 1.19),
         (0.075, 0, 0.77), (0.08, -0.012, 0.44), (0.085, 0.01, 0.07), (0.09, -0.09, 0.025),
         (0.15, 0.005, 1.12), (0.185, 0.015, 0.87), (0.2, 0.0, 0.64), (0.2, -0.015, 0.49)]
    Rr = [(0.1, 0.075), (0.08, 0.06), (0.095, 0.065), 0.042, 0.062, 0.043, 0.03, 0.022, 0.046, 0.037, 0.029, 0.02]
    Ed = [(0, 1), (1, 2), (2, 3), (0, 4), (4, 5), (5, 6), (6, 7), (2, 8), (8, 9), (9, 10), (10, 11)]
    mirror_limb(V, Rr, Ed, [4, 5, 6, 7], 0)
    mirror_limb(V, Rr, Ed, [8, 9, 10, 11], 2)
    body = skin_body('g_body', V, Ed, Rr, M['skin'])
    hands = [sphere('g_hand', (0, 0, 0), 1, M['skin'], seg=12, ring=8) for _ in range(2)]
    for hsx, hnd in zip((1, -1), hands):
        hnd.scale = (0.022, 0.03, 0.055); hnd.location = (0.205 * hsx, -0.012, 0.5)
        bpy.context.view_layer.objects.active = hnd; bpy.ops.object.transform_apply(location=True, scale=True)
    head = sphere('g_head', (0, 0, 0), 1, M['skin'], seg=24, ring=16)
    head.scale = (0.083, 0.095, 0.108)
    head.location = (0.0, 0.0, 1.29)
    head.rotation_euler = (0.12, 0.1, 0)
    bpy.context.view_layer.objects.active = head
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    eye = sphere('g_eye', (0, 0, 0), 0.014, M['eye'])
    eye.location = (0.036, -0.082, 1.305)
    eye2 = sphere('g_eye2', (0, 0, 0), 0.013, M['eye'])
    eye2.location = (-0.036, -0.082, 1.3)
    dress = dress_mesh('g_dress', [(1.17, 0.1, 0.065, 0.0), (1.1, 0.165, 0.085, 0.0), (0.98, 0.14, 0.085, 0.0),
                                   (0.8, 0.165, 0.11, 0.0), (0.6, 0.2, 0.14, 0.0), (0.42, 0.235, 0.17, 0.01), (0.3, 0.25, 0.18, 0.015)],
                       M['dress'], 3)
    sleeves = []
    for sx in (1, -1):
        s = cyl('sleeve', (0, 0, 0), 0.052, 0.2, M['dress'], seg=16, cap=False, r2=0.045)
        s.location = (0.165 * sx, 0.01, 1.02)
        s.rotation_euler = (0, 0.12 * sx, 0)
        sleeves.append(s)
    hr = hair('g_hair', (0, 0.0, 1.30), (0.088, 0.1, 0.112),
              [((0, 0, 1.06), (0.2, 0.12, 0.15)), ((0, 0, 0.92), (0.2, 0.135, 0.24)), ((0, 0.005, 0.7), (0.235, 0.165, 0.22)), ((0, 0.0, 1.18), (0.05, 0.05, 0.05))],   # skull, shoulders and the gown: hair falls outside the dress
              M['hair'], 5, count=230, length=(0.42, 0.62), front_len=(0.36, 0.48), gap=(0.0, 1.24, 0.03, 0.12))
    cap = sphere('g_cap', (0, 0, 0), 1, M['hair'], seg=24, ring=16)
    cap.scale = (0.093, 0.106, 0.118); cap.location = (0.0, 0.012, 1.305); cap.rotation_euler = (0.12, 0.1, 0)
    bpy.context.view_layer.objects.active = cap
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bm_ = bmesh.new(); bm_.from_mesh(cap.data)
    bmesh.ops.delete(bm_, geom=[f for f in bm_.faces if f.calc_center_median().y < -0.06 and f.calc_center_median().z < 1.36], context='FACES')  # open at the face
    bm_.to_mesh(cap.data); bm_.free()
    g = join('ghost_stand', [body, head, eye, eye2, dress, hr, cap] + sleeves + hands)
    bpy.context.view_layer.objects.active = g

    # ---------------- crouching girl
    V = [(0, 0.06, 0.26), (0, 0.02, 0.4), (0, -0.04, 0.53), (0, -0.09, 0.63),
         (0.08, 0.04, 0.26), (0.085, -0.13, 0.44), (0.08, -0.07, 0.05), (0.085, -0.16, 0.02),
         (0.14, -0.02, 0.57), (0.17, -0.2, 0.46), (0.06, -0.25, 0.43), (0.0, -0.26, 0.42)]
    Rr = [(0.1, 0.08), (0.08, 0.06), (0.09, 0.065), 0.04, 0.062, 0.045, 0.03, 0.022, 0.04, 0.03, 0.022, 0.014]
    Ed = [(0, 1), (1, 2), (2, 3), (0, 4), (4, 5), (5, 6), (6, 7), (2, 8), (8, 9), (9, 10), (10, 11)]
    mirror_limb(V, Rr, Ed, [4, 5, 6, 7], 0)
    mirror_limb(V, Rr, Ed, [8, 9, 10, 11], 2)
    body = skin_body('c_body', V, Ed, Rr, M['skin'])
    head = sphere('c_head', (0, 0, 0), 1, M['skin'], seg=24, ring=16)
    head.scale = (0.083, 0.095, 0.108)
    head.location = (0.0, -0.13, 0.72)
    head.rotation_euler = (0.5, -0.25, 0.1)
    bpy.context.view_layer.objects.active = head
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    eye = sphere('c_eye', (0, 0, 0), 0.014, M['eye'])
    eye.location = (0.03, -0.215, 0.725)
    dress = dress_mesh('c_dress', [(0.62, 0.1, 0.07, -0.08), (0.56, 0.17, 0.12, -0.05), (0.42, 0.2, 0.19, -0.06),
                                   (0.25, 0.23, 0.22, -0.05), (0.1, 0.26, 0.24, -0.04), (0.02, 0.28, 0.25, -0.03)],
                       M['dress'], 7, folds=11)
    hr = hair('c_hair', (0, -0.13, 0.72), (0.09, 0.1, 0.112),
              [((0, -0.05, 0.4), (0.27, 0.28, 0.3)), ((0, -0.2, 0.44), (0.17, 0.09, 0.07)), ((0, -0.05, 0.12), (0.3, 0.27, 0.14))],
              M['hair'], 9, count=220, length=(0.42, 0.62), front_len=(0.4, 0.55), gap=(0.03, 0.725, 0.012, 0.025))
    cap = sphere('c_cap', (0, 0, 0), 1, M['hair'], seg=24, ring=16)
    cap.scale = (0.093, 0.106, 0.118); cap.location = (0.0, -0.118, 0.725); cap.rotation_euler = (0.5, -0.25, 0.1)
    bpy.context.view_layer.objects.active = cap
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    join('ghost_crouch', [body, head, eye, dress, hr, cap])


# ------------------------------------------------------------------------------------------
exec(open(os.path.join(HERE, 'props_ph.py'), encoding='utf-8').read())

OPEN_MESHES = ('floor', 'ceiling', 'wall_', 'curtain_L', 'curtain_R', 'window_glass', 'tv_screen', 'clock_face', 'corridor', 'ghost_')


def smooth_all():
    bpy.ops.object.select_all(action='DESELECT')
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in meshes:
        if o.modifiers:
            apply_mods(o)
        if not o.name.startswith(OPEN_MESHES) and 'ph' not in o:
            # closed props: make every face point outwards (grid fill / joins can flip islands)
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
            bm.to_mesh(o.data)
            bm.free()
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(42))


def bake_ao():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 48
    if scene.world is None:
        scene.world = bpy.data.worlds.new('W')
    scene.world.light_settings.distance = 0.9
    meshes = [o for o in scene.objects if o.type == 'MESH']
    for o in meshes:
        if o.modifiers:
            apply_mods(o)
        ca = o.data.color_attributes.new('AO', 'BYTE_COLOR', 'CORNER')
        o.data.color_attributes.active_color = ca
    scene.render.bake.target = 'VERTEX_COLORS'
    # trash piles only appear later in the game, so they must not darken the floor in the clean room
    trash = [o for o in meshes if o.name.startswith('trash_')]
    # scanned Poly Haven props bring their own occlusion map: don't darken them twice (they still occlude others)
    own_ao = [o for o in meshes if o not in trash and 'ph' in o and not str(o['ph']).startswith('hy_')]
    modern = [o for o in meshes if o.name.startswith(('mod_', 'yw_')) and not ('ph' in o and not str(o['ph']).startswith('hy_'))]   # scanned ones keep their own AO
    OLD = ('tv', 'tv_cabinet', 'tv_screen', 'lowtable', 'bookshelf', 'desk', 'drawer', 'drawer_lock', 'desk_clutter',
           'answering_machine', 'am_led', 'deco_desklamp', 'deco_pencils', 'deco_suitcase')
    # things that are not always in the room (1999 pieces, the twenty late props): they must not darken the shell
    KIDS = ('deco_teddy', 'deco_backpack', 'deco_shoes', 'deco_musicbox', 'item_doll', 'deco_duck', 'deco_basket', 'deco_cake')
    vintage = [o for o in meshes if o.name in OLD or o.name in KIDS or o.name.startswith('p_')]
    rest = [o for o in meshes if o not in trash and o not in own_ao and o not in modern and o not in vintage]
    for o in own_ao:
            o.data.color_attributes.remove(o.data.color_attributes['AO'])
    # the 1999 room, its trash, and the modern studio are never there at the same time: bake each on its own
    late = [o for o in vintage if o not in own_ao]
    ywph = [o for o in own_ao if o.name.startswith('yw_')]   # her scanned things: they come and go, so they must not shade the shell
    for group, hide in ((rest, trash + modern + vintage + ywph), (late, trash + modern + ywph), (trash, modern + ywph), (modern, trash + vintage)):   # own_ao props stay visible as occluders
        if not group:
            continue
        for o in hide:
            o.hide_render = True
        bpy.ops.object.select_all(action='DESELECT')
        for o in group:
            o.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        bpy.ops.object.bake(type='AO')
        for o in hide:
            o.hide_render = False


def export(name, ghost=False):
    bpy.ops.object.select_all(action='SELECT')
    path = os.path.join(OUT, name)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False, export_apply=True,
                              export_image_format='WEBP' if not ghost else 'NONE', export_image_quality=82,
                              export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                              export_materials='EXPORT', export_yup=True, export_texcoords=True, export_normals=True,
                              export_extras=False, export_cameras=False, export_lights=False)
    print('EXPORTED', path, os.path.getsize(path))


def preview(name, views):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_cavity = True
    scene.render.resolution_x, scene.render.resolution_y = 960, 540
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    link(cam)
    scene.camera = cam
    cam.data.lens = 18
    for i, (loc, rot) in enumerate(views):
        cam.location = loc
        cam.rotation_euler = rot
        scene.render.filepath = os.path.join(HERE, 'preview', '%s_%d.png' % (name, i))
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)


if MODE in ('room', 'all'):
    reset()
    build_room()
    smooth_all()
    if PREVIEW:
        eye = E(0, 1.15, 0.3)
        preview('room', [(eye, (PI / 2, 0, a)) for a in (0, PI / 2, PI, -PI / 2)] + [(eye, (PI / 2 - 0.9, 0, -PI / 2))])
    if not NOBAKE:
        bake_ao()
    fill_missing_uvs()
    export('room.glb')
if MODE in ('ghost', 'all'):
    reset()
    build_ghost()
    smooth_all()
    bpy.data.objects['ghost_crouch'].location = (0.8, 0, 0)
    if PREVIEW:
        cam_views = [((0.4, -2.2, 0.9), (PI / 2 - 0.05, 0, 0)), ((2.0, -1.2, 1.0), (PI / 2 - 0.1, 0, 1.0))]
        preview('ghost', cam_views)
    bpy.data.objects['ghost_crouch'].location = (0, 0, 0)
    if not NOBAKE:
        bake_ao()
    export('ghost.glb', True)
