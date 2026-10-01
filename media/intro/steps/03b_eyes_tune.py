import bpy, math
from mathutils import Vector
for side in ("L", "R"):
    eye = bpy.data.objects[f"Alien Eye {side}"]
    eye.rotation_euler = (0, math.radians(26 if side == "L" else -26), 0)   # outer corners sweep UP
    eye.scale = (0.37, 0.08, 0.165)
    eye.location.y -= 0.045                                                   # sit proud of the socket
    lamp = bpy.data.objects[f"Eye Light {side}"]
    lamp.data.energy = 5.0
nt = bpy.data.materials["Alien Eye Glow"].node_tree
mix = next(n for n in nt.nodes if n.type == "MIX")
mix.inputs["A"].default_value = (0.55, 1.0, 0.82, 1)     # core: pale green, not white
mix.inputs["B"].default_value = (0.0, 0.85, 0.45, 1)     # edges: deep alien green
nt.nodes["EyeEmission"].inputs["Strength"].default_value = 22.0
print("eyes tuned")
