/**
 * Geometry and band math for the player's round spectrum ring: bars stand on a circle around the
 * cover art and point outwards; an oscilloscope trace runs just inside it. Pure functions; the
 * player draws them on a canvas once per frame.
 */

export interface RingPoint {
  x: number;
  y: number;
  /** Outward unit normal (for a circle: straight out from the centre). */
  nx: number;
  ny: number;
}

/**
 * `n` points evenly spread round a circle of radius `r` centred on (0, 0), y down, starting just
 * right of the top and going clockwise.
 */
export function circleRing(n: number, r: number): RingPoint[] {
  const out: RingPoint[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * (i + 0.5)) / n;
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    out.push({ x: r * nx, y: r * ny, nx, ny });
  }
  return out;
}

/** Ring position `i` of `n` -> band index, mirrored so the ring is symmetric left / right. */
export function mirrorIndex(i: number, n: number): number {
  return i < n / 2 ? i : n - 1 - i;
}

/**
 * `out.length` log-spaced bands (0..1, the loudest bin in each) from byte frequency data, as
 * from `AnalyserNode.getByteFrequencyData`.
 */
export function logBands(
  freq: Uint8Array,
  sampleRate: number,
  out: Float32Array,
  fMin = 35,
  fMax = 14000,
): Float32Array {
  const n = out.length;
  const bins = freq.length;
  const hzPerBin = sampleRate / 2 / bins;
  for (let i = 0; i < n; i++) {
    const f0 = fMin * (fMax / fMin) ** (i / n);
    const f1 = fMin * (fMax / fMin) ** ((i + 1) / n);
    const b0 = Math.min(bins - 1, Math.floor(f0 / hzPerBin));
    const b1 = Math.min(bins, Math.max(b0 + 1, Math.ceil(f1 / hzPerBin)));
    let peak = 0;
    for (let b = b0; b < b1; b++) peak = Math.max(peak, freq[b]);
    out[i] = peak / 255;
  }
  return out;
}

/**
 * Without an analyser (cross-origin audio): the master's own peaks around the playhead, one per
 * band, so the ring still shows the music's real shape.
 */
export function envelopeBands(
  peaks: readonly number[],
  t: number,
  duration: number,
  out: Float32Array,
): Float32Array {
  const n = out.length;
  if (!peaks.length || !duration) return out.fill(0);
  const centre = Math.floor((t / duration) * peaks.length);
  for (let i = 0; i < n; i++) {
    const idx = centre - Math.floor(n / 2) + i;
    out[i] = idx >= 0 && idx < peaks.length ? peaks[idx] : 0;
  }
  return out;
}

/** Peak-meter ballistics per band: instant attack, slow release. */
export function decay(prev: Float32Array, next: Float32Array, release = 0.86): Float32Array {
  for (let i = 0; i < prev.length; i++) prev[i] = Math.max(next[i], prev[i] * release);
  return prev;
}
