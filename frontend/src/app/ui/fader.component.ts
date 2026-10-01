import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Animator } from '../core/animator.service';
import { formatDb } from '../core/time';

export const FADER_MIN_DB = -48;
export const FADER_MAX_DB = 6;

/** 0..1 travel for a volume in dB (linear in dB, -inf at the bottom). */
export function faderPos(db: number): number {
  return Math.min(1, Math.max(0, (db - FADER_MIN_DB) / (FADER_MAX_DB - FADER_MIN_DB)));
}

/** Read-only volume fader with a level meter beside it. */
@Component({
  selector: 'aw-fader',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fader',
    '[class.glow]': 'glowing()',
    '[attr.data-path]': 'path()',
    role: 'meter',
    '[attr.aria-label]': 'label()',
    '[attr.aria-valuemin]': 'minDb',
    '[attr.aria-valuemax]': 'maxDb',
    '[attr.aria-valuenow]': 'db()',
    '[attr.aria-valuetext]': 'text()',
  },
  template: `
    <div class="fader-body">
      <div class="fader-scale" aria-hidden="true">
        @for (m of marks; track m.db) {
          <span [style.bottom.%]="m.pos * 100">{{ m.db }}</span>
        }
      </div>
      <div class="fader-slot">
        <div class="fader-fill" [style.height.%]="pos() * 100"></div>
        <div class="fader-cap" [style.bottom.%]="pos() * 100"></div>
      </div>
      <div class="meter" aria-hidden="true">
        <div
          class="meter-fill"
          [style.height.%]="meterPos() * 100"
          [class.hot]="meterPos() > 0.89"
        ></div>
      </div>
    </div>
    <span class="fader-value">{{ text() }}</span>
  `,
})
export class FaderComponent {
  private readonly animator = inject(Animator);

  readonly path = input.required<string>();
  readonly label = input.required<string>();
  readonly db = input.required<number>();
  /** Meter level 0..1 (linear amplitude). */
  readonly level = input(0);

  protected readonly minDb = FADER_MIN_DB;
  protected readonly maxDb = FADER_MAX_DB;
  protected readonly marks = [6, 0, -12, -24, -36, -48].map((db) => ({ db, pos: faderPos(db) }));
  protected readonly shown = computed(() => this.animator.value(this.path(), this.db()));
  protected readonly pos = computed(() => faderPos(this.shown()));
  protected readonly glowing = computed(() => this.animator.glow(this.path()));
  protected readonly text = computed(() => formatDb(this.shown()));
  protected readonly meterPos = computed(() =>
    this.level() > 0 ? faderPos(20 * Math.log10(this.level())) : 0,
  );
}
