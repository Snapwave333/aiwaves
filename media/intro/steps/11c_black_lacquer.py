import bpy
from bpy_extras.object_utils import world_to_camera_view
scn = bpy.context.scene
bs = next(n for n in bpy.data.materials["Logo Liquid"].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bs.inputs["Metallic"].default_value = 0.0
bs.inputs["Base Color"].default_value = (0.004, 0.004, 0.005, 1)
bs.inputs["Roughness"].default_value = 0.18
bs.inputs["Coat Weight"].default_value = 1.0; bs.inputs["Coat Roughness"].default_value = 0.03
scn.frame_set(296)
cam = scn.camera
dg = bpy.context.evaluated_depsgraph_get()
suspects = []
for o in scn.objects:
    if o.type not in ("MESH",) or o.hide_render or o.name.startswith(("Spray", "Droplet", "Cyclorama")):
        continue
    oe = o.evaluated_get(dg)
    if max(abs(s) for s in oe.matrix_world.to_scale()) < 1e-4:
        continue
    c = world_to_camera_view(scn, cam, oe.matrix_world.translation)
    suspects.append((o.name, round(c.x, 2), round(c.y, 2), tuple(round(s, 3) for s in oe.matrix_world.to_scale())))
print("visible meshes at 296:", suspects)
