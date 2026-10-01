import { decay, envelopeBands, hexRing, logBands, mirrorIndex } from './spectrum';

describe('spectrum ring', () => {
  it('spreads points evenly around a flat-topped hexagon, starting at the top, clockwise', () => {
    const r = 60;
    const h = (r * Math.sqrt(3)) / 2;
    const pts = hexRing(96, r);
    expect(pts.length).toBe(96);
    // the first point is just right of the top edge's middle, with an upward normal
    expect(pts[0].y).toBeCloseTo(-h);
    expect(pts[0].x).toBeGreaterThan(0);
    expect(pts[0].nx).toBeCloseTo(0);
    expect(pts[0].ny).toBeCloseTo(-1);
    // every point is on the hexagon: between the inradius and the circumradius
    for (const p of pts) {
      const d = Math.hypot(p.x, p.y);
      expect(d).toBeGreaterThanOrEqual(h - 1e-6);
      expect(d).toBeLessThanOrEqual(r + 1e-6);
      expect(Math.hypot(p.nx, p.ny)).toBeCloseTo(1);
      // normals point outwards
      expect(p.x * p.nx + p.y * p.ny).toBeGreaterThan(0);
    }
    // a quarter of the way round: on the right-hand slanted edges
    expect(pts[24].x).toBeGreaterThan(r / 2);
    // halfway: the middle of the bottom edge
    expect(pts[48].y).toBeCloseTo(h);
  });

  it('mirrors bands so the ring is symmetric', () => {
    expect([0, 1, 46, 47, 48, 49, 95].map((i) => mirrorIndex(i, 96))).toEqual([
      0, 1, 46, 47, 47, 46, 0,
    ]);
  });

  it('maps FFT bins to log-spaced bands, loudest bin per band', () => {
    const freq = new Uint8Array(1024);
    // 44.1 kHz, 1024 bins: ~21.5 Hz per bin; a loud 60 Hz bass and a quieter 5 kHz tone
    freq[3] = 255;
    freq[232] = 128;
    const bands = logBands(freq, 44100, new Float32Array(24));
    expect(Math.max(...bands)).toBe(1);
    expect(bands.indexOf(1)).toBeLessThan(5);
    const hi = bands.findIndex((v) => Math.abs(v - 128 / 255) < 1e-6);
    expect(hi).toBeGreaterThan(15);
    for (const v of bands) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('falls back to the master peaks around the playhead', () => {
    const peaks = Array.from({ length: 100 }, (_, i) => i / 100);
    const out = envelopeBands(peaks, 50, 100, new Float32Array(4));
    expect(Array.from(out).map((v) => Math.round(v * 100))).toEqual([48, 49, 50, 51]);
    expect(Array.from(envelopeBands([], 1, 10, new Float32Array(3)))).toEqual([0, 0, 0]);
  });

  it('bars jump up and fall back slowly', () => {
    const shown = new Float32Array([0, 1]);
    decay(shown, new Float32Array([0.8, 0]), 0.5);
    expect(Array.from(shown)).toEqual([0.800000011920929, 0.5]);
  });
});
