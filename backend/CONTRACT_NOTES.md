# Contract notes (backend)

Where `docs/CONTRACT.md` leaves something open, or the fixture disagrees with it, this is what the
backend does. The contract itself is unchanged.

## Choices where the contract is silent

| Verb | `target` | `value` (→ event `to`) | `from` recorded |
|---|---|---|---|
| `param.set` | `tracks.T.devices.D.params.P` | number within `[min, max]` (inclusive) | old value |
| `mixer.set` | `tracks.T.mixer.volume_db\|pan\|mute\|solo\|sends.R` | number / bool | old value (`null` for a new send) |
| `song.set` | `bpm` \| `key` | number / non-empty string | old value |
| `device.enable` | `tracks.T.devices.D` | bool | old bool |
| `track.rename` | `tracks.T` | non-empty string | old name |
| `clip.move` | `tracks.T.clips.C` | new `start_bar` (number ≥ 0) | old `start_bar` |
| `render.done` | ignored (`null`) | `{"audio": path, "duration_s"?: n, "peaks"?: [..]}` or a path string | `{"audio", "duration_s"}` before |
| `track.add` / `device.add` / `clip.add` | the new object's path | a name string, or a (partial) object; optional `"index"` = insert position | `null` |
| `track.remove` / `device.remove` / `clip.remove` | the object's path | ignored | the whole object plus `"index"` |
| `section.set` | `sections.<name>` | `{"start_bar", "end_bar"}` (end > start), or `null` to delete | old section or `null` |
| `chord.set` | `chords.<bar>` | chord name, or `null` to delete | old name or `null` |
| `version.tag` | ignored | version string | previous version string or `null` |
| `note` | anything / `null` | anything | `null` |

- **Ranges without a min/max in the file:** `volume_db` and sends `[-96, 6]` dB, `pan` `[-1, 1]`,
  `bpm` `[20, 999]`. Out of range is a 400, never clamped.
- **Sends:** `sends.R` is accepted if the track already has a send `R` or a track `R` of kind
  `return` exists; otherwise 400 (unknown target).
- **New tracks** without `"index"` go before the first `master` track (else at the end); new
  devices/clips are appended.
- **`display` is regenerated** when a param changes (by apply or un-apply): `"<value> <unit>"`, or just
  the value when the unit is empty — this matches the fixture's style (`"0.62"`, `"2 bars"`) but
  not hand-written labels like `"83 %"` or `"dotted 1/8"`. The frontend's `apply` should do the same
  or format values itself.
- **Event `version`** (song version) is filled from the latest `version.tag` in the log.
- **Event `agent`** defaults to `"agent"` when a command omits it (the CLI sends `--agent`, default
  `$AIWAVES_AGENT` or `"agent"`).
- **`state?at=`**: `at` greater than the last seq is a 400; the returned project has `version = at`.
  Without `at` it returns the current project.
- **Un-apply of a name-only removal** (fixture seq 26: `track.remove tracks.flute`, `from: "Flute"`)
  restores a bare track with that name, so `state?at=25` shows the flute and a replay can remove it.
- **Persistence:** the event is appended to `events.jsonl` (flushed + synced) before `project.json`
  is rewritten (temp file + rename). If the rewrite fails, the event still counts; on the next load,
  events newer than `project.json`'s `version` are re-applied. `project.json` is written with
  2-space indentation and raw UTF-8, so the first command reformats the fixture's file (same data).
- **WebSocket:** a viewer more than 1024 events behind is disconnected; it reconnects and catches up
  with `GET /events?since=` (as §6 already says).
- **Audio:** `{file}` must be a plain file name inside `audio/` (no `/`, `\`, `..`, `:`, no leading
  `.`); invalid names are 400, missing files 404. No subfolders.
- **Unknown `/api/...` paths** are a JSON 404 (they never fall through to the SPA's `index.html`).
- HTTP JSON responses have alphabetically ordered keys; `events.jsonl` lines keep contract order.

## CLI additions (all optional, nothing removed)

- `import-events ... --snapshot <final project.json>`: see "the fixture log can't rebuild the
  project" below.
- `set` infers the verb from the target: params → `param.set`, mixer → `mixer.set`, `bpm`/`key` →
  `song.set`, a device path → `device.enable`, a track path → `track.rename`, a clip path →
  `clip.move`, `sections.*` → `section.set`, `chords.*` → `chord.set`.
- `--server` also reads `$AIWAVES_SERVER`; `--agent` reads `$AIWAVES_AGENT`.
- Usage errors are JSON on stderr too (exit code 2; other errors exit 1).

## Problems found in the fixture (`fixtures/longing/`)

1. **`project.json` disagrees with the log on one value.** Event 23 sets
   `tracks.drums.mixer.volume_db` from `0.0` to `-3.0`, but `project.json` has `0.0`. A replay of the
   log ends at `-3.0`. One of the two should be fixed.
2. **The log can't rebuild the project from empty.** `track.add` / `device.add` / `clip.add` events
   carry only a name in `to`, and many devices (e.g. `tracks.sub.devices.duck`) never have an add
   event, so replaying onto an empty project fails at seq 8. Workaround: `import-events --snapshot
   fixtures/longing/project.json` sends each add with the full object as it was right after that
   event (computed by un-applying the log from the final state). With it, the 42 events replay onto
   `state?at=0` and reproduce `project.json` (apart from item 1 and regenerated `display` strings).
3. Some `from` values are below the param's `min` (seq 22 and 39: `period` from `0`, min `0.5`) —
   presumably "off". Un-apply restores them without range checks, so `state?at=21` shows `0`.
