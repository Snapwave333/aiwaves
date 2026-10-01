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
import { WorkspaceStore } from '../core/workspace.store';
import { formatJson, shortTarget } from './format';

@Component({
  selector: 'aw-activity-feed',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon],
  host: { class: 'panel feed', role: 'region', 'aria-label': 'Activity' },
  template: `
    <div class="panel-bar">
      <mat-icon aria-hidden="true">bolt</mat-icon>
      <h2 class="panel-title">Activity</h2>
      <span class="panel-sub">{{ store.events().length }} events</span>
    </div>
    <ol class="feed-list" reversed>
      @for (e of newestFirst(); track e.seq) {
        <li>
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
            @if (e.from !== null || e.to !== null) {
              <span class="fi-change"
                ><span class="from">{{ fmt(e.from) }}</span> →
                <span class="to">{{ fmt(e.to) }}</span></span
              >
            }
            <span class="fi-reason">{{ e.reason }}</span>
          </button>
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly fmt = formatJson;
  protected readonly short = shortTarget;
  protected readonly newestFirst = computed(() => [...this.store.events()].reverse());

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
