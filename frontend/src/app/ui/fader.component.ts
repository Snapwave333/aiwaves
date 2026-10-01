import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Animator } from '../core/animator.service';
import { Track } from '../core/model';
import { formatDb } from '../core/time';
import { FADER_MAX_DB, FADER_MIN_DB, MeterDirective, faderPos } from './live-style.directives';

/** Read-only volume fader with a level meter beside it. */
@Component({
  selector: 'aw-fader',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MeterDirective],
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
        <div class="meter-fill" [awMeter]="track()" scale="db"></div>
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
  /** The track whose level the meter shows. */
  readonly track = input.required<Track>();

  protected readonly minDb = FADER_MIN_DB;
  protected readonly maxDb = FADER_MAX_DB;
  protected readonly marks = [6, 0, -12, -24, -36, -48].map((db) => ({ db, pos: faderPos(db) }));
  protected readonly shown = computed(() => this.animator.value(this.path(), this.db()));
  protected readonly pos = computed(() => faderPos(this.shown()));
  protected readonly glowing = computed(() => this.animator.glow(this.path()));
  protected readonly text = computed(() => formatDb(this.shown()));
}
