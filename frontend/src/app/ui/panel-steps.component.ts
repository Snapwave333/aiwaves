import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { PanelId, PanelLayout } from '../core/panel-layout';

/** A panel's size arrows: ▴ one step smaller, ▾ one step bigger (collapsed → compact → expanded). */
@Component({
  selector: 'aw-panel-steps',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconButton, MatIcon, MatTooltip],
  host: { class: 'panel-steps' },
  template: `
    @if (canLess()) {
      <button
        mat-icon-button
        type="button"
        class="icon-btn-sm step-less"
        (click)="layout.less(panel()); $event.stopPropagation()"
        [attr.aria-label]="(state() === 'expanded' ? 'Compact the ' : 'Collapse the ') + name()"
        [matTooltip]="state() === 'expanded' ? 'Compact' : 'Collapse'"
      >
        <mat-icon>keyboard_arrow_up</mat-icon>
      </button>
    }
    @if (state() !== 'expanded') {
      <button
        mat-icon-button
        type="button"
        class="icon-btn-sm step-more"
        (click)="layout.more(panel()); $event.stopPropagation()"
        [attr.aria-expanded]="state() !== 'collapsed'"
        [attr.aria-label]="(state() === 'collapsed' ? 'Open the ' : 'Expand the ') + name()"
        [matTooltip]="state() === 'collapsed' ? 'Open' : 'Expand'"
      >
        <mat-icon>keyboard_arrow_down</mat-icon>
      </button>
    }
  `,
})
export class PanelStepsComponent {
  protected readonly layout = inject(PanelLayout);
  readonly panel = input.required<PanelId>();
  /** Read by screen readers: "Open the <name>". */
  readonly name = input.required<string>();
  protected readonly state = computed(() => this.layout.state(this.panel()));
  protected readonly canLess = computed(
    () => this.state() === 'expanded' || (this.state() === 'compact' && this.layout.canFold(this.panel())),
  );
}
