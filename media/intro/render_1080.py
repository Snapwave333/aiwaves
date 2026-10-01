"""Render the intro at 1920x1080 in a background Blender (the open Blender session is not touched).

  blender -b aiwaves_intro.blend --python render_1080.py      -> frames_1080/f_0001.png ... f_0300.png
"""
import os
import bpy

HERE = os.path.dirname(bpy.data.filepath)
s = bpy.context.scene
s.render.resolution_x, s.render.resolution_y, s.render.resolution_percentage = 1920, 1080, 100
s.render.image_settings.file_format = "PNG"
s.render.filepath = os.path.join(HERE, "frames_1080", "f_")
s.render.use_overwrite = False          # a rerun resumes where it stopped
s.render.use_placeholder = True
print(f"render {s.frame_start}-{s.frame_end} at 1920x1080 ({s.render.engine}) -> {s.render.filepath}")
bpy.ops.render.render(animation=True)
