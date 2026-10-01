import bpy, math, random
scn = bpy.context.scene
rig = bpy.data.objects["Speaker"]
# settle into a three-quarter view (depth: the cabinet's side, the cone's dish)
fc = rig.animation_data.action
for f, rot in ((130, (14, 0, -40)), (165, (7, 0, -24)), (205, (5, 0, -16))):
    rig.rotation_euler = [math.radians(a) for a in rot]; rig.keyframe_insert("rotation_euler", frame=f)
cone, cap = bpy.data.objects["Speaker Cone"], bpy.data.objects["Speaker Dust Cap"]
ring_s = bpy.data.materials["Speaker Light"].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"]
cam = bpy.data.objects["Camera"]
base = {o: o.location.y for o in (cone, cap)}
cam0 = tuple(cam.location)
beats = [(172, 0.035), (182, 0.05), (192, 0.07), (200, 0.09), (205, 0.11), (209, 0.14)]
rnd = random.Random(7)
for o in (cone, cap):
    o.location.y = base[o]; o.keyframe_insert("location", index=1, frame=166)
cam.location = cam0; cam.keyframe_insert("location", frame=166)
for f, amp in beats:
    for o in (cone, cap):
        o.location.y = base[o] - amp; o.keyframe_insert("location", index=1, frame=f)        # punch out
        o.location.y = base[o] + amp * 0.3; o.keyframe_insert("location", index=1, frame=f + 2)
        o.location.y = base[o]; o.keyframe_insert("location", index=1, frame=f + 4)
    ring_s.default_value = 9 + 120 * amp; ring_s.keyframe_insert("default_value", frame=f)
    ring_s.default_value = 9; ring_s.keyframe_insert("default_value", frame=f + 4)
    cam.location = (cam0[0] + rnd.uniform(-1, 1) * amp * 0.5, cam0[1], cam0[2] + rnd.uniform(-1, 1) * amp * 0.5)
    cam.keyframe_insert("location", frame=f + 1)
    cam.location = cam0; cam.keyframe_insert("location", frame=f + 3)
scn.frame_set(209)
print("pumping; showing frame 209 (the biggest punch)")
