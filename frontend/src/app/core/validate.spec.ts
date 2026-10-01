import { tiny } from '../testing/fixtures';
import { parseJsonl } from './mock-api.service';
import { FALLBACK_TRACK_COLOR, audioPath, isAiEvent, isProject, sanitizeProject } from './validate';

describe('data boundary checks', () => {
  it('accepts contract events and rejects malformed ones', () => {
    const ok = {
      seq: 3,
      ts: '2026-09-30T19:41:07Z',
      agent: 'claude',
      verb: 'param.set',
      target: 'bpm',
      from: 1,
      to: 2,
      reason: 'r',
    };
    expect(isAiEvent(ok)).toBe(true);
    expect(isAiEvent({ ...ok, target: null })).toBe(true);
    for (const bad of [
      { ...ok, seq: 0 },
      { ...ok, seq: 1.5 },
      { ...ok, verb: null },
      { ...ok, reason: 7 },
      { ...ok, target: 3 },
      [ok],
      'event',
      null,
    ])
      expect(isAiEvent(bad)).toBe(false);
  });

  it('a project needs an id, a positive bpm, tracks and audio', () => {
    expect(isProject(tiny())).toBe(true);
    expect(isProject({ ...tiny(), tracks: null })).toBe(false);
    expect(isProject({ ...tiny(), bpm: 0 })).toBe(false);
    expect(isProject({ ...tiny(), audio: null })).toBe(false);
  });

  it('reduces track and clip colours (they go into style bindings) to hex', () => {
    const p = tiny();
    p.tracks[0].color = 'red; background: url(https://evil.example/x)';
    p.tracks[0].clips[0].color = '#a1b2c3';
    const clean = sanitizeProject(p);
    expect(clean.tracks[0].color).toBe(FALLBACK_TRACK_COLOR);
    expect(clean.tracks[0].clips[0].color).toBe('#a1b2c3');
    expect(sanitizeProject(tiny()).tracks[0].color).toBe('#fff');
  });

  it('encodes audio paths and refuses traversal', () => {
    expect(audioPath('audio/master.wav')).toBe('audio/master.wav');
    expect(audioPath('audio/a b?.wav')).toBe('audio/a%20b%3F.wav');
    for (const bad of ['../x.wav', 'audio/../../x', '/etc/passwd', 'audio//x.wav'])
      expect(audioPath(bad)).toBeNull();
  });

  it('a broken line in events.jsonl costs that line, not the log', () => {
    const lines = [
      JSON.stringify({ seq: 2, ts: 't', agent: 'a', verb: 'note', target: null, reason: 'b' }),
      '{"seq": 3, "verb": ',
      JSON.stringify({ seq: 'x' }),
      '',
      JSON.stringify({ seq: 1, ts: 't', agent: 'a', verb: 'note', target: null, reason: 'a' }),
    ];
    expect(parseJsonl(lines.join('\n')).map((e) => e.seq)).toEqual([1, 2]);
  });
});
