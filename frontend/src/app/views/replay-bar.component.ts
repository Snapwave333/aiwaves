import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'aw-replay-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'replay', role: 'region', 'aria-label': 'Replay' },
  template: `
    <button
      type="button"
      class="replay-btn"
      [class.on]="store.replaying()"
      (click)="store.toggleReplay()"
      [attr.aria-pressed]="store.replaying()"
    >
      {{ store.replaying() ? '■ Stop replay' : '▶ Replay the build' }}
    </button>
    <button
      type="button"
      class="mini-btn"
      (click)="nudge(-1)"
      [disabled]="store.seq() <= 0"
      aria-label="Previous event"
      title="Previous event (←)"
    >
      ‹
    </button>
    <button
      type="button"
      class="mini-btn"
      (click)="nudge(1)"
      [disabled]="store.atHead()"
      aria-label="Next event"
      title="Next event (→)"
    >
      ›
    </button>
    <div class="scrub">
      <div class="scrub-marks" aria-hidden="true">
        @for (m of marks(); track m.seq) {
          <span class="scrub-mark" [style.left.%]="m.pos" [title]="'v' + m.label"
            >v{{ m.label }}</span
          >
        }
      </div>
      <input
        type="range"
        min="0"
        [max]="store.lastSeq()"
        step="1"
        [value]="store.seq()"
        (input)="onScrub($event)"
        aria-label="Replay position (event seq)"
        [attr.aria-valuetext]="'event ' + store.seq() + ' of ' + store.lastSeq()"
      />
    </div>
    <span class="replay-readout" aria-live="polite">
      seq <b>{{ store.seq() }}</b> / {{ store.lastSeq() }}
      @if (current(); as e) {
        · <span class="fi-verb" [attr.data-verb]="e.verb.split('.')[0]">{{ e.verb }}</span>
      }
    </span>
    <button
      type="button"
      class="live-btn"
      [class.on]="store.atHead()"
      [disabled]="store.atHead() && !store.replaying()"
      (click)="store.goLive()"
      title="Jump to the current state"
    >
      {{ store.atHead() ? '● Now' : 'Go to now' }}
    </button>
  `,
})
export class ReplayBarComponent {
  protected readonly store = inject(WorkspaceStore);

  protected readonly current = computed(
    () => this.store.events().find((e) => e.seq === this.store.seq()) ?? null,
  );
  protected readonly marks = computed(() => {
    const last = this.store.lastSeq() || 1;
    return this.store
      .events()
      .filter((e) => e.verb === 'version.tag' && typeof e.to === 'string')
      .map((e) => ({ seq: e.seq, label: e.to as string, pos: (e.seq / last) * 100 }));
  });

  protected nudge(delta: number): void {
    this.store.stopReplay();
    this.store.step(delta);
  }

  protected onScrub(e: Event): void {
    this.store.stopReplay();
    this.store.seekSeq(Number((e.target as HTMLInputElement).value));
  }
}
