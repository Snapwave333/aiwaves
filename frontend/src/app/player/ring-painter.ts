import { AudioService } from '../core/audio.service';
import { RingPoint, decay, envelopeBands, hexRing, logBands, mirrorIndex } from './spectrum';

/** Ring geometry in CSS px: hexagon circumradius, bar gap and length, canvas size. */
export const RING = { r: 60, gap: 3, minBar: 2, maxBar: 15, w: 160, h: 142, points: 84 } as const;
const SCOPE_INSET = 6;
const SCOPE_AMP = 4;
const COLOR_EVERY_FRAMES = 6;

/**
 * Draws the hexagonal spectrum ring around the cover art: one bar per ring point (mirrored
 * log-frequency bands), a glowing hexagon outline and an oscilloscope trace just inside it.
 * Allocates nothing per frame.
 */
export class RingPainter {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly points: RingPoint[] = hexRing(RING.points, RING.r);
  private readonly scope: RingPoint[] = hexRing(RING.points * 2, RING.r - SCOPE_INSET);
  private readonly target = new Float32Array(RING.points / 2);
  private readonly shown = new Float32Array(RING.points / 2);
  private readonly freq: Uint8Array<ArrayBuffer>;
  private readonly wave: Uint8Array<ArrayBuffer>;
  private accent = '#00e5ff';
  private frame = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly audio: AudioService,
  ) {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    canvas.width = Math.round(RING.w * dpr);
    canvas.height = Math.round(RING.h * dpr);
    this.ctx = typeof CanvasRenderingContext2D === 'undefined' ? null : canvas.getContext('2d');
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.freq = new Uint8Array(audio.bins);
    this.wave = new Uint8Array(audio.bins * 2);
  }

  /** Band levels 0..1 (smoothed), low to high: the badge's equalizer reads these too. */
  get bands(): Float32Array {
    return this.shown;
  }

  /** One frame. While paused the bars fall back to rest. */
  draw(playing: boolean): void {
    if (playing) {
      if (this.audio.spectrum(this.freq)) logBands(this.freq, this.audio.sampleRate, this.target);
      else {
        const { peaks, duration } = this.audio.envelope;
        envelopeBands(peaks, this.audio.time(), duration, this.target);
      }
    } else this.target.fill(0);
    decay(this.shown, this.target, playing ? 0.86 : 0.8);
    if (this.frame++ % COLOR_EVERY_FRAMES === 0) this.readColors();
    this.paint(playing);
  }

  /** Re-reads the accent (after the cover art changed it) and draws the ring at rest. */
  refresh(): void {
    this.readColors();
    this.paint(false);
  }

  private readColors(): void {
    const c = getComputedStyle(this.canvas).getPropertyValue('--mat-sys-primary').trim();
    if (c) this.accent = c;
  }

  private paint(playing: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const cx = RING.w / 2;
    const cy = RING.h / 2;
    ctx.clearRect(0, 0, RING.w, RING.h);

    // the hexagon outline
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      if (i === 0) ctx.moveTo(cx + p.x, cy + p.y);
      else ctx.lineTo(cx + p.x, cy + p.y);
    }
    ctx.closePath();
    ctx.stroke();

    // spectrum bars: accent at the base, magenta tips on the loud ones
    const n = this.points.length;
    ctx.lineWidth = ((6 * RING.r) / n) * 0.5;
    ctx.lineCap = 'butt';
    for (let i = 0; i < n; i++) {
      const p = this.points[i];
      const v = this.shown[mirrorIndex(i, n)];
      const len = RING.minBar + v * RING.maxBar;
      const x0 = cx + p.x + p.nx * RING.gap;
      const y0 = cy + p.y + p.ny * RING.gap;
      ctx.globalAlpha = 0.45 + v * 0.55;
      ctx.strokeStyle = v > 0.72 ? '#ff2bd6' : this.accent;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + p.nx * len, y0 + p.ny * len);
      ctx.stroke();
    }

    // oscilloscope trace inside the ring
    if (playing && this.audio.waveform(this.wave)) {
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = this.accent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const step = this.wave.length / this.scope.length;
      for (let i = 0; i < this.scope.length; i++) {
        const p = this.scope[i];
        const d = ((this.wave[Math.floor(i * step)] - 128) / 128) * SCOPE_AMP;
        const x = cx + p.x - p.nx * d;
        const y = cy + p.y - p.ny * d;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
