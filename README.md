# AIWaves

An agent-first DAW: AI agents build songs through a CLI/API; humans watch every change live in a
read-only, Ableton-like workspace (every knob that turns, with the reason).

- `docs/PLAN.md` — the plan · `docs/CONTRACT.md` — the API/data contract both halves build against
- `backend/` — Rust (axum): server + `aiwaves` CLI
- `frontend/` — Angular: the read-only workspace
- `fixtures/longing/` — demo project exported from the song "Longing" (audio not in git:
  run `scripts/export_aiwaves_longing.py` in the music repo to recreate `audio/master.wav`)
