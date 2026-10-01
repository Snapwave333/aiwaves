import bpy
scn = bpy.context.scene
try:
    scn.view_settings.view_transform = "Khronos PBR Neutral"
    scn.view_settings.look = "None"
except Exception as e:
    print("view transform:", e)
eye = bpy.data.materials["Alien Eye Glow"].node_tree
mix = next(n for n in eye.nodes if n.type == "MIX")
mix.inputs["A"].default_value = (1.0, 0.10, 0.04, 1)
mix.inputs["B"].default_value = (0.75, 0.0, 0.01, 1)
s = eye.nodes["EyeEmission"].inputs["Strength"]
fc = next((c for c in eye.animation_data.action.fcurves if "EyeEmission" in c.data_path), None) if eye.animation_data and hasattr(eye.animation_data.action, "fcurves") else None
keys = {1: 4.0, 50: 4.0, 58: 8.0, 68: 4.0, 120: 4.5, 156: 9.0, 161: 0.0}
for f, v in keys.items():
    s.default_value = v; s.keyframe_insert("default_value", frame=f)
for side in ("L", "R"):
    lamp = bpy.data.objects[f"Eye Light {side}"]
    lamp.data.color = (1.0, 0.02, 0.01)
glare = next(n for n in scn.compositing_node_group.nodes if n.bl_idname == "CompositorNodeGlare")
glare.inputs["Saturation"].default_value = 1.6
glare.inputs["Threshold"].default_value = 0.8
scn.frame_set(60)
print("true red; view transform:", scn.view_settings.view_transform)
