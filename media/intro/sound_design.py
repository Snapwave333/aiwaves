#!/usr/bin/env python
"""Sound design for the AIWaves intro (10 s, 30 fps), built from AIWaves' Surge XT presets and synced
to the animation's frames. Writes intro_sfx.wav (48 kHz stereo, about -16 LUFS: a splash screen
should not shout).

  frames      picture                         sound
  1-75        the orb floats, eyes glow        a drone swells in
  58          the eyes flare                   a bright ping
  84-104      droplets peel off                tiny tuned plinks, scattered in space
  128-166     the speaker forms in the liquid  a reversed ring swelling into it, a thump when it lights
  172-209     the cone pumps                   thumps on every beat, harder each time
  211         the blast                        impact + sub drop + a whoosh flying left to right
  220-245     the rings fly past the lens      whooshes flying past
  258         AIWAVES rises                    the braam, then shards as the letters settle
"""

import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "engines" / "surge"))
import surge_engine as E  # noqa: E402

SR_IN, SR = E.SR, 48000
FPS, SECS = 30, 10.0
CACHE = Path(__file__).resolve().parent / "sfx_cache"
OUT = Path(__file__).resolve().parent / "intro_sfx.wav"
rng = np.random.default_rng(2049)


def t(frame):
    return (frame - 1) / FPS


def sfx(preset, transpose=0):
    return E.render(preset, None, transpose, cache_dir=CACHE)


def pan(y, p):
    m = y.mean(1) if y.ndim > 1 else y
    a = (np.clip(p, -1, 1) + 1) * np.pi / 4
    return np.stack([m * np.cos(a), m * np.sin(a)], 1)


def fly_by(y, left_to_right=True, cents=80):
    """A sound passing the listener: pans across, pitch falls through the pass, loudest when closest."""
    m = y.mean(1)
    n = len(m)
    tt = np.linspace(0, 1, n)
    rate = 2 ** ((cents - 2 * cents * tt) / 1200)
    pos = np.cumsum(rate) - rate[0]
    pos = pos[pos < n - 1]
    m = np.interp(pos, np.arange(n), m)
    tt = np.linspace(0, 1, len(m))
    p = (-0.9 + 1.8 * tt) if left_to_right else (0.9 - 1.8 * tt)
    a = (p + 1) * np.pi / 4
    near = 0.6 + 0.4 * np.sin(np.pi * tt)
    return np.stack([m * np.cos(a) * near, m * np.sin(a) * near], 1)


def reverb(y, secs=2.2, mix=0.3, seed=1):
    r = np.random.default_rng(seed)
    n = int(secs * SR_IN)
    ir = r.standard_normal((n, 2)) * np.exp(-np.linspace(0, 6, n))[:, None]
    from scipy.signal import fftconvolve
    wet = np.stack([fftconvolve(y[:, c], ir[:, c])[: len(y)] for c in range(2)], 1)
    wet *= np.abs(y).max() / (np.abs(wet).max() + 1e-9)
    return y + mix * wet


def main():
    mix = np.zeros((int(SECS * SR_IN) + SR_IN, 2), np.float32)

    def put(y, frame, gain):
        i = int(t(frame) * SR_IN)
        j = min(len(mix), i + len(y))
        if 0 <= i < j:
            mix[i:j] += y[: j - i] * gain

    drone = sfx("drone")[: int(3.2 * SR_IN)].copy()
    drone *= np.minimum(np.linspace(0, 3.2, len(drone)) / 1.4, 1)[:, None] * np.clip((3.2 - np.linspace(0, 3.2, len(drone))) / 1.0, 0, 1)[:, None]
    put(drone, 1, 0.35)
    put(reverb(sfx("shard", transpose=-12)), 58, 0.5)                      # the eyes flare
    for k in range(9):                                                       # droplets: plinks in A minor
        note = int(rng.choice([0, 3, 5, 7, 10, 12, 15]))
        put(pan(reverb(sfx("shard", transpose=note - 5), mix=0.5, seed=k), float(rng.uniform(-0.8, 0.8))),
            int(rng.integers(84, 106)), 0.22)
    ring = sfx("impact_ring")[: int(1.3 * SR_IN)][::-1].copy()                # reversed: swells into the speaker
    put(ring, 166 - int(1.3 * FPS), 0.45)
    put(sfx("impact_thump"), 166, 0.5)
    for f, g in ((172, 0.35), (182, 0.45), (192, 0.55), (200, 0.65), (205, 0.75), (209, 0.85)):
        put(sfx("impact_thump"), f, g)
    put(sfx("impact"), 211, 1.0)                                             # the blast
    put(sfx("sub_drop"), 211, 0.6)
    put(fly_by(sfx("whoosh_up")), 205, 0.5)
    put(fly_by(sfx("whoosh_down"), left_to_right=False), 222, 0.45)
    put(fly_by(sfx("whoosh_up"), cents=120), 232, 0.35)
    put(reverb(sfx("braam"), secs=3.0, mix=0.25), 258, 0.85)                 # AIWAVES
    for k, f in enumerate((262, 266, 271, 276)):
        put(pan(sfx("shard", transpose=[0, 7, 12, 19][k]), [-0.5, 0.4, -0.2, 0.6][k]), f, 0.25)
    y = mix[: int(SECS * SR_IN)]
    f = int(0.6 * SR_IN)
    y[-f:] *= np.linspace(1, 0, f)[:, None] ** 2
    y = resample_poly(y, SR, SR_IN, axis=0).astype(np.float32)
    try:
        import pyloudnorm as pyln
        loud = pyln.Meter(SR).integrated_loudness(y)
        y *= 10 ** ((-16.0 - loud) / 20)
    except ImportError:
        y *= 0.5 / (np.abs(y).max() + 1e-9)
    peak = np.abs(y).max()
    if peak > 0.89:
        y *= 0.89 / peak
    sf.write(str(OUT), y, SR, subtype="PCM_24")
    print(f"{OUT}: {len(y) / SR:.1f} s, peak {20 * np.log10(np.abs(y).max()):.1f} dBFS")


if __name__ == "__main__":
    main()
