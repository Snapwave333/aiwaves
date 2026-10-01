import { AiEvent, Device, Json, Project, Track } from './model';

/** Verbs the frontend applies itself (CONTRACT section 4); the rest need a re-fetch of project.json. */
export const MIRRORED_VERBS: ReadonlySet<string> = new Set([
  'param.set',
  'mixer.set',
  'song.set',
  'device.enable',
  'track.rename',
  'clip.move',
  'render.done',
]);

/** Verbs that create something; while replaying, things created after the current seq are ghosted. */
export const ADD_VERBS: ReadonlySet<string> = new Set(['track.add', 'device.add', 'clip.add']);

const SONG_FIELDS = new Set(['bpm', 'key', 'title', 'artist', 'time_signature', 'length_bars']);

/** Applies an event: the target takes the event's `to`. Unknown targets leave the project unchanged. */
export function apply(project: Project, event: AiEvent): Project {
  return setTarget(project, event, event.to, event.seq);
}

/** Reverses an event using its `from`. Verbs that can't be undone that way only roll back `version`. */
export function unapply(project: Project, event: AiEvent): Project {
  return setTarget(project, event, event.from, event.seq - 1);
}

/**
 * The project as it was right after event `seq`, starting from `base` (whose `version` is the last
 * seq it contains): later events are un-applied newest-first, missing newer ones applied in order.
 */
export function stateAt(base: Project, events: readonly AiEvent[], seq: number): Project {
  let p = base;
  if (seq < base.version) {
    const undo = events
      .filter((e) => e.seq > seq && e.seq <= base.version)
      .sort((a, b) => b.seq - a.seq);
    for (const e of undo) p = unapply(p, e);
  } else if (seq > base.version) {
    const redo = events
      .filter((e) => e.seq > base.version && e.seq <= seq)
      .sort((a, b) => a.seq - b.seq);
    for (const e of redo) p = apply(p, e);
  }
  return p;
}

/** Paths of tracks / devices / clips that are only added by events after `seq`. */
export function pendingAdds(events: readonly AiEvent[], seq: number): ReadonlySet<string> {
  const out = new Set<string>();
  for (const e of events) {
    if (e.seq > seq && ADD_VERBS.has(e.verb) && e.target) out.add(e.target);
  }
  return out;
}

/** Song version label (e.g. "3.0") in force right after `seq`. */
export function versionAt(events: readonly AiEvent[], seq: number): string | null {
  let v: string | null = null;
  for (const e of events) {
    if (e.seq > seq) break;
    if (e.verb === 'version.tag' && typeof e.to === 'string') v = e.to;
    else if (e.version) v = e.version;
  }
  return v;
}

/** The data-path of the UI control an event moves (what animates, glows and gets the caption). */
export function controlPath(event: AiEvent): string | null {
  switch (event.verb) {
    case 'render.done':
      return 'audio';
    case 'version.tag':
      return 'version';
    case 'device.enable':
      return event.target?.replace(/\.enabled$/, '') ?? null;
    default:
      return event.target;
  }
}

/** `tracks.<id>...` -> `<id>`. */
export function trackIdOf(path: string | null): string | null {
  const m = path?.match(/^tracks\.([^.]+)/);
  return m ? m[1] : null;
}

/**
 * `display` after a param changes, as the backend regenerates it: "<value> <unit>", or just the
 * value when the unit is empty (see CONTRACT_NOTES.md).
 */
export function formatValue(value: number, unit: string): string {
  return unit ? `${value} ${unit}` : String(value);
}

/** A rounded number for values in motion (tweens), e.g. "12.3 ms". */
export function formatRounded(value: number, unit: string): string {
  let s: string;
  if (Number.isInteger(value)) s = String(value);
  else if (Math.abs(value) >= 100) s = value.toFixed(0);
  else if (Math.abs(value) >= 10) s = value.toFixed(1);
  else s = String(Number(value.toFixed(2)));
  return unit ? `${s} ${unit}` : s;
}

/** Merges events into an ascending, de-duplicated (by seq) list. */
export function mergeEvents(existing: readonly AiEvent[], incoming: readonly AiEvent[]): AiEvent[] {
  const bySeq = new Map<number, AiEvent>();
  for (const e of existing) bySeq.set(e.seq, e);
  for (const e of incoming) bySeq.set(e.seq, e);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

// ---------------------------------------------------------------------------------------------

function setTarget(project: Project, event: AiEvent, value: Json, version: number): Project {
  const next =
    MIRRORED_VERBS.has(event.verb) && value !== null ? setValue(project, event, value) : project;
  return next.version === version ? next : { ...next, version };
}

function setValue(p: Project, event: AiEvent, value: Exclude<Json, null>): Project {
  const parts = event.target?.split('.') ?? [];

  if (event.verb === 'song.set') {
    const field = parts[0];
    if (parts.length !== 1 || !SONG_FIELDS.has(field)) return p;
    if (field === 'bpm' || field === 'length_bars')
      return typeof value === 'number' ? { ...p, [field]: value } : p;
    if (field === 'time_signature')
      return Array.isArray(value) ? { ...p, time_signature: value as [number, number] } : p;
    return typeof value === 'string' ? { ...p, [field]: value } : p;
  }

  if (event.verb === 'render.done') {
    if (typeof value === 'string') return { ...p, audio: { ...p.audio, master: value } };
    if (typeof value !== 'object' || Array.isArray(value)) return p;
    const audio = { ...p.audio };
    const path = value['audio'] ?? value['master'];
    if (typeof path === 'string') audio.master = path;
    if (typeof value['duration_s'] === 'number') audio.duration_s = value['duration_s'];
    if (Array.isArray(value['peaks'])) audio.peaks = value['peaks'] as number[];
    return { ...p, audio };
  }

  if (parts[0] !== 'tracks' || parts.length < 2) return p;
  const trackId = parts[1];
  const rest = parts.slice(2);

  return updateTrack(p, trackId, (t) => {
    switch (event.verb) {
      case 'track.rename':
        return rest.length === 0 && typeof value === 'string' ? { ...t, name: value } : t;

      case 'mixer.set': {
        if (rest[0] !== 'mixer') return t;
        const [, field, sendId] = rest;
        if (
          (field === 'volume_db' || field === 'pan') &&
          rest.length === 2 &&
          typeof value === 'number'
        )
          return { ...t, mixer: { ...t.mixer, [field]: value } };
        if (
          (field === 'mute' || field === 'solo') &&
          rest.length === 2 &&
          typeof value === 'boolean'
        )
          return { ...t, mixer: { ...t.mixer, [field]: value } };
        if (field === 'sends' && sendId && rest.length === 3 && typeof value === 'number')
          return { ...t, mixer: { ...t.mixer, sends: { ...t.mixer.sends, [sendId]: value } } };
        return t;
      }

      case 'param.set': {
        if (
          rest[0] !== 'devices' ||
          rest[2] !== 'params' ||
          rest.length !== 4 ||
          typeof value !== 'number'
        )
          return t;
        return updateDevice(t, rest[1], (d) =>
          d.params.some((prm) => prm.id === rest[3])
            ? {
                ...d,
                params: d.params.map((prm) =>
                  prm.id === rest[3]
                    ? { ...prm, value, display: formatValue(value, prm.unit) }
                    : prm,
                ),
              }
            : d,
        );
      }

      case 'device.enable': {
        const ok =
          rest[0] === 'devices' &&
          (rest.length === 2 || (rest.length === 3 && rest[2] === 'enabled'));
        if (!ok || typeof value !== 'boolean') return t;
        return updateDevice(t, rest[1], (d) => ({ ...d, enabled: value }));
      }

      case 'clip.move': {
        if (rest[0] !== 'clips' || rest.length !== 2) return t;
        const clipId = rest[1];
        if (!t.clips.some((c) => c.id === clipId)) return t;
        return {
          ...t,
          clips: t.clips.map((c) => {
            if (c.id !== clipId) return c;
            if (typeof value === 'number') return { ...c, start_bar: value };
            if (typeof value !== 'object' || Array.isArray(value)) return c;
            const moved = { ...c };
            if (typeof value['start_bar'] === 'number') moved.start_bar = value['start_bar'];
            if (typeof value['length_bars'] === 'number') moved.length_bars = value['length_bars'];
            return moved;
          }),
        };
      }

      default:
        return t;
    }
  });
}

function updateTrack(p: Project, id: string, fn: (t: Track) => Track): Project {
  let changed = false;
  const tracks = p.tracks.map((t) => {
    if (t.id !== id) return t;
    const n = fn(t);
    changed ||= n !== t;
    return n;
  });
  return changed ? { ...p, tracks } : p;
}

function updateDevice(t: Track, id: string, fn: (d: Device) => Device): Track {
  const old = t.devices.find((d) => d.id === id);
  if (!old) return t;
  const next = fn(old);
  return next === old ? t : { ...t, devices: t.devices.map((d) => (d === old ? next : d)) };
}
