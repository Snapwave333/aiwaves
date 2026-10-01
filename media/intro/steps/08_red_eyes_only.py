import bpy, math
from mathutils import Vector
# skin: no emission at all, dark glossy liquid
skin = bpy.data.materials["Alien Skin"].node_tree
b = next(n for n in skin.nodes if n.type == "BSDF_PRINCIPLED")
rim = skin.nodes["RimGlow"].inputs[1]
if skin.animation_data and skin.animation_data.action:
    for fc in list(skin.animation_data.action.fcurves) if hasattr(skin.animation_data.action, "fcurves") else []:
        if "RimGlow" in fc.data_path:
            skin.animation_data.action.fcurves.remove(fc)
try:
    rim.keyframe_delete("default_value")
except Exception:
    pass
for kp in []: pass
rim.default_value = 0.0
for link in list(skin.links):
    if link.to_socket == b.inputs["Emission Strength"]:
        skin.links.remove(link)
b.inputs["Emission Strength"].default_value = 0.0
b.inputs["Base Color"].default_value = (0.018, 0.02, 0.026, 1)
b.inputs["Coat Weight"].default_value = 1.0
# eyes: red, hot core
eye = bpy.data.materials["Alien Eye Glow"].node_tree
mix = next(n for n in eye.nodes if n.type == "MIX")
mix.inputs["A"].default_value = (1.0, 0.32, 0.12, 1)      # core: hot orange-red
mix.inputs["B"].default_value = (0.85, 0.0, 0.02, 1)      # edge: deep red
for s in ("L", "R"):
    bpy.data.objects[f"Eye Light {s}"].data.color = (1.0, 0.05, 0.02)
# lights: neutral, so nothing but the eyes reads as glow
for n, e in (("Rim Cyan", 380), ("Rim Magenta", 320)):
    l = bpy.data.objects[n].data; l.color = (0.82, 0.88, 1.0); l.energy = e
bpy.data.objects["Key"].data.energy = 25
# speaker: no liquid glow; its light ring is the eyes' red energy
for mname in ("Speaker Gunmetal", "Speaker Cone"):
    nt = bpy.data.materials[mname].node_tree
    if nt.animation_data: nt.animation_data_clear()
    nt.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.0
cap = bpy.data.materials["Speaker Cap"].node_tree.nodes["Principled BSDF"]
cap.inputs["Emission Strength"].default_value = 0.0
bpy.data.materials["Speaker Light"].node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = (1.0, 0.04, 0.02, 1)
# the floating eyes stay in frame: less drift towards the camera
for s, dx in (("L", -1), ("R", 1)):
    e = bpy.data.objects[f"Alien Eye {s}"]
    act = e.animation_data.action
    bpy.context.scene.frame_set(80)
    home = e.location.copy()
    e.location = home + Vector((dx * 0.7, -0.22, 0.3)); e.keyframe_insert("location", frame=122)
bpy.context.scene.frame_set(60)
print("only the eyes glow, red; showing frame 60")
