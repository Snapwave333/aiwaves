#!/usr/bin/env python
"""AIWaves intro: the edit and post-processing in DaVinci Resolve.

Builds project "AIWaves Intro": the Blender frames (frames/f_0001.png ...) + the sound design
(intro_sfx.wav) on one timeline; a filmic grade (CDL); a Fusion composition on the clip for soft
glow (the red eyes and edges bloom), fine film grain and a subtle vignette; renders
aiwaves_intro_final.mp4 (H.264 + AAC) next to this script; saves the project.

Runs two ways:
  - inside Resolve: Workspace > Scripts > AIWaves Intro Edit (works in the free edition)
  - from outside:   python resolve_edit.py (needs Preferences > System > General >
                    "External scripting using: Local")
"""

import os
import sys
import time

HERE = r"C:\Users\chrom\Desktop\aiwaves\media\intro"
FRAMES = os.path.join(HERE, "frames")
AUDIO = os.path.join(HERE, "intro_sfx.wav")
OUT_NAME = "aiwaves_intro_final"
PROJECT = "AIWaves Intro"
LOG = os.path.join(HERE, "resolve_edit.log")


def log(msg):
    print(msg)
    with open(LOG, "a", encoding="utf-8") as fh:
        fh.write(time.strftime("%H:%M:%S ") + str(msg) + "\n")


def get_resolve():
    g = globals()
    if g.get("resolve"):                                  # Workspace > Scripts provides it
        return g["resolve"]
    try:
        import DaVinciResolveScript as dvr                # external scripting
    except ImportError:
        sys.path.append(r"C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting\Modules")
        import DaVinciResolveScript as dvr
    return dvr.scriptapp("Resolve")


def main():
    open(LOG, "w").close()
    r = get_resolve()
    if not r:
        log("ERROR: cannot reach Resolve (run it from Workspace > Scripts, or enable External scripting: Local)")
        return 1
    log(f"connected: {r.GetProductName()} {r.GetVersionString()}")
    n = len([f for f in os.listdir(FRAMES) if f.startswith("f_") and f.endswith(".png")])
    if n < 300 or not os.path.exists(AUDIO):
        log(f"ERROR: need 300 frames in {FRAMES} (found {n}) and {AUDIO}")
        return 1
    pm = r.GetProjectManager()
    proj = pm.LoadProject(PROJECT) or pm.CreateProject(PROJECT)
    if not proj:
        log("ERROR: cannot create or load the project")
        return 1
    for k, v in (("timelineFrameRate", "30"), ("timelineResolutionWidth", "1280"), ("timelineResolutionHeight", "720"),
                 ("timelinePlaybackFrameRate", "30")):
        proj.SetSetting(k, v)
    pool = proj.GetMediaPool()
    root = pool.GetRootFolder()
    for clip in list(root.GetClipList() or []):            # a rerun starts clean
        pool.DeleteClips([clip])
    seq = pool.ImportMedia([{"FilePath": os.path.join(FRAMES, "f_%04d.png"), "StartIndex": 1, "EndIndex": 300}])
    aud = pool.ImportMedia([AUDIO])
    if not seq or not aud:
        log(f"ERROR: import failed (frames: {bool(seq)}, audio: {bool(aud)})")
        return 1
    for t in [proj.GetTimelineByIndex(i + 1) for i in range(proj.GetTimelineCount())]:
        if t and t.GetName() == "AIWaves Intro":
            pool.DeleteTimelines([t])
    tl = pool.CreateEmptyTimeline("AIWaves Intro")
    proj.SetCurrentTimeline(tl)
    pool.AppendToTimeline([{"mediaPoolItem": seq[0], "trackIndex": 1, "mediaType": 1}])
    pool.AppendToTimeline([{"mediaPoolItem": aud[0], "trackIndex": 1, "mediaType": 2}])
    item = tl.GetItemListInTrack("video", 1)[0]
    log(f"timeline: {tl.GetName()}, {tl.GetEndFrame() - tl.GetStartFrame()} frames")
    # grade: a little lift in contrast and density, cooler shadows, slightly richer colour
    ok = item.SetCDL({"NodeIndex": "1", "Slope": "1.06 1.02 1.00", "Offset": "-0.012 -0.008 -0.002",
                      "Power": "1.04 1.04 1.03", "Saturation": "1.10"})
    log(f"grade (CDL): {ok}")
    # post: soft glow -> film grain -> vignette, in Fusion
    comp = item.AddFusionComp()
    if comp:
        mi = comp.FindTool("MediaIn1")
        mo = comp.FindTool("MediaOut1")
        glow = comp.AddTool("SoftGlow", 1, 0)
        glow.Input = mi.Output
        glow.Threshold = 0.82
        glow.Gain = 0.9
        glow.XGlowSize = 12
        grain = comp.AddTool("FilmGrain", 2, 0)
        grain.Input = glow.Output
        grain.Strength = 0.12
        grain.Size = 1.1
        vig_mask = comp.AddTool("EllipseMask", 3, 1)
        vig_mask.Width = 1.25
        vig_mask.Height = 1.25
        vig_mask.SoftEdge = 0.45
        vig_mask.Invert = 1
        vig = comp.AddTool("BrightnessContrast", 3, 0)
        vig.Input = grain.Output
        vig.Gain = 0.82
        vig.EffectMask = vig_mask.Mask
        mo.Input = vig.Output
        log("post (Fusion): soft glow, film grain, vignette")
    else:
        log("WARNING: could not add a Fusion comp (post-processing skipped)")
    # render
    proj.SetCurrentRenderFormatAndCodec("mp4", "H264")
    proj.SetRenderSettings({"SelectAllFrames": True, "TargetDir": HERE, "CustomName": OUT_NAME,
                            "ExportVideo": True, "ExportAudio": True, "FormatWidth": 1280, "FormatHeight": 720,
                            "FrameRate": "30"})
    proj.DeleteAllRenderJobs()
    job = proj.AddRenderJob()
    if not job:
        log("ERROR: could not add the render job")
        return 1
    proj.StartRendering([job])
    t0 = time.time()
    while proj.IsRenderingInProgress() and time.time() - t0 < 900:
        time.sleep(1)
    status = proj.GetRenderJobStatus(job)
    log(f"render: {status}")
    pm.SaveProject()
    out = os.path.join(HERE, OUT_NAME + ".mp4")
    log(f"DONE: {out} ({os.path.getsize(out) // 1024} KB)" if os.path.exists(out) else "ERROR: no output file")
    return 0


if __name__ == "__main__":
    main()
