import { Json } from '../core/model';
import { formatClock } from '../core/time';

/** Longest value text in the feed and the captions. */
const MAX_TEXT = 40;

function ellipsis(s: string, max = MAX_TEXT): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function num(v: Json | undefined): number | null {
  return typeof v === 'number' ? v : null;
}

function round(v: number): string {
  return String(Number(v.toFixed(2)));
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/**
 * An object in an event, in words: a track, device or clip by its name (a clip also by its notes
 * or its bars), a render by its file and length. `kind` is the verb family ("clip", "render", …).
 */
function describeObject(o: { [key: string]: Json }, kind: string): string {
  const name = typeof o['name'] === 'string' ? o['name'] : null;
  const audio = o['audio'] ?? o['master'];
  if (!name && typeof audio === 'string') {
    const d = num(o['duration_s']);
    return d === null ? fileName(audio) : `${fileName(audio)} · ${formatClock(d)}`;
  }
  // a handoff document update (aiwave411.md): how it was written and how long it is now
  const summary = o['summary'];
  if (typeof o['how'] === 'string' && summary && typeof summary === 'object' && !Array.isArray(summary)) {
    const lines = num(summary['lines']);
    return lines === null ? o['how'] : `${o['how']} · ${lines} lines`;
  }
  if (kind === 'clip') {
    const notes = Array.isArray(o['notes']) ? o['notes'].length : 0;
    const start = num(o['start_bar']);
    const length = num(o['length_bars']);
    const where =
      notes > 0
        ? `${notes} note${notes === 1 ? '' : 's'}`
        : start !== null
          ? `bars ${round(start + 1)}–${round(start + 1 + (length ?? 0))}`
          : null;
    return [name ?? 'clip', where].filter(Boolean).join(' · ');
  }
  if (name) return name;
  return Object.entries(o)
    .filter(([k]) => k !== 'index')
    .map(([k, v]) => `${k}: ${formatJson(v)}`)
    .join(', ');
}

/** Text for an event's from / to value in the feed and the captions. */
export function formatJson(v: Json, kind = ''): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return String(Number(v.toFixed(3)));
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'string') return ellipsis(v);
  if (Array.isArray(v)) return ellipsis(v.map((x) => formatJson(x)).join(', '));
  return ellipsis(describeObject(v, kind));
}

export interface Change {
  /** Null when there is nothing to show on that side (an add has no "from"). */
  from: string | null;
  to: string | null;
}

/**
 * What an event changed, for people. Removals read "removed <name>"; adds show what was added;
 * everything else is from → to, with objects summarised (never raw JSON).
 */
export function describeChange(e: {
  verb: string;
  target: string | null;
  from: Json;
  to: Json;
}): Change | null {
  const kind = e.verb.split('.')[0];
  if (e.verb.endsWith('.remove')) {
    const what = e.from === null ? leafTarget(e.target) : formatJson(e.from, kind);
    return { from: ellipsis(`removed ${what}`), to: null };
  }
  const from = e.from === null ? null : formatJson(e.from, kind);
  const to = e.to === null ? null : formatJson(e.to, kind);
  return from === null && to === null ? null : { from, to };
}

/** "tracks.zither.devices.echo.params.feedback" -> "zither › echo › feedback". */
export function shortTarget(target: string | null): string {
  if (!target) return '';
  return target
    .replace(/^tracks\./, '')
    .replace(/\.(devices|params|clips|mixer)\./g, ' › ')
    .replace(/\.mixer$/, ' › mixer');
}

/** "tracks.zither.devices.echo.params.feedback" -> "feedback"; a file name ("aiwave411.md") stays whole. */
export function leafTarget(target: string | null): string {
  if (!target) return '';
  const isPath = /^(tracks|sections|chords)\./.test(target);
  if (!isPath && /^[\w-]+\.[a-z0-9]{1,4}$/i.test(target)) return target;
  return target.split('.').pop() ?? '';
}
