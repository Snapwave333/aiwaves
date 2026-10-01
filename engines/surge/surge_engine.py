#!/usr/bin/env python
"""AIWaves synth engine: Surge XT (free, open-source GPL-3, Serum-class) driven from Python via
pedalboard. Presets are data (engines/surge/presets/*.json): synth settings + notes + optional
pitch-bend, or a stack of other presets ("layers"). Agents render them, change any setting with
--set, or render a device straight from a project (its params override the preset).

CLI (JSON on stdout; errors as {"error": ...} on stderr, exit 1):
  surge_engine.py info
  surge_engine.py presets
  surge_engine.py params [--match TEXT]                      # Surge's parameters: id, name, value, choices
  surge_engine.py render PRESET --out FILE.wav [--set KEY=VALUE ...] [--transpose N] [--secs S]
  surge_engine.py render-device PROJECT_JSON TRACK_ID DEVICE_ID --out FILE.wav [--transpose N]

Finding Surge XT: $AIWAVES_SURGE_VST3, else tools/surge-xt/... next to this repo or the music repo.
Python needs `pedalboard` (pip install pedalboard).
"""

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path

import numpy as np

SR = 44100
HERE = Path(__file__).resolve().parent
PRESETS = HERE / "presets"
_INNER = Path("Surge Synth Team") / "Surge XT.vst3" / "Contents" / "x86_64-win" / "Surge XT.vst3"
CANDIDATES = [HERE.parent.parent / "tools" / "surge-xt" / _INNER,
              Path.home() / "Desktop" / "music" / "tools" / "surge-xt" / _INNER]
_NUM = re.compile(r"(-?\d+(?:\.\d+)?)\s*([a-zA-Z%]*)")


class EngineError(Exception):
    pass


def plugin_path():
    env = os.environ.get("AIWAVES_SURGE_VST3")
    for p in ([Path(env)] if env else []) + CANDIDATES:
        if p.exists():
            return p
    raise EngineError("Surge XT not found: set AIWAVES_SURGE_VST3 to its VST3 binary "
                      "(the portable zip from github.com/surge-synthesizer/releases-xt)")


def _value(label):
    """A step label as a number in the parameter's base unit (ms for times, Hz for frequencies)."""
    m = _NUM.search(str(label))
    if not m:
        return np.nan
    x, unit = float(m.group(1)), m.group(2)
    return x * 1000 if unit in ("s", "kHz") else x


class Surge:
    """One Surge XT instance: `patch(settings)` resets to the init patch and applies settings
    (numbers snap to the nearest valid step, strings must be one of the choices); `play()` renders."""

    def __init__(self):
        try:
            from pedalboard import load_plugin
        except ImportError as e:
            raise EngineError("pedalboard is not installed (pip install pedalboard)") from e
        self.path = plugin_path()
        self.s = load_plugin(str(self.path))
        self.P = self.s.parameters
        self.init = {k: p.raw_value for k, p in self.P.items()}

    def patch(self, settings):
        for k, v in self.init.items():
            self.P[k].raw_value = v
        for k, v in settings.items():
            self.set(k, v)

    def set(self, key, value):
        if key not in self.P:
            raise EngineError(f"unknown Surge parameter: {key}")
        p = self.P[key]
        vals = list(getattr(p, "valid_values", None) or [])
        if isinstance(value, str) and not _is_number(value):
            if vals and value not in vals:
                raise EngineError(f"{key}: '{value}' is not one of {vals[:12]}{' ...' if len(vals) > 12 else ''}")
            setattr(self.s, key, value)
        elif vals and isinstance(vals[0], str):
            nums = np.array([_value(x) for x in vals])
            i = int(np.nanargmin(np.abs(nums - float(value))))
            p.raw_value = i / max(1, len(vals) - 1)
        else:
            setattr(self.s, key, float(value))

    def play(self, notes, secs, bends=()):
        msgs = []
        for m, v, t0, ln in notes:
            msgs += [(bytes([0x90, int(m), int(v)]), float(t0)), (bytes([0x80, int(m), 0]), float(t0 + ln))]
        for t, b in bends:
            val = int(np.clip((b + 1) * 8192, 0, 16383))
            msgs.append((bytes([0xE0, val & 0x7F, val >> 7]), float(t)))
        out = self.s(sorted(msgs, key=lambda m: m[1]), duration=float(secs), sample_rate=SR, reset=True)
        return np.ascontiguousarray(out.T, dtype=np.float32)

    def describe(self, key):
        p = self.P[key]
        vals = list(getattr(p, "valid_values", None) or [])
        info = {"id": key, "name": p.name, "value": p.string_value}
        if vals and isinstance(vals[0], str) and len(vals) <= 64:
            info["choices"] = vals
        elif vals:
            nums = [_value(x) for x in vals] if isinstance(vals[0], str) else [float(x) for x in vals]
            finite = [x for x in nums if np.isfinite(x)]
            info["min"], info["max"] = (min(finite), max(finite)) if finite else (None, None)
        return info


def _is_number(s):
    try:
        float(s)
        return True
    except ValueError:
        return False


_ENGINE = None


def engine():
    global _ENGINE
    if _ENGINE is None:
        _ENGINE = Surge()
    return _ENGINE


def load_preset(name):
    path = PRESETS / f"{name}.json"
    if not path.exists():
        raise EngineError(f"unknown preset '{name}' (have: {', '.join(p.stem for p in sorted(PRESETS.glob('*.json')))})")
    return json.loads(path.read_text(encoding="utf-8"))


def _bends(spec):
    """{"semitones": 12, "time": 1.6, "curve": 0.7, "range": 12} -> [(t, -1..0)] down-bend points."""
    if not spec:
        return []
    frac = spec["semitones"] / spec.get("range", spec["semitones"])
    return [(t, -frac * min(t / spec["time"], 1.0) ** spec.get("curve", 1.0)) for t in np.arange(0, spec["time"] + 0.1, 0.01)]


def render(name, overrides=None, transpose=0, secs=None, cache_dir=None):
    """A preset as stereo float32 (n, 2), peak 0.9. Layers are rendered and mixed by their gains."""
    pre = load_preset(name)
    if "layers" in pre:
        parts = [(render(l["preset"], overrides if l.get("pass_overrides") else None, transpose, None, cache_dir), l.get("gain", 1.0))
                 for l in pre["layers"]]
        n = int((secs or pre.get("secs") or max(len(p) for p, _ in parts) / SR) * SR)
        out = np.zeros((n, 2), np.float32)
        for y, g in parts:
            out[: min(n, len(y))] += y[:n] * g
        return out / (np.abs(out).max() + 1e-9) * 0.9
    settings = {**pre.get("settings", {}), **(overrides or {})}
    if pre.get("bend"):
        settings.setdefault("a_pitch_bend_down_range", f"{pre['bend'].get('range', pre['bend']['semitones'])} semitones")
    notes = [(m + transpose, v, t, ln) for m, v, t, ln in pre["notes"]]
    secs = secs or pre["secs"]
    key = hashlib.sha1(json.dumps([name, settings, notes, secs, pre.get("bend")], sort_keys=True).encode()).hexdigest()[:16]
    if cache_dir:
        cached = Path(cache_dir) / f"{name}_{key}.npy"
        if cached.exists():
            return np.load(cached)
    e = engine()
    e.patch(settings)
    y = e.play(notes, secs, _bends(pre.get("bend")))
    y = (y / (np.abs(y).max() + 1e-9) * 0.9).astype(np.float32)
    if cache_dir:
        Path(cache_dir).mkdir(parents=True, exist_ok=True)
        np.save(cached, y)
    return y


def device_overrides(project, track_id, device_id):
    """A project's Surge device -> (preset, overrides): every param whose id is a Surge parameter."""
    track = next((t for t in project["tracks"] if t["id"] == track_id), None)
    if not track:
        raise EngineError(f"no track '{track_id}'")
    dev = next((d for d in track["devices"] if d["id"] == device_id), None)
    if not dev or dev.get("engine") != "surge-xt":
        raise EngineError(f"no Surge XT device '{device_id}' on track '{track_id}'")
    return dev["preset"], {p["surge"]: p["value"] for p in dev["params"] if p.get("surge")}


def _write(path, y):
    import soundfile as sf
    sf.write(str(path), y, SR, subtype="FLOAT")
    return {"out": str(Path(path).resolve()), "secs": round(len(y) / SR, 3), "peak": round(float(np.abs(y).max()), 3)}


def main(argv=None):
    ap = argparse.ArgumentParser(prog="surge_engine", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("info")
    sub.add_parser("presets")
    pp = sub.add_parser("params")
    pp.add_argument("--match", default="")
    r = sub.add_parser("render")
    r.add_argument("preset")
    r.add_argument("--out", required=True)
    r.add_argument("--set", action="append", default=[], metavar="KEY=VALUE")
    r.add_argument("--transpose", type=int, default=0)
    r.add_argument("--secs", type=float)
    rd = sub.add_parser("render-device")
    rd.add_argument("project")
    rd.add_argument("track")
    rd.add_argument("device")
    rd.add_argument("--out", required=True)
    rd.add_argument("--transpose", type=int, default=0)
    a = ap.parse_args(argv)
    try:
        if a.cmd == "info":
            try:
                path, ok = str(plugin_path()), True
            except EngineError:
                path, ok = None, False
            out = {"engine": "surge-xt", "available": ok, "plugin": path, "presets": len(list(PRESETS.glob("*.json")))}
            if ok:
                out["params"] = len(engine().P)
        elif a.cmd == "presets":
            out = []
            for p in sorted(PRESETS.glob("*.json")):
                d = json.loads(p.read_text(encoding="utf-8"))
                out.append({"name": p.stem, "description": d.get("description", ""),
                            "layers": [l["preset"] for l in d.get("layers", [])] or None,
                            "settings": sorted(d.get("settings", {}))})
        elif a.cmd == "params":
            e = engine()
            out = [e.describe(k) for k in e.P if a.match.lower() in k.lower() or a.match.lower() in e.P[k].name.lower()]
        elif a.cmd == "render":
            ov = {}
            for kv in a.set:
                k, _, v = kv.partition("=")
                ov[k] = float(v) if _is_number(v) else v
            out = _write(a.out, render(a.preset, ov, a.transpose, a.secs))
        else:
            project = json.loads(Path(a.project).read_text(encoding="utf-8"))
            preset, ov = device_overrides(project, a.track, a.device)
            out = {"preset": preset, "overrides": ov, **_write(a.out, render(preset, ov, a.transpose))}
        print(json.dumps(out, indent=1))
        return 0
    except EngineError as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
