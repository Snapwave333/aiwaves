# Third-party notices

The AIWaves workspace includes code adapted from the projects below. Their licences and
copyright notices are reproduced here.

## IPTVnator / CarbonCast IPTV: the audio player

`src/app/player/player.component.ts`, `src/app/player/extract-color.ts` and
`src/styles/_player.scss` are adapted from the audio player of CarbonCast IPTV
(`libs/ui/playback/src/lib/audio-player/`), an independent fork of
[IPTVnator](https://github.com/4gray/iptvnator) by [@4gray](https://github.com/4gray) and
contributors. AIWaves removed its NgRx store, ngx-translate and channel dependencies, drives it from
the app's own audio service, and re-themed it. This credit does not imply endorsement by the
upstream maintainers.

The player's GLSL visualizer, `src/app/player/visualizer/` (except `audio-energy.ts`, which is
new), is adapted from CarbonCast IPTV's radio player
(`libs/portal/radio/feature/src/lib/radio-visualizer/`): the metaball shader, its trail buffer,
the renderer and the orb choreography. AIWaves drives it from the song's real spectrum instead of a
synthesised one and colours it from its own palette. Same licence as above.

```
Copyright 2020-2021

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Fonts and icons (npm packages)

- **Space Grotesk, Inter, JetBrains Mono** (`@fontsource-variable/*`): SIL Open Font License 1.1.
- **Material Symbols** (`material-symbols`): Apache License 2.0, Google.

Each package ships its licence in `node_modules/<package>/LICENSE`.
