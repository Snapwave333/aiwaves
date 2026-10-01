// The player's GLSL visualizer, ported from CarbonCast IPTV's radio player
// (libs/portal/radio/feature/src/lib/radio-visualizer/radio-visualizer.component.ts; MIT, see
// THIRD_PARTY_NOTICES.md). AIWaves changes: driven by the song's real spectrum (the app's one
// AnalyserNode) instead of a synthesised one; coloured from the AlienFX palette and the cover
// art's accent; stops when the page or the player is hidden; recovers from a lost GL context.
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { AudioService } from '../../core/audio.service';
import { parseColor, rgbToHsl } from '../../core/dynamic-color';
import { envelopeBands, logBands } from '../spectrum';
import { BAND_COUNT, EnergyFrame, EnergyTracker, IDLE_LEVEL, SETTLED } from './audio-energy';
import { MetaballFrame, MetaballRenderer } from './metaball-renderer';

/** Sway rate (revolutions per second) at rest; loud passages push it faster. */
const SWAY_RATE = 0.012;
const SWAY_RATE_GAIN = 0.05;
/** How far the sway moves every orb's hue: enough to shimmer, not enough to leave the palette. */
const SWAY_DEPTH = 0.035;
/** The accent glides for 900 ms after a new cover; re-reading it every few frames follows that. */
const ACCENT_EVERY_FRAMES = 8;
/**
 * Reduced motion, as the original answered it but slower still: the orbs drift at a fifth of the
 * speed, follow the music only through slow swells (no beat pulse, no darting), and leave no trails.
 */
const REDUCED_SPEED = 0.2;
const REDUCED_SMOOTHING_SECONDS = 0.8;
const CYAN = '#00e5ff';

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Stable per-song value in 0..1. */
function hashToUnit(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000) / 1000;
}

/**
 * Liquid metaballs behind the player that swell, fuse and dart with the music. The frame loop runs
 * while the song plays and while the orbs settle after a pause, then parks (the last frame stays
 * on screen); it never runs while the page or the player is hidden. Without WebGL2 (or after the
 * context is lost for good) the canvas just hides: the player itself doesn't depend on it.
 */
@Component({
  selector: 'aw-visualizer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'visualizer', 'aria-hidden': 'true', '[class.off]': '!supported()' },
  template: `<canvas #canvas class="visualizer-canvas"></canvas>`,
})
export class VisualizerComponent {
  private readonly audio = inject(AudioService);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  protected readonly supported = signal(true);

  private renderer: MetaballRenderer | null = null;
  private raf = 0;
  private lastAt = 0;
  private time = 0;
  private swayPhase = Math.random();
  private accentHue = 0;
  private rim: [number, number, number] = [0, 0.9, 1];
  private frames = 0;
  private onScreen = true;
  private readonly reduced = prefersReducedMotion();
  private readonly energy = new EnergyTracker();
  private readonly freq = new Uint8Array(this.audio.bins);
  private readonly measured = new Float32Array(BAND_COUNT);
  private readonly calmBands = new Array<number>(BAND_COUNT).fill(IDLE_LEVEL);

  constructor() {
    const destroyRef = inject(DestroyRef);
    const listeners = new AbortController();
    let resizeObserver: ResizeObserver | undefined;
    let intersectionObserver: IntersectionObserver | undefined;

    afterNextRender(() => {
      const canvas = this.canvasRef().nativeElement;
      const opts = { signal: listeners.signal };
      canvas.addEventListener(
        'webglcontextlost',
        (e) => {
          // preventDefault asks the browser to restore the context later
          e.preventDefault();
          this.park();
          this.renderer = null;
          this.supported.set(false);
        },
        opts,
      );
      canvas.addEventListener('webglcontextrestored', () => this.attach(canvas), opts);
      document.addEventListener(
        'visibilitychange',
        () => (document.hidden ? this.park() : this.wake()),
        opts,
      );
      if (typeof ResizeObserver === 'function') {
        resizeObserver = new ResizeObserver(([entry]) => {
          this.renderer?.setSize(entry.contentRect.width, entry.contentRect.height);
          // the loop resizes on its next frame; a parked canvas would stay stretched, so repaint
          if (!this.raf) this.paint();
        });
        resizeObserver.observe(canvas);
      }
      if (typeof IntersectionObserver === 'function') {
        intersectionObserver = new IntersectionObserver(([entry]) => {
          this.onScreen = entry.isIntersecting;
          if (this.onScreen) this.wake();
          else this.park();
        });
        intersectionObserver.observe(canvas);
      }
      this.attach(canvas);
    });

    // playing is what wakes the loop; once it settles after a pause it parks itself
    effect(() => {
      this.audio.playing();
      untracked(() => this.wake());
    });

    destroyRef.onDestroy(() => {
      listeners.abort();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      this.park();
      this.renderer?.dispose();
      this.renderer = null;
    });
  }

  private attach(canvas: HTMLCanvasElement): void {
    this.renderer = MetaballRenderer.create(canvas);
    this.supported.set(this.renderer !== null);
    if (!this.renderer) return;
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.paint();
    this.wake();
  }

  private get visible(): boolean {
    return this.onScreen && !(typeof document !== 'undefined' && document.hidden);
  }

  /** Starts the frame loop if there is anything to animate. */
  private wake(): void {
    if (!this.renderer || this.raf || !this.visible) return;
    if (!this.audio.playing() && this.energy.envelope < SETTLED) return;
    this.lastAt = performance.now() / 1000;
    this.raf = requestAnimationFrame(() => this.tick());
  }

  private park(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private tick(): void {
    this.raf = 0;
    if (!this.renderer) return;
    const now = performance.now() / 1000;
    // clamped so a stall doesn't resume with a jump
    const dt = Math.min(Math.max(0, now - this.lastAt), 0.1);
    this.lastAt = now;
    const speed = this.reduced ? REDUCED_SPEED : 1;
    this.time += dt * speed;

    const playing = this.audio.playing();
    const measured = this.energy.step(playing ? this.measure() : null, playing, dt);
    const energy = this.reduced ? this.calm(measured, dt) : measured;
    this.swayPhase += dt * speed * (SWAY_RATE + energy.level * SWAY_RATE_GAIN);
    this.swayPhase -= Math.floor(this.swayPhase);
    if (this.frames++ % ACCENT_EVERY_FRAMES === 0) this.readAccent();
    this.renderer.render(this.frame(energy, true));

    if (!playing && this.energy.envelope < SETTLED) return;
    if (this.visible) this.raf = requestAnimationFrame(() => this.tick());
  }

  /** One frame without advancing time: the first paint, or a resize while parked. */
  private paint(): void {
    if (!this.renderer) return;
    this.readAccent();
    const energy = this.energy.step(null, this.audio.playing(), 0);
    this.renderer.render(this.frame(this.reduced ? this.calm(energy, 0) : energy, false));
  }

  /** Reduced motion: the bands follow slowly and there is no pulse. */
  private calm(e: EnergyFrame, dt: number): EnergyFrame {
    const k = 1 - Math.exp(-dt / REDUCED_SMOOTHING_SECONDS);
    let total = 0;
    for (let i = 0; i < BAND_COUNT; i++) {
      this.calmBands[i] += (e.bands[i] - this.calmBands[i]) * k;
      total += this.calmBands[i];
    }
    return { bands: this.calmBands, level: total / BAND_COUNT, pulse: 0 };
  }

  private frame(energy: EnergyFrame, trails: boolean): MetaballFrame {
    return {
      time: this.time,
      sway: Math.sin(this.swayPhase * Math.PI * 2) * SWAY_DEPTH,
      accentHue: this.accentHue,
      rim: this.rim,
      energy,
      seed: Math.round(hashToUnit(this.audio.src() ?? '') * 1000),
      trails: trails && !this.reduced,
    };
  }

  /** This frame's seven bands: the real spectrum, or the master's peaks around the playhead. */
  private measure(): Float32Array {
    if (this.audio.spectrum(this.freq))
      return logBands(this.freq, this.audio.sampleRate, this.measured);
    const { peaks, duration } = this.audio.envelope;
    return envelopeBands(peaks, this.audio.time(), duration, this.measured);
  }

  private readAccent(): void {
    const canvas = this.canvasRef().nativeElement;
    const css = getComputedStyle(canvas).getPropertyValue('--mat-sys-primary').trim() || CYAN;
    const rgb = parseColor(css) ?? parseColor(CYAN)!;
    this.accentHue = rgbToHsl(rgb).h / 360;
    this.rim = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  }
}
