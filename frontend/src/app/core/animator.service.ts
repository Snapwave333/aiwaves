import { Injectable, computed, signal } from '@angular/core';
import { controlPath } from './apply';
import { AiEvent, Json } from './model';

export interface Anim {
  /** data-path of the control (or `event:<seq>` when the event targets no control). */
  path: string;
  seq: number;
  from: Json;
  to: Json;
  t0: number;
  /** False for a reveal (feed click): glow and caption only, the control doesn't move. */
  tween: boolean;
  agent: string;
  verb: string;
  reason: string;
}

export const reducedMotion =
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const TWEEN_MS = reducedMotion ? 0 : 400;
export const GLOW_MS = 1600;
export const CAPTION_MS = 4000;
/** Captions on screen at once; fast scrubbing would otherwise bury the UI. */
export const MAX_CAPTIONS = 3;

/** A number to tween through: plain numbers, or the start bar of a moved clip. */
export function numericOf(v: Json): number | null {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof v['start_bar'] === 'number')
    return v['start_bar'];
  return null;
}

export function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/**
 * The animated mapping: when an event is presented, the control at its path tweens from `from`
 * to `to`, glows, and carries the reason as a caption. Controls ask `value()` / `glow()` with
 * their own path; only controls that are animating subscribe to the frame clock.
 */
@Injectable({ providedIn: 'root' })
export class Animator {
  private readonly active = signal<ReadonlyMap<string, Anim>>(new Map());
  /** Frame clock, advanced by requestAnimationFrame while anything is animating. */
  readonly now = signal(performance.now());
  /** The event whose control most recently moved (the feed highlights it). */
  readonly highlightSeq = signal<number | null>(null);
  readonly captions = computed(() => {
    const now = this.now();
    return [...this.active().values()]
      .filter((a) => now - a.t0 < CAPTION_MS)
      .sort((a, b) => a.t0 - b.t0)
      .slice(-MAX_CAPTIONS);
  });

  private raf = 0;
  private highlightTimer: ReturnType<typeof setTimeout> | undefined;

  /** direction 1: the event is being applied (from -> to); -1: un-applied (to -> from). */
  trigger(event: AiEvent, direction: 1 | -1 = 1, tween = true): Anim {
    const t0 = performance.now();
    const anim: Anim = {
      path: controlPath(event) ?? `event:${event.seq}`,
      seq: event.seq,
      from: direction === 1 ? event.from : event.to,
      to: direction === 1 ? event.to : event.from,
      t0,
      tween,
      agent: event.agent,
      verb: event.verb,
      reason: event.reason,
    };
    const next = new Map(this.active());
    next.set(anim.path, anim);
    this.active.set(next);
    this.now.set(t0);
    this.highlightSeq.set(event.seq);
    clearTimeout(this.highlightTimer);
    this.highlightTimer = setTimeout(() => this.highlightSeq.set(null), CAPTION_MS);
    this.loop();
    return anim;
  }

  clear(): void {
    this.active.set(new Map());
    this.highlightSeq.set(null);
  }

  /** The value a numeric control shows right now: tweened while animating, else `actual`. */
  value(path: string, actual: number): number {
    const a = this.active().get(path);
    if (!a?.tween) return actual;
    const from = numericOf(a.from);
    const to = numericOf(a.to);
    if (from === null || to === null) return actual;
    const x = TWEEN_MS === 0 ? 1 : Math.min(1, Math.max(0, (this.now() - a.t0) / TWEEN_MS));
    return x >= 1 ? actual : from + (to - from) * easeInOutCubic(x);
  }

  /** True while the control at `path` should glow. */
  glow(path: string): boolean {
    const a = this.active().get(path);
    return !!a && this.now() - a.t0 < GLOW_MS;
  }

  /** True while any control under `prefix` (e.g. a whole track) is glowing. */
  glowUnder(prefix: string): boolean {
    const now = this.now();
    for (const a of this.active().values()) {
      if ((a.path === prefix || a.path.startsWith(prefix + '.')) && now - a.t0 < GLOW_MS)
        return true;
    }
    return false;
  }

  private loop(): void {
    if (this.raf || typeof requestAnimationFrame === 'undefined') return;
    const step = () => {
      // performance.now(), not the rAF timestamp: that can predate t0 and run the tween backwards
      const t = performance.now();
      this.raf = 0;
      this.now.set(t);
      const alive = [...this.active().values()].filter((a) => t - a.t0 < CAPTION_MS);
      if (alive.length !== this.active().size)
        this.active.set(new Map(alive.map((a) => [a.path, a])));
      if (alive.length) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
}
