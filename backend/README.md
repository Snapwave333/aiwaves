# AIWaves backend

Rust crate `aiwaves`: one binary that is both the server (HTTP + WebSocket, CONTRACT §5–6) and the
CLI agents use (§7). The library holds the project model and the pure `apply` / `unapply` /
`state_at` functions.

## Run the server

```sh
cd backend
cargo run -- serve --data ../fixtures
# optional: --bind 127.0.0.1:8787 (default)  --static ../frontend/dist/<app>/browser
```

- `--data` holds one folder per project (`project.json` + `events.jsonl`, optional `audio/`,
  `history.json`). The Longing fixture shows up as project `longing`.
- **Serving `../fixtures` mutates those files** on every command (`events.jsonl` grows,
  `project.json` is rewritten). For experiments, work on a copy:
  `cp -r ../fixtures ../data && cargo run -- serve --data ../data`.
- Commands need a token. Set `AIWAVES_TOKEN` before starting the server; if it is unset, the
  server generates one and prints `AIWAVES_TOKEN=…` to stderr. CLI clients read the same variable
  (or `--token`).
- CORS allows the Angular dev server (`http://localhost:4200`). With `--static`, the built frontend
  is served at `/`, and unknown non-API paths get its `index.html`.
- The audio player streams `GET /api/projects/longing/audio/master.wav` (HTTP Range supported).
  `master.wav` is not in git; recreate it with `scripts/export_aiwaves_longing.py` in the music repo.

## CLI

Every subcommand except `serve` talks to a running server (`--server`, default
`http://127.0.0.1:8787`, or `$AIWAVES_SERVER`). Output is JSON on stdout; errors are
`{"error": …}` on stderr with a non-zero exit code.

```
aiwaves projects
aiwaves show <project>
aiwaves events <project> [--since N]                       # JSON lines
aiwaves set <project> <target> <value> --reason "…" [--agent NAME] [--evidence JSON]
aiwaves do <project> <verb> [<target>] [--value JSON] --reason "…"
aiwaves import-events <project> <file.jsonl> [--delay-ms N] [--snapshot project.json]
```

`<value>` / `--value` are parsed as JSON when they parse, else taken as a string (`0.7` is a
number, `true` a bool, `A minor` a string). `set` infers the verb from the target
(param → `param.set`, mixer → `mixer.set`, `bpm`/`key` → `song.set`).

Examples against the Longing fixture (server running, `AIWAVES_TOKEN` set in this shell too):

```sh
# Longer echo tail on the zither (param.set; must stay within the param's 0..1)
cargo run -q -- set longing tracks.zither.devices.echo.params.feedback 0.7 \
  --reason "the echoes died too fast to hear the wow" --agent claude \
  --evidence '{"metric":"echo_tail_s","before":1.6,"after":2.3}'

# Pull the drums back (mixer.set; negative numbers are fine as values)
cargo run -q -- set longing tracks.drums.mixer.volume_db -4.5 --reason "drums mask her consonants in drop 2"

# Bypass a device with `do` (any verb), then see what happened since seq 42
cargo run -q -- do longing device.enable tracks.vocal.devices.stutter --value false --reason "stutter fights the doubles"
cargo run -q -- events longing --since 42
```

A rejected command changes nothing, e.g. `set longing tracks.zither.devices.echo.params.feedback 1.7 …`
prints `{"error":"…value 1.7 is outside [0, 1]","status":400}` and exits 1.
Value shapes for every verb are listed in `CONTRACT_NOTES.md`.

## Demo replay (watch the song being built)

`import-events` posts each line of a recorded `events.jsonl` as a command (agent, verb, target,
`to` as value, reason, evidence), pausing `--delay-ms` between them, so the workspace animates the
whole build. The server assigns fresh seqs and timestamps.

The replay must start from the state *before* the first event, and the fixture's add events carry
only names, so `--snapshot` supplies full tracks/devices/clips from the final project:

```sh
cp -r ../fixtures ../demo                                   # never replay into the fixtures
cargo run -- serve --data ../demo                           # terminal 1
curl -s "http://127.0.0.1:8787/api/projects/longing/state?at=0" -o ../zero.json   # terminal 2
# stop the server, then reset the copy to seq 0:
mv ../zero.json ../demo/longing/project.json && : > ../demo/longing/events.jsonl
cargo run -- serve --data ../demo                           # terminal 1 again; open the frontend
cargo run -q -- import-events longing ../fixtures/longing/events.jsonl \
  --snapshot ../fixtures/longing/project.json --delay-ms 1500
```

PowerShell equivalents: `Copy-Item -Recurse ..\fixtures ..\demo`, `curl.exe -s … -o ..\zero.json`,
`Move-Item -Force ..\zero.json ..\demo\longing\project.json`, `Clear-Content ..\demo\longing\events.jsonl`.

Import stops at the first rejected event and reports it (`imported_seq` in the error).

## Tests

```sh
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Unit tests (`src/apply_tests.rs`) cover apply, validation, un-apply, `state_at` and a full replay of
the fixture log. Integration tests (`tests/api.rs`) run a real server on a temp copy of
`fixtures/longing` (with a small dummy `audio/master.wav`) and drive it over HTTP, WebSocket and the
CLI binary. The real fixtures are never modified.
