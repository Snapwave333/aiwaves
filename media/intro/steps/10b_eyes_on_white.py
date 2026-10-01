import bpy
scn = bpy.context.scene
eye = bpy.data.materials["Alien Eye Glow"].node_tree
mix = next(n for n in eye.nodes if n.type == "MIX")
mix.inputs["A"].default_value = (1.0, 0.035, 0.0, 1)
mix.inputs["B"].default_value = (1.0, 0.0, 0.0, 1)
s = eye.nodes["EyeEmission"].inputs["Strength"]
for f, v in {1: 14.0, 50: 14.0, 58: 28.0, 68: 14.0, 120: 15.0, 156: 30.0, 161: 0.0}.items():
    s.default_value = v; s.keyframe_insert("default_value", frame=f)
for side in ("L", "R"):
    bpy.data.objects[f"Eye Light {side}"].data.energy = 8.0
cam = bpy.data.objects["Camera"]
act = cam.animation_data.action if cam.animation_data else None
# move the whole camera track back (its shake keys keep their offsets)
dy, dz = -1.6, -0.1
if act:
    try:
        curves = list(act.fcurves)
    except AttributeError:
        curves = [fc for layer in act.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]
    for fc in curves:
        if fc.data_path == "location" and fc.array_index in (1, 2):
            for kp in fc.keyframe_points:
                d = dy if fc.array_index == 1 else dz
                kp.co.y += d; kp.handle_left.y += d; kp.handle_right.y += d
else:
    cam.location.y += dy; cam.location.z += dz
scn.frame_set(1); scn.frame_set(30)
print("eyes brighter; camera at", tuple(round(c, 2) for c in cam.location))
