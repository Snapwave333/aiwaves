import bpy
scn = bpy.context.scene
me = bpy.data.objects["AIWaves Logo"].data
fixed = 0
for v in me.vertices:
    if v.co.y > 0.43:
        v.co.y = 0.40; fixed += 1
me.update()
r = scn.render
old = (r.resolution_percentage, r.filepath)
r.resolution_percentage = 50
scn.frame_set(296)
r.filepath = r"C:\Users\chrom\Desktop\aiwaves\media\intro\shots\render_f296b.png"
bpy.ops.render.render(write_still=True)
r.resolution_percentage, r.filepath = old
print("clamped", fixed, "vertices; re-rendered 296")
