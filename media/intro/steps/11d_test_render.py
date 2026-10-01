import bpy
scn = bpy.context.scene
head = bpy.data.objects["Alien Head"]
for f, hidden in ((1, False), (166, False), (167, True)):
    head.hide_render = hidden; head.keyframe_insert("hide_render", frame=f)
    head.hide_viewport = hidden; head.keyframe_insert("hide_viewport", frame=f)
logo = bpy.data.objects["AIWaves Logo"]
print("logo material slots:", [s.material.name if s.material else None for s in logo.material_slots])
dg = bpy.context.evaluated_depsgraph_get()
me = logo.evaluated_get(dg).to_mesh()
import statistics
print("logo evaluated faces:", len(me.polygons), "material indices:", sorted({p.material_index for p in me.polygons})[:5],
      "mean normal y:", round(statistics.mean(p.normal.y for p in me.polygons), 3))
logo.evaluated_get(dg).to_mesh_clear()
r = scn.render
old = (r.resolution_percentage, r.filepath)
r.resolution_percentage = 50
scn.frame_set(296)
r.filepath = r"C:\Users\chrom\Desktop\aiwaves\media\intro\shots\render_f296.png"
bpy.ops.render.render(write_still=True)
r.resolution_percentage, r.filepath = old
print("rendered frame 296")
