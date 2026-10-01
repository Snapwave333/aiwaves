import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { Animator } from '../core/animator.service';
import { PanelLayout } from '../core/panel-layout';
import { WorkspaceStore } from '../core/workspace.store';
import { CompactToggleComponent } from '../ui/compact-toggle.component';
import { describeChange, leafTarget, shortTarget } from './format';

@Component({
  selector: 'aw-activity-feed',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, CompactToggleComponent],
  host: {
    class: 'panel feed',
    role: 'region',
    'aria-label': 'Activity',
    '[class.compact]': 'compact()',
  },
  template: `
    <div class="panel-bar">
      <mat-icon aria-hidden="true">bolt</mat-icon>
      <h2 class="panel-title">Activity</h2>
      <span class="panel-sub">{{ store.events().length }} events</span>
      <span class="panel-tools"><aw-compact-toggle panel="activity" name="activity feed" /></span>
    </div>
    <ol class="feed-list" reversed>
      @for (r of rows(); track r.e.seq) {
        @let e = r.e;
        <li>
          @if (compact()) {
            <button
              type="button"
              class="feed-line"
              [attr.data-seq]="e.seq"
              (click)="store.reveal(e)"
              [class.hot]="e.seq === animator.highlightSeq()"
              [class.future]="e.seq > store.seq()"
              [class.current]="e.seq === store.seq()"
              [title]="
                '#' +
                e.seq +
                ' · ' +
                (e.target ?? '') +
                '
' +
                e.reason
              "
              [attr.aria-label]="
                'Event ' + e.seq + ': ' + e.verb + ' ' + (e.target ?? '') + '. ' + e.reason
              "
            >
              <span class="fl-line">
                <span class="fl-agent">{{ e.agent }}</span>
                <span class="fi-verb" [attr.data-verb]="e.verb.split('.')[0]">{{ e.verb }}</span>
                @if (r.leaf) {
                  <span class="fl-target">{{ r.leaf }}</span>
                }
                @if (r.change; as c) {
                  <span class="fl-change">
                    @if (c.from !== null) {
                      <span class="from">{{ c.from }}</span>
                    }
                    @if (c.from !== null && c.to !== null) {
                      →
                    }
                    @if (c.to !== null) {
                      <span class="to">{{ c.to }}</span>
                    }
                  </span>
                }
              </span>
              <span class="fl-reason">{{ e.reason }}</span>
            </button>
          } @else {
            <button
              type="button"
              class="feed-item"
              [attr.data-seq]="e.seq"
              (click)="store.reveal(e)"
              [class.hot]="e.seq === animator.highlightSeq()"
              [class.future]="e.seq > store.seq()"
              [class.current]="e.seq === store.seq()"
              [attr.aria-label]="
                'Event ' + e.seq + ': ' + e.verb + ' ' + (e.target ?? '') + '. ' + e.reason
              "
            >
              <span class="fi-top">
                <span class="fi-seq">#{{ e.seq }}</span>
                <span class="fi-time" [title]="e.ts">{{ time(e.ts) }}</span>
                <span class="fi-agent">{{ e.agent }}</span>
                <span class="fi-verb" [attr.data-verb]="e.verb.split('.')[0]">{{ e.verb }}</span>
              </span>
              @if (e.target) {
                <span class="fi-target">{{ short(e.target) }}</span>
              }
              @if (r.change; as c) {
                <span class="fi-change">
                  @if (c.from !== null) {
                    <span class="from">{{ c.from }}</span>
                  }
                  @if (c.from !== null && c.to !== null) {
                    →
                  }
                  @if (c.to !== null) {
                    <span class="to">{{ c.to }}</span>
                  }
                </span>
              }
              <span class="fi-reason">{{ e.reason }}</span>
            </button>
          }
        </li>
      } @empty {
        <li class="empty">
          <mat-icon aria-hidden="true">hourglass_empty</mat-icon>
          No events yet. Changes an agent makes will appear here as they happen.
        </li>
      }
    </ol>
  `,
})
export class ActivityFeedComponent {
  protected readonly store = inject(WorkspaceStore);
  protected readonly animator = inject(Animator);
  private readonly layout = inject(PanelLayout);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly compact = computed(() => this.layout.compact('activity'));
  protected readonly short = shortTarget;
  /** Newest first, with the text worked out once per event rather than on every render. */
  protected readonly rows = computed(() =>
    [...this.store.events()]
      .reverse()
      .map((e) => ({ e, change: describeChange(e), leaf: leafTarget(e.target) })),
  );

  constructor() {
    effect(() => {
      const seq = this.animator.highlightSeq();
      if (seq === null) return;
      setTimeout(() =>
        this.host.nativeElement
          .querySelector(`[data-seq="${seq}"]`)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
      );
    });
  }

  protected time(ts: string): string {
    const d = new Date(ts);
    return Number.isNaN(d.getTime())
      ? ts
      : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}
