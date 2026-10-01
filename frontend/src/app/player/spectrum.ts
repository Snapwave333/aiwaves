/**
 * Geometry and band math for the player's hexagonal spectrum ring: bars stand on the perimeter
 * of a flat-topped hexagon around the cover art and point outwards; an oscilloscope trace runs
 * just inside it. Pure functions; the player draws them on a canvas once per frame.
 */

export interface RingPoint {
  x: number;
  y: number;
  /** Outward unit normal of the edge the point is on. */
  nx: number;
  ny: number;
}

const SQRT3_2 = Math.sqrt(3) / 2;

/**
 * `n` points evenly spread along a flat-topped hexagon of circumradius `r` centred on (0, 0),
 * y down, starting at the middle of the top edge and going clockwise.
 */
export function hexRing(n: number, r: number): RingPoint[] {
  const h = r * SQRT3_2;
  // the perimeter as a path that starts and ends at the middle of the top edge
  const path: [number, number][] = [
    [0, -h],
    [r / 2, -h],
    [r, 0],
    [r / 2, h],
    [-r / 2, h],
    [-r, 0],
    [-r / 2, -h],
    [0, -h],
  ];
  const segs = path.slice(1).map(([x1, y1], i) => {
    const [x0, y0] = path[i];
    // the normal of a regular hexagon's edge points at the edge's middle
    const mx = i === 0 || i === 6 ? 0 : (x0 + x1) / 2;
    const my = i === 0 || i === 6 ? -h : (y0 + y1) / 2;
    const ml = Math.hypot(mx, my);
    return { x0, y0, x1, y1, len: Math.hypot(x1 - x0, y1 - y0), nx: mx / ml, ny: my / ml };
  });
  const total = 6 * r;
  const out: RingPoint[] = [];
  let seg = 0;
  let start = 0;
  for (let i = 0; i < n; i++) {
    const s = ((i + 0.5) / n) * total;
    while (seg < segs.length - 1 && s > start + segs[seg].len) start += segs[seg++].len;
    const g = segs[seg];
    const u = (s - start) / g.len;
    out.push({ x: g.x0 + (g.x1 - g.x0) * u, y: g.y0 + (g.y1 - g.y0) * u, nx: g.nx, ny: g.ny });
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
