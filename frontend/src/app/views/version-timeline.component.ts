import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSlider, MatSliderThumb } from '@angular/material/slider';
import { MatTooltip } from '@angular/material/tooltip';
import { PanelLayout } from '../core/panel-layout';
import { WorkspaceStore } from '../core/workspace.store';
import { PanelStepsComponent } from '../ui/panel-steps.component';

/** Room (px) a version label needs before the next one. */
const MARK_PX = 34;

/** The version timeline: every event the song was built from, by version; replay, step, scrub, now. */
@Component({
  selector: 'aw-version-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatIconButton, MatIcon, MatSlider, MatSliderThumb, MatTooltip, PanelStepsComponent],
  host: {
    class: 'panel timeline',
    role: 'region',
    'aria-label': 'Version timeline',
    '[class.collapsed]': 'collapsed()',
  },
  template: `
    <div class="panel-bar">
      <mat-icon aria-hidden="true">timeline</mat-icon>
      <h2 class="panel-title">Version timeline</h2>
      @if (collapsed()) {
        <span class="panel-ticker" [class.past]="!store.atHead()" aria-live="polite">{{ where() }}</span>
        @if (!store.atHead()) {
          <button mat-button type="button" class="now-link" (click)="store.goLive()">
            <mat-icon>skip_next</mat-icon>Back to now
          </button>
        }
      }
      <span class="panel-tools"><aw-panel-steps panel="timeline" name="version timeline" /></span>
    </div>
    @if (!collapsed()) {
    <div class="replay">
    <button
      mat-flat-button
      type="button"
      class="replay-btn cut-btn"
      (click)="store.toggleReplay()"
      [attr.aria-pressed]="store.replaying()"
    >
      <mat-icon>{{ store.replaying() ? 'stop' : 'history' }}</mat-icon>
      {{ store.replaying() ? 'Stop replay' : 'Replay the build' }}
    </button>
    <button
      mat-icon-button
      type="button"
      class="icon-btn-sm"
      (click)="nudge(-1)"
      [disabled]="store.seq() <= 0"
      aria-label="Previous event"
      matTooltip="Previous event (←)"
    >
      <mat-icon>chevron_left</mat-icon>
    </button>
    <button
      mat-icon-button
      type="button"
      class="icon-btn-sm"
      (click)="nudge(1)"
      [disabled]="store.atHead()"
      aria-label="Next event"
      matTooltip="Next event (→)"
    >
      <mat-icon>chevron_right</mat-icon>
    </button>
    <div class="scrub" #scrub>
      <div class="scrub-marks" aria-hidden="true">
        @for (m of marks(); track m.seq) {
          <span
            class="scrub-mark"
            [class.tick]="!m.room"
            [style.left.%]="m.pos"
            [title]="'v' + m.label + ' (event ' + m.seq + ')'"
            >{{ m.room ? 'v' + m.label : '' }}</span
          >
        }
      </div>
      <mat-slider min="0" [max]="store.lastSeq()" step="1" [disabled]="!store.lastSeq()">
        <input
          matSliderThumb
          [value]="store.seq()"
          (valueChange)="onScrub($event)"
          aria-label="Replay position (event seq)"
          [attr.aria-valuetext]="'event ' + store.seq() + ' of ' + store.lastSeq()"
        />
      </mat-slider>
    </div>
    <span class="replay-readout" aria-live="polite">
      SEQ <b>{{ store.seq() }}</b> / {{ store.lastSeq() }}
      @if (current(); as e) {
        <span class="fi-verb" [attr.data-verb]="e.verb.split('.')[0]">{{ e.verb }}</span>
      }
    </span>
    <button
      mat-stroked-button
      type="button"
      class="live-btn cut-btn"
      [class.on]="store.atHead()"
      [disabled]="store.atHead() && !store.replaying()"
      (click)="store.goLive()"
      matTooltip="Jump to the current state"
    >
      <mat-icon>{{ store.atHead() ? 'radio_button_checked' : 'skip_next' }}</mat-icon>
      {{ store.atHead() ? 'Now' : 'Go to now' }}
    </button>
    </div>
    }
  `,
})
export class VersionTimelineComponent {
  protected readonly store = inject(WorkspaceStore);
  private readonly layout = inject(PanelLayout);
  protected readonly collapsed = computed(() => this.layout.collapsed('timeline'));
  /** The one row: where the views are in the song's history. */
  protected readonly where = computed(() => {
    const v = this.store.versionLabel();
    const ver = v ? `v${v} · ` : '';
    return this.store.atHead()
      ? `${ver}seq ${this.store.seq()}/${this.store.lastSeq()} · NOW`
      : `viewing ${ver}seq ${this.store.seq()} of ${this.store.lastSeq()}`;
  });
  private readonly scrub = viewChild<ElementRef<HTMLElement>>('scrub');
  private readonly scrubW = signal(600);

  protected readonly current = computed(
    () => this.store.events().find((e) => e.seq === this.store.seq()) ?? null,
  );
  /** Version tags on the scrubber; a label that would overlap the next one becomes a tick. */
  protected readonly marks = computed(() => {
    const last = this.store.lastSeq() || 1;
    const tags = this.store
      .events()
      .filter((e) => e.verb === 'version.tag' && typeof e.to === 'string')
      .map((e) => ({ seq: e.seq, label: e.to as string, pos: (e.seq / last) * 100 }));
    const gap = (MARK_PX / Math.max(1, this.scrubW())) * 100;
    return tags.map((m, i) => ({
      ...m,
      // the newest always gets its label; others need MARK_PX to the next one
      room: i === tags.length - 1 || tags[i + 1].pos - m.pos >= gap,
    }));
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.scrub()?.nativeElement;
      if (!el || typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(() => this.scrubW.set(el.clientWidth));
      ro.observe(el);
      destroyRef.onDestroy(() => ro.disconnect());
    });
  }

  protected nudge(delta: number): void {
    this.store.stopReplay();
    this.store.step(delta);
  }

  protected onScrub(seq: number): void {
    this.store.stopReplay();
    this.store.seekSeq(seq);
  }
}
