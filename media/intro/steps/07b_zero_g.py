import bpy, bmesh, math, random
from mathutils import Vector, Matrix
scn = bpy.context.scene
head = bpy.data.objects["Alien Head"]
me = head.data
# --- shape keys: liquefy (lobes in every direction) and sphere (surface tension) ---
for kb in list(me.shape_keys.key_blocks)[1:] if me.shape_keys else []:
    head.shape_key_remove(kb)
basis = me.shape_keys.key_blocks["Basis"]
liq = head.shape_key_add(name="Liquefy", from_mix=False)
sph = head.shape_key_add(name="Sphere", from_mix=False)
for i, v in enumerate(basis.data):
    p = v.co.copy(); n = p.normalized()
    lobes = (0.20 * math.sin(3.1 * n.x * math.pi + 1.0) * math.sin(2.2 * n.y * math.pi + 0.4) * math.cos(2.7 * n.z * math.pi)
             + 0.12 * math.sin(5.0 * n.z + 2.3 * n.x) + 0.08 * math.cos(7.0 * n.y - 1.7 * n.z))
    q = p * (1 + lobes)
    q = q.lerp(n * 1.05, 0.35)
    liq.data[i].co = q
    sph.data[i].co = n * 0.92
head.animation_data_clear()
if me.shape_keys.animation_data: me.shape_keys.animation_data_clear()
for f, z, rz in ((1, 0.95, -14), (40, 1.02, 0), (75, 0.98, 0)):
    head.location.z = z; head.keyframe_insert("location", index=2, frame=f)
    head.rotation_euler.z = math.radians(rz); head.keyframe_insert("rotation_euler", index=2, frame=f)
head.location.z = 1.0; head.keyframe_insert("location", index=2, frame=120)
# wobble: liquefy breathes in and out, then surface tension wins
for f, l, s in ((78, 0, 0), (92, 1.0, 0), (100, 0.7, 0), (108, 1.1, 0), (116, 0.8, 0), (124, 0.5, 0.4), (140, 0, 1.0)):
    liq.value = l; liq.keyframe_insert("value", frame=f)
    sph.value = s; sph.keyframe_insert("value", frame=f)
head.scale = (1, 1, 1); head.keyframe_insert("scale", frame=140)
head.scale = (0.03, 0.03, 0.03); head.keyframe_insert("scale", frame=166)   # the sphere closes around the speaker
# --- droplets: peel off, drift into space, get pulled back in ---
for o in [o for o in bpy.data.objects if o.name.startswith("Droplet")]:
    bpy.data.objects.remove(o, do_unlink=True)
skin = bpy.data.materials["Alien Skin"]
rnd = random.Random(11)
center = Vector((0, 0, 1.0))
proto = bpy.data.meshes.new("DropletMesh"); bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=1.0); bm.to_mesh(proto); bm.free()
for p in proto.polygons: p.use_smooth = True
proto.materials.append(skin)
for k in range(26):
    d = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1) * 0.6 - 0.3, rnd.gauss(0, 1))).normalized()
    r = rnd.uniform(0.035, 0.12)
    o = bpy.data.objects.new(f"Droplet {k:02d}", proto); scn.collection.objects.link(o)
    start = center + Vector((d.x * 0.85, d.y * 0.8, d.z * 1.2))
    far = start + d * rnd.uniform(0.7, 1.9) + Vector((rnd.uniform(-.3, .3), 0, rnd.uniform(-.3, .3)))
    f0 = rnd.randint(84, 104)
    o.location = start; o.scale = (0, 0, 0); o.keyframe_insert("location", frame=f0); o.keyframe_insert("scale", frame=f0)
    o.scale = (r, r * rnd.uniform(0.8, 1.2), r); o.keyframe_insert("scale", frame=f0 + 8)
    o.location = far; o.keyframe_insert("location", frame=rnd.randint(124, 132))
    swirl = Matrix.Rotation(math.radians(rnd.uniform(60, 120)), 3, "Y") @ (far - center) * 0.35
    o.location = center + swirl; o.keyframe_insert("location", frame=150)
    o.location = center; o.keyframe_insert("location", frame=rnd.randint(158, 163))
    o.keyframe_insert("scale", frame=152); o.scale = (0, 0, 0); o.keyframe_insert("scale", frame=163)
    o.rotation_euler = (0, 0, 0); o.keyframe_insert("rotation_euler", frame=f0)
    o.rotation_euler = [rnd.uniform(-3, 3) for _ in range(3)]; o.keyframe_insert("rotation_euler", frame=160)
# --- the eyes float free, then spiral into the speaker (their light becomes its light ring) ---
for s, dx in (("L", -1), ("R", 1)):
    e = bpy.data.objects[f"Alien Eye {s}"]
    lamp = bpy.data.objects[f"Eye Light {s}"]
    for ob in (e, lamp):
        mw = ob.matrix_world.copy(); ob.parent = None; ob.matrix_world = mw
    lamp.parent = e; lamp.matrix_parent_inverse = e.matrix_world.inverted()
    e.animation_data_clear()
    scn.frame_set(80)
    home = e.matrix_world.translation.copy(); rot0 = e.rotation_euler.copy(); sc = (0.37, 0.08, 0.165)
    e.location = home; e.rotation_euler = rot0; e.scale = sc
    for f in (1, 80):
        e.keyframe_insert("location", frame=f); e.keyframe_insert("rotation_euler", frame=f); e.keyframe_insert("scale", frame=f)
    e.location = home + Vector((dx * 0.9, -0.6, 0.35)); e.rotation_euler = (math.radians(25), math.radians(rot0.y * 57.3 + dx * 40), math.radians(dx * 30))
    e.keyframe_insert("location", frame=122); e.keyframe_insert("rotation_euler", frame=122)
    e.location = center + Vector((dx * 0.45, -0.4, -0.15)); e.keyframe_insert("location", frame=146)
    e.scale = sc; e.keyframe_insert("scale", frame=146)
    e.location = center + Vector((0, -0.15, 0)); e.keyframe_insert("location", frame=160)
    e.scale = (0, 0, 0); e.keyframe_insert("scale", frame=161)
    e.rotation_euler = (math.radians(70), 0, math.radians(dx * 200)); e.keyframe_insert("rotation_euler", frame=160)
eyem = bpy.data.materials["Alien Eye Glow"].node_tree.nodes["EyeEmission"].inputs["Strength"]
fc = bpy.data.materials["Alien Eye Glow"].node_tree.animation_data
if fc: fc.action = None
for f, v in ((1, 14), (50, 14), (58, 26), (68, 14), (120, 16), (156, 30), (161, 0)):
    eyem.default_value = v; eyem.keyframe_insert("default_value", frame=f)
# --- the speaker forms inside the liquid, floating and slowly tumbling ---
rig = bpy.data.objects["Speaker"]
rig.animation_data_clear()
rig.location = center
for f, s, rot in ((128, 0.15, (25, 10, -70)), (166, 1.0, (7, 2, -26)), (205, 1.0, (5, -2, -16)), (215, 1.0, (4, -3, -12))):
    rig.scale = (s, s, s); rig.keyframe_insert("scale", frame=f)
    rig.rotation_euler = [math.radians(a) for a in rot]; rig.keyframe_insert("rotation_euler", frame=f)
for f, z in ((128, 1.0), (180, 1.06), (215, 0.98)):
    rig.location.z = z; rig.keyframe_insert("location", index=2, frame=f)
scn.frame_set(112)
print("zero-g melt keyed; showing frame 112")
