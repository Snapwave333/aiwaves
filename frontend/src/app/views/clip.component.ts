import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Animator } from '../core/animator.service';
import { Clip } from '../core/model';
import { NAME_MIN_PX } from './clip-render';

/**
 * One clip box in the arrangement, Live-style: a tinted body with a name bar in the clip colour.
 * Its contents (waveform, notes, drum hits) are drawn by the lane's canvas on top of it. The box
 * carries the clip's `data-path`, so `clip.move` slides it and `clip.add` makes it glow.
 */
@Component({
  selector: 'aw-clip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'clip',
    '[attr.data-path]': 'path()',
    '[class.glow]': 'glowing()',
    '[class.ghost]': 'ghost()',
    '[class.playing]': 'playing()',
    '[class.narrow]': 'width() < nameMinPx',
    '[style.left.px]': 'left()',
    '[style.width.px]': 'width()',
    '[style.--clip]': 'color()',
    '[attr.title]': 'tooltip()',
  },
  template: `<span class="clip-name">{{ clip().name }}</span>`,
})
export class ClipComponent {
  private readonly animator = inject(Animator);

  readonly clip = input.required<Clip>();
  readonly path = input.required<string>();
  readonly color = input.required<string>();
  readonly ppb = input.required<number>();
  readonly ghost = input(false);
  readonly playing = input(false);

  protected readonly nameMinPx = NAME_MIN_PX;
  protected readonly glowing = computed(() => this.animator.glow(this.path()));
  protected readonly left = computed(
    () => this.animator.value(this.path(), this.clip().start_bar) * this.ppb(),
  );
  protected readonly width = computed(() => Math.max(2, this.clip().length_bars * this.ppb()));
  protected readonly tooltip = computed(() => {
    const c = this.clip();
    const what = c.peaks?.length ? 'audio' : c.notes?.length ? `${c.notes.length} notes` : '';
    const where = `bar ${(c.start_bar + 1).toFixed(2)}, ${c.length_bars.toFixed(2)} bars`;
    return `${c.name} — ${where}${what ? ' · ' + what : ''}`;
  });
}
