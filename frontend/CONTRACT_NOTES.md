# Contract notes (frontend)

Where `docs/CONTRACT.md` is silent or the fixture disagrees with it, this is what the workspace does.
The contract itself is unchanged. These match the choices in `backend/CONTRACT_NOTES.md`.

## Value shapes `apply` accepts

- **`render.done`**: the contract says `to` is "audio path + duration", but the fixture sends
  `{"audio": "audio/master.wav"}` with no duration. The frontend takes a path string or an object
  with `audio` (or `master`), and optional `duration_s` and `peaks`. Un-applying it with a `null`
  `from` changes nothing.
- **`clip.move`**: `to` is the new `start_bar` (a number), as the backend does it. An object
  `{start_bar?, length_bars?}` also works.
- **`device.enable`**: the target can be `tracks.T.devices.D` or `tracks.T.devices.D.enabled`.
- **Values of the wrong type** (a number for `mute`, say) leave the project unchanged. Only
  `version` moves.

## `display` after a change

The contract doesn't say what happens to a param's `display` string when its value changes. Like
the backend, `apply` and `unapply` regenerate it as `"<value> <unit>"`, or just the value when the
unit is empty. Hand-written labels such as `"83 %"` or `"dotted 1/8"` therefore show only at the
current state; once you scrub past the event that set them, they become `"0.76"`. Suggestion: the
contract could say a param's `display` is a pure function of `value` and `unit`.

## Replay state is computed locally

The scrubber doesn't call `GET /state?at=`. It starts from the current project and un-applies
later events (or applies newer ones) with the TypeScript `stateAt`. That avoids a round trip per
step, and it works the same in demo mode.

For the verbs both sides mirror, the result is the same. Where it differs:

- **Removals:** the backend restores a bare track when it un-applies a removal (the fixture's
  `track.remove tracks.flute` at seq 26). The frontend doesn't reconstruct removed objects, so the
  flute never appears.
- **Additions:** tracks, devices and clips whose `*.add` event comes after the replay position are
  drawn as faded **ghosts**, not hidden. The fixture's add events carry only a name, so there is
  nothing better to show.
- **Out-of-range values:** the fixture has some `from` values below the param's `min` (seq 22 and
  39: `period` from `0`, min `0.5`). The knob clamps its arc and shows the raw value as text.

## Live feed

- Events with verbs the frontend doesn't apply (`track.add`, `section.set` and so on) bump
  `version` and trigger a re-fetch of `GET /projects/{id}`, as §4 allows.
- `hello` replaces the local project only when its `version` is at least the one already held, so
  a slow hello can't roll back events that came in meanwhile. If `hello.last_seq` is ahead, the
  missed events are fetched with `GET /events?since=`. The same happens when an `event` arrives
  with a gap in `seq`.
- Live or demo is decided by `GET /api/health` (1.5 s timeout). In demo mode the check repeats
  every 15 s, and the workspace switches to live by itself.

## Audio

- `audio.master` is relative to the project folder (`"audio/master.wav"`), so the player requests
  `/api/projects/{id}/{audio.master}`, which is `/audio/{file}`. A subfolder under `audio/` would
  fail: the backend rejects those.
- The URL gets `?v=<seq of the last render.done>` so a new render isn't served from cache.
- The master meter uses a WebAudio `AnalyserNode` only for **same-origin** audio. Cross-origin
  audio without CORS would play silently through WebAudio. For other origins (for example
  `?audio=` pointing elsewhere), the meter falls back to `audio.peaks` at the playhead.
- Track meters aren't measured, because there are no stems. A track shows the master level, scaled
  by its fader, while one of its clips is under the playhead and it isn't muted or soloed out.

## Cover art (section 10)

- The image URL is built from the cover's `name` (checked against
  `^cover-[0-9a-z-]{1,64}\.png$`) and the encoded project id, not taken from `url`. A cover with
  any other name is ignored.
- `POST /covers` waits up to 35 s (the server gives up after 30). Any failure (network, 404 from a
  backend without covers, 503, a malformed answer) shows local art with a "Local cover art" note;
  the next playthrough asks the server again.
- When several requests overlap (play, stop, play), only the latest one's answer is shown.
- Local art is "saved" per project in `localStorage` (`aiwaves.cover.saved.<id>`); the server's
  saved cover always wins in live mode.

## Untrusted data

- Events (live or from `/events`) that aren't well-formed (positive integer `seq`, string `verb`,
  `agent`, `ts`, `reason`, string-or-null `target`) are dropped. A `hello` whose project lacks an
  id, a positive bpm, tracks or audio is ignored. One bad line in `events.jsonl` drops that line.
- Track and clip colours are reduced to `#rgb` / `#rrggbb` before they reach style bindings.
- `audio.master` is encoded segment by segment; `..` or empty segments mean no audio.
- The WebSocket is treated as dead after 50 s without any message (the server pings every 20 s)
  and reconnects with the same capped backoff (1 s doubling to 10 s).

## CORS

The backend allows `http://localhost:4200` only. The default setup doesn't need CORS: `ng serve`
proxies `/api` (including the WebSocket), and `aiwaves serve --static` serves the app from the
same origin. `?api=http://127.0.0.1:8787` (cross-origin) works only from `localhost:4200`.
