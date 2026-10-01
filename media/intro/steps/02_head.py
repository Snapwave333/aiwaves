import bpy, bmesh, math
from mathutils import Vector
scn = bpy.context.scene
def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)
mesh = bpy.data.meshes.new("AlienHead")
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=96, v_segments=64, radius=1.0)
EYES = [(-0.36, 0.30), (0.36, 0.30)]           # (x, z) of the eye sockets on the front
for v in bm.verts:
    x, y, z = v.co
    t = (z + 1) / 2                             # 0 chin .. 1 crown
    w = 0.40 + 0.72 * smooth(0.02, 0.78, t)      # narrow chin, wide cranium
    x *= w; y *= w * 0.92
    if t > 0.55: y += (t - 0.55) * 0.55         # the skull sweeps back
    if t < 0.32: y -= (0.32 - t) * 0.35         # the chin comes forward a little
    z *= 1.32
    for ex, ez in EYES:                          # shallow sockets on the front
        d = math.hypot((x - ex) / 0.34, (z - ez) / 0.20)
        if y < 0 and d < 1.0: y += 0.10 * (1 - d) ** 2
    v.co = Vector((x, y, z))
bm.to_mesh(mesh); bm.free()
for p in mesh.polygons: p.use_smooth = True
head = bpy.data.objects.get("Alien Head")
if head: bpy.data.objects.remove(head, do_unlink=True)
head = bpy.data.objects.new("Alien Head", mesh)
scn.collection.objects.link(head)
head.location = (0, 0, 0.95)
sub = head.modifiers.new("Smooth", "SUBSURF"); sub.levels = 1; sub.render_levels = 2
# skin: dark iridescent teal, a coat, a glow that rises towards the silhouette
mat = bpy.data.materials.get("Alien Skin") or bpy.data.materials.new("Alien Skin")
mat.use_nodes = True
nt = mat.node_tree; nt.nodes.clear()
out = nt.nodes.new("ShaderNodeOutputMaterial")
bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
bsdf.inputs["Base Color"].default_value = (0.03, 0.09, 0.10, 1)
bsdf.inputs["Roughness"].default_value = 0.32
bsdf.inputs["Coat Weight"].default_value = 0.7
bsdf.inputs["Subsurface Weight"].default_value = 0.25
bsdf.inputs["Subsurface Radius"].default_value = (0.1, 0.9, 0.7)
bsdf.inputs["Emission Color"].default_value = (0.1, 1.0, 0.75, 1)
lw = nt.nodes.new("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.35
pw = nt.nodes.new("ShaderNodeMath"); pw.operation = "POWER"; pw.inputs[1].default_value = 2.2
mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"; mul.inputs[1].default_value = 4.0
mul.name = "RimGlow"
noise = nt.nodes.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 18
bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.12
nt.links.new(lw.outputs["Facing"], pw.inputs[0])
nt.links.new(pw.outputs[0], mul.inputs[0])
nt.links.new(mul.outputs[0], bsdf.inputs["Emission Strength"])
nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
head.data.materials.clear(); head.data.materials.append(mat)
print("head:", len(mesh.vertices), "vertices")
