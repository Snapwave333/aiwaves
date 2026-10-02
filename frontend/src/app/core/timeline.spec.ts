import { ev } from '../testing/fixtures';
import { AiEvent } from './model';
import { familyOf, layoutLabels, renderAt, versionSpans, versionStep } from './timeline';

function tag(seq: number, v: string): AiEvent {
  return { ...ev(seq, 'version.tag', null, null, v), reason: `title ${v}` };
}
function render(seq: number, audio: string, version: string): AiEvent {
  return { ...ev(seq, 'render.done', null, null, { audio, duration_s: 200, peaks: [0.1, 0.2] }), version };
}

// v1: 1-4 (render to master.wav at 4), v2: 5-8 (render to master.wav at 8),
// v3: 9-12 (render to master_v3.wav at 12), v4: 13-15 (render to master_v4.wav at 15)
const LOG: AiEvent[] = [
  tag(1, '1'), ev(2, 'param.set', 'tracks.a.devices.d.params.p', 0, 1), ev(3, 'note', null, null, null), render(4, 'audio/master.wav', '1'),
  tag(5, '2'), ev(6, 'device.add', 'tracks.a.devices.e', null, 'E'), ev(7, 'mixer.set', 'tracks.a.mixer.pan', 0, 0.5), render(8, 'audio/master.wav', '2'),
  tag(9, '3'), ev(10, 'clip.add', 'tracks.a.clips.c', null, 'C'), ev(11, 'note', null, null, null), render(12, 'audio/master_v3.wav', '3'),
  tag(13, '4'), ev(14, 'param.set', 'tracks.a.devices.d.params.p', 1, 2), render(15, 'audio/master_v4.wav', '4'),
];

describe('version timeline logic', () => {
  it('splits the log into versions: from each tag to the event before the next', () => {
    expect(versionSpans(LOG, 15).map((v) => [v.version, v.start, v.end])).toEqual([
      ['1', 1, 4],
      ['2', 5, 8],
      ['3', 9, 12],
      ['4', 13, 15],
    ]);
  });

  it('steps a whole version at a time (to its end), and stops at the ends of the log', () => {
    const spans = versionSpans(LOG, 15);
    expect(versionStep(spans, 6, 1)).toBe(8);
    expect(versionStep(spans, 8, 1)).toBe(12);
    expect(versionStep(spans, 15, 1)).toBeNull();
    expect(versionStep(spans, 10, -1)).toBe(8);
    expect(versionStep(spans, 8, -1)).toBe(4);
    expect(versionStep(spans, 3, -1)).toBe(0);
    expect(versionStep(spans, 0, -1)).toBeNull();
  });

  it('an old render can be heard only if no later render wrote over its file', () => {
    expect(renderAt(LOG, 6)).toBeNull(); // v1's master.wav was overwritten by v2
    expect(renderAt(LOG, 10)!.audio).toBe('audio/master.wav'); // v2: its file still holds it
    const v3 = renderAt(LOG, 14)!;
    expect(v3).toEqual({ audio: 'audio/master_v3.wav', seq: 12, version: '3', duration_s: 200, peaks: [0.1, 0.2] });
    expect(renderAt(LOG, 15)!.audio).toBe('audio/master_v4.wav');
    expect(renderAt(LOG, 3)).toBeNull(); // nothing rendered yet
  });

  it('colours each event by what kind of change it is', () => {
    expect(['param.set', 'mixer.set', 'song.set'].map(familyOf)).toEqual(['move', 'move', 'move']);
    expect(['device.add', 'clip.remove', 'track.rename'].map(familyOf)).toEqual(['build', 'build', 'build']);
    expect([familyOf('note'), familyOf('render.done'), familyOf('version.tag')]).toEqual(['note', 'render', 'version']);
  });

  it('lays version labels out on two rows without overlap; the newest always shows', () => {
    // 30 versions crammed into 300 px: most become plain ticks, none overlap, the last one shows
    const many = Array.from({ length: 30 }, (_, i) => ({ version: `5.${i}`, title: '', start: i * 4 + 1, end: i * 4 + 4 }));
    const out = layoutLabels(many, 120, 300);
    const w = (v: string) => (v.length + 1) * 7 + 10;
    for (const row of [0, 1] as const) {
      const placed = out.filter((l) => l.row === row).sort((a, b) => a.labelX - b.labelX);
      for (let i = 1; i < placed.length; i++)
        expect(placed[i].labelX).toBeGreaterThanOrEqual(placed[i - 1].labelX + w(placed[i - 1].span.version));
    }
    expect(out.at(-1)!.row).toBe(0);
    expect(out.at(-1)!.labelX + w('5.29')).toBeLessThanOrEqual(300);
    // plenty of room: every label shows on the first row
    expect(layoutLabels(versionSpans(LOG, 15), 15, 1000).every((l) => l.row === 0)).toBe(true);
  });
});
