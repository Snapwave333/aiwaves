import { Injectable, signal } from '@angular/core';

/**
 * Plays the master render. Publishes the playhead (`time`) every frame while playing and a
 * master level 0..1: from a WebAudio AnalyserNode when the audio is same-origin (cross-origin
 * audio through WebAudio would be silenced without CORS), otherwise from the project's peaks.
 */
@Injectable({ providedIn: 'root' })
export class AudioService {
  readonly time = signal(0);
  readonly duration = signal(0);
  readonly playing = signal(false);
  readonly level = signal(0);
  readonly error = signal<string | null>(null);
  readonly src = signal<string | null>(null);

  private readonly el: HTMLAudioElement | null = typeof Audio === 'undefined' ? null : new Audio();
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Float32Array<ArrayBuffer> | null = null;
  private peaks: readonly number[] = [];
  private peaksDuration = 0;
  private raf = 0;

  constructor() {
    const el = this.el;
    if (!el) return;
    el.preload = 'metadata';
    el.addEventListener('loadedmetadata', () => {
      this.duration.set(el.duration || 0);
      this.error.set(null);
    });
    el.addEventListener('timeupdate', () => this.time.set(el.currentTime));
    el.addEventListener('play', () => {
      this.playing.set(true);
      this.loop();
    });
    el.addEventListener('pause', () => this.playing.set(false));
    el.addEventListener('ended', () => this.playing.set(false));
    el.addEventListener('error', () => {
      this.playing.set(false);
      this.error.set('audio unavailable');
    });
  }

  /** Points the player at a render, keeping the playhead where it was. */
  load(url: string, peaks: readonly number[], durationS: number): void {
    this.peaks = peaks;
    this.peaksDuration = durationS;
    if (!this.duration()) this.duration.set(durationS);
    if (!this.el || this.src() === url) return;
    const at = this.el.currentTime;
    const wasPlaying = this.playing();
    this.src.set(url);
    this.error.set(null);
    this.el.src = url;
    if (at) this.el.currentTime = at;
    if (wasPlaying) void this.play();
  }

  async play(): Promise<void> {
    if (!this.el) return;
    this.ensureGraph();
    await this.ctx?.resume();
    try {
      await this.el.play();
    } catch {
      this.error.set('audio unavailable');
    }
  }

  pause(): void {
    this.el?.pause();
  }

  toggle(): void {
    if (this.playing()) this.pause();
    else void this.play();
  }

  stop(): void {
    this.pause();
    this.seek(0);
  }

  seek(t: number): void {
    const d = this.duration();
    const clamped = Math.max(0, d ? Math.min(t, d) : t);
    if (this.el) this.el.currentTime = clamped;
    this.time.set(clamped);
  }

  private ensureGraph(): void {
    if (this.ctx || !this.el || typeof AudioContext === 'undefined') return;
    const url = new URL(this.el.src || location.href, location.href);
    if (url.origin !== location.origin) return;
    this.ctx = new AudioContext();
    const source = this.ctx.createMediaElementSource(this.el);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.buf = new Float32Array(this.analyser.fftSize);
    source.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  private measure(): number {
    if (this.analyser && this.buf) {
      this.analyser.getFloatTimeDomainData(this.buf);
      let peak = 0;
      for (const v of this.buf) peak = Math.max(peak, Math.abs(v));
      return peak;
    }
    if (!this.peaks.length || !this.peaksDuration) return 0;
    const i = Math.floor((this.time() / this.peaksDuration) * this.peaks.length);
    return this.peaks[Math.min(this.peaks.length - 1, Math.max(0, i))] ?? 0;
  }

  private loop(): void {
    if (this.raf) return;
    const step = () => {
      this.raf = 0;
      if (this.el) this.time.set(this.el.currentTime);
      const target = this.playing() ? this.measure() : 0;
      const prev = this.level();
      // fast attack, slow release, like a hardware peak meter
      const next = target > prev ? target : prev * 0.9 + target * 0.1;
      this.level.set(next < 0.002 ? 0 : next);
      if (this.playing() || next > 0.002) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
}
