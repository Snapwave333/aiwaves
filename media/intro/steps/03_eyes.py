import bpy, math
from mathutils import Vector
scn = bpy.context.scene
head = bpy.data.objects["Alien Head"]
dg = bpy.context.evaluated_depsgraph_get()
heval = head.evaluated_get(dg)
mat = bpy.data.materials.get("Alien Eye Glow") or bpy.data.materials.new("Alien Eye Glow")
mat.use_nodes = True
nt = mat.node_tree; nt.nodes.clear()
out = nt.nodes.new("ShaderNodeOutputMaterial")
em = nt.nodes.new("ShaderNodeEmission"); em.name = "EyeEmission"
em.inputs["Color"].default_value = (0.15, 1.0, 0.7, 1)
em.inputs["Strength"].default_value = 30.0
# hotter, whiter core: brighter where the eye faces the camera
lw = nt.nodes.new("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.5
mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"
mix.inputs["A"].default_value = (0.85, 1.0, 0.95, 1)
mix.inputs["B"].default_value = (0.05, 0.95, 0.55, 1)
nt.links.new(lw.outputs["Facing"], mix.inputs["Factor"])
nt.links.new(mix.outputs["Result"], em.inputs["Color"])
nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
for side, ex in (("L", -0.36), ("R", 0.36)):
    ez = 0.30 * 1.32
    hit, loc, normal, _ = heval.ray_cast(Vector((ex, -5.0, ez)), Vector((0, 1, 0)))
    name = f"Alien Eye {side}"
    old = bpy.data.objects.get(name)
    if old: bpy.data.objects.remove(old, do_unlink=True)
    me = bpy.data.meshes.new(name)
    import bmesh
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=1.0); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    eye = bpy.data.objects.new(name, me)
    scn.collection.objects.link(eye)
    eye.parent = head
    eye.location = loc + Vector((0, 0.035, 0))
    eye.scale = (0.30, 0.07, 0.13)
    eye.rotation_euler = (0, math.radians(-24 if side == "L" else 24), 0)   # almond, tilted up-and-out
    me.materials.append(mat)
    l = bpy.data.lights.new(f"Eye Light {side}", "POINT")
    l.color = (0.2, 1.0, 0.7); l.energy = 25; l.shadow_soft_size = 0.08
    lo = bpy.data.objects.new(f"Eye Light {side}", l)
    scn.collection.objects.link(lo)
    lo.parent = head
    lo.location = eye.location + Vector((0, -0.25, 0))
print("eyes placed at", [tuple(round(c, 2) for c in bpy.data.objects[n].location) for n in ("Alien Eye L", "Alien Eye R")])
