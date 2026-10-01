#!/usr/bin/env python
"""AIWaves intro: the edit and post-processing without Resolve (same look as resolve_edit.py).

Grade (ASC CDL) -> soft glow on saturated light (the red eyes and rings bloom, the white studio does
not) -> fine luminance grain -> subtle vignette -> a short fade up from the splash screen's colour.
Muxed with intro_sfx.wav into aiwaves_intro_final.mp4 (H.264 + AAC, faststart).

  python post.py                 # frames_1080/ if complete, else frames/
  python post.py --frames frames --check   # also write a before/after contact sheet to shots/
"""

import argparse
import os
import subprocess
import sys
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
AUDIO = HERE / "intro_sfx.wav"
OUT = HERE / "aiwaves_intro_final.mp4"
FPS, N_FRAMES = 30, 300

# the grade, glow, grain and vignette: the same values as resolve_edit.py
SLOPE, OFFSET, POWER, SAT = (1.03, 1.03, 1.04), (-0.010, -0.008, -0.004), (1.06, 1.06, 1.05), 1.06
GLOW_THRESHOLD, GLOW_GAIN, GLOW_SIZE_720 = 0.82, 0.5, 12      # glow size in pixels at 720p
GLOW_MIN_SAT = 0.45                                            # below this saturation nothing glows: the studio stays white
GRAIN = 0.012                                                  # sd of the grain, in linear-ish units
VIGNETTE_GAIN, VIGNETTE_START = 0.86, 0.55                     # corners at 0.86; untouched inside 0.55
FADE_IN_FRAMES, SPLASH_BG = 9, (7, 9, 13)                      # up from #07090d, the splash screen


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def blur(img, sigma):
    """Gaussian blur done at quarter size (a glow does not need full resolution)."""
    from scipy.ndimage import gaussian_filter
    h, w = img.shape[:2]
    small = np.asarray(Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).resize((w // 4, h // 4), Image.BILINEAR),
                       np.float32) / 255
    small = gaussian_filter(small, (sigma / 4, sigma / 4, 0))
    return np.asarray(Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR), np.float32) / 255


class Look:
    def __init__(self, w, h, seed=2049):
        self.seed = seed
        self.sigma = GLOW_SIZE_720 * h / 720
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        r = np.hypot((xx - w / 2) / (w / 2), (yy - h / 2) / (h / 2))           # 1 at the edges, 1.41 in corners
        self.vignette = (1 - (1 - VIGNETTE_GAIN) * smoothstep(VIGNETTE_START, 1.41, r))[..., None]

    def __call__(self, rgb, frame):
        x = rgb.astype(np.float32) / 255
        x = np.clip(x * SLOPE + OFFSET, 0, None) ** np.array(POWER, np.float32)          # CDL
        luma = (x @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None]
        x = luma + SAT * (x - luma)
        hi, lo = x.max(2, keepdims=True), x.min(2, keepdims=True)
        sat = (hi - lo) / (hi + 1e-4)
        key = smoothstep(GLOW_THRESHOLD - 0.25, GLOW_THRESHOLD + 0.1, hi) * smoothstep(GLOW_MIN_SAT - 0.1, GLOW_MIN_SAT + 0.3, sat)
        x = x + GLOW_GAIN * blur(x * key, self.sigma)                                      # soft glow: bright AND coloured
        mid = 4 * luma * (1 - np.clip(luma, 0, 1))                                         # grain lives in mid-tones
        grain = np.random.default_rng((self.seed, frame)).standard_normal(luma.shape, np.float32)   # per frame: order-free
        x = x + GRAIN * grain * (0.35 + 0.65 * mid)
        x = x * self.vignette
        if frame <= FADE_IN_FRAMES:
            a = smoothstep(0, 1, frame / (FADE_IN_FRAMES + 1))
            x = a * x + (1 - a) * (np.array(SPLASH_BG, np.float32) / 255)
        return (np.clip(x, 0, 1) * 255 + 0.5).astype(np.uint8)


CHECK_FRAMES = (20, 75, 200, 280)
_look = None


def _init_worker(w, h):
    global _look
    _look = Look(w, h)


def _process(job):
    """In a worker process: (frame number, path) -> (graded frame, the raw frame for check frames only)."""
    i, f = job
    raw = np.asarray(Image.open(f).convert("RGB"))
    return _look(raw, i), (raw if i in CHECK_FRAMES else None)


def write_sheet(pairs):
    """Before (left) / after (right) for each check frame -> shots/post_check.png."""
    tw, th = 640, 360
    sheet = Image.new("RGB", (tw * 2, th * len(pairs)))
    for row, (raw, out) in enumerate(pairs.values()):
        sheet.paste(Image.fromarray(raw).resize((tw, th)), (0, row * th))
        sheet.paste(Image.fromarray(out).resize((tw, th)), (tw, row * th))
    (HERE / "shots").mkdir(exist_ok=True)
    sheet.save(HERE / "shots" / "post_check.png")


def pick_frames(arg):
    if arg:
        return HERE / arg
    hd = HERE / "frames_1080"
    done = [hd / f"f_{i:04d}.png" for i in range(1, N_FRAMES + 1)]
    complete = all(f.exists() and f.stat().st_size > 0 for f in done)      # a render in progress leaves empty placeholders
    return hd if complete else HERE / "frames"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", help="frame folder under media/intro (default: frames_1080 if complete, else frames)")
    ap.add_argument("--check", action="store_true", help="write a before/after sheet to shots/post_check.png")
    ap.add_argument("--sheet-only", action="store_true", help="only the before/after sheet, no video (fast look check)")
    ap.add_argument("--crf", type=int, default=20, help="H.264 quality: lower is cleaner and bigger (default 20)")
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 2), help="worker processes")
    args = ap.parse_args()
    src = pick_frames(args.frames)
    files = [src / f"f_{i:04d}.png" for i in range(1, N_FRAMES + 1)]
    missing = [f.name for f in files if not f.exists() or f.stat().st_size == 0]
    if missing or not AUDIO.exists():
        sys.exit(f"need {N_FRAMES} frames in {src} (missing {missing[:3]}...) and {AUDIO.name}")
    w, h = Image.open(files[0]).size
    look = Look(w, h)
    if args.sheet_only:
        write_sheet({i: (r := np.asarray(Image.open(files[i - 1]).convert("RGB")), look(r, i)) for i in CHECK_FRAMES})
        return
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(FPS), "-i", "-",
           "-i", str(AUDIO), "-map", "0:v", "-map", "1:a",
           "-c:v", "libx264", "-preset", "slow", "-crf", str(args.crf), "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", str(OUT)]
    ff = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    check = {}
    try:
        with Pool(args.jobs, _init_worker, (w, h)) as pool:          # frames come back in order
            for i, (out, raw) in enumerate(pool.imap(_process, enumerate(files, 1), chunksize=4), 1):
                ff.stdin.write(out.tobytes())
                if args.check and raw is not None:
                    check[i] = (raw, out)
                if i % 50 == 0:
                    print(f"  {i}/{N_FRAMES}", flush=True)
        ff.stdin.close()
    except BrokenPipeError:
        pass
    if ff.wait(timeout=300) != 0:
        sys.exit("ffmpeg failed")
    if check:
        write_sheet(check)
    print(f"{OUT.name}: {w}x{h}, {N_FRAMES / FPS:.1f} s, {OUT.stat().st_size // 1024} KB (from {src.name}/)")


if __name__ == "__main__":
    main()
