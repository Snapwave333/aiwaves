# AIWaves workspace (frontend)

The read-only, Ableton-like web workspace from `docs/CONTRACT.md` §8. Agents change the song only
through the backend's API/CLI. This app shows every change as it happens, and it never sends
anything back.

Angular 22 with standalone components, signals, OnPush and no zone.js. Tests use Vitest with jsdom.

## Run

```sh
cd frontend
npm install
npm start                 # copies the demo fixture, then ng serve on http://localhost:4200
```

**Against the backend.** Start it first (`cd backend && cargo run -- serve --data ../data`; see
`backend/README.md`), then `npm start`. The dev server proxies `/api`, including the WebSocket,
to `http://127.0.0.1:8787` (see `proxy.conf.json`), so CORS isn't needed. The transport shows a
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
```

## Layout

- **Transport (top):** play/pause/stop, bar.beat.sixteenth, time, BPM, time signature, key, the
  section and chord at the playhead, the song version, and the connection state.
- **Arrangement (centre):** a ruler with section locators and bar numbers, the chord lane, the
  master waveform from `audio.peaks` (pinned under the ruler), and a lane per track. Clips show
  their contents like Live's arrangement (see below). A playhead follows the audio. Click the ruler
  or the waveform to seek.
- **Right column:** the activity feed, with Changelog / Git tabs below it.
- **Replay bar:** "Replay the build", step buttons, a scrubber over event seq with version marks,
  and "Go to now".
- **Bottom:** the mixer (fader in dB with a meter, pan knob, M/S lights, sends) and the device chain
  of the selected track (an SVG knob for every param).

Below 1000 px wide the panels stack vertically. Keys: **Space** plays/pauses, **← / →** step the
replay one event.

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
   `tracks.drums.mixer.volume_db`. The transport fields use `bpm`, `key` and `version`, and the
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
   control (`note`, a removed track) float under the transport. Captions are also announced
   through an `aria-live` region.
5. The activity feed highlights `animator.highlightSeq()` and scrolls to it. Clicking a feed item
   calls `store.reveal()`: select the track, glow and caption the control, and scroll it into
   view, without moving any value.

The state the whole UI shows is `stateAt(currentProject, events, seq)`, a pure apply/unapply
(`core/apply.ts`, mirrored from the contract verbs). The replay therefore changes only local view
state. Contract gaps and the choices made for them are in `CONTRACT_NOTES.md`.
