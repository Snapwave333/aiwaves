import { AiEvent, Project } from './model';

/**
 * Checks at the data boundary. Events and projects come from agents through the backend, so the
 * workspace treats them as untrusted: malformed events are dropped, and values that end up in
 * style bindings (colours) are reduced to plain hex.
 */

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** A well-formed event (CONTRACT section 4): positive integer seq, string verb / agent / ts. */
export function isAiEvent(x: unknown): x is AiEvent {
  if (!isObj(x)) return false;
  return (
    Number.isInteger(x['seq']) &&
    (x['seq'] as number) > 0 &&
    typeof x['verb'] === 'string' &&
    typeof x['agent'] === 'string' &&
    typeof x['ts'] === 'string' &&
    typeof x['reason'] === 'string' &&
    (x['target'] === null || typeof x['target'] === 'string')
  );
}

/** Enough of a project for the views not to throw (CONTRACT section 3). */
export function isProject(x: unknown): x is Project {
  if (!isObj(x)) return false;
  const audio = x['audio'];
  return (
    typeof x['id'] === 'string' &&
    typeof x['bpm'] === 'number' &&
    x['bpm'] > 0 &&
    typeof x['version'] === 'number' &&
    Array.isArray(x['tracks']) &&
    Array.isArray(x['sections']) &&
    Array.isArray(x['chords']) &&
    isObj(audio) &&
    typeof audio['master'] === 'string'
  );
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
export const FALLBACK_TRACK_COLOR = '#8a9bc4';

export function safeColor(c: unknown, fallback = FALLBACK_TRACK_COLOR): string {
  return typeof c === 'string' && HEX.test(c.trim()) ? c.trim() : fallback;
}

/** The project with every track and clip colour reduced to hex (they feed style bindings). */
export function sanitizeProject(p: Project): Project {
  return {
    ...p,
    tracks: p.tracks.map((t) => ({
      ...t,
      color: safeColor(t.color),
      clips: (t.clips ?? []).map((c) =>
        c.color === null ? c : { ...c, color: safeColor(c.color) },
      ),
    })),
  };
}

/**
 * `audio.master` ("audio/master.wav") as a URL path: each segment encoded, `..` and empty
 * segments refused (null).
 */
export function audioPath(master: string): string | null {
  const parts = master.split('/');
  if (parts.some((s) => !s || s === '.' || s === '..')) return null;
  return parts.map(encodeURIComponent).join('/');
}
