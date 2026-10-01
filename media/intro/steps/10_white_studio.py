import bpy, bmesh, math
from mathutils import Vector
scn = bpy.context.scene
for n in ("Rim Cyan", "Rim Magenta", "Key", "Studio Key", "Studio Fill", "Studio Back", "Cyclorama"):
    o = bpy.data.objects.get(n)
    if o: bpy.data.objects.remove(o, do_unlink=True)
# world: soft studio white
nt = scn.world.node_tree
bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
for l in list(nt.links):
    if l.to_socket == bg.inputs["Color"]: nt.links.remove(l)
bg.inputs["Color"].default_value = (0.86, 0.87, 0.89, 1); bg.inputs["Strength"].default_value = 0.8
# the cyc: a floor sweeping up into a wall behind, white, matte
me = bpy.data.meshes.new("Cyclorama"); bm = bmesh.new()
prof = [(y, -2.6) for y in (-14, -8, -2, 2)]
R = 4.0
for k in range(1, 13):
    a = math.radians(90 * k / 12)
    prof.append((2 + R * math.sin(a), -2.6 + R * (1 - math.cos(a))))
prof += [(2 + R, z) for z in (4, 10, 18)]
rows = []
for x in (-26, 26):
    rows.append([bm.verts.new((x, y, z)) for y, z in prof])
for i in range(len(prof) - 1):
    bm.faces.new((rows[0][i], rows[0][i + 1], rows[1][i + 1], rows[1][i]))
bm.to_mesh(me); bm.free()
for p in me.polygons: p.use_smooth = True
cyc = bpy.data.objects.new("Cyclorama", me); scn.collection.objects.link(cyc)
cyc.location.y = 3.0
wm = bpy.data.materials.get("Studio White") or bpy.data.materials.new("Studio White")
wm.use_nodes = True; b = wm.node_tree.nodes["Principled BSDF"]
b.inputs["Base Color"].default_value = (0.9, 0.9, 0.92, 1); b.inputs["Roughness"].default_value = 0.9
me.materials.append(wm)
# three-point lighting, aimed at the subject
target = Vector((0, 0, 1.0))
def area(name, loc, energy, size, color):
    l = bpy.data.lights.new(name, "AREA"); l.energy = energy; l.size = size; l.color = color
    o = bpy.data.objects.new(name, l); scn.collection.objects.link(o); o.location = loc
    o.rotation_euler = (target - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return o
area("Studio Key", (-4.5, -5.0, 4.5), 1400, 4.0, (1.0, 0.97, 0.92))
area("Studio Fill", (5.0, -4.5, 1.6), 450, 6.0, (0.92, 0.96, 1.0))
area("Studio Back", (0.5, 4.5, 5.0), 1100, 3.0, (1.0, 1.0, 1.0))
# only things brighter than white bloom (the eyes, the blast flash)
glare = next(n for n in scn.compositing_node_group.nodes if n.bl_idname == "CompositorNodeGlare")
glare.inputs["Threshold"].default_value = 1.3
glare.inputs["Size"].default_value = 0.5
# the liquid: pure glossy black chrome, no glow
bpy.data.materials["Liquid Wave"].node_tree.nodes["EdgeEnergy"].inputs[1].default_value = 0.0
scn.frame_set(30)
print("white three-point studio; showing frame 30")
