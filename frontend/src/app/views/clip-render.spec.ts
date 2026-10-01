import { Clip, Note } from '../core/model';
import {
  MAX_PPB,
  MIN_PPB,
  barLabelEvery,
  bucketMax,
  clampLane,
  drumLanes,
  fitAnchorPx,
  fitPpb,
  laneWindow,
  noteRects,
  peakGain,
  pitchRange,
  tint,
  wavePath,
  wavePolygon,
  wheelFactor,
  zoomStep,
} from './clip-render';

const note = (start: number, len: number, midi: number, velocity = 1, label?: string): Note => ({
  start_beat: start,
  length_beats: len,
  midi,
  velocity,
  label,
});

describe('waveform geometry', () => {
  it('bucketMax keeps the loudest peak of each bucket, and passes short arrays through', () => {
    expect(bucketMax([0.1, 0.9, 0.2, 0.3, 0.8, 0.1], 3)).toEqual([0.9, 0.3, 0.8]);
    expect(bucketMax([0.1, 0.2], 5)).toEqual([0.1, 0.2]);
    expect(bucketMax([], 5)).toEqual([]);
    expect(bucketMax([0.5], 0)).toEqual([]);
  });

  it('wavePolygon is symmetric around the middle and spans the width', () => {
    const pts = wavePolygon([0, 1, 0.5], 100, 20);
    expect(pts.length).toBe(6);
    expect(pts[0]).toEqual({ x: 0, y: 10 });
    expect(pts[1]).toEqual({ x: 50, y: 0.5 });
    expect(pts[2].x).toBe(100);
    // bottom edge mirrors the top, in reverse order
    expect(pts[3]).toEqual({ x: 100, y: 10 + 0.5 * 9.5 });
    expect(pts[4]).toEqual({ x: 50, y: 19.5 });
    expect(pts[5]).toEqual({ x: 0, y: 10 });
  });

  it('wavePolygon never emits more than one point per pixel column', () => {
    const peaks = Array.from({ length: 1000 }, (_, i) => (i % 10) / 10);
    expect(wavePolygon(peaks, 50, 10).length).toBe(100);
    expect(wavePolygon(peaks, 0, 10)).toEqual([]);
  });

  it('wavePolygon scales by the display gain and never leaves the box', () => {
    const pts = wavePolygon([0.25, 0.5], 10, 20, 2);
    expect(pts[0].y).toBeCloseTo(10 - 0.5 * 9.5, 10);
    expect(pts[1].y).toBeCloseTo(0.5, 10); // 0.5 x 2 = full height
    expect(wavePolygon([0.9], 10, 20, 4)[0].y).toBeCloseTo(0.5, 10); // capped
  });

  it('peakGain brings the loudest clip of a track near full height, at most 4x', () => {
    const clip = (peaks: number[] | null): Clip => ({
      id: 'c',
      name: 'c',
      start_bar: 0,
      length_bars: 1,
      color: null,
      notes: null,
      peaks,
    });
    expect(peakGain([clip([0.1, 0.3]), clip([0.2])])).toBeCloseTo(3, 10);
    expect(peakGain([clip([0.01])])).toBe(4);
    expect(peakGain([clip(null)])).toBe(1);
    expect(peakGain([clip([1])])).toBeCloseTo(0.9, 10);
  });

  it('wavePath is a closed SVG path', () => {
    const d = wavePath([0.5, 0.5], 10, 10);
    expect(d.startsWith('M 0.0 ')).toBe(true);
    expect(d.endsWith(' Z')).toBe(true);
    expect(wavePath([], 10, 10)).toBe('');
  });
});

describe('note geometry', () => {
  it('pitchRange widens to an octave around the notes', () => {
    expect(pitchRange([note(0, 1, 60)])).toEqual({ lo: 55, hi: 66 });
    expect(pitchRange([note(0, 1, 60), note(1, 1, 64)])).toEqual({ lo: 57, hi: 68 });
    expect(pitchRange([note(0, 1, 40), note(1, 1, 80)])).toEqual({ lo: 40, hi: 80 });
    expect(pitchRange([])).toEqual({ lo: 60, hi: 71 });
  });

  it('maps pitch to rows (high notes on top), beats to x and width, velocity to alpha', () => {
    const r = noteRects([note(0, 1, 60, 1), note(2, 2, 64, 0.5)], 4, 80, 24);
    expect(r.length).toBe(2);
    // range 57..68 -> 12 rows of 2 px; midi 64 is row 4, midi 60 is row 8
    expect(r[0]).toMatchObject({ x: 0, y: 16, w: 19.5, h: 2 });
    expect(r[1]).toMatchObject({ x: 40, y: 8, w: 39.5, h: 2 });
    expect(r[0].alpha).toBe(1);
    expect(r[1].alpha).toBeCloseTo(0.675, 5);
  });

  it('clips notes at the clip end and drops notes that start after it', () => {
    const r = noteRects([note(3, 4, 60), note(5, 1, 60)], 4, 40, 12);
    expect(r.length).toBe(1);
    expect(r[0].x + r[0].w).toBeLessThanOrEqual(40);
  });

  it('a note is never thinner than a pixel', () => {
    const r = noteRects([note(0, 0.01, 60)], 64, 64, 12);
    expect(r[0].w).toBe(1);
  });

  it('drum clips get one row per lane, in lane order, with the drum name', () => {
    const notes = [
      note(0, 0.25, 3, 1, 'snare'),
      note(0, 0.25, 1, 1, 'deep'),
      note(2, 0.25, 3, 0.5, 'snare'),
    ];
    const lanes = drumLanes(notes);
    expect(lanes).toEqual([
      { lane: 1, label: 'deep' },
      { lane: 3, label: 'snare' },
    ]);
    const r = noteRects(notes, 4, 40, 20, lanes);
    expect(r.map((x) => [x.y, x.label])).toEqual([
      [10.5, 'snare'],
      [0.5, 'deep'],
      [10.5, 'snare'],
    ]);
    expect(r[2].alpha).toBeCloseTo(0.675, 5);
  });

  it("drum rows come from the whole track, so a clip without a lane keeps the others' rows", () => {
    const track = drumLanes([
      note(0, 1, 36, 1, 'deep'),
      note(0, 1, 38, 1, 'snare'),
      note(0, 1, 42), // a lane named only by a later note
      note(1, 1, 42, 1, 'shaker'),
    ]);
    expect(track.map((l) => l.label)).toEqual(['deep', 'snare', 'shaker']);
    // this clip has no snare: the shaker still sits on the third row
    const r = noteRects([note(0, 1, 36), note(1, 1, 42)], 4, 40, 30, track);
    expect(r.map((x) => x.y)).toEqual([0.5, 20.5]);
    // a lane the list doesn't know is skipped rather than drawn on a wrong row
    expect(noteRects([note(0, 1, 99)], 4, 40, 30, track)).toEqual([]);
  });

  it('tint lightens a hex colour toward white', () => {
    expect(tint('#000000', 0.5)).toBe('rgb(128, 128, 128)');
    expect(tint('#e07a5f', 0)).toBe('rgb(224, 122, 95)');
    expect(tint('#fff', 0.3)).toBe('rgb(255, 255, 255)');
    expect(tint('tomato', 0.5)).toBe('rgb(255, 255, 255)');
  });
});

describe('zoom math', () => {
  it('fitPpb shows all bars in the viewport, within limits', () => {
    expect(fitPpb(66, 1088)).toBeCloseTo(16.48, 2);
    expect(fitPpb(1000, 100)).toBe(MIN_PPB);
    expect(fitPpb(2, 10000)).toBe(MAX_PPB);
  });

  it('zoomStep eases toward the target in log space and lands exactly on it', () => {
    const up = zoomStep(10, 40);
    const down = zoomStep(40, 10);
    expect(up).toBeGreaterThan(10);
    expect(up).toBeLessThan(40);
    expect(up / 10).toBeCloseTo(40 / down, 10); // in and out move by the same ratio
    let p = 10;
    let frames = 0;
    while (p !== 40 && frames < 100) {
      p = zoomStep(p, 40);
      frames++;
    }
    expect(p).toBe(40);
    expect(frames).toBeLessThan(25); // about 0.3 s at 60 fps
    expect(zoomStep(10, 40, 1)).toBe(40);
  });

  it('fitAnchorPx picks the anchor that makes a zoom end scrolled to the start', () => {
    for (const [s0, p0, p1] of [
      [5000, 160, 10.8],
      [0, 40, 10],
      [120, 9, 12],
    ]) {
      const px = fitAnchorPx(s0, p0, p1);
      const bar = (s0 + px) / p0;
      expect(bar * p1 - px).toBeCloseTo(0, 6);
    }
    expect(fitAnchorPx(300, 10, 10)).toBe(0);
  });

  it('wheelFactor zooms in on wheel-up and is symmetric', () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100) * wheelFactor(-100)).toBeCloseTo(1, 10);
  });

  it('ruler labels thin out as the zoom shrinks', () => {
    expect(barLabelEvery(6)).toBe(8);
    expect(barLabelEvery(16)).toBe(4);
    expect(barLabelEvery(30)).toBe(2);
    expect(barLabelEvery(60)).toBe(1);
  });

  it('laneWindow covers the viewport with a margin and only moves tile by tile', () => {
    const total = 20000;
    for (const scroll of [0, 100, 799, 800, 4321, 19000]) {
      const w = laneWindow(scroll, 800, total);
      expect(w.start).toBeLessThanOrEqual(scroll);
      expect(w.start + w.width).toBeGreaterThanOrEqual(Math.min(total, scroll + 800));
      expect(w.width).toBeLessThanOrEqual(2400);
    }
    // scrolling inside a tile keeps the same window: nothing to redraw
    expect(laneWindow(1700, 800, total)).toEqual(laneWindow(2300, 800, total));
    expect(laneWindow(1500, 800, total)).not.toEqual(laneWindow(1700, 800, total));
    // a short song is covered whole
    expect(laneWindow(0, 800, 600)).toEqual({ start: 0, width: 600 });
  });

  it('clampLane keeps lane heights sane', () => {
    expect(clampLane(5)).toBe(24);
    expect(clampLane(1000)).toBe(240);
    expect(clampLane(47.6)).toBe(48);
  });
});
