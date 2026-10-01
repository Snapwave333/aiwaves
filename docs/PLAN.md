# AIWaves — plan

**An agent-first DAW.** AI agents (Claude and other LLMs) build songs and do sound design through a
complete CLI / API. Humans watch every step in a live, **read-only** workspace that looks and moves
like Ableton Live: every knob turning, fader moving, clip launching and automation point being
drawn, as it happens, with the reason for each change.

Status: plan only (2026-09-30). Nothing below is built yet except the seed (§7).

---

## 1. Principles

1. **Agents are the users.** Every capability exists first as a CLI command / API call with a
   machine-readable result (JSON). The GUI never has a feature the CLI lacks.
2. **Humans see everything, change nothing.** The workspace is read-only by design. Humans steer
   through the agent ("make the drop hit harder"), never by grabbing a fader. (A future,
   opt-in "suggest" button sends a note to the agent; it still doesn't edit.)
3. **Every change is an event with a reason.** The project's history is an append-only event log:
   who (which agent), what (`device.param.set drums/glue/threshold -18 → -21 dB`), why (the
   agent's one-line rationale), and the measurement that justified it. The GUI animates events;
   git checkpoints them.
4. **Song = code + data, renderable anywhere.** A project is a folder: a JSON song graph, samples,
   and scripts. Same input → bit-identical render. (Today's `make_longing_song.py` already works
   this way.)
5. **Measure, don't guess.** Agents can't hear, so analysis is a first-class tool: loudness,
   spectrum per band, masking between tracks, key and chord detection, onset grids, true peak,
   stereo correlation. (These all exist as one-off code in this repo today.)

## 2. Architecture

```
 agents (Claude, other LLMs)            humans (read-only)
        │  CLI: aiwaves …                      │  browser
        │  MCP server (same verbs)             │
        ▼                                      ▼
 ┌──────────────── AIWaves core (Python) ──────────────┐   WebSocket   ┌──── Workspace (web) ────┐
 │ command layer → validates → appends EVENT to log    │ ────────────▶ │ session / arrangement / │
 │ song graph (JSON): tracks, clips, devices, sends,   │   events +    │ mixer / devices /       │
 │   automation, tempo/key map                         │   meters +    │ automation, animated    │
 │ engine: render (offline, exact) + preview (live)    │   audio       │ live audio stream       │
 │ analysis: LUFS, spectra, masking, key, onsets …     │               │ changelog + git panel   │
 │ git: checkpoint per milestone, LFS for audio        │               └─────────────────────────┘
 └─────────────────────────────────────────────────────┘
```

- **Song graph** (`song.aiwaves.json`): tempo map, key/chord map, sections, tracks → clips → devices →
  parameters → automation lanes; sends/returns; master chain. All parameters have ids such as
  `tracks.lead.devices.reverb.params.mix`.
- **Event log** (`events.jsonl`): `{t, agent, verb, target, from, to, reason, evidence}`. Replaying it
  rebuilds the project; the GUI animates it (a knob tweens from `from` to `to` over ~300 ms; an
  automation point drops in; a clip lights up).
- **Engine:** offline render = today's numpy pipeline, generalised; live preview = block-based
  streaming of the affected region, re-rendering only changed tracks (cache per track per section).
- **Interfaces:** `aiwaves` CLI (JSON in/out, `--dry-run`, `--explain`); an MCP server exposing the
  same verbs to Claude; a local HTTP + WebSocket server feeding the workspace.

## 3. What "everything Ableton Live has" means, mapped

| Live | AIWaves (agent verb) | Human view |
|---|---|---|
| Session view: clip slots, scenes, launch | `clip.create/launch`, `scene.launch` | grid lighting up as clips launch |
| Arrangement view, sections, locators | `arrange.place`, `section.add` | timeline with section labels |
| Warp / tempo map / time-stretch | `audio.warp` (beat grid from analysis) | warp markers moving |
| Simpler / Sampler (multisample, RR, velocity) | `instrument.sampler` | key zones lighting per note |
| Drum Rack, choke groups | `drums.pad`, `drums.pattern` | pads flashing on hits |
| MIDI clips, piano roll, groove pool, humanise | `notes.write`, `groove.apply` | notes appearing in the roll |
| Audio effects (EQ Eight, Compressor, Glue, Reverb, Delay, Saturator, Auto Filter, Utility …) | `device.add`, `param.set` | device chain; knobs turning |
| Racks + macros | `rack.create`, `macro.map` | macro knob turning drives mapped knobs |
| Sidechain | `sidechain.route` | gain-reduction meter pumping |
| Automation lanes + clip envelopes | `automation.draw` (points / curves / LFO) | points dropping in, curves drawn |
| Mixer: volume, pan, sends/returns, groups, solo/mute | `mix.*` | faders gliding, meters live |
| Browser (samples, presets) with licences | `browse.search` (licence-filtered) | browser highlighting picks |
| Follow actions, probability | `clip.follow` | |
| Freeze / flatten / resample / bounce | `track.freeze`, `bounce` | |
| Export (stems, master, LUFS / true-peak targets) | `export --lufs -14 --tp -1` | meters + loudness report |
| Max for Live (custom devices) | Python device plugins (sandboxed) | auto-generated knob panel |
| Undo history | event log + git checkpoints | the changelog / git side panel |

## 4. The human workspace (read-only)

- Live's look and layout: session/arrangement toggle, device chain at the bottom, mixer, browser.
- **Animated mapping:** every event animates the exact control it touched, with a short caption
  ("lead reverb mix 0.20 → 0.30: the zither felt dry under her voice"). Playback can follow the
  agent's cursor.
- **Timeline scrubbing:** replay the build of the song from the first event; pause at any point;
  hear the song as it was at that step (from cached renders).
- **Side panel:** changelog, git history, the agent's current plan and to-do list, measurements.
- **Live listening:** streamed audio of the current render; A/B against any earlier version.
- Read-only is enforced server-side: the WebSocket is send-only to viewers.

## 5. Roadmap (estimates assume one agent working full-time with this repo as the base)

| Phase | Delivers | Estimate |
|---|---|---|
| 0. Seed (done) | Player with waveform, sections, changelog + git panel; songs as scripts | done |
| 1. Song graph + CLI | JSON song format; `aiwaves render/analyze/export`; port "Longing" to it bit-identically; event log | 2-3 weeks |
| 2. Read-only workspace v1 | Arrangement + mixer + device views fed by the event log; animated knobs; replay | 3-4 weeks |
| 3. Devices + automation | Ableton-equivalent core effects as parametrised devices; automation lanes; racks/macros; sidechain routing | 4-6 weeks |
| 4. Live engine | streaming preview, per-track render cache, session view with clip launching. **LMMS as a render engine** (Eli's suggestion): project.json -> LMMS .mmp -> `lmms -r` via the existing daw-cli, so instruments/effects/plugins come from a real DAW instead of being written from scratch | 4-6 weeks |
| 5. MCP + multi-agent | MCP server; several agents on one project (roles: arranger, mixer, sound designer) with locking | 2-3 weeks |
| 6. Polish | presets/browser with licence filter, stems export, follow actions, plugin devices | ongoing |

Rough total to an Ableton-like v1: **4-6 months**. Phase 1 alone already makes every future song
inspectable.

## 6. Open decisions (for Eli)

1. Where it runs: local only (this PC) or also hosted so others can watch?
2. Name and repo: a new repo `aiwaves`, separate from this music folder? (Recommended: yes.)
3. Open source licence, if published.
4. Which LLMs besides Claude must be supported from day one (affects the MCP vs plain-CLI priority).

## 7. Seed already in this repo

- `samples/vocals_new/longing/player.html` — waveform, sections, transport, changelog + git panel.
- `scripts/aiwaves_export.py` — changelog + git log → the panel's data.
- `scripts/make_longing_song.py` + `make_von_braun_song.py` — the engine's first draft (sampler,
  drums, bass synthesis, effects, vocal chain, analysis-driven placement, mastering).
- `scripts/analyze_longing.py` — beat grid, chord map and note chops from stems.
