import bpy, math
from mathutils import Vector
scn = bpy.context.scene
cam = bpy.data.objects["Camera"]
cam.rotation_euler.x = math.radians(89.5)
for n in ("AIWaves Logo", "AIWaves Text"):
    o = bpy.data.objects.get(n)
    if o: bpy.data.objects.remove(o, do_unlink=True)
# the text, then a real mesh (so it can ripple like liquid)
cu = bpy.data.curves.new("AIWaves Text", "FONT")
cu.body = "AIWAVES"
cu.font = bpy.data.fonts.load(r"C:\Windows\Fonts\AGENCYB.TTF", check_existing=True)
cu.align_x = "CENTER"; cu.align_y = "CENTER"
cu.size = 1.25; cu.space_character = 1.12
cu.extrude = 0.07; cu.bevel_depth = 0.018; cu.bevel_resolution = 3
tobj = bpy.data.objects.new("AIWaves Text", cu); scn.collection.objects.link(tobj)
dg = bpy.context.evaluated_depsgraph_get()
mesh = bpy.data.meshes.new_from_object(tobj.evaluated_get(dg))
bpy.data.objects.remove(tobj, do_unlink=True)
logo = bpy.data.objects.new("AIWaves Logo", mesh); scn.collection.objects.link(logo)
logo.location = (0, 0, 1.0); logo.rotation_euler = (math.radians(90), 0, 0)
rem = logo.modifiers.new("Even", "REMESH"); rem.mode = "SHARP"; rem.octree_depth = 8; rem.use_remove_disconnected = False
# material: black liquid chrome; the bevels carry the eyes' red
m = bpy.data.materials.get("Logo Liquid") or bpy.data.materials.new("Logo Liquid")
m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
out = nt.nodes.new("ShaderNodeOutputMaterial"); bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
bs.inputs["Base Color"].default_value = (0.008, 0.008, 0.01, 1); bs.inputs["Metallic"].default_value = 0.95
bs.inputs["Roughness"].default_value = 0.06; bs.inputs["Coat Weight"].default_value = 1.0
bs.inputs["Emission Color"].default_value = (1.0, 0.02, 0.0, 1)
lw = nt.nodes.new("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.25
mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"; mul.name = "RedEdge"; mul.inputs[1].default_value = 7.0
nt.links.new(lw.outputs["Fresnel"], mul.inputs[0]); nt.links.new(mul.outputs[0], bs.inputs["Emission Strength"])
nt.links.new(bs.outputs["BSDF"], out.inputs["Surface"])
mesh.materials.append(m)
# liquid that settles: a travelling wave and the shared wobble, both fading to nothing
wave = logo.modifiers.new("Liquid Wave", "WAVE"); wave.use_normal = False; wave.use_x = True; wave.use_y = False
wave.width = 0.55; wave.narrowness = 1.4; wave.speed = 0.18; wave.time_offset = 255
disp = logo.modifiers.new("Liquid", "DISPLACE"); disp.texture = bpy.data.textures["Liquid Wobble"]
disp.texture_coords = "OBJECT"; disp.texture_coords_object = bpy.data.objects["Wobble Driver"]
for f, h, d in ((256, 0.35, 0.18), (276, 0.18, 0.10), (294, 0.0, 0.0)):
    wave.height = h; wave.keyframe_insert("height", frame=f)
    disp.strength = d; disp.keyframe_insert("strength", frame=f)
# the letters rise out of the waveform lines
for f, sz in ((254, 0.015), (262, 0.25), (276, 1.0)):
    logo.scale = (1.0, 1.0, sz) if False else (1.0, sz, 1.0)
    logo.keyframe_insert("scale", frame=f)
logo.hide_render = False
for f, hidden in ((1, True), (254, False)):
    logo.hide_viewport = hidden; logo.keyframe_insert("hide_viewport", frame=f)
    logo.hide_render = hidden; logo.keyframe_insert("hide_render", frame=f)
# the rings stop expanding, pull back together and flatten into a waveform, then dissolve into the letters
for k in range(7):
    r = bpy.data.objects[f"Wave Ring {k}"]
    t1 = 240 + k
    r.keyframe_insert("location", frame=t1); r.keyframe_insert("scale", frame=t1); r.keyframe_insert("rotation_euler", frame=t1)
    r.location = (0, -0.3, 1.0 + (k - 3) * 0.16); r.rotation_euler = (math.radians(90), 0, 0)
    r.scale = (2.7, 0.05, 1.0)
    r.keyframe_insert("location", frame=258); r.keyframe_insert("scale", frame=258); r.keyframe_insert("rotation_euler", frame=258)
    r.scale = (0.0, 0.0, 0.0); r.keyframe_insert("scale", frame=274)
# the last push-in
for f, y in ((240, cam.location.y), (300, cam.location.y + 1.1)):
    cam.location.y = y; cam.keyframe_insert("location", index=1, frame=f)
scn.frame_set(292)
print("logo built; showing frame 292")
