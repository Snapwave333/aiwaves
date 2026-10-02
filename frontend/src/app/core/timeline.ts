import { AiEvent, Json } from './model';

/** A version's stretch of the log: from its version.tag to the event before the next tag. */
export interface VersionSpan {
  version: string;
  title: string;
  start: number;
  end: number;
}

/** A render that can be listened to: its file, and what the player needs to draw it. */
export interface Render {
  audio: string;
  seq: number;
  version: string | null;
  duration_s: number | null;
  peaks: number[] | null;
}

/** What kind of change an event is, for colouring its mark on the timeline. */
export type Family = 'move' | 'build' | 'note' | 'render' | 'version';

export function familyOf(verb: string): Family {
  if (verb === 'version.tag') return 'version';
  if (verb === 'render.done') return 'render';
  if (verb === 'note') return 'note';
  if (verb.endsWith('.set')) return 'move';
  return 'build';
}

export function versionSpans(events: readonly AiEvent[], lastSeq: number): VersionSpan[] {
  const tags = events.filter((e) => e.verb === 'version.tag' && typeof e.to === 'string');
  return tags.map((t, i) => ({
    version: t.to as string,
    title: t.reason,
    start: t.seq,
    end: (tags[i + 1]?.seq ?? lastSeq + 1) - 1,
  }));
}

/** The seq to jump to when stepping `delta` versions from `seq` (the end of a version). */
export function versionStep(spans: readonly VersionSpan[], seq: number, delta: number): number | null {
  const ends = spans.map((v) => v.end);
  if (delta > 0) return ends.find((e) => e > seq) ?? null;
  return [...ends].reverse().find((e) => e < seq) ?? (seq > 0 ? 0 : null);
}

function audioOf(to: Json): string | null {
  if (typeof to === 'string') return to;
  if (to && typeof to === 'object' && !Array.isArray(to) && typeof to['audio'] === 'string')
    return to['audio'];
  return null;
}

/**
 * The render that belongs to the state at `seq`: the last render.done up to it, if its file was not
 * written again by a later render (then it no longer holds that version's audio).
 */
export function renderAt(events: readonly AiEvent[], seq: number): Render | null {
  let r: AiEvent | undefined;
  for (const e of events) if (e.verb === 'render.done' && e.seq <= seq) r = e;
  const audio = r ? audioOf(r.to) : null;
  if (!r || !audio) return null;
  const rewritten = events.some(
    (e) => e.seq > r.seq && e.verb === 'render.done' && audioOf(e.to) === audio,
  );
  if (rewritten) return null;
  const to = r.to && typeof r.to === 'object' && !Array.isArray(r.to) ? r.to : {};
  const peaks = Array.isArray(to['peaks']) && to['peaks'].every((x) => typeof x === 'number')
    ? (to['peaks'] as number[])
    : null;
  return {
    audio,
    seq: r.seq,
    version: r.version ?? null,
    duration_s: typeof to['duration_s'] === 'number' ? to['duration_s'] : null,
    peaks,
  };
}

/**
 * Version labels on a scrubber `width` px wide, newest first so it always shows: each goes on row
 * 0 or 1, whichever has room; with no room it stays a plain tick (its title says which version).
 */
export function layoutLabels(
  spans: readonly VersionSpan[],
  lastSeq: number,
  width: number,
  charPx = 7,
  padPx = 10,
): { span: VersionSpan; x: number; labelX: number; row: 0 | 1 | null }[] {
  const ends: [number, number] = [Infinity, Infinity];
  const out: { span: VersionSpan; x: number; labelX: number; row: 0 | 1 | null }[] = [];
  for (const span of [...spans].reverse()) {
    const x = (span.start / Math.max(1, lastSeq)) * width;
    const w = (span.version.length + 1) * charPx + padPx;
    const labelX = Math.max(0, Math.min(x, width - w));        // the newest stays inside the bar
    const row = ([0, 1] as const).find((r) => labelX + w <= ends[r]) ?? null;
    if (row !== null) ends[row] = labelX;
    out.push({ span, x, labelX, row });
  }
  return out.reverse();
}
