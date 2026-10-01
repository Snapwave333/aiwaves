import { signal } from '@angular/core';
import type { MockInstance } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AudioService } from '../../core/audio.service';
import { BAND_COUNT, EnergyTracker, IDLE_LEVEL, SETTLED } from './audio-energy';
import { MetaballFrame, MetaballRenderer, computeDrawingBufferSize } from './metaball-renderer';
import {
  ARC_SPAN,
  ARC_START,
  LEAD_ORB,
  ORB_COUNT,
  computeOrbPlacements,
  orbHue,
} from './orb-choreography';
import { VisualizerComponent } from './visualizer.component';

describe('computeDrawingBufferSize', () => {
  const BUDGET = 1_600_000;

  it('renders the player strip at full device resolution', () => {
    expect(computeDrawingBufferSize(1300, 160, 2)).toEqual({ width: 2600, height: 320 });
  });

  it('never exceeds 2x, however dense the display', () => {
    expect(computeDrawingBufferSize(400, 100, 4).width).toBe(800);
  });

  it('caps large canvases to the fill budget and keeps their aspect', () => {
    const large = computeDrawingBufferSize(2560, 1200, 2);
    expect(large.width * large.height).toBeLessThanOrEqual(BUDGET);
    expect(large.width / large.height).toBeCloseTo(2560 / 1200, 2);
  });

  it('stays at least one pixel for a collapsed canvas', () => {
    expect(computeDrawingBufferSize(0, 0, 2)).toEqual({ width: 1, height: 1 });
  });
});

describe('orb choreography', () => {
  const energy = { bands: new Array(BAND_COUNT).fill(0.9), level: 0.9, pulse: 1 };

  it('keeps every orb on the canvas, whatever the music does', () => {
    const aspect = 1300 / 160;
    for (let t = 0; t < 120; t += 0.37) {
      for (const orb of computeOrbPlacements(t, energy, aspect, 7)) {
        expect(Math.abs(orb.x)).toBeLessThanOrEqual(aspect / 2);
        expect(Math.abs(orb.y)).toBeLessThanOrEqual(0.48);
        expect(orb.radius).toBeGreaterThan(0);
      }
    }
  });

  it('is a pure function of time (the loop can park and resume without a jump)', () => {
    expect(computeOrbPlacements(41.5, energy, 8, 3)).toEqual(
      computeOrbPlacements(41.5, energy, 8, 3),
    );
  });

  it('colours the lead orb with the accent and the rest from the cyan-to-magenta arc', () => {
    expect(orbHue(LEAD_ORB, 0.08)).toBe(0.08);
    for (let i = 0; i < ORB_COUNT; i++) {
      if (i === LEAD_ORB) continue;
      const h = orbHue(i, 0.08);
      expect(h).toBeGreaterThanOrEqual(ARC_START);
      expect(h).toBeLessThanOrEqual(ARC_START + ARC_SPAN);
    }
  });
});

describe('EnergyTracker (the real-audio signal)', () => {
  const DT = 1 / 60;

  it('rests at the idle level with no pulse while nothing plays', () => {
    const e = new EnergyTracker();
    let f = e.step(null, false, DT);
    for (let i = 0; i < 120; i++) f = e.step(null, false, DT);
    expect(f.bands.every((b) => b === IDLE_LEVEL)).toBe(true);
    expect(f.pulse).toBe(0);
    expect(e.envelope).toBe(0);
  });

  it('pulses on each kick in the low end and decays between them', () => {
    const e = new EnergyTracker();
    const quiet = new Float32Array(BAND_COUNT).fill(0.35);
    const kick = new Float32Array(BAND_COUNT).fill(0.35);
    kick[0] = kick[1] = 0.95;
    // 4 s at 120 BPM: a kick every 30 frames
    let peak = 0;
    let between = 1;
    for (let frame = 0; frame < 240; frame++) {
      const f = e.step(frame % 30 < 3 ? kick : quiet, true, DT);
      if (frame < 120) continue;
      if (frame % 30 === 3) peak = Math.max(peak, f.pulse);
      if (frame % 30 === 25) between = Math.min(between, f.pulse);
    }
    expect(peak).toBeGreaterThan(0.5);
    expect(between).toBeLessThan(0.15);
  });

  it('moves a band above the middle when it gets louder than it has been', () => {
    const e = new EnergyTracker();
    const steady = new Float32Array(BAND_COUNT).fill(0.5);
    for (let i = 0; i < 300; i++) e.step(steady, true, DT);
    const swell = new Float32Array(BAND_COUNT).fill(0.5);
    swell[3] = 0.85;
    let f = e.step(swell, true, DT);
    for (let i = 0; i < 10; i++) f = e.step(swell, true, DT);
    expect(f.bands[3]).toBeGreaterThan(f.bands[2] + 0.2);
  });

  it('settles to rest within a few seconds of a pause', () => {
    const e = new EnergyTracker();
    const loud = new Float32Array(BAND_COUNT).fill(0.8);
    for (let i = 0; i < 120; i++) e.step(loud, true, DT);
    let frames = 0;
    while (e.envelope >= SETTLED && frames < 1000) {
      e.step(null, false, DT);
      frames++;
    }
    expect(frames / 60).toBeLessThan(4);
  });
});

/**
 * The frame loop decides whether anything is drawn at all. requestAnimationFrame and the clock are
 * driven by hand (honouring ids: Angular's scheduler uses rAF too), and the GL renderer is a fake.
 */
describe('VisualizerComponent', () => {
  let scheduled: Map<number, FrameRequestCallback>;
  let nextId: number;
  let now: number;
  let hidden: boolean;
  let audio: ReturnType<typeof fakeAudio>;
  let renderer: { render: MockInstance; dispose: MockInstance; setSize: MockInstance };
  let create: MockInstance<typeof MetaballRenderer.create>;

  function fakeAudio() {
    return {
      playing: signal(false),
      bins: 1024,
      sampleRate: 44100,
      src: signal<string | null>('/demo/longing/audio/master.wav'),
      time: signal(0),
      envelope: { peaks: [] as number[], duration: 0 },
      spectrum: (out: Uint8Array) => {
        out.fill(180);
        return true;
      },
    };
  }

  function pump(seconds = 1 / 60): void {
    const due = [...scheduled.values()];
    scheduled.clear();
    now += seconds * 1000;
    for (const cb of due) cb(now);
  }

  const renders = () => renderer.render.mock.calls.length;
  const lastFrame = () => renderer.render.mock.calls.at(-1)![0] as MetaballFrame;

  /** Pumps until the visualizer stops drawing; returns how many frames it took. */
  function pumpUntilQuiet(limit = 2000): number {
    for (let n = 1; n <= limit; n++) {
      const before = renders();
      pump();
      if (renders() === before) return n;
    }
    throw new Error('the visualizer never stopped drawing');
  }

  async function mount(): Promise<ComponentFixture<VisualizerComponent>> {
    const f = TestBed.createComponent(VisualizerComponent);
    await f.whenStable();
    return f;
  }

  beforeEach(() => {
    scheduled = new Map();
    nextId = 1;
    now = 10_000;
    hidden = false;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = nextId++;
      scheduled.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => scheduled.delete(id));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    audio = fakeAudio();
    renderer = { render: vi.fn(), dispose: vi.fn(), setSize: vi.fn() };
    create = vi
      .spyOn(MetaballRenderer, 'create')
      .mockImplementation(() => renderer as unknown as MetaballRenderer);
    TestBed.configureTestingModule({ providers: [{ provide: AudioService, useValue: audio }] });
  });

  afterEach(() => {
    delete (document as { hidden?: boolean }).hidden;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('paints one resting frame, then waits for the music', async () => {
    const f = await mount();
    expect(create).toHaveBeenCalledTimes(1);
    expect(renders()).toBe(1);
    expect(lastFrame().energy.level).toBeCloseTo(IDLE_LEVEL);
    pump();
    pump();
    expect(renders()).toBe(1);
    expect(f.nativeElement.classList).not.toContain('off');
  });

  it('animates while the song plays, driven by its spectrum, and parks after a pause', async () => {
    await mount();
    audio.playing.set(true);
    TestBed.tick();
    for (let i = 0; i < 90; i++) pump();
    expect(renders()).toBeGreaterThanOrEqual(90);
    const playing = lastFrame();
    expect(playing.energy.level).toBeGreaterThan(IDLE_LEVEL + 0.1);
    expect(playing.trails).toBe(true);
    expect(playing.time).toBeGreaterThan(1.4);

    audio.playing.set(false);
    TestBed.tick();
    const frames = pumpUntilQuiet();
    // it settles (the orbs ease back to rest) instead of freezing mid-swell, then stops
    expect(frames).toBeGreaterThan(30);
    expect(frames / 60).toBeLessThan(5);
    expect(scheduled.size).toBe(0);
  });

  it('stops while the page is hidden and resumes when it is shown again', async () => {
    await mount();
    audio.playing.set(true);
    TestBed.tick();
    pump();
    pump();
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    const before = renders();
    for (let i = 0; i < 20; i++) pump();
    expect(renders()).toBe(before);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    pump();
    pump();
    expect(renders()).toBe(before + 2);
  });

  it('cancels its frame and releases the GL context when destroyed', async () => {
    const f = await mount();
    audio.playing.set(true);
    TestBed.tick();
    pump();
    f.destroy();
    const before = renders();
    pump();
    expect(renders()).toBe(before);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
  });

  it('with reduced motion, drifts very slowly: no trails, no beat pulse, a fifth of the speed', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
    await mount();
    audio.playing.set(true);
    TestBed.tick();
    for (let i = 0; i < 60; i++) pump();
    expect(renders()).toBe(61);
    const f = lastFrame();
    expect(f.trails).toBe(false);
    expect(f.energy.pulse).toBe(0);
    expect(f.time).toBeCloseTo(0.2, 5);
    // it still follows the song, slowly
    expect(f.energy.level).toBeGreaterThan(IDLE_LEVEL);
    audio.playing.set(false);
    TestBed.tick();
    pumpUntilQuiet();
    expect(scheduled.size).toBe(0);
  });

  it('hides itself when the GL context is lost, and comes back when it is restored', async () => {
    const f = await mount();
    audio.playing.set(true);
    TestBed.tick();
    pump();
    const canvas = (f.nativeElement as HTMLElement).querySelector('canvas')!;
    const lost = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    await f.whenStable();
    expect(f.nativeElement.classList).toContain('off');
    const before = renders();
    pump();
    expect(renders()).toBe(before);

    canvas.dispatchEvent(new Event('webglcontextrestored'));
    await f.whenStable();
    expect(create).toHaveBeenCalledTimes(2);
    expect(f.nativeElement.classList).not.toContain('off');
    pump();
    expect(renders()).toBeGreaterThan(before + 1);
  });

  it('falls back silently when WebGL2 is unavailable', async () => {
    create.mockRestore();
    const f = await mount();
    audio.playing.set(true);
    TestBed.tick();
    pump();
    expect(f.nativeElement.classList).toContain('off');
  });

  it('repaints a parked canvas at its new size when it is resized', async () => {
    const observed: { cb?: ResizeObserverCallback } = {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: ResizeObserverCallback) {
          observed.cb = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    await mount();
    expect(renders()).toBe(1);
    observed.cb!(
      [{ contentRect: { width: 900, height: 150 } } as ResizeObserverEntry],
      {} as ResizeObserver,
    );
    expect(renderer.setSize).toHaveBeenLastCalledWith(900, 150);
    expect(renders()).toBe(2);
  });
});
