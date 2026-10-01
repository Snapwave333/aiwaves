# AIWaves workspace (frontend)

The read-only, Ableton-like web workspace from `docs/CONTRACT.md` §8. Agents change the song only
through the backend's API/CLI. This app shows every change as it happens, and it never sends
anything back.

Angular 22 with standalone components, signals, OnPush and no zone.js; Angular Material (M3) with
Space Grotesk, Inter, JetBrains Mono and Material Symbols. Tests use Vitest with jsdom.

## Run

```sh
cd frontend
npm install
npm start                 # copies the demo fixture, then ng serve on http://localhost:4200
```

**Against the backend.** Start it first (`cd backend && cargo run -- serve --data ../data`; see
`backend/README.md`), then `npm start`. The dev server proxies `/api`, including the WebSocket,
to `http://127.0.0.1:8787` (see `proxy.conf.json`), so CORS isn't needed. The app bar shows a
green **LIVE**.

To serve a build from the backend at the same origin:

```sh
npm run build                       # dist/frontend/browser (the demo audio is left out)
cargo run -- serve --data ../data --static ../frontend/dist/frontend/browser
```

**Mock / demo mode.** If `GET /api/health` fails, the app loads the "Longing" fixture from
`public/demo/longing/` and shows a **Demo data** banner. `npm start` and `npm run build` copy it
there from `../fixtures/longing/` (`npm run fixtures` does it alone). `npx ng serve` and
`npx ng build` skip those npm hooks, so run `npm run fixtures` first, or the demo shows whatever
copy is already in `public/`. The unit tests read `../fixtures/longing/` directly. The demo audio
(`fixtures/longing/audio/master.wav`, not in git) is copied too when it exists. While in demo mode
the app checks the backend every 15 s and switches to live once it answers.

URL options: `?mock=1` forces demo data, `?api=http://127.0.0.1:8787` sets a backend base
(cross-origin), `?project=<id>` picks a project, and `?audio=<url>` sets the demo-mode audio.

## Checks

```sh
npx ng build                        # production build
npx ng test --watch=false           # unit tests, headless (Vitest + jsdom)
npx prettier --check "src/**/*.{ts,html,scss}"
python scripts/subset-icons.py      # after adding an icon (needs fonttools + brotli)
```

Icons are a subset of Material Symbols (rounded): `src/styles/fonts/material-symbols-rounded-subset.woff2`
holds only the ligatures used in `src/app` (8 KB instead of the package's 5.4 MB). A new
`<mat-icon>name</mat-icon>` shows as plain text until the script has been re-run.

## Layout

- **App bar (top):** logo, song title and artist, the connection state (LIVE / DEMO /
  RECONNECTING / CONNECTING) and the side-sheet toggle. Its bottom edge is a light bar that
  sweeps whenever an agent change is presented; a progress bar runs there while connecting. In the
  desktop app (user agent contains `Electron`) it is the window's title bar: exactly 40 px tall,
  `#07090d`, draggable, with 144 px kept free on the right for the overlaid window controls.
- **Player (top of the stage):** see below.
- **Arrangement (centre, the main stage):** a ruler with section locators and bar numbers, the chord lane, the
  master waveform from `audio.peaks` (pinned under the ruler), and a lane per track. Clips show
  their contents like Live's arrangement (see below). A playhead follows the audio. Click the ruler
  or the waveform to seek.
- **Side sheet (right, collapsible):** the activity feed, with Changelog / Git tabs below it.
- **Replay bar:** "Replay the build", step buttons, a scrubber over event seq with version marks
  (labels that would collide become ticks; the tooltip keeps them), and "Go to now".
- **Bottom panel:** the mixer (fader in dB with a meter, pan knob, M/S lights, sends) and the
  device chain of the selected track (an SVG knob for every param, an icon per device type).

The side sheet and the bottom panel load just after the first paint (`@defer (on idle)`).
Below 1000 px wide the panels stack vertically. Keys: **Space** plays/pauses, **M** mutes,
**← / →** step the replay one event.

## The player

Ported from CarbonCast IPTV / IPTVnator's audio player (MIT, see `THIRD_PARTY_NOTICES.md`) and
re-themed. It drives the app's one audio element (`AudioService`): back to the start, play /
pause, stop, seek, volume and mute. Next to it are the readouts: bar.beat, BPM, key, time
signature, section, chord, version and time (BPM, key and version carry `data-path`, so they
animate and glow like any other control).

- **State machine** (`core/player-state.ts`): idle, loading, ready, playing, buffering, paused,
  ended, error. A **playthrough** starts when play begins at the start (< 0.5 s) or after the song
  ended; seeking into the middle after the end doesn't count.
- **Spectrum ring:** a hexagon around the cover art with one bar per log-spaced band (mirrored)
  and an oscilloscope trace, drawn on a canvas from the WebAudio `AnalyserNode`. Cross-origin
  audio has no analyser, so the ring then shows the master peaks around the playhead. The status
  badge's equalizer follows the same bands, and the art glows with the level.
- **Per-frame work** runs in one `requestAnimationFrame` loop (`AudioService.onFrame`) and writes
  to the canvas / DOM directly, so a playing song costs no change detection for these visuals. The
  loop stops when playback stops. The arrangement's playheads and every track meter are moved
  the same way (`ui/live-style.directives.ts`), so the arrangement and mixer templates re-render
  only when something discrete changes (a clip starts or ends, a bar, a section), not every
  frame.

## Cover art (CONTRACT section 10)

Every playthrough asks `POST /api/projects/{id}/covers` and the answer fades and morphs in over
the old cover (and, blurred, behind the whole player). The bookmark on the art saves it
(`POST …/covers/{name}/save`) or unsaves it (`DELETE …/covers/saved`); a saved cover is the answer
to every playthrough. Before the first playthrough the player shows the saved cover, else the
newest (`GET …/covers`). In demo mode, or when the cover engine doesn't answer (an older backend,
a 503), the art is drawn locally from the project (`player/cover-art.ts`: its track colours, one
orbit per section, chord ticks, the waveform round a hexagon, a seeded nebula); saving then keeps
the seed in `localStorage`. These cover routes are the only requests the workspace sends that
aren't reads.

**Dynamic colour:** when a cover appears, its dominant colour (`player/extract-color.ts`, from the
same port) becomes the M3 primary colour of the whole UI. `core/dynamic-color.ts` keeps its hue
but lifts it until it has at least 6:1 contrast on every surface (AA with headroom), and falls
back to the cover's palette when the art is mostly grey. The colours are registered with
`@property`, so the UI glides to the new accent over 0.9 s.

## Theme

`src/styles/_tokens.scss` builds the M3 theme with Angular Material's Sass API (dark, primary
#00e5ff, tertiary #b14dff, gunmetal surfaces) and defines the workspace tokens: a 4 / 8 px spacing
scale (`--sp-*`), type (`--aw-font-display|body|mono`, `--aw-fs-*`), surfaces, text, AlienFX
accents and the agent-change colour (`--aw-signal`, magenta). `_mixins.scss` has the chamfered
corners, the light strip along panel tops and the hexagon. Each view has its own partial; no
component or partial uses a raw colour or size outside the tokens. Animations stop under
`prefers-reduced-motion`.

## The arrangement

- **Whole song by default.** The view opens fitted to the whole song (all 65 bars of "Longing" at
  1280 px wide) and keeps fitting as the window resizes, until you zoom. **Ctrl/Cmd + wheel**
  zooms smoothly around the mouse (the bar under it stays put), **− / +** zoom around the centre,
  **Fit** glides back to the whole song. Shift + wheel or the scrollbar scrolls sideways. The ruler
  thins its bar numbers out as you zoom out and the grid adds beat lines as you zoom in.
- **Clip contents** (contract §3, v0.1). Clip colour is the track colour: a name bar in that
  colour over a darker body. Audio clips with `peaks` draw a filled, symmetric waveform. Each track
  gets one display gain so its loudest clip nearly fills the lane (at most 4×); clips keep their
  relative loudness. MIDI clips draw a piano roll: pitch is the row (auto range per clip, at least
  an octave), length is the width, velocity is the brightness. Drum tracks (`kind: "drum"`) draw
  one row per lane (`midi` = lane, `label` = drum name). The rows come from all the track's clips,
  so they line up from clip to clip, and the drum names show at each clip's left edge once the rows
  are tall enough. Clips narrower than 40 px hide their name; the tooltip always has it.
- **Lane heights.** Drag a track's bottom edge (or focus it and use ↑ / ↓) to resize it, and
  double-click it to reset. Defaults depend on the track kind: audio 46 px, instrument 52 px,
  drum 72 px.
- **Performance.** Clip boxes are DOM elements (about 130, so they can carry `data-path`, glow
  and tooltips). Their contents are drawn on **one canvas per lane**, never a node per note. The
  canvas covers the viewport plus one viewport of margin on each side, snapped to viewport-sized
  tiles (`laneWindow`). Scrolling within a tile moves pixels that are already drawn. Crossing a
  tile, or zooming, redraws every lane, which takes about 6 ms with ~3,100 notes on screen. Canvas
  memory doesn't grow with zoom. The geometry (note → rect, peaks → polygon, drum lanes, zoom
  steps, the lane window) is pure code in `views/clip-render.ts` with unit tests.
- `clip.move` slides the clip box and its drawn contents together (both read `Animator.value` at
  the clip's path). `clip.add` makes the box glow and pins its caption.

## How the animated mapping works

1. Every control that can be changed carries `data-path` set to its contract path. For example,
   a knob uses `tracks.zither.devices.echo.params.feedback` and a fader uses
   `tracks.drums.mixer.volume_db`. The player's readouts use `bpm`, `key` and `version`, and the
   waveform uses `audio`. `controlPath(event)` in `core/apply.ts` maps an event to that path.
2. When an event is **presented** (it arrives live while you're at "now", or the replay crosses it
   one step at a time), `WorkspaceStore.present()` does three things:
   - selects the event's track, so a device on another track comes into view;
   - calls `Animator.trigger(event, direction)`;
   - scrolls the control into view.
3. `Animator` keeps one active animation per path, with `from`, `to` and a start time. Stepping
   backwards swaps `from` and `to`. While something is animating, a `requestAnimationFrame` loop
   advances a `now` signal. Controls ask `animator.value(path, actual)`, which tweens from `from`
   to `to` over 400 ms with ease-in-out-cubic and then returns the real value. Controls also ask
   `animator.glow(path)`, which stays true for 1.6 s and adds the `.glow` class. Only controls that
   are animating read `now`, so the rest of the UI doesn't re-render per frame.
4. `CaptionOverlayComponent` reads `animator.captions()` (up to 3, each for 4 s). It pins each
   caption (verb, target, from → to, reason) next to the element with that `data-path`, in a fixed
   layer so scroll containers can't clip it. Overlapping captions are pushed apart. Events with no
   control (`note`, a removed track) float under the app bar. Captions are also announced
   through an `aria-live` region.
   While a control glows, the light strip on top of its panel breathes, and every presented event
   sweeps the app bar's light bar once (Web Animations, no change detection).
5. The activity feed highlights `animator.highlightSeq()` and scrolls to it. Clicking a feed item
   calls `store.reveal()`: select the track, glow and caption the control, and scroll it into
   view, without moving any value.

The state the whole UI shows is `stateAt(currentProject, events, seq)`, a pure apply/unapply
(`core/apply.ts`, mirrored from the contract verbs). The replay therefore changes only local view
state. Contract gaps and the choices made for them are in `CONTRACT_NOTES.md`.
