import bpy
scn = bpy.context.scene
scn.eevee.taa_render_samples = 48
scn.render.resolution_percentage = 100
scn.render.image_settings.file_format = "PNG"
scn.render.filepath = r"C:\Users\chrom\Desktop\aiwaves\media\intro\frames\f_"
scn.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=r"C:\Users\chrom\Desktop\aiwaves\media\intro\aiwaves_intro.blend")
print("saved", bpy.data.filepath)
