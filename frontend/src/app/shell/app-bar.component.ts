import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  model,
  untracked,
  viewChild,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { Animator, reducedMotion } from '../core/animator.service';
import { WorkspaceStore } from '../core/workspace.store';

const LINK_TEXT: Record<string, string> = {
  open: 'LIVE',
  reconnecting: 'RECONNECTING',
  demo: 'DEMO',
  connecting: 'CONNECTING',
};

const LINK_HINT: Record<string, string> = {
  open: 'Connected to the AIWaves backend: agent changes arrive as they happen',
  reconnecting: 'Connection lost: reconnecting and catching up on missed events',
  demo: 'Demo data: the backend is not reachable, showing the recorded "Longing" project',
  connecting: 'Looking for the AIWaves backend…',
};

/**
 * The top app bar: logo, the song, connection status and the side-sheet toggle. Its bottom edge
 * is an AlienFX light bar that sweeps whenever an agent change is presented.
 */
@Component({
  selector: 'aw-app-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconButton, MatIcon, MatProgressBar, MatTooltip],
  host: { class: 'app-bar', role: 'banner' },
  template: `
    @let p = store.project();
    <div class="brand" aria-label="AIWaves">
      <svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
        <circle class="logo-ring" cx="16" cy="16" r="13" />
        <path class="logo-wave" d="M7 17c2.5 0 2.5-6 5-6s2.5 10 5 10 2.5-8 5-8 2 4 3 4" />
      </svg>
      <span class="brand-name">AIWaves</span>
    </div>
    <span class="bar-divider" aria-hidden="true"></span>
    @if (p) {
      <div class="app-song" [title]="p.title + ' — ' + p.artist">
        <span class="app-song-title">{{ p.title }}</span>
        <span class="app-song-artist">{{ p.artist }}</span>
      </div>
    }
    <span class="app-spacer"></span>
    <span
      class="status-chip"
      [class]="'status-chip status-' + store.link()"
      role="status"
      [attr.aria-label]="'Connection: ' + linkText()"
      [matTooltip]="linkHint()"
    >
      <span class="status-dot" aria-hidden="true"></span>{{ linkText() }}
    </span>
    @if (store.mode() === 'demo') {
      <button
        mat-icon-button
        type="button"
        class="icon-btn-sm"
        (click)="store.init()"
        aria-label="Look for the backend now"
        matTooltip="Look for the backend now"
      >
        <mat-icon>sync</mat-icon>
      </button>
    }
    <button
      mat-icon-button
      type="button"
      class="icon-btn-sm"
      (click)="sheetOpen.set(!sheetOpen())"
      [attr.aria-expanded]="sheetOpen()"
      aria-controls="aw-sheet"
      [attr.aria-label]="sheetOpen() ? 'Hide activity and history' : 'Show activity and history'"
      [matTooltip]="sheetOpen() ? 'Hide activity and history' : 'Show activity and history'"
    >
      <mat-icon>{{ sheetOpen() ? 'right_panel_close' : 'right_panel_open' }}</mat-icon>
    </button>
    <div class="light-bar" aria-hidden="true">
      @if (store.mode() === 'connecting') {
        <mat-progress-bar mode="indeterminate" />
      } @else {
        <span class="light-sweep" #sweep></span>
      }
    </div>
  `,
})
export class AppBarComponent {
  protected readonly store = inject(WorkspaceStore);
  private readonly animator = inject(Animator);
  private readonly sweep = viewChild<ElementRef<HTMLElement>>('sweep');

  /** Whether the activity / history side sheet is shown. */
  readonly sheetOpen = model(true);

  protected readonly linkText = computed(() => LINK_TEXT[this.store.link()] ?? 'CONNECTING');
  protected readonly linkHint = computed(() => LINK_HINT[this.store.link()] ?? '');

  constructor() {
    // every presented agent change sweeps the light bar once (Web Animations: no change detection)
    effect(() => {
      if (this.animator.highlightSeq() === null || reducedMotion) return;
      untracked(() =>
        this.sweep()?.nativeElement.animate(
          [
            { transform: 'translateX(-100%)', opacity: 1 },
            { transform: 'translateX(340%)', opacity: 0.6 },
          ],
          { duration: 900, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
        ),
      );
    });
  }
}
