import bpy, bmesh, math, random
from mathutils import Vector
scn = bpy.context.scene
eye = bpy.data.materials["Alien Eye Glow"].node_tree
next(n for n in eye.nodes if n.type == "MIX").inputs["A"].default_value = (1.0, 0.06, 0.02, 1)   # deeper red core
center = Vector((0, 0, 1.0))
rig = bpy.data.objects["Speaker"]
for f, s in ((209, 1.0), (211, 1.16), (217, 0.0)):
    rig.scale = (s, s, s); rig.keyframe_insert("scale", frame=f)
for o in [o for o in bpy.data.objects if o.name.startswith(("Wave Ring", "Spray", "Blast Flash", "Wobble"))]:
    bpy.data.objects.remove(o, do_unlink=True)
# the flash: the eyes' energy released, red
fl = bpy.data.lights.new("Blast Flash", "POINT"); fl.color = (1.0, 0.08, 0.03); fl.shadow_soft_size = 0.6
flo = bpy.data.objects.new("Blast Flash", fl); scn.collection.objects.link(flo); flo.location = center + Vector((0, -0.6, 0))
for f, e in ((209, 0), (211, 2500), (224, 0)):
    fl.energy = e; fl.keyframe_insert("energy", frame=f)
# liquid: glossy black with a red energy edge
m = bpy.data.materials.get("Liquid Wave") or bpy.data.materials.new("Liquid Wave")
m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
out = nt.nodes.new("ShaderNodeOutputMaterial"); bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
bs.inputs["Base Color"].default_value = (0.01, 0.01, 0.012, 1); bs.inputs["Metallic"].default_value = 0.9
bs.inputs["Roughness"].default_value = 0.05; bs.inputs["Coat Weight"].default_value = 1.0
bs.inputs["Emission Color"].default_value = (1.0, 0.03, 0.01, 1)
lw = nt.nodes.new("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.2
mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"; mul.name = "EdgeEnergy"; mul.inputs[1].default_value = 3.0
nt.links.new(lw.outputs["Fresnel"], mul.inputs[0]); nt.links.new(mul.outputs[0], bs.inputs["Emission Strength"])
nt.links.new(bs.outputs["BSDF"], out.inputs["Surface"])
# wobble: one noise texture, its coordinates swimming through the blast
tex = bpy.data.textures.get("Liquid Wobble") or bpy.data.textures.new("Liquid Wobble", "CLOUDS")
tex.noise_scale = 0.35
wob = bpy.data.objects.new("Wobble Driver", None); scn.collection.objects.link(wob)
for f, z in ((205, 0.0), (300, 3.0)):
    wob.location = (z * 0.3, 0, z); wob.keyframe_insert("location", frame=f)
rnd = random.Random(5)
for k in range(7):
    bpy.ops.mesh.primitive_torus_add(major_radius=0.9, minor_radius=0.055, major_segments=160, minor_segments=14)
    r = bpy.context.active_object; r.name = f"Wave Ring {k}"
    r.data.materials.append(m); bpy.ops.object.shade_smooth()
    d = r.modifiers.new("Liquid", "DISPLACE"); d.texture = tex; d.texture_coords = "OBJECT"; d.texture_coords_object = wob; d.strength = 0.16
    t0 = 210 + k * 3
    tilt = (math.radians(90 + rnd.uniform(-14, 14)), math.radians(rnd.uniform(-10, 10)), math.radians(rnd.uniform(-20, 20)))
    r.location = center; r.rotation_euler = tilt; r.scale = (0, 0, 0)
    r.keyframe_insert("location", frame=t0); r.keyframe_insert("scale", frame=t0); r.keyframe_insert("rotation_euler", frame=t0)
    s = 4.4 - k * 0.35
    r.scale = (s, s, s * 1.3); r.keyframe_insert("scale", frame=t0 + 26)
    r.location = center + Vector((rnd.uniform(-.3, .3), -1.2 - k * 0.25, rnd.uniform(-.2, .2))); r.keyframe_insert("location", frame=t0 + 26)
    r.rotation_euler = (tilt[0] + rnd.uniform(-.3, .3), tilt[1] + rnd.uniform(-.3, .3), tilt[2] + rnd.uniform(-.5, .5))
    r.keyframe_insert("rotation_euler", frame=t0 + 26)
# the spray: droplets flying out in every direction, never falling (zero-g)
drop = bpy.data.meshes.get("DropletMesh")
for k in range(48):
    o = bpy.data.objects.new(f"Spray {k:02d}", drop); scn.collection.objects.link(o)
    o.material_slots[0].link = "OBJECT"; o.material_slots[0].material = m
    v = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1) - 0.8, rnd.gauss(0, 1))).normalized()
    sz = rnd.uniform(0.02, 0.07)
    o.location = center; o.scale = (0, 0, 0)
    o.keyframe_insert("location", frame=211); o.keyframe_insert("scale", frame=211)
    o.scale = (sz, sz, sz); o.keyframe_insert("scale", frame=214)
    o.location = center + v * rnd.uniform(2.5, 5.5); o.keyframe_insert("location", frame=262)
    if o.animation_data and o.animation_data.action:
        try:
            for fc in o.animation_data.action.fcurves:
                if fc.data_path == "location":
                    for kp in fc.keyframe_points: kp.interpolation = "LINEAR"     # drift: no easing, no gravity
        except Exception:
            pass
scn.frame_set(228)
print("blast keyed; showing frame 228")
