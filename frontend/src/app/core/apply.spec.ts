import { ev, longing, tiny } from '../testing/fixtures';
import {
  apply,
  controlPath,
  formatRounded,
  formatValue,
  mergeEvents,
  pendingAdds,
  stateAt,
  trackIdOf,
  unapply,
  versionAt,
} from './apply';
import { Project } from './model';

// the demo fixture keeps growing as the song gets new versions: count, don't hard-code
const LAST = longing().events.length;

const FEEDBACK = 'tracks.lead.devices.echo.params.feedback';
const param = (p: Project) => p.tracks[0].devices[0].params[0];

describe('apply / unapply', () => {
  it('param.set sets value and display, bumps version, leaves the input untouched', () => {
    const p = tiny();
    const before = structuredClone(p);
    const next = apply(p, ev(6, 'param.set', FEEDBACK, 0.5, 0.62));
    expect(param(next).value).toBe(0.62);
    expect(param(next).display).toBe('0.62');
    expect(next.version).toBe(6);
    expect(p).toEqual(before);
    expect(next.tracks[0].clips).toBe(p.tracks[0].clips);
  });

  it('unapply restores `from` and sets version to seq - 1', () => {
    const e = ev(6, 'param.set', FEEDBACK, 0.3, 0.5);
    const p = { ...tiny(), version: 6 };
    const back = unapply(p, e);
    expect(param(back).value).toBe(0.3);
    expect(back.version).toBe(5);
    expect(param(apply(back, e)).value).toBe(0.5);
  });

  it('mixer.set handles volume, pan, mute, solo and sends', () => {
    let p = tiny();
    p = apply(p, ev(6, 'mixer.set', 'tracks.lead.mixer.volume_db', 0, -3));
    p = apply(p, ev(7, 'mixer.set', 'tracks.lead.mixer.pan', 0, -0.4));
    p = apply(p, ev(8, 'mixer.set', 'tracks.lead.mixer.mute', false, true));
    p = apply(p, ev(9, 'mixer.set', 'tracks.lead.mixer.solo', false, true));
    p = apply(p, ev(10, 'mixer.set', 'tracks.lead.mixer.sends.hall', -12, -6));
    expect(p.tracks[0].mixer).toEqual({
      volume_db: -3,
      pan: -0.4,
      mute: true,
      solo: true,
      sends: { hall: -6 },
    });
    expect(p.version).toBe(10);
  });

  it('mixer.set ignores a value of the wrong type', () => {
    const p = apply(tiny(), ev(6, 'mixer.set', 'tracks.lead.mixer.mute', false, 1));
    expect(p.tracks[0].mixer.mute).toBe(false);
  });

  it('song.set changes bpm and key, ignores unknown fields', () => {
    let p = apply(tiny(), ev(6, 'song.set', 'bpm', 120, 80));
    p = apply(p, ev(7, 'song.set', 'key', 'C major', 'A minor'));
    p = apply(p, ev(8, 'song.set', 'tracks', null, 'x'));
    expect([p.bpm, p.key, p.tracks.length]).toEqual([80, 'A minor', 1]);
  });

  it('device.enable accepts the device path or its .enabled path', () => {
    const off = apply(tiny(), ev(6, 'device.enable', 'tracks.lead.devices.echo', true, false));
    expect(off.tracks[0].devices[0].enabled).toBe(false);
    const on = apply(off, ev(7, 'device.enable', 'tracks.lead.devices.echo.enabled', false, true));
    expect(on.tracks[0].devices[0].enabled).toBe(true);
  });

  it('track.rename renames', () => {
    expect(
      apply(tiny(), ev(6, 'track.rename', 'tracks.lead', 'Lead', 'Zither')).tracks[0].name,
    ).toBe('Zither');
  });

  it('clip.move takes a start bar or an object', () => {
    const a = apply(tiny(), ev(6, 'clip.move', 'tracks.lead.clips.c1', 2, 4));
    expect(a.tracks[0].clips[0].start_bar).toBe(4);
    const b = apply(
      a,
      ev(
        7,
        'clip.move',
        'tracks.lead.clips.c1',
        { start_bar: 4 },
        { start_bar: 1, length_bars: 3 },
      ),
    );
    expect(b.tracks[0].clips[0]).toMatchObject({ start_bar: 1, length_bars: 3 });
    expect(
      unapply(b, ev(7, 'clip.move', 'tracks.lead.clips.c1', { start_bar: 4 }, { start_bar: 1 }))
        .tracks[0].clips[0].start_bar,
    ).toBe(4);
  });

  it('render.done takes a path or {audio, duration_s}; a null `from` cannot be un-applied', () => {
    const a = apply(tiny(), ev(6, 'render.done', null, null, 'audio/v2.wav'));
    expect(a.audio.master).toBe('audio/v2.wav');
    const b = apply(a, ev(7, 'render.done', null, null, { audio: 'audio/v3.wav', duration_s: 20 }));
    expect(b.audio).toMatchObject({ master: 'audio/v3.wav', duration_s: 20 });
    const back = unapply(b, ev(7, 'render.done', null, null, { audio: 'audio/v3.wav' }));
    expect(back.audio.master).toBe('audio/v3.wav');
    expect(back.version).toBe(6);
  });

  it('unknown targets and non-mirrored verbs only move the version', () => {
    const p = tiny();
    for (const e of [
      ev(6, 'param.set', 'tracks.nope.devices.echo.params.feedback', 0, 1),
      ev(6, 'param.set', 'tracks.lead.devices.echo.params.nope', 0, 1),
      ev(6, 'param.set', 'tracks.lead.devices.nope.params.feedback', 0, 1),
      ev(6, 'track.add', 'tracks.bass', null, 'Bass'),
      ev(6, 'note', null, null, null),
    ]) {
      const next = apply(p, e);
      expect(next.version).toBe(6);
      expect(next.tracks).toBe(p.tracks);
    }
  });
});

describe('stateAt on the Longing build log', () => {
  const { project, events } = longing();

  it('the fixture is the state after its last event', () => {
    expect(project.version).toBe(LAST);
    expect(events.length).toBe(LAST);
    expect(stateAt(project, events, LAST)).toBe(project);
  });

  it('rewinds bpm, key, params and mixer to before the build', () => {
    const p0 = stateAt(project, events, 0);
    expect(p0.version).toBe(0);
    expect(p0.bpm).toBe(140);
    expect(p0.key).toBe('D Phrygian');
    const zither = p0.tracks.find((t) => t.id === 'zither')!;
    expect(
      zither.devices.find((d) => d.id === 'echo')!.params.find((x) => x.id === 'feedback')!.value,
    ).toBe(0);
    expect(p0.tracks.find((t) => t.id === 'drums')!.mixer.volume_db).toBe(0);
  });

  it('steps across single events', () => {
    expect(stateAt(project, events, 16).bpm).toBe(140);
    expect(stateAt(project, events, 17).bpm).toBe(80);
    expect(stateAt(project, events, 2).key).toBe('D Phrygian');
    expect(stateAt(project, events, 3).key).toBe('A minor');
  });

  it('replaying forward from seq 0 returns every value to the current state', () => {
    const p0 = stateAt(project, events, 0);
    const again = stateAt(p0, events, LAST);
    const values = (p: Project) => ({
      bpm: p.bpm,
      key: p.key,
      tracks: p.tracks.map((t) => ({
        mixer: t.mixer,
        params: t.devices.map((d) => d.params.map((x) => x.value)),
      })),
    });
    expect(values(again)).toEqual(values(project));
    expect(again.version).toBe(LAST);
  });

  it('ghosts tracks that are only added later', () => {
    const at20 = pendingAdds(events, 20);
    expect(at20.has('tracks.strings')).toBe(true);
    expect(at20.has('tracks.zither')).toBe(true);
    expect(at20.has('tracks.vocal')).toBe(false);
    expect(pendingAdds(events, LAST).size).toBe(0);
  });

  it('knows the song version at each seq', () => {
    expect(versionAt(events, 0)).toBeNull();
    expect(versionAt(events, 17)).toBe('1.0');
    expect(versionAt(events, LAST)).toBe(String([...events].reverse().find((e) => e.verb === 'version.tag')!.to));
  });
});

describe('helpers', () => {
  it('controlPath maps events to the control that moves', () => {
    expect(controlPath(ev(1, 'param.set', FEEDBACK, 0, 1))).toBe(FEEDBACK);
    expect(controlPath(ev(1, 'render.done', null, null, 'a.wav'))).toBe('audio');
    expect(controlPath(ev(1, 'version.tag', null, '1.0', '2.0'))).toBe('version');
    expect(controlPath(ev(1, 'device.enable', 'tracks.a.devices.b.enabled', true, false))).toBe(
      'tracks.a.devices.b',
    );
    expect(controlPath(ev(1, 'note', null, null, null))).toBeNull();
  });

  it('trackIdOf', () => {
    expect(trackIdOf(FEEDBACK)).toBe('lead');
    expect(trackIdOf('bpm')).toBeNull();
    expect(trackIdOf(null)).toBeNull();
  });

  it('formatValue matches the backend: raw value plus unit', () => {
    expect(formatValue(0.62, '')).toBe('0.62');
    expect(formatValue(2, 'bars')).toBe('2 bars');
    expect(formatValue(12.345, 'ms')).toBe('12.345 ms');
  });

  it('formatRounded keeps tweening values short', () => {
    expect(formatRounded(2500, 'Hz')).toBe('2500 Hz');
    expect(formatRounded(12.345, 'ms')).toBe('12.3 ms');
    expect(formatRounded(-2.5, 'dB')).toBe('-2.5 dB');
    expect(formatRounded(0.1 + 0.2, '')).toBe('0.3');
  });

  it('mergeEvents de-duplicates by seq and sorts', () => {
    const merged = mergeEvents(
      [ev(1, 'note', null, null, null), ev(3, 'note', null, null, null)],
      [ev(2, 'note', null, null, null), ev(3, 'note', null, null, null)],
    );
    expect(merged.map((e) => e.seq)).toEqual([1, 2, 3]);
  });
});
