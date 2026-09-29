import bpy, sys, math, os
argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
obs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
print('MESHES', [(o.name, len(o.data.polygons)) for o in obs], [tuple(round(v, 3) for v in o.dimensions) for o in obs])
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'; sc.display.shading.show_cavity = True
sc.render.resolution_x, sc.render.resolution_y = 1200, 800
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'
import mathutils
mn = mathutils.Vector((1e9,) * 3); mx = -mn
for o in obs:
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c); mn = mathutils.Vector(map(min, mn, w)); mx = mathutils.Vector(map(max, mx, w))
ctr = (mn + mx) / 2; size = max(mx - mn)
cam.data.ortho_scale = size * 1.25
views = [(0, -1), (1, 0), (0, 1)]
import bpy
for i, (dx, dy) in enumerate(views):
    cam.location = ctr + mathutils.Vector((dx, dy, 0)) * size * 3
    cam.rotation_euler = (math.pi / 2, 0, math.atan2(dx, -dy))
    sc.render.filepath = out.replace('.png', f'_{i}.png'); bpy.ops.render.render(write_still=True)
