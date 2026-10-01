import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector
scn = bpy.context.scene; scn.frame_set(296)
cam = scn.camera; logo = bpy.data.objects["AIWaves Logo"]; tgt = bpy.data.objects["Camera Target"]
dg = bpy.context.evaluated_depsgraph_get()
le = logo.evaluated_get(dg)
pts = [le.matrix_world @ Vector(c) for c in le.bound_box]
xs = [world_to_camera_view(scn, cam, p).x for p in pts]
print("cam world", [round(c, 2) for c in cam.matrix_world.translation], "lens", round(cam.data.lens, 1),
      "target", [round(c, 2) for c in tgt.matrix_world.translation],
      "logo center", [round(c, 2) for c in le.matrix_world.translation],
      "logo x in frame", round(min(xs), 2), "-", round(max(xs), 2))
