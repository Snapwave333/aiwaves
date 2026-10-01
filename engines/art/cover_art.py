#!/usr/bin/env python
"""Generative cover art for an AIWaves project (CONTRACT §10), drawn with Pillow from the song
itself: its track colours make the palette, each section is an orbit ring, each bar an arc coloured
by its chord (minor = cool, major = warm), the master waveform is a glowing halo, and a ring of
alien glyphs circles the core. A new seed gives a new composition; the same seed, the same cover.

Usage: cover_art.py PROJECT_JSON --out FILE.png [--seed N] [--size 1024]
Prints {"out", "seed", "palette", "ms"} as JSON; errors as {"error": ...} on stderr, exit 1.
"""

import argparse
import colorsys
import json
import math
import random
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

FONTS = ["C:/Windows/Fonts/bahnschrift.ttf", "C:/Windows/Fonts/segoeuil.ttf", "C:/Windows/Fonts/segoeui.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def shift(rgb, dh=0.0, dl=0.0, ds=0.0):
    h, l, s = colorsys.rgb_to_hls(*(c / 255 for c in rgb))
    r, g, b = colorsys.hls_to_rgb((h + dh) % 1, min(1, max(0, l + dl)), min(1, max(0, s + ds)))
    return int(r * 255), int(g * 255), int(b * 255)


def palette(project, rnd):
    """5 colours from the song's tracks, rotated by the seed, pushed towards luminous."""
    cols = [hex_rgb(t["color"]) for t in project.get("tracks", []) if str(t.get("color", "")).startswith("#")]
    if not cols:
        cols = [(0, 229, 255), (170, 90, 255), (255, 80, 160)]
    rnd.shuffle(cols)
    hue = rnd.uniform(-0.08, 0.08)
    return [shift(c, dh=hue, dl=0.05, ds=0.25) for c in cols[:5]]


def font(size):
    for f in FONTS:
        if Path(f).exists():
            try:
                return ImageFont.truetype(f, size)
            except OSError:
                continue
    return ImageFont.load_default()


def glow(layer, radius):
    """A layer plus its blurred copy: light that bleeds."""
    return ImageChops.add(layer, layer.filter(ImageFilter.GaussianBlur(radius)))


def draw(project, seed, size):
    rnd = random.Random(seed)
    np_rnd = np.random.default_rng(seed)
    S = size
    cx, cy = S / 2 + rnd.uniform(-0.04, 0.04) * S, S * rnd.uniform(0.39, 0.43)   # high: the title lives below
    pal = palette(project, rnd)
    base = shift(pal[0], dl=-0.42, ds=-0.1)

    # deep space: a radial gradient towards the song's darkest colour
    yy, xx = np.mgrid[0:S, 0:S]
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / (S * 0.75)
    bg = np.zeros((S, S, 3), np.float32)
    for i, c in enumerate(base):
        bg[..., i] = c * np.clip(1.15 - d, 0.05, 1) * 0.55
    img = Image.fromarray(bg.astype(np.uint8), "RGB")

    # nebula: big soft clouds in the palette, screened in
    neb = Image.new("RGB", (S, S))
    nd = ImageDraw.Draw(neb)
    for _ in range(rnd.randint(4, 7)):
        c = rnd.choice(pal)
        r = rnd.uniform(0.12, 0.32) * S
        x, y = cx + rnd.uniform(-0.4, 0.4) * S, cy + rnd.uniform(-0.4, 0.4) * S
        nd.ellipse([x - r, y - r * rnd.uniform(0.5, 1.2), x + r, y + r * rnd.uniform(0.5, 1.2)], fill=tuple(int(v * 0.5) for v in c))
    img = ImageChops.screen(img, neb.filter(ImageFilter.GaussianBlur(S / 9)))

    # stars
    stars = np.zeros((S, S), np.float32)
    n = int(S * S / 900)
    sx, sy = np_rnd.integers(0, S, n), np_rnd.integers(0, S, n)
    stars[sy, sx] = np_rnd.power(6, n) * 255
    st = Image.fromarray(stars.astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(0.6))
    img = ImageChops.add(img, Image.merge("RGB", (st, st, st)))

    # the song as orbits: a ring per section, an arc per bar coloured by its chord
    lines = Image.new("RGB", (S, S))
    ld = ImageDraw.Draw(lines)
    sections = project.get("sections") or [{"start_bar": 0, "end_bar": 8}]
    chords = {c["bar"]: c["name"] for c in project.get("chords", [])}
    total = max(1, max(s["end_bar"] for s in sections))
    rot = rnd.uniform(0, 360)
    r0, r1 = S * 0.16, S * 0.35
    cool, warm = pal[0], pal[min(2, len(pal) - 1)]
    for k, sec in enumerate(sections):
        r = r0 + (r1 - r0) * k / max(1, len(sections) - 1)
        w = max(2, int(S / 220 * (1 + (sec["end_bar"] - sec["start_bar"]) / 8)))
        for bar in range(int(sec["start_bar"]), int(sec["end_bar"])):
            a0 = rot + 360 * bar / total
            a1 = rot + 360 * (bar + 0.82) / total
            name = chords.get(bar, "Am")
            c = cool if name.endswith("m") else warm
            if rnd.random() < 0.18:
                c = rnd.choice(pal)
            ld.arc([cx - r, cy - r, cx + r, cy + r], a0, a1, fill=c, width=w)
    img = ImageChops.add(img, glow(lines, S / 120))

    # the waveform as a halo around the core
    peaks = (project.get("audio") or {}).get("peaks") or list(np.abs(np.sin(np.linspace(0, 20, 400))))
    peaks = np.asarray(peaks, np.float32)
    peaks = peaks / (peaks.max() + 1e-9)
    halo = Image.new("RGB", (S, S))
    hd = ImageDraw.Draw(halo)
    rh = S * rnd.uniform(0.09, 0.13)
    pts = []
    for i, p in enumerate(peaks):
        a = math.radians(rot + 360 * i / len(peaks))
        rr = rh + p * S * 0.055
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    hd.line(pts + pts[:1], fill=pal[1 % len(pal)], width=max(2, S // 340))
    hd.ellipse([cx - rh * 0.55, cy - rh * 0.55, cx + rh * 0.55, cy + rh * 0.55], fill=tuple(min(255, int(v * 1.2)) for v in pal[-1]))
    img = ImageChops.add(img, glow(halo, S / 60))

    # alien glyphs on an outer ring
    gl = Image.new("RGB", (S, S))
    gd = ImageDraw.Draw(gl)
    rg = S * 0.40
    n_glyphs = rnd.randint(28, 44)
    gs = S / 70
    for i in range(n_glyphs):
        a = math.radians(rot * 0.5 + 360 * i / n_glyphs)
        gx, gy = cx + rg * math.cos(a), cy + rg * math.sin(a)
        c = pal[i % len(pal)]
        for _ in range(rnd.randint(2, 4)):
            x0, y0 = gx + rnd.uniform(-gs, gs), gy + rnd.uniform(-gs, gs)
            if rnd.random() < 0.5:
                gd.line([x0, y0, gx + rnd.uniform(-gs, gs), gy + rnd.uniform(-gs, gs)], fill=c, width=max(1, S // 600))
            else:
                rr = rnd.uniform(gs * 0.2, gs * 0.6)
                gd.arc([x0 - rr, y0 - rr, x0 + rr, y0 + rr], rnd.uniform(0, 360), rnd.uniform(0, 360), fill=c, width=max(1, S // 600))
    img = ImageChops.add(img, glow(gl, S / 300))

    # title, on a dark fade so it always reads
    fade = np.clip((yy / S - 0.70) / 0.22, 0, 1)[..., None] ** 1.5
    arr = np.asarray(img).astype(np.float32) * (1 - 0.82 * fade)
    img = Image.fromarray(arr.astype(np.uint8), "RGB")
    td = ImageDraw.Draw(img)
    title = str(project.get("title") or "AIWaves").upper()
    sub = " · ".join(x for x in ["AIWAVES", str(project.get("key") or "").upper(),
                                f"{project.get('bpm'):g} BPM" if project.get("bpm") else ""] if x)
    f1, f2 = font(int(S * 0.072)), font(int(S * 0.022))
    spaced = " ".join(title)
    w1 = td.textlength(spaced, font=f1)
    y_title = S * 0.83
    td.text(((S - w1) / 2 + 2, y_title + 2), spaced, font=f1, fill=(0, 0, 0))
    td.text(((S - w1) / 2, y_title), spaced, font=f1, fill=(240, 246, 255))
    w2 = td.textlength(sub, font=f2)
    td.text(((S - w2) / 2, y_title + S * 0.09), sub, font=f2, fill=shift(pal[0], dl=0.25))

    # film grain + vignette
    arr = np.asarray(img).astype(np.float32)
    arr += np_rnd.normal(0, 6, arr.shape)
    v = np.clip(1.25 - d * 0.75, 0.35, 1)[..., None]
    arr = np.clip(arr * v, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, "RGB"), ["#%02x%02x%02x" % c for c in pal]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("project")
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int)
    ap.add_argument("--size", type=int, default=1024)
    a = ap.parse_args(argv)
    t0 = time.time()
    try:
        if not 128 <= a.size <= 4096:
            raise ValueError("--size must be between 128 and 4096")
        project = json.loads(Path(a.project).read_text(encoding="utf-8"))
        seed = a.seed if a.seed is not None else random.SystemRandom().randrange(2 ** 31)
        img, pal = draw(project, seed, a.size)
        img.save(a.out, "PNG", optimize=True)
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as e:
        print(json.dumps({"error": f"cover art failed: {e}"}), file=sys.stderr)
        return 1
    print(json.dumps({"out": str(Path(a.out).resolve()), "seed": seed, "palette": pal, "ms": int((time.time() - t0) * 1000)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
