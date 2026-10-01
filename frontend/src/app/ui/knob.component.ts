import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Animator } from '../core/animator.service';

const START = -135;
const SWEEP = 270;

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  if (Math.abs(a1 - a0) < 0.01) return '';
  const lo = Math.min(a0, a1);
  const hi = Math.max(a0, a1);
  const [x0, y0] = polar(cx, cy, r, lo);
  const [x1, y1] = polar(cx, cy, r, hi);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${hi - lo > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Read-only rotary control. Animates and glows when an event targets its `path`. */
@Component({
  selector: 'aw-knob',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'knob',
    '[class.glow]': 'glowing()',
    '[attr.data-path]': 'path()',
    role: 'meter',
    '[attr.aria-label]': 'label()',
    '[attr.aria-valuemin]': 'min()',
    '[attr.aria-valuemax]': 'max()',
    '[attr.aria-valuenow]': 'value()',
    '[attr.aria-valuetext]': 'text()',
    '[attr.title]': 'label() + ": " + text()',
  },
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 40 40" aria-hidden="true">
      <path class="knob-track" [attr.d]="trackD" />
      <path class="knob-arc" [attr.d]="arcD()" [style.stroke]="color()" />
      <line class="knob-needle" x1="20" y1="20" [attr.x2]="needle()[0]" [attr.y2]="needle()[1]" />
    </svg>
    @if (showLabel()) {
      <span class="knob-name">{{ label() }}</span>
    }
    <span class="knob-value">{{ text() }}</span>
  `,
})
export class KnobComponent {
  private readonly animator = inject(Animator);

  readonly path = input.required<string>();
  readonly label = input.required<string>();
  readonly value = input.required<number>();
  readonly min = input(0);
  readonly max = input(1);
  /** Text shown at rest (e.g. the param's `display`); while tweening, `format` of the tween value. */
  readonly display = input<string | null>(null);
  readonly format = input<(v: number) => string>((v) => String(Number(v.toFixed(2))));
  readonly bipolar = input(false);
  readonly size = input(40);
  readonly color = input('var(--accent)');
  readonly showLabel = input(true);

  protected readonly trackD = arcPath(20, 20, 15, START, START + SWEEP);
  protected readonly shown = computed(() => this.animator.value(this.path(), this.value()));
  protected readonly glowing = computed(() => this.animator.glow(this.path()));
  private readonly norm = computed(() => {
    const span = this.max() - this.min();
    return span ? Math.min(1, Math.max(0, (this.shown() - this.min()) / span)) : 0;
  });
  protected readonly angle = computed(() => START + SWEEP * this.norm());
  protected readonly arcD = computed(() =>
    arcPath(20, 20, 15, this.bipolar() ? START + SWEEP / 2 : START, this.angle()),
  );
  protected readonly needle = computed(() => polar(20, 20, 11, this.angle()));
  protected readonly text = computed(() => {
    const animating = this.shown() !== this.value();
    return !animating && this.display() !== null ? this.display()! : this.format()(this.shown());
  });
}
