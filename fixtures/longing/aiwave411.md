# aiwave411: Longing

> The handoff for agents working on this song (like a CLAUDE.md). Read it before you change
> anything; keep it current with `aiwaves 411 append` / `aiwaves 411 set`. Every update shows up
> live in the AIWaves workspace, and Eli watches the work there.

## What this is

**Longing**: psychedelic world bass in the Tipper / Shpongle / OTT / CloZee family, built around
Madam Snowflake's a cappella "Longing" (ccMixter, **CC BY 3.0**: credit her). 80 BPM (her tempo),
A minor (her chords, tracked from her piano), 65 bars, about 3:21.
Current version: **v5.3**, builds that rise into the drops.

## Who decides

Eli handed over every musical decision ("you make all the decisions"). He steers by saying
**"enhance"**: each time, pick the weakest thing (measure first), fix it, render, show him.
His suggestions are suggestions; your judgement is final.

## Form

| Section | Bars | What happens |
|---|---|---|
| intro | 0–8 | space: her frozen first note, her reversed ending, a drone |
| verse | 8–25 | her lines, cut into breathing pieces; zither answers; strings, choir |
| drop | 25–41 | her chop hook + zither, talking bass, tribal kit, handpan |
| verse 2 | 41–49 | doubled with her other take |
| drop 2 | 49–57 | the climax: her peak line, harmonised chops |
| outro | 57–65 | back to space |

A stop (1.5 beats of silence) and a 3-bar build sit before each drop (bars 22–24 and 46–48).

## How it is made

- **Renderer:** `music/scripts/make_longing_song.py` (numpy/scipy; ~2 min). Stems:
  `LONGING_STEMS=1`. Output `music/samples/vocals_new/longing/longing_song.wav`.
- **Her voice:** `make_von_braun_song.longing_voice` (Eli loves this chain: keep it).
- **Talking bass:** `music/scripts/tipper_bass.py`: Surge XT played in 5.8 ms blocks, the
  filter and wavefolder set between blocks (gestures: wow, yoy, stab, rise, fall, growl).
- **Sound design:** Surge XT through `aiwaves/engines/surge` (braam, impacts, whooshes, shards).
- **To AIWaves:** `python music/scripts/export_aiwaves_longing.py` sends new versions to the
  running app as live commands and refreshes `aiwaves/fixtures/longing`.
- **Live while you work:** send each step as you take it (`music/scripts/aiwaves_live.py` or the
  `aiwaves` CLI; both find the app through `%APPDATA%\AIWaves\server.json`), with a reason, and
  evidence when you measured something.
- **Changelog:** `music/samples/vocals_new/longing/CHANGELOG.md`, one entry per version. Branch
  `wip/longing` in the music repo.

## Rules that must hold

- Vocals: hers (CC BY 3.0) and public-domain sources only; nothing religious.
- No uncut singing: her lines are cut into breathing pieces (alien and spiritual).
- Lead instrument: dan tranh zither (flute and harp were rejected). Glitches stay subtle.
- Clean mono sub; the mid-bass is mono below 400 Hz.
- Her voice stays on top: measure the masking when you add anything in 250 Hz–4 kHz.
- Master about -14 LUFS, true peak -1 dBTP.
- Playback goes to the default output (Eli listens over Chrome Remote Desktop).
- Ask before downloads (name, source, size); never delete files permanently.

## What was measured (don't re-derive)

- v5.2: the drops' mid-bass was missing between 300 Hz and 2.5 kHz (her chops were 26–36 dB over
  it); with the talking bass, 10–16 dB. Her margin stayed within 0.6 dB.
- v5.3: the bars before each drop sagged (drop 1: -19.1, -17.3, -18.8 LUFS). With the builds:
  -18.2, -14.9, -14.7 into the drop at -11.8. The 1.5 LU breath after her last word is left in on purpose.
- Surge's FM2 oscillator ignores its controls through the plugin host: use saws + fold + filter.

## Where it stands, what is next

- Candidates for the next "enhance": verse 2 is thin (her voice + sub + strings; the zither is
  silent there); the drops are no wider than the verses (0.36 vs 0.38 side/mid); the outro.
- Measure first, then pick one; say what was wrong in numbers.

## Log

- 2026-10-01: written from the song's state at v5.3 (talking bass, builds, live AIWaves workflow).
