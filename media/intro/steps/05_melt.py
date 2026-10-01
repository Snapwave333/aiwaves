import bpy, math
head = bpy.data.objects["Alien Head"]
me = head.data
if me.shape_keys:
    head.shape_key_clear()
basis = head.shape_key_add(name="Basis")
zs = [v.co.z for v in me.vertices]
zb, zt = min(zs), max(zs)
sag = head.shape_key_add(name="Sag", from_mix=False)
pud = head.shape_key_add(name="Puddle", from_mix=False)
floor = -1.30                                    # object space: world z -0.35
for i, v in enumerate(me.vertices):
    x, y, z = v.co
    h = (z - zb) / (zt - zb)
    ang = math.atan2(y, x)
    r = math.hypot(x, y)
    # sag: the skull slumps, bulges, and drips run down the sides in bands
    band = max(0.0, math.sin(ang * 7 + 1.3)) ** 6 + 0.6 * max(0.0, math.sin(ang * 11 - 0.4)) ** 8
    drip = 0.55 * band * (1 - h) ** 0.8
    k = 1 + 0.30 * h
    sag.data[i].co = (x * k, y * k, z - 0.6 * h ** 1.4 - drip)
    # puddle: a low glossy dome on the floor
    rr = 1.75 * (1 - h) ** 0.55 + 0.05
    ripple = 0.03 * math.sin(ang * 9 + rr * 6)
    pud.data[i].co = (rr * math.cos(ang), rr * math.sin(ang) * 0.85, floor + 0.22 * h ** 0.5 + ripple)
def key(obj, path, frame, value, index=-1):
    if index >= 0:
        getattr(obj, path)[index] = value
        obj.keyframe_insert(path, index=index, frame=frame)
    else:
        setattr(obj, path, value)
        obj.keyframe_insert(path, frame=frame)
# life: a gentle float, a turn to face the camera
head.animation_data_clear()
for f, rz, zz in ((1, -14, 0.95), (40, 0, 1.02), (75, 0, 0.98)):
    key(head, "rotation_euler", f, math.radians(rz), 2)
    key(head, "location", f, zz, 2)
# the melt
for f, s, p in ((75, 0, 0), (100, 1, 0), (112, 1, 0.25), (135, 0, 1)):
    sag.value = s; sag.keyframe_insert("value", frame=f)
    pud.value = p; pud.keyframe_insert("value", frame=f)
# liquid: glossier and brighter-edged as it melts
skin = bpy.data.materials["Alien Skin"].node_tree
b = next(n for n in skin.nodes if n.type == "BSDF_PRINCIPLED")
rim = skin.nodes["RimGlow"].inputs[1]
for f, ro, rg in ((75, 0.28, 2.2), (120, 0.06, 5.0)):
    b.inputs["Roughness"].default_value = ro; b.inputs["Roughness"].keyframe_insert("default_value", frame=f)
    rim.default_value = rg; rim.keyframe_insert("default_value", frame=f)
# eyes: flare at 55, slide down with the melt, shrink and go out
eyem = bpy.data.materials["Alien Eye Glow"].node_tree.nodes["EyeEmission"].inputs["Strength"]
for f, v in ((1, 14), (50, 14), (58, 26), (68, 14), (100, 12), (128, 0)):
    eyem.default_value = v; eyem.keyframe_insert("default_value", frame=f)
for s in ("L", "R"):
    e = bpy.data.objects[f"Alien Eye {s}"]
    e.animation_data_clear()
    z0, sc = e.location.z, tuple(e.scale)
    key(e, "location", 80, z0, 2); key(e, "location", 125, z0 - 0.95, 2)
    e.scale = sc; e.keyframe_insert("scale", frame=95)
    e.scale = (sc[0] * 1.3, sc[1], sc[2] * 0.25); e.keyframe_insert("scale", frame=128)
    lamp = bpy.data.objects[f"Eye Light {s}"]
    for f, v in ((1, 3), (58, 6), (68, 3), (110, 3), (128, 0)):
        lamp.data.energy = v; lamp.data.keyframe_insert("energy", frame=f)
bpy.context.scene.frame_set(110)
print("melt keyed; showing frame 110")
