import bpy, math
from mathutils import Vector, Quaternion
scn = bpy.context.scene
head = bpy.data.objects["Alien Head"]
head.name = "Orb"
me = head.data
R = 1.08
keys = me.shape_keys.key_blocks
basis, liq, sph = keys["Basis"], keys["Liquefy"], keys["Sphere"]
for i, v in enumerate(me.vertices):
    n = basis.data[i].co.normalized()
    p = n * R
    v.co = p; basis.data[i].co = p
    lobes = (0.20 * math.sin(3.1 * n.x * math.pi + 1.0) * math.sin(2.2 * n.y * math.pi + 0.4) * math.cos(2.7 * n.z * math.pi)
             + 0.12 * math.sin(5.0 * n.z + 2.3 * n.x) + 0.08 * math.cos(7.0 * n.y - 1.7 * n.z))
    liq.data[i].co = p * (1 + lobes)
    sph.data[i].co = n * (R * 0.85)
me.update()
# the eyes, seated on the orb: flat side along the surface normal, tilted up-and-out
scn.frame_set(80)
c = head.matrix_world.translation.copy()
for side, ex in (("L", -0.36), ("R", 0.36)):
    e = bpy.data.objects[f"Alien Eye {side}"]
    ez = 0.24
    ey = -math.sqrt(max(0.0, R * R - ex * ex - ez * ez))
    normal = Vector((ex, ey, ez)).normalized()
    home = c + normal * (R + 0.012)
    q = Vector((0, -1, 0)).rotation_difference(normal)
    tilt = Quaternion(normal, math.radians(26 if side == "L" else -26))
    rot = (tilt @ q).to_euler()
    for f in (1, 80):
        e.location = home; e.keyframe_insert("location", frame=f)
        e.rotation_euler = rot; e.keyframe_insert("rotation_euler", frame=f)
    dx = -1 if side == "L" else 1
    e.location = home + Vector((dx * 0.7, -0.22, 0.3)); e.keyframe_insert("location", frame=122)
    e.scale = (0.33, 0.08, 0.15)
    for f in (1, 80, 146):
        e.keyframe_insert("scale", frame=f)
scn.frame_set(30)
print("the orb: radius", R, "eyes re-seated")
