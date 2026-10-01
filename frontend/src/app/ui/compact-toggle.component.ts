import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { PanelId, PanelLayout } from '../core/panel-layout';

/** The expand / compact switch in a panel's bar. */
@Component({
  selector: 'aw-compact-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconButton, MatIcon, MatTooltip],
  template: `
    <button
      mat-icon-button
      type="button"
      class="icon-btn-sm compact-toggle"
      (click)="layout.toggle(panel())"
      [attr.aria-expanded]="!compact()"
      [attr.aria-label]="(compact() ? 'Expand the ' : 'Compact the ') + name()"
      [matTooltip]="compact() ? 'Expand' : 'Compact'"
    >
      <mat-icon>{{ compact() ? 'unfold_more' : 'unfold_less' }}</mat-icon>
    </button>
  `,
})
export class CompactToggleComponent {
  protected readonly layout = inject(PanelLayout);
  readonly panel = input.required<PanelId>();
  /** Read by screen readers: "Expand the <name>". */
  readonly name = input.required<string>();
  protected readonly compact = computed(() => this.layout.compact(this.panel()));
}
