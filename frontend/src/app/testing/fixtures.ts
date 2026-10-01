import longingProject from '../../../../fixtures/longing/project.json';
import longingEventsText from '../../../../fixtures/longing/events.jsonl' with { loader: 'text' };
import { AiEvent, Project } from '../core/model';
import { parseJsonl } from '../core/mock-api.service';

/** The real "Longing" demo project and its 42-event build log (repo fixtures, read-only). */
export function longing(): { project: Project; events: AiEvent[] } {
  return {
    project: structuredClone(longingProject) as unknown as Project,
    events: parseJsonl(longingEventsText),
  };
}

export function ev(
  seq: number,
  verb: string,
  target: string | null,
  from: AiEvent['from'],
  to: AiEvent['to'],
): AiEvent {
  return {
    seq,
    ts: '2026-09-30T00:00:00Z',
    agent: 'test',
    verb,
    target,
    from,
    to,
    reason: `r${seq}`,
  };
}

/** A small project for unit tests. */
export function tiny(): Project {
  return {
    schema: 'aiwaves/project@1',
    id: 'tiny',
    title: 'Tiny',
    artist: 'test',
    bpm: 120,
    time_signature: [4, 4],
    key: 'C major',
    length_bars: 8,
    version: 5,
    sections: [{ name: 'a', start_bar: 0, end_bar: 8 }],
    chords: [{ bar: 0, name: 'C' }],
    audio: { master: 'audio/master.wav', duration_s: 16, peaks: [0.1, 0.5, 0.2] },
    tracks: [
      {
        id: 'lead',
        name: 'Lead',
        kind: 'instrument',
        color: '#fff',
        mixer: { volume_db: 0, pan: 0, mute: false, solo: false, sends: { hall: -12 } },
        devices: [
          {
            id: 'echo',
            type: 'delay',
            name: 'Echo',
            enabled: true,
            params: [
              {
                id: 'feedback',
                name: 'Feedback',
                value: 0.5,
                min: 0,
                max: 1,
                unit: '',
                display: '50 %',
              },
            ],
          },
        ],
        clips: [{ id: 'c1', name: 'Clip', start_bar: 2, length_bars: 2, color: null, notes: null }],
      },
    ],
  };
}
