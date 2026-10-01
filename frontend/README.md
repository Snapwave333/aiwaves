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
there from `../fixtures/longing/` (`npm run fixtures` does it alone). The demo audio
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
- **Arrangement (centre):** section ruler, chord lane, the master waveform from `audio.peaks`, and a
  lane per track with coloured clips on a bar grid. A playhead follows the audio. Zoom with − / + /
  Fit or Ctrl+wheel. Click the ruler or the waveform to seek.
- **Right column:** the activity feed, with Changelog / Git tabs below it.
- **Replay bar:** "Replay the build", step buttons, a scrubber over event seq with version marks,
  and "Go to now".
- **Bottom:** the mixer (fader in dB with a meter, pan knob, M/S lights, sends) and the device chain
  of the selected track (an SVG knob for every param).

Below 1000 px wide the panels stack vertically. Keys: **Space** plays/pauses, **← / →** step the
replay one event.

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
