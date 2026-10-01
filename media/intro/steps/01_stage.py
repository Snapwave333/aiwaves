import bpy, math
scn = bpy.context.scene
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scn.render.engine = "BLENDER_EEVEE"
scn.render.resolution_x, scn.render.resolution_y = 1280, 720
scn.render.fps = 30
scn.frame_start, scn.frame_end = 1, 300
scn.frame_set(1)
try:
    scn.view_settings.view_transform = "AgX"
    scn.view_settings.look = "AgX - Punchy"
except Exception as e:
    print("look:", e)
# world: deep space, a faint blue-violet gradient
w = bpy.data.worlds.get("AIWaves Space") or bpy.data.worlds.new("AIWaves Space")
scn.world = w
w.use_nodes = True
nt = w.node_tree; nt.nodes.clear()
out = nt.nodes.new("ShaderNodeOutputWorld")
bg = nt.nodes.new("ShaderNodeBackground")
grad = nt.nodes.new("ShaderNodeTexGradient"); grad.gradient_type = "SPHERICAL"
ramp = nt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].color = (0.002, 0.002, 0.004, 1)
ramp.color_ramp.elements[1].color = (0.010, 0.014, 0.035, 1)
nt.links.new(grad.outputs["Fac"], ramp.inputs["Fac"])
nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
bg.inputs["Strength"].default_value = 1.0
nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
# camera
cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
scn.collection.objects.link(cam)
cam.location = (0, -9.0, 1.1)
cam.rotation_euler = (math.radians(86), 0, 0)
cam.data.lens = 50
scn.camera = cam
def area_light(name, loc, rot, color, power, size):
    l = bpy.data.lights.new(name, "AREA"); l.color = color; l.energy = power; l.size = size
    o = bpy.data.objects.new(name, l); o.location = loc; o.rotation_euler = [math.radians(a) for a in rot]
    scn.collection.objects.link(o); return o
area_light("Rim Cyan", (-3.5, 2.5, 2.5), (60, 0, -125), (0.0, 0.9, 1.0), 900, 3)
area_light("Rim Magenta", (3.5, 2.5, 2.0), (65, 0, 125), (0.85, 0.15, 1.0), 800, 3)
area_light("Key", (0.5, -5, 3), (55, 0, 5), (0.8, 0.9, 1.0), 120, 5)
# the viewport: rendered, through the camera
for win in bpy.context.window_manager.windows:
    for a in win.screen.areas:
        if a.type == "VIEW_3D":
            sp = a.spaces.active
            sp.shading.type = "RENDERED"
            sp.region_3d.view_perspective = "CAMERA"
            sp.overlay.show_overlays = False
print("stage ready:", [o.name for o in scn.objects])
