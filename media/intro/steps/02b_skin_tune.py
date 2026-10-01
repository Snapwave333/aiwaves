import bpy
nt = bpy.data.materials["Alien Skin"].node_tree
b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
b.inputs["Subsurface Weight"].default_value = 0.0        # no speckle
b.inputs["Base Color"].default_value = (0.012, 0.045, 0.05, 1)
b.inputs["Roughness"].default_value = 0.28
b.inputs["Emission Color"].default_value = (0.05, 1.0, 0.65, 1)
nt.nodes["RimGlow"].inputs[1].default_value = 9.0
bpy.data.objects["Key"].data.energy = 35
bpy.data.objects["Rim Cyan"].data.energy = 500
bpy.data.objects["Rim Magenta"].data.energy = 450
print("skin tuned")
