import bpy, math, random
from mathutils import Vector
scn = bpy.context.scene
cam = bpy.data.objects["Camera"]
for n in ("Camera Target", "Camera Rig"):
    o = bpy.data.objects.get(n)
    if o: bpy.data.objects.remove(o, do_unlink=True)
cam.animation_data_clear(); cam.constraints.clear()
if cam.data.animation_data: cam.data.animation_data_clear()
def keys(obj, path, pts, interp="BEZIER"):
    for f, v in pts:
        setattr(obj, path, v); obj.keyframe_insert(path, frame=f)
# what the camera looks at (and focuses on): the action
tgt = bpy.data.objects.new("Camera Target", None); scn.collection.objects.link(tgt)
tgt.empty_display_type = "CUBE"; tgt.empty_display_size = 0.15
keys(tgt, "location", [(1, (0, 0, 1.15)), (50, (0, -0.55, 1.32)), (64, (0, -0.6, 1.33)), (90, (0, 0, 1.05)),
                       (130, (0, 0, 1.0)), (205, (0, -0.1, 1.0)), (214, (0, -0.4, 1.0)), (236, (0, -1.2, 1.0)),
                       (255, (0, 0, 1.0)), (300, (0, 0, 1.0))])
# the path the camera travels (a rig), the camera rides it (shake lives on the camera itself)
rig = bpy.data.objects.new("Camera Rig", None); scn.collection.objects.link(rig)
rig.empty_display_type = "ARROWS"
keys(rig, "location", [(1, (-3.4, -8.6, 2.3)), (30, (-2.0, -7.0, 1.9)), (60, (-0.55, -5.0, 1.45)),
                       (75, (-0.5, -5.4, 1.4)), (122, (3.1, -7.6, 0.55)), (165, (2.2, -6.1, 1.55)),
                       (208, (0.75, -4.7, 1.15)), (212, (0.7, -4.6, 1.12)), (236, (0.0, -10.4, 1.0)),
                       (300, (0.0, -8.3, 1.02))])
cam.parent = rig; cam.location = (0, 0, 0); cam.rotation_euler = (0, 0, 0)
tr = cam.constraints.new("TRACK_TO"); tr.target = tgt; tr.track_axis = "TRACK_NEGATIVE_Z"; tr.up_axis = "UP_Y"
# lens: wide establishing, tight on the eyes, wide for the blast, 50 for the logo
keys(cam.data, "lens", [(1, 35), (58, 65), (70, 60), (120, 40), (208, 55), (213, 55), (236, 28), (300, 50)])
cam.data.dof.use_dof = True; cam.data.dof.focus_object = tgt; cam.data.dof.aperture_fstop = 2.8
# shake: punches on the pump beats, a hard hit on the blast, settling after
rnd = random.Random(3)
cam.keyframe_insert("location", frame=166)
for f, amp in [(172, .035), (182, .05), (192, .07), (200, .09), (205, .11), (209, .14)]:
    cam.location = (rnd.uniform(-1, 1) * amp * .6, rnd.uniform(-1, 1) * amp * .6, 0); cam.keyframe_insert("location", frame=f + 1)
    cam.location = (0, 0, 0); cam.keyframe_insert("location", frame=f + 3)
for k, f in enumerate(range(211, 230, 2)):
    a = 0.22 * (0.78 ** k)
    cam.location = (rnd.uniform(-1, 1) * a, rnd.uniform(-1, 1) * a, 0); cam.keyframe_insert("location", frame=f)
cam.location = (0, 0, 0); cam.keyframe_insert("location", frame=232)
scn.render.use_motion_blur = True
scn.render.motion_blur_shutter = 0.5
scn.frame_set(58)
print("camera rigged; showing frame 58")
