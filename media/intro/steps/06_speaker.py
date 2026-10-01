import bpy, bmesh, math
from mathutils import Vector
scn = bpy.context.scene
for n in ("Speaker", "Speaker Body", "Speaker Cone", "Speaker Surround", "Speaker Dust Cap", "Speaker Light Ring"):
    o = bpy.data.objects.get(n)
    if o: bpy.data.objects.remove(o, do_unlink=True)
rig = bpy.data.objects.new("Speaker", None); scn.collection.objects.link(rig)
rig.empty_display_type = "SPHERE"; rig.empty_display_size = 0.2
def mat(name, base, metal, rough, emit=(0, 0, 0, 1), es=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = base
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    b.inputs["Emission Color"].default_value = emit
    b.inputs["Emission Strength"].default_value = es
    return m
gun = mat("Speaker Gunmetal", (0.045, 0.05, 0.06, 1), 1.0, 0.28, (0.05, 1.0, 0.7, 1), 0.0)
cone_m = mat("Speaker Cone", (0.02, 0.02, 0.025, 1), 0.0, 0.55, (0.6, 0.2, 1.0, 1), 0.0)
rubber = mat("Speaker Rubber", (0.01, 0.01, 0.012, 1), 0.0, 0.8)
cap_m = mat("Speaker Cap", (0.01, 0.012, 0.015, 1), 0.3, 0.12, (0.0, 0.9, 1.0, 1), 0.6)
ring_m = mat("Speaker Light", (0, 0, 0, 1), 0.0, 0.5, (0.0, 0.9, 1.0, 1), 0.0)
def part(name, build, m, loc, rot=(0, 0, 0), scale=(1, 1, 1), smooth=True):
    me = bpy.data.meshes.new(name); bm = bmesh.new(); build(bm); bm.to_mesh(me); bm.free()
    if smooth:
        for p in me.polygons: p.use_smooth = True
    o = bpy.data.objects.new(name, me); scn.collection.objects.link(o)
    o.parent = rig; o.location = loc; o.rotation_euler = [math.radians(a) for a in rot]; o.scale = scale
    me.materials.append(m); return o
X = -90                                                    # everything faces the camera (-Y)
body = part("Speaker Body", lambda bm: bmesh.ops.create_cone(bm, cap_ends=True, segments=96, radius1=1.05, radius2=1.05, depth=0.55),
            gun, (0, 0.30, 0), (X, 0, 0))
bev = body.modifiers.new("Bevel", "BEVEL"); bev.width = 0.06; bev.segments = 4
cone = part("Speaker Cone", lambda bm: bmesh.ops.create_cone(bm, cap_ends=False, segments=96, radius1=0.80, radius2=0.22, depth=0.34),
            cone_m, (0, -0.02, 0), (X, 0, 0))
sol = cone.modifiers.new("Thickness", "SOLIDIFY"); sol.thickness = 0.015
part("Speaker Surround", lambda bm: bmesh.ops.create_circle(bm, cap_ends=False, segments=96, radius=0.9), rubber, (0, -0.19, 0), (X, 0, 0))
sur = bpy.data.objects["Speaker Surround"]; sur.modifiers.new("Tube", "SKIN") if False else None
bpy.data.objects.remove(sur, do_unlink=True)
bpy.ops.mesh.primitive_torus_add(major_radius=0.9, minor_radius=0.075, major_segments=96, minor_segments=16)
sur = bpy.context.active_object; sur.name = "Speaker Surround"; sur.parent = rig
sur.location = (0, -0.18, 0); sur.rotation_euler = (math.radians(90), 0, 0); sur.data.materials.append(rubber)
bpy.ops.object.shade_smooth()
cap = part("Speaker Dust Cap", lambda bm: bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=0.24), cap_m, (0, 0.12, 0), (0, 0, 0), (1, 0.45, 1))
bpy.ops.mesh.primitive_torus_add(major_radius=1.0, minor_radius=0.026, major_segments=128, minor_segments=12)
ring = bpy.context.active_object; ring.name = "Speaker Light Ring"; ring.parent = rig
ring.location = (0, -0.13, 0); ring.rotation_euler = (math.radians(90), 0, 0); ring.data.materials.append(ring_m)
bpy.ops.object.shade_smooth()
# rise out of the puddle; the puddle drains into it
rig.animation_data_clear()
for f, z, s in ((112, -1.7, 0.35), (138, -0.2, 0.75), (160, 1.0, 1.0), (170, 0.95, 1.0)):
    rig.location = (0, 0, z); rig.keyframe_insert("location", frame=f)
    rig.scale = (s, s, s); rig.keyframe_insert("scale", frame=f)
rig.rotation_euler = (math.radians(14), 0, 0); rig.keyframe_insert("rotation_euler", frame=130)
rig.rotation_euler = (0, 0, 0); rig.keyframe_insert("rotation_euler", frame=165)
head = bpy.data.objects["Alien Head"]
head.scale = (1, 1, 1); head.keyframe_insert("scale", frame=140)
head.scale = (0.02, 0.02, 0.02); head.keyframe_insert("scale", frame=166)
# the alien's liquid coats it, then runs off; the light ring comes on
for m_, f0, f1, e0 in ((gun, 128, 178, 3.0), (cone_m, 128, 178, 2.0)):
    s = m_.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"]
    s.default_value = e0; s.keyframe_insert("default_value", frame=f0)
    s.default_value = 0.0; s.keyframe_insert("default_value", frame=f1)
rs = ring_m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"]
for f, v in ((150, 0.0), (166, 9.0)):
    rs.default_value = v; rs.keyframe_insert("default_value", frame=f)
scn.frame_set(168)
print("speaker built; showing frame 168")
