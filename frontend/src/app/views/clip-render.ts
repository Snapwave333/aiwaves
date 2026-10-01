/** Pure geometry for drawing clip contents and for the arrangement's zoom. No DOM here. */
import { Clip, Note } from '../core/model';

export const MIN_PPB = 6;
export const MAX_PPB = 320;
/** Clips narrower than this hide their name (the tooltip still has it). */
export const NAME_MIN_PX = 40;
/** Clip box geometry inside a lane (must match `.clip` in styles.scss): inset, border, name bar. */
export const CLIP_INSET_PX = 1;
export const CLIP_BORDER_PX = 1;
export const CLIP_HEADER_PX = 12;
/** Where clip contents start, from the top of the lane. */
export const CLIP_CONTENT_TOP = CLIP_INSET_PX + CLIP_BORDER_PX + CLIP_HEADER_PX;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0..1, from velocity. */
  alpha: number;
  label?: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface DrumLane {
  lane: number;
  label: string;
}

/** Keeps `n` buckets, each the max of the peaks that fall in it (for clips narrower than their peaks). */
export function bucketMax(peaks: readonly number[], n: number): number[] {
  if (n <= 0 || peaks.length === 0) return [];
  if (peaks.length <= n) return [...peaks];
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < peaks.length; i++) {
    const b = Math.min(n - 1, Math.floor((i / peaks.length) * n));
    out[b] = Math.max(out[b], peaks[i]);
  }
  return out;
}

/**
 * A filled, symmetric waveform polygon for `peaks` (scaled by `gain`, capped at full height) in a
 * w x h box: the top edge left to right, then the mirrored bottom edge back. At most one point
 * per pixel column.
 */
export function wavePolygon(peaks: readonly number[], w: number, h: number, gain = 1): Point[] {
  const pk = bucketMax(peaks, Math.max(1, Math.floor(w)));
  if (pk.length === 0 || w <= 0 || h <= 0) return [];
  const mid = h / 2;
  const amp = h / 2 - 0.5;
  const step = pk.length > 1 ? w / (pk.length - 1) : 0;
  const level = (v: number) => Math.min(1, Math.max(0, v * gain)) * amp;
  const top = pk.map((v, i) => ({ x: i * step, y: mid - level(v) }));
  const bottom = pk.map((v, i) => ({ x: i * step, y: mid + level(v) }));
  return [...top, ...bottom.reverse()];
}

/** SVG path for `wavePolygon`. */
export function wavePath(peaks: readonly number[], w: number, h: number, gain = 1): string {
  const pts = wavePolygon(peaks, w, h, gain);
  if (!pts.length) return '';
  return 'M ' + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ') + ' Z';
}

/**
 * Display gain for a track's clip waveforms: its loudest peak reaches 90% of the clip height, so
 * quiet vocal takes stay legible while clips keep their loudness relative to each other. Capped
 * at 4x so a near-silent track doesn't turn its noise floor into a full-height waveform.
 */
export function peakGain(clips: readonly Clip[]): number {
  let max = 0;
  for (const c of clips) for (const v of c.peaks ?? []) if (v > max) max = v;
  return max > 0 ? Math.min(4, 0.9 / max) : 1;
}

/** Pitch range to show for a MIDI clip: the notes' span, widened to at least one octave. */
export function pitchRange(notes: readonly Note[]): { lo: number; hi: number } {
  if (!notes.length) return { lo: 60, hi: 71 };
  let lo = Infinity;
  let hi = -Infinity;
  for (const n of notes) {
    lo = Math.min(lo, n.midi);
    hi = Math.max(hi, n.midi);
  }
  const missing = 11 - (hi - lo);
  if (missing > 0) {
    lo -= Math.floor(missing / 2);
    hi += Math.ceil(missing / 2);
  }
  return { lo, hi };
}

/**
 * Distinct drum lanes, top to bottom in lane order, with their names. Built from all of a
 * track's clips so every clip of the track draws the same rows.
 */
export function drumLanes(notes: readonly Note[]): DrumLane[] {
  const byLane = new Map<number, string>();
  for (const n of notes) {
    if (!byLane.has(n.midi) || (!byLane.get(n.midi) && n.label)) byLane.set(n.midi, n.label ?? '');
  }
  return [...byLane.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([lane, label]) => ({ lane, label }));
}

/**
 * Piano-roll preview: one rectangle per note in a w x h box. Pitch picks the row (auto range per
 * clip, at least an octave, high notes on top), or with `lanes` (drum tracks) the note's lane
 * does. Start/length in beats pick x/width, velocity the alpha. Notes past the clip's end are
 * clipped.
 */
export function noteRects(
  notes: readonly Note[],
  lengthBeats: number,
  w: number,
  h: number,
  lanes: readonly DrumLane[] | null = null,
): Rect[] {
  if (!notes.length || lengthBeats <= 0 || w <= 0 || h <= 0) return [];
  const pxPerBeat = w / lengthBeats;
  let rows: number;
  let rowOf: (n: Note) => number | undefined;
  if (lanes) {
    const index = new Map(lanes.map((l, i) => [l.lane, i]));
    rows = lanes.length;
    rowOf = (n) => index.get(n.midi);
  } else {
    const { lo, hi } = pitchRange(notes);
    rows = hi - lo + 1;
    rowOf = (n) => hi - n.midi;
  }
  const rowH = h / rows;
  const pad = rowH > 3 ? 0.5 : 0;
  const out: Rect[] = [];
  for (const n of notes) {
    const row = rowOf(n);
    const x = n.start_beat * pxPerBeat;
    if (row === undefined || x >= w) continue;
    out.push({
      x,
      y: row * rowH + pad,
      w: Math.max(1, Math.min(w - x, n.length_beats * pxPerBeat - 0.5)),
      h: Math.max(1, rowH - pad * 2),
      alpha: 0.35 + 0.65 * Math.min(1, Math.max(0, n.velocity)),
      label: lanes ? n.label : undefined,
    });
  }
  return out;
}

/** `#rgb` / `#rrggbb` mixed toward white by `amount` (0..1); anything else falls back to white. */
export function tint(color: string, amount: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return 'rgb(255, 255, 255)';
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const ch = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [r, g, b] = ch.map((v) => Math.round(v + (255 - v) * amount));
  return `rgb(${r}, ${g}, ${b})`;
}

// --- zoom and scroll -----------------------------------------------------------------------------

export function clampPpb(ppb: number): number {
  return Math.min(MAX_PPB, Math.max(MIN_PPB, ppb));
}

/** Pixels per bar that show the whole song (`bars`) in `viewportPx`. */
export function fitPpb(bars: number, viewportPx: number): number {
  return clampPpb(viewportPx / Math.max(1, bars));
}

/**
 * Where to anchor a zoom from `ppb` to `target` so that it ends scrolled to the very start
 * (Fit): the bar under that viewport x stays put and lands at scrollLeft 0. A zoom anchored at
 * `px` keeps bar `(scrollLeft + px) / ppb` at `px`, i.e. scrolls to `bar * newPpb - px`.
 */
export function fitAnchorPx(scrollLeft: number, ppb: number, target: number): number {
  return ppb === target ? 0 : (scrollLeft * target) / (ppb - target);
}

/**
 * One animation frame of a smooth zoom: moves `ppb` a fraction `rate` of the way to `target` in
 * log space (so zooming in and out feel the same); snaps once within 0.2%, or when `rate` >= 1.
 */
export function zoomStep(ppb: number, target: number, rate = 0.3): number {
  const k = Math.log(target / ppb);
  return rate >= 1 || Math.abs(k) < 0.002 ? target : ppb * Math.exp(k * rate);
}

/** Smooth wheel zoom: a factor from the wheel delta (about 1.13 per mouse-wheel notch). */
export function wheelFactor(deltaY: number): number {
  return Math.exp(-deltaY * 0.0012);
}

/** Bars between labels on the ruler so numbers don't collide. */
export function barLabelEvery(ppb: number): number {
  return ppb < 10 ? 8 : ppb < 20 ? 4 : ppb < 40 ? 2 : 1;
}

/**
 * The horizontal span (in lane pixels) a lane canvas covers: the viewport plus one viewport of
 * margin each side, snapped to viewport-sized tiles. It only changes when the scroll crosses a
 * tile, so ordinary scrolling moves already-drawn pixels and redraws nothing.
 */
export function laneWindow(
  scrollLeft: number,
  viewportPx: number,
  totalPx: number,
): { start: number; width: number } {
  const tile = Math.max(256, viewportPx);
  const start = Math.max(0, Math.floor(scrollLeft / tile) * tile - tile);
  return { start, width: Math.max(0, Math.min(totalPx, start + 3 * tile) - start) };
}

// --- lane heights --------------------------------------------------------------------------------

export const LANE_MIN_PX = 24;
export const LANE_MAX_PX = 240;

/** Default lane height per track kind. */
export function defaultLaneHeight(kind: string): number {
  switch (kind) {
    case 'drum':
      return 72;
    case 'audio':
      return 46;
    case 'master':
    case 'bus':
    case 'return':
      return 28;
    default:
      return 52;
  }
}

export function clampLane(h: number): number {
  return Math.min(LANE_MAX_PX, Math.max(LANE_MIN_PX, Math.round(h)));
}
