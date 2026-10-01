import { Chord, Project, Section } from './model';

export function beatsPerBar(p: Pick<Project, 'time_signature'>): number {
  return p.time_signature?.[0] || 4;
}

export function secondsPerBar(p: Pick<Project, 'bpm' | 'time_signature'>): number {
  return (60 / p.bpm) * beatsPerBar(p);
}

/** Bars (0-based, fractional) at audio time `t` seconds. */
export function barAt(p: Pick<Project, 'bpm' | 'time_signature'>, t: number): number {
  return t / secondsPerBar(p);
}

/** Ableton-style position "bar.beat.sixteenth", 1-based. */
export function formatBBT(p: Pick<Project, 'bpm' | 'time_signature'>, t: number): string {
  const totalBeats = Math.max(0, t) * (p.bpm / 60);
  const bpb = beatsPerBar(p);
  const bar = Math.floor(totalBeats / bpb) + 1;
  const beat = Math.floor(totalBeats % bpb) + 1;
  const six = Math.floor((totalBeats % 1) * 4) + 1;
  return `${bar}.${beat}.${six}`;
}

export function formatClock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function sectionAt(sections: readonly Section[], bar: number): Section | null {
  return sections.find((s) => bar >= s.start_bar && bar < s.end_bar) ?? null;
}

export function chordAt(chords: readonly Chord[], bar: number): Chord | null {
  let c: Chord | null = null;
  for (const ch of chords) {
    if (ch.bar <= bar) c = ch;
    else break;
  }
  return c;
}

export function dbToGain(db: number): number {
  return db <= -96 ? 0 : 10 ** (db / 20);
}

export function formatDb(db: number): string {
  if (db <= -96) return '-inf dB';
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

/** Ableton pan display: C, 20L, 35R. */
export function formatPan(pan: number): string {
  const v = Math.round(pan * 50);
  return v === 0 ? 'C' : `${Math.abs(v)}${v < 0 ? 'L' : 'R'}`;
}
