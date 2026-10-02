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
import { AiEvent } from '../core/model';
import { PanelLayout } from '../core/panel-layout';
import { VersionSpan, familyOf, layoutLabels } from '../core/timeline';
import { describeChange, shortTarget } from './format';
import { WorkspaceStore } from '../core/workspace.store';
import { PanelStepsComponent } from '../ui/panel-steps.component';

/** Label row height (px): two rows of version labels above the scrubber. */
const ROW_PX = 15;
const FAMILIES = ['build', 'move', 'note', 'render', 'version'] as const;

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
      <div class="version-labels" [style.height.px]="labelRows() * ROW_PX">
        @for (l of labels(); track l.span.start) {
          @if (l.row !== null) {
            <button
              type="button"
              class="version-label"
              [class.current]="l.span.version === store.versionLabel()"
              [style.left.px]="l.labelX"
              [style.top.px]="l.row * ROW_PX"
              (click)="jump(l.span)"
              [title]="labelTitle(l.span)"
            >
              v{{ l.span.version }}
            </button>
          }
        }
      </div>
      <svg class="event-marks" viewBox="0 0 1000 10" preserveAspectRatio="none" aria-hidden="true">
        @for (f of marks(); track f.family) {
          <path [attr.d]="f.d" [attr.class]="'mark mark-' + f.family" />
        }
      </svg>
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
        <span class="readout-change" [title]="e.reason">{{ line(e) }}</span>
      }
    </span>
    @if (store.audition(); as a) {
      <button mat-flat-button type="button" class="hear-btn on cut-btn" (click)="store.hear(null)">
        <mat-icon>headphones</mat-icon>Hearing v{{ a.version }} · back to the current mix
      </button>
    } @else if (canHear(); as r) {
      <button
        mat-stroked-button
        type="button"
        class="hear-btn cut-btn"
        (click)="store.hear(r)"
        matTooltip="Load this version's mix into the player (A/B)"
      >
        <mat-icon>headphones</mat-icon>Hear v{{ r.version }}
      </button>
    }
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
      : `viewing ${ver}seq ${this.store.seq()} of ${this.store.lastSeq()}` +
          (this.store.audition() ? ` · hearing v${this.store.audition()!.version}` : '');
  });
  private readonly scrub = viewChild<ElementRef<HTMLElement>>('scrub');
  private readonly scrubW = signal(600);

  protected readonly ROW_PX = ROW_PX;
  protected readonly current = computed(
    () => this.store.events().find((e) => e.seq === this.store.seq()) ?? null,
  );
  /** Version labels, newest first, on whichever of two rows has room (never overlapping). */
  protected readonly labels = computed(() =>
    layoutLabels(this.store.versions(), this.store.lastSeq(), Math.max(1, this.scrubW() - 16)),
  );
  protected readonly labelRows = computed(() => (this.labels().some((l) => l.row === 1) ? 2 : 1));
  /** Every event as a thin mark, one SVG path per kind (cheap however long the log gets). */
  protected readonly marks = computed(() => {
    const last = Math.max(1, this.store.lastSeq());
    const d = new Map<string, string[]>(FAMILIES.map((f) => [f, []]));
    for (const e of this.store.events()) {
      const x = ((e.seq / last) * 1000).toFixed(1);
      d.get(familyOf(e.verb))!.push(`M${x} 1V9`);
    }
    return FAMILIES.map((family) => ({ family, d: d.get(family)!.join('') })).filter((f) => f.d);
  });
  /** The version on screen has its own render, different from the one in the player. */
  protected readonly canHear = computed(() => {
    const r = this.store.renderOnScreen();
    const playing = this.store.audition()?.audio ?? this.store.base()?.audio.master;
    return this.store.mode() === 'live' && r && r.audio !== playing ? r : null;
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

  /** The readout's line for the event at the position: where, then what changed (the verb is beside it). */
  protected line(e: AiEvent): string {
    const c = describeChange(e);
    const what = !c ? e.reason : c.to === null ? (c.from ?? '') : c.from === null ? c.to : `${c.from} → ${c.to}`;
    const where = shortTarget(e.target);
    return where ? `${where} · ${what}` : what;
  }

  protected labelTitle(v: VersionSpan): string {
    return `v${v.version} · ${v.title} (events ${v.start}–${v.end}): click to jump to its end`;
  }

  /** A version label: to the end of that version. */
  protected jump(span: VersionSpan): void {
    this.store.stopReplay();
    this.store.seekSeq(span.end, false);
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
