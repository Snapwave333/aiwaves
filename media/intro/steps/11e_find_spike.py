import bpy
me = bpy.data.objects["AIWaves Logo"].data
ys = sorted(v.co.y for v in me.vertices)
n = len(ys)
cap = ys[int(n * 0.995)]
out = [(round(v.co.x, 3), round(v.co.y, 3), round(v.co.z, 3)) for v in me.vertices if v.co.y > cap + 0.03]
xs = sorted(v.co.x for v in me.vertices)
print("verts", n, "x range", round(xs[0], 2), round(xs[-1], 2), "y p0.5/p99.5/max", round(ys[int(n*0.005)], 3), round(cap, 3), round(ys[-1], 3))
print("above cap:", len(out), out[:12])
