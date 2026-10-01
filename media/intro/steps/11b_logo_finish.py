import bpy
logo = bpy.data.objects["AIWaves Logo"]
rem = logo.modifiers["Even"]
rem.mode = "VOXEL"; rem.voxel_size = 0.011; rem.adaptivity = 0.0; rem.use_smooth_shade = True
nt = bpy.data.materials["Logo Liquid"].node_tree
lw = next(n for n in nt.nodes if n.type == "LAYER_WEIGHT")
mul = nt.nodes["RedEdge"]
pw = nt.nodes.get("EdgeOnly") or nt.nodes.new("ShaderNodeMath"); pw.name = "EdgeOnly"; pw.operation = "POWER"; pw.inputs[1].default_value = 3.0
for l in list(nt.links):
    if l.to_node == mul and l.to_socket == mul.inputs[0]: nt.links.remove(l)
nt.links.new(lw.outputs["Facing"], pw.inputs[0]); nt.links.new(pw.outputs[0], mul.inputs[0])
mul.inputs[1].default_value = 5.0
bpy.context.scene.frame_set(296)
print("logo finished; showing frame 296")
