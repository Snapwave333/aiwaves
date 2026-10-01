import bpy
bpy.data.materials["Alien Skin"].node_tree.nodes["RimGlow"].inputs[1].default_value = 2.2
nt = bpy.data.materials["Alien Eye Glow"].node_tree
nt.nodes["EyeEmission"].inputs["Strength"].default_value = 14.0
mix = next(n for n in nt.nodes if n.type == "MIX")
mix.inputs["A"].default_value = (0.35, 1.0, 0.6, 1)
mix.inputs["B"].default_value = (0.0, 0.9, 0.35, 1)
for s in ("L", "R"):
    bpy.data.objects[f"Eye Light {s}"].data.energy = 3.0
print("balanced")
