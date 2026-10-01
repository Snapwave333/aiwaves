# AIWaves intro (the desktop app's opening animation)

A red-eyed orb in a white zero-gravity studio melts into a speaker, the speaker blasts itself into
liquid soundwaves, and the waves form AIWAVES. 10 s, 30 fps.

| Step | Command | Output |
|------|---------|--------|
| Build the scene, one step at a time, in a running Blender (blender-mcp add-on, port 9876) | `python blend.py steps/NN_name.py` | `aiwaves_intro.blend` |
| Render 1920x1080 in a background Blender (the open one is not touched; a rerun resumes) | `blender -b aiwaves_intro.blend --python render_1080.py` | `frames_1080/` (git-ignored) |
| Sound design from the AIWaves Surge XT presets, synced to the frames | `python sound_design.py` | `intro_sfx.wav` |
| Edit + post: CDL grade, soft glow on the red light only, grain, vignette, fade up from the splash colour | `python post.py [--check] [--crf 20]` | `aiwaves_intro_final.mp4` |
| Use it in the app | copy to `desktop/splash/intro.mp4` | |

`post.py --sheet-only` writes a before/after sheet (`shots/post_check.png`) in a few seconds, for
judging a look change without encoding.

## DaVinci Resolve (optional)

`resolve_edit.lua` / `resolve_edit.py` build the same edit as a Resolve project ("AIWaves Intro") and
render `aiwaves_intro_resolve.mp4`, for hand-editing in Resolve. Copy them to
`%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility\`, restart Resolve
(it reads that folder at startup), then run Workspace > Scripts > AIWaves Intro Edit (Lua).
Each run logs to `resolve_edit.log`. To run it from outside Resolve instead
(`python resolve_edit.py`), set Preferences > System > General > External scripting using: Local.

## In the app

The intro plays on launch while the server starts; any click or key skips it. Turn it off from the
right-click menu (AIWaves > Play intro on launch), with `--no-intro`, or with `AIWAVES_NO_INTRO=1`;
AIWaves > Replay intro plays it again.
