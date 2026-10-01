import { Injectable, computed, signal } from '@angular/core';
import { INITIAL_PLAYER, PlayerInput, PlayerState, isPlaying, playerStep } from './player-state';

/** Called once per animation frame while audio plays (and while the meters fall back to 0). */
export type FrameFn = (now: number) => void;

const VOLUME_KEY = 'aiwaves.volume';

export function mediaErrorText(code: number | undefined): string {
  switch (code) {
    case 1:
      return 'Loading the render was interrupted.';
    case 2:
      return 'A network error stopped the render from loading.';
    case 3:
      return "The render couldn't be decoded.";
    case 4:
      return 'There is no render to play at this address yet.';
    default:
      return 'The audio is unavailable.';
  }
}

/**
 * The one audio element of the app: it plays the master render. Publishes the playhead (`time`)
 * every frame while playing and a master level 0..1: from a WebAudio AnalyserNode when the audio
 * is same-origin (cross-origin audio through WebAudio would be silenced without CORS), otherwise
 * from the project's peaks. Visuals that need per-frame data (the player's spectrum ring)
 * subscribe with `onFrame` and read `spectrum` / `waveform` directly instead of going through
 * signals, so they cost no change detection.
 */
@Injectable({ providedIn: 'root' })
export class AudioService {
  readonly time = signal(0);
  readonly duration = signal(0);
  readonly level = signal(0);
  readonly error = signal<string | null>(null);
  readonly src = signal<string | null>(null);
  readonly volume = signal(1);
  readonly muted = signal(false);
  /** Bins of `spectrum()` (half the FFT size). */
  readonly bins = 1024;

  private readonly state = signal<PlayerState>(INITIAL_PLAYER);
  readonly status = computed(() => this.state().status);
  readonly playing = computed(() => isPlaying(this.state().status));
  /** Increments when a playthrough starts (CONTRACT section 10: a new cover). */
  readonly playthrough = computed(() => this.state().playthrough);

  private readonly el: HTMLAudioElement | null = typeof Audio === 'undefined' ? null : new Audio();
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Float32Array<ArrayBuffer> | null = null;
  private peaks: readonly number[] = [];
  private peaksDuration = 0;
  private raf = 0;
  private readonly frameFns = new Set<FrameFn>();

  constructor() {
    const el = this.el;
    if (!el) return;
    el.preload = 'metadata';
    const saved = Number(globalThis.localStorage?.getItem(VOLUME_KEY) ?? 1);
    if (Number.isFinite(saved)) this.setVolume(saved, false);
    el.addEventListener('loadedmetadata', () => {
      this.duration.set(el.duration || this.peaksDuration);
      this.error.set(null);
      this.dispatch({ type: 'loaded', at: el.currentTime });
    });
    el.addEventListener('timeupdate', () => this.time.set(el.currentTime));
    el.addEventListener('play', () => {
      this.dispatch({ type: 'play', at: el.currentTime });
      this.loop();
    });
    el.addEventListener('waiting', () => this.dispatch({ type: 'waiting' }));
    el.addEventListener('playing', () => this.dispatch({ type: 'playing' }));
    el.addEventListener('pause', () => this.dispatch({ type: 'pause', at: el.currentTime }));
    el.addEventListener('ended', () => this.dispatch({ type: 'ended' }));
    el.addEventListener('error', () => {
      this.dispatch({ type: 'error' });
      this.error.set(mediaErrorText(el.error?.code));
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
    this.dispatch({ type: 'load' });
    this.el.src = url;
    if (at) this.el.currentTime = at;
    if (wasPlaying) void this.play();
  }

  /** Tries the current render again after an error. */
  reload(): void {
    if (!this.el?.src) return;
    this.error.set(null);
    this.dispatch({ type: 'load' });
    this.el.load();
  }

  async play(): Promise<void> {
    if (!this.el) return;
    this.ensureGraph();
    await this.ctx?.resume();
    try {
      await this.el.play();
    } catch (e) {
      // a newer load() interrupted this play(): not an error
      if (e instanceof DOMException && e.name === 'AbortError') return;
      this.error.set(mediaErrorText(this.el.error?.code));
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
    this.dispatch({ type: 'seek', at: clamped });
  }

  setVolume(v: number, persist = true): void {
    const clamped = Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
    this.volume.set(clamped);
    if (this.el) this.el.volume = clamped;
    if (clamped > 0 && this.muted()) this.toggleMute();
    if (persist) globalThis.localStorage?.setItem(VOLUME_KEY, String(clamped));
  }

  toggleMute(): void {
    const next = !this.muted();
    this.muted.set(next);
    if (this.el) this.el.muted = next;
  }

  /** Subscribes `fn` to the playback frame loop; returns the unsubscribe function. */
  onFrame(fn: FrameFn): () => void {
    this.frameFns.add(fn);
    return () => this.frameFns.delete(fn);
  }

  /** Byte frequency data into `out`. False when there is no analyser (cross-origin audio). */
  spectrum(out: Uint8Array<ArrayBuffer>): boolean {
    if (!this.analyser) return false;
    this.analyser.getByteFrequencyData(out);
    return true;
  }

  /** Byte time-domain data (128 = silence) into `out`. False without an analyser. */
  waveform(out: Uint8Array<ArrayBuffer>): boolean {
    if (!this.analyser) return false;
    this.analyser.getByteTimeDomainData(out);
    return true;
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 44100;
  }

  /** The project's master peaks and their duration (the analyser-less fallback). */
  get envelope(): { peaks: readonly number[]; duration: number } {
    return { peaks: this.peaks, duration: this.peaksDuration };
  }

  private dispatch(input: PlayerInput): void {
    this.state.update((s) => playerStep(s, input));
  }

  private ensureGraph(): void {
    if (this.ctx || !this.el || typeof AudioContext === 'undefined') return;
    const url = new URL(this.el.src || location.href, location.href);
    if (url.origin !== location.origin) return;
    this.ctx = new AudioContext();
    const source = this.ctx.createMediaElementSource(this.el);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = this.bins * 2;
    this.analyser.smoothingTimeConstant = 0.72;
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
    const step = (now: number) => {
      this.raf = 0;
      if (this.el) this.time.set(this.el.currentTime);
      const target = this.playing() ? this.measure() : 0;
      const prev = this.level();
      // fast attack, slow release, like a hardware peak meter
      const next = target > prev ? target : prev * 0.9 + target * 0.1;
      this.level.set(next < 0.002 ? 0 : next);
      for (const fn of this.frameFns) fn(now);
      if (this.playing() || next > 0.002) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
}
