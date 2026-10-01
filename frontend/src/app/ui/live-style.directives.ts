import { Directive, ElementRef, effect, inject, input } from '@angular/core';
import { AudioService } from '../core/audio.service';
import { Track } from '../core/model';
import { Playhead } from '../core/playhead';
import { WorkspaceStore } from '../core/workspace.store';
import { trackLevel } from '../views/levels';

/**
 * These write per-frame values (playhead position, meter levels) straight to the element's
 * style from an effect. The templates that host them never read the per-frame signals, so a
 * playing song doesn't re-render the arrangement or the mixer sixty times a second.
 */

/** Places a playhead at the current bar: `translateX(offset + bar * ppb)` (no layout). */
@Directive({ selector: '[awPlayhead]' })
export class PlayheadDirective {
  /** Pixels per bar. */
  readonly awPlayhead = input.required<number>();
  readonly offset = input(0);

  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const playhead = inject(Playhead);
    effect(() => {
      const x = this.offset() + playhead.bar() * this.awPlayhead();
      el.style.transform = `translateX(${x.toFixed(1)}px)`;
    });
  }
}

/** dB at the top of the fader scale and at its bottom. */
export const FADER_MIN_DB = -48;
export const FADER_MAX_DB = 6;

/** 0..1 travel for a volume in dB (linear in dB, -inf at the bottom). */
export function faderPos(db: number): number {
  return Math.min(1, Math.max(0, (db - FADER_MIN_DB) / (FADER_MAX_DB - FADER_MIN_DB)));
}

/**
 * A track's meter as the element's height. `scale: 'db'` uses the fader's dB scale and adds
 * `.hot` near full scale; 'lin' is the plain amplitude (the arrangement's small meters).
 */
@Directive({ selector: '[awMeter]' })
export class MeterDirective {
  readonly awMeter = input.required<Track>();
  readonly scale = input<'lin' | 'db'>('lin');

  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const audio = inject(AudioService);
    const store = inject(WorkspaceStore);
    const playhead = inject(Playhead);
    effect(() => {
      const p = store.project();
      const v = p
        ? trackLevel(p, this.awMeter(), playhead.bar(), audio.playing(), audio.level())
        : 0;
      const db = this.scale() === 'db';
      const pos = db ? (v > 0 ? faderPos(20 * Math.log10(v)) : 0) : v;
      el.style.height = `${(pos * 100).toFixed(1)}%`;
      if (db) el.classList.toggle('hot', pos > 0.89);
    });
  }
}
