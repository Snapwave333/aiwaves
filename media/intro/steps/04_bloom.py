import bpy
scn = bpy.context.scene
bpy.data.materials["Alien Eye Glow"].node_tree.nodes["EyeEmission"].inputs["Strength"].default_value = 6.0
tree = bpy.data.node_groups.get("AIWaves Glow") or bpy.data.node_groups.new("AIWaves Glow", "CompositorNodeTree")
tree.nodes.clear()
for item in list(tree.interface.items_tree):
    tree.interface.remove(item)
tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
rl = tree.nodes.new("CompositorNodeRLayers")
glare = tree.nodes.new("CompositorNodeGlare")
for k, v in (("Type", "Bloom"), ("Quality", "High"), ("Threshold", 0.6), ("Strength", 0.85), ("Size", 0.8), ("Saturation", 1.15)):
    try:
        glare.inputs[k].default_value = v
    except Exception as e:
        print("glare", k, e)
gout = tree.nodes.new("NodeGroupOutput")
tree.links.new(rl.outputs["Image"], glare.inputs["Image"])
tree.links.new(glare.outputs[0], gout.inputs[0])
scn.compositing_node_group = tree
for win in bpy.context.window_manager.windows:
    for a in win.screen.areas:
        if a.type == "VIEW_3D":
            a.spaces.active.shading.use_compositor = "ALWAYS"
print("bloom on:", [i.name + "=" + str(getattr(i, "default_value", "")) for i in glare.inputs if i.name in ("Type", "Threshold", "Strength", "Size")])
