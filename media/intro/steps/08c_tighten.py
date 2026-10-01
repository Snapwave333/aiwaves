import bpy
scn = bpy.context.scene
glare = next(n for n in scn.compositing_node_group.nodes if n.bl_idname == "CompositorNodeGlare")
glare.inputs["Size"].default_value = 0.55
glare.inputs["Strength"].default_value = 0.6
for n, e in (("Rim Cyan", 170), ("Rim Magenta", 140)):
    bpy.data.objects[n].data.energy = e
    bpy.data.objects[n].data.size = 4.5          # bigger, softer highlights
scn.frame_set(30)
print("tightened; showing frame 30")
