# AIWaves — v0 contract (backend ↔ frontend ↔ agents)

This is the single source of truth both halves build against. Change it only together.
Backend: Rust (`backend/`, crate `aiwaves`, binary `aiwaves`). Frontend: Angular (`frontend/`).
Demo data: `fixtures/longing/` (exported from the real song "Longing").

## 1. Principles that the code must enforce

- **Agents write, humans watch.** State changes only through `POST /api/projects/{id}/commands`
  (or the CLI, which calls it), authenticated with a token. Viewers (browser, WebSocket) can never
  change state; the WebSocket is server → client only (anything a client sends is ignored).
- **Every change is an event with a reason.** Commands without a non-empty `reason` are rejected.
- **Local by default.** The server binds `127.0.0.1:8787` unless `--bind` says otherwise.

## 2. Files of a project (on disk, under `--data <dir>/<project_id>/`)

```
project.json      current state (schema below), rewritten after every applied command
events.jsonl      append-only event log, one Event per line, seq strictly increasing from 1
audio/            renders the player can stream (e.g. master.wav)
history.json      optional: {"changelog": [...], "commits": [...], "branch": "..."}
```

## 3. Project (`project.json`)

```jsonc
{
  "schema": "aiwaves/project@1",
  "id": "longing",
  "title": "Longing",
  "artist": "Madam Snowflake (vocal, CC BY 3.0) + Claude",
  "bpm": 80, "time_signature": [4, 4], "key": "A minor",
  "length_bars": 65,
  "version": 3,                        // bumped by every applied command (= last event seq)
  "sections": [ { "name": "intro", "start_bar": 0, "end_bar": 8 } ],
  "chords":   [ { "bar": 0, "name": "Am" } ],            // one per bar
  "audio": { "master": "audio/master.wav", "duration_s": 201.4, "peaks": [0.0, 0.12, ...] },
  "tracks": [ Track ]
}
```

`Track`:
```jsonc
{
  "id": "vocal", "name": "Vocal — Madam Snowflake", "kind": "audio",   // audio | instrument | drum | bus | return | master
  "color": "#d9a45b",
  "mixer": { "volume_db": 0.0, "pan": 0.0, "mute": false, "solo": false, "sends": { "hall": -12.0 } },
  "devices": [ Device ],
  "clips": [ { "id": "v1", "name": "Phrase 1", "start_bar": 8.0, "length_bars": 3.6, "color": null,
               "notes": null } ]       // notes: [{ "start_beat": 0.0, "length_beats": 1.0, "midi": 69, "velocity": 0.8 }] for MIDI clips
}
```

`Device` (a processor or instrument on a track, in chain order):
```jsonc
{ "id": "echo", "type": "delay", "name": "Tape echo", "enabled": true,
  "params": [ { "id": "feedback", "name": "Feedback", "value": 0.62, "min": 0, "max": 1, "unit": "",
                "display": "62 %" } ] }
```
**Clip contents (v0.1, so the arrangement reads like Ableton's):**
- Audio clips may carry `"peaks": [0.0 .. 1.0, …]` — the clip's own waveform, values evenly spread
  over the clip's length (about 24 per second). Draw it inside the clip.
- MIDI clips carry `"notes": [{ "start_beat", "length_beats", "midi", "velocity", "label"? }]`,
  beats relative to the clip start; draw them as a piano-roll preview inside the clip (pitch =
  vertical position, length = width, velocity = brightness). For `kind: "drum"` tracks `midi` is a
  lane number and `label` the drum name ("deep", "snare", …): draw one row per lane.
- Clips may be dense: one per vocal piece (about 70 on the vocal tracks), one per bar for the
  zither. The view must fit the whole song on screen and stay readable when zoomed in.

Device `type` is free text for display (eq, compressor, delay, reverb, filter, sampler, synth,
shimmer, freeze, chorus, utility, limiter, …); the UI picks an icon by type, falling back to a
generic one.

**Addressing:** every parameter has a path
`tracks.<track_id>.devices.<device_id>.params.<param_id>`; mixer controls are
`tracks.<track_id>.mixer.volume_db | pan | mute | solo | sends.<return_id>`; song-level fields are
`bpm`, `key`. Paths are what events and commands use.

## 4. Event (one line of `events.jsonl`, and what the WebSocket pushes)

```jsonc
{
  "seq": 42,                                    // 1, 2, 3, … no gaps
  "ts": "2026-09-30T19:41:07Z",                 // RFC 3339 UTC
  "agent": "claude",                            // who did it
  "verb": "param.set",                          // see verbs
  "target": "tracks.zither.devices.echo.params.feedback",
  "from": 0.5, "to": 0.62,                      // any JSON; null when not applicable
  "reason": "the echoes died too fast to hear the wow",   // required, non-empty
  "evidence": { "metric": "echo_tail_s", "before": 0.8, "after": 1.6 },  // optional, any JSON
  "version": "3.0"                              // optional: song version this belongs to
}
```

Verbs (v0): `param.set`, `mixer.set`, `device.add`, `device.remove`, `device.enable`,
`track.add`, `track.remove`, `track.rename`, `clip.add`, `clip.move`, `clip.remove`,
`section.set`, `chord.set`, `song.set` (bpm/key), `render.done` (to: audio path + duration),
`note` (free comment from the agent; target may be null), `version.tag` (to: version string,
reason: the changelog title).

Applying an event to a project is a pure function `apply(project, event) -> project` that both
sides implement identically for `param.set`, `mixer.set`, `song.set`, `device.enable`,
`track.rename`, `clip.move`, `render.done` (the rest may be backend-only in v0; the frontend can
re-fetch `project.json`).

## 5. HTTP API (JSON, base `http://127.0.0.1:8787`)

| Method | Path | Result |
|---|---|---|
| GET | `/api/health` | `{ "ok": true, "version": "<crate version>" }` |
| GET | `/api/projects` | `[ { "id", "title", "bpm", "key", "version", "length_bars" } ]` |
| GET | `/api/projects/{id}` | `Project` (current) |
| GET | `/api/projects/{id}/state?at=<seq>` | `Project` as it was right after event `seq`: start from the current `project.json` and **un-apply** later events newest-first using their `from` values (verbs whose effect can't be undone that way are skipped) |
| GET | `/api/projects/{id}/events?since=<seq>&limit=<n>` | `[Event]`, seq > since, ascending, default limit 500 |
| GET | `/api/projects/{id}/history` | `history.json` or `{ "changelog": [], "commits": [], "branch": null }` |
| GET | `/api/projects/{id}/audio/{file}` | the audio file; **must support HTTP Range** (seeking); no path traversal |
| POST | `/api/projects/{id}/commands` | apply a command → `201 { "event": Event, "version": n }` |
| GET (WS) | `/api/projects/{id}/live` | WebSocket, see §6 |

Command body (POST): `{ "agent": "claude", "verb": "param.set", "target": "...", "value": 0.62,
"reason": "...", "evidence": {...} }`. Header `Authorization: Bearer <AIWAVES_TOKEN>` (env var on
the server; if unset, the server generates one at start and prints it). Errors:
`400 { "error": "..." }` (unknown verb / target / value out of range / empty reason),
`401` (token), `404` (project). Values outside a param's min/max are rejected, not clamped.

## 6. WebSocket `/api/projects/{id}/live`

On connect the server sends `{ "type": "hello", "project": Project, "last_seq": n }`, then
`{ "type": "event", "event": Event }` for every applied event, and `{ "type": "ping" }` every 20 s.
Messages from clients are ignored. Clients reconnect and catch up with `GET /events?since=`.

## 7. CLI (`aiwaves`, same binary as the server)

```
aiwaves serve [--data DIR] [--bind 127.0.0.1:8787] [--static FRONTEND_DIST_DIR]
aiwaves projects                                  # list (JSON)
aiwaves show <project>                            # project.json (JSON)
aiwaves events <project> [--since N]              # events (JSON lines)
aiwaves set <project> <target> <value> --reason "…" [--agent NAME] [--evidence JSON]
aiwaves do <project> <verb> [<target>] [--value JSON] --reason "…"   # any verb
aiwaves import-events <project> <file.jsonl>      # replay a recorded build (for demos), with --delay-ms
```
Global: `--server URL` (default `http://127.0.0.1:8787`), `--token` (default `$AIWAVES_TOKEN`).
Output is JSON on stdout, errors as `{ "error": … }` on stderr with a non-zero exit code.

## 8. Frontend (read-only workspace)

Views (Ableton-like, dark): transport bar (play / pause / stop / seek the master audio, bar.beat,
BPM, key) · arrangement (section ruler, chord lane, track lanes with clips, playhead) · mixer
(channel strips: fader, pan knob, meter, mute/solo lights) · device chain of the selected track
(knobs) · activity feed (live events: agent, verb, target, from → to, reason) · replay scrubber
(move through event seq; the views show the state at that seq) · side panel (changelog + git).

**Animated mapping:** when an event arrives, the exact control it targets animates from `from` to
`to` over ~400 ms, glows, and shows the reason as a caption for a few seconds; the activity feed
highlights the same event; clicking a feed item selects and reveals the control.

Viewers can play/seek audio, select tracks, scroll/zoom, and scrub the replay — all local view
state. Nothing in the UI sends commands.
