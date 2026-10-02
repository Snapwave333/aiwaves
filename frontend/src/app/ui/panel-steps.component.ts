import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { PanelId, PanelLayout } from '../core/panel-layout';

/**
 * A module's size controls: ▴ one size smaller, ▾ one size bigger (collapsed → compact → expanded
 * → full screen), × close (reopen it from the top bar's Modules menu).
 */
@Component({
  selector: 'aw-panel-steps',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconButton, MatIcon, MatTooltip],
  host: { class: 'panel-steps' },
  template: `
    @if (state() !== 'collapsed') {
      <button
        mat-icon-button
        type="button"
        class="icon-btn-sm step-less"
        (click)="layout.less(panel()); $event.stopPropagation()"
        [attr.aria-label]="lessLabel()"
        [matTooltip]="lessTip()"
      >
        <mat-icon>{{ state() === 'full' ? 'close_fullscreen' : 'keyboard_arrow_up' }}</mat-icon>
      </button>
    }
    @if (state() !== 'full') {
      <button
        mat-icon-button
        type="button"
        class="icon-btn-sm step-more"
        (click)="layout.more(panel()); $event.stopPropagation()"
        [attr.aria-expanded]="state() !== 'collapsed'"
        [attr.aria-label]="moreLabel()"
        [matTooltip]="moreTip()"
      >
        <mat-icon>{{ state() === 'expanded' ? 'open_in_full' : 'keyboard_arrow_down' }}</mat-icon>
      </button>
    }
    @if (closable()) {
      <button
        mat-icon-button
        type="button"
        class="icon-btn-sm step-close"
        (click)="layout.hide(panel()); $event.stopPropagation()"
        [attr.aria-label]="'Close the ' + name()"
        matTooltip="Close (reopen it from Modules in the top bar)"
      >
        <mat-icon>close</mat-icon>
      </button>
    }
  `,
})
export class PanelStepsComponent {
  protected readonly layout = inject(PanelLayout);
  readonly panel = input.required<PanelId>();
  /** Read by screen readers: "Open the <name>". */
  readonly name = input.required<string>();
  /** Show the × (close) button. */
  readonly closable = input(true);
  protected readonly state = computed(() => this.layout.state(this.panel()));
  protected readonly lessLabel = computed(() => {
    const s = this.state();
    return s === 'full' ? `Leave full screen: ${this.name()}` : (s === 'expanded' ? 'Compact the ' : 'Collapse the ') + this.name();
  });
  protected readonly lessTip = computed(() =>
    ({ full: 'Leave full screen (Esc)', expanded: 'Compact', compact: 'Collapse', collapsed: '' })[this.state()],
  );
  protected readonly moreLabel = computed(() => {
    const s = this.state();
    return s === 'expanded' ? `Full screen: ${this.name()}` : (s === 'collapsed' ? 'Open the ' : 'Expand the ') + this.name();
  });
  protected readonly moreTip = computed(() =>
    ({ collapsed: 'Open', compact: 'Expand', expanded: 'Full screen', full: '' })[this.state()],
  );
}
