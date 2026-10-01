import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Anim, Animator, CAPTION_MS } from '../core/animator.service';
import { formatJson, shortTarget } from './activity-feed.component';

const W = 300;
/** Approximate caption height, for keeping captions from covering each other. */
const H = 62;

interface Placed {
  anim: Anim;
  left: number;
  top: number;
  below: boolean;
  fade: number;
}

/**
 * Captions with the event's reason, pinned next to the control that moved. Lives in a fixed
 * layer so scroll containers can't clip it; positions are re-read every animation frame.
 */
@Component({
  selector: 'aw-caption-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'captions' },
  template: `
    @for (c of placed(); track c.anim.seq) {
      <div
        class="caption"
        [class.below]="c.below"
        [style.left.px]="c.left"
        [style.top.px]="c.top"
        [style.opacity]="c.fade"
        aria-hidden="true"
      >
        <div class="caption-head">
          <span class="fi-verb" [attr.data-verb]="c.anim.verb.split('.')[0]">{{
            c.anim.verb
          }}</span>
          {{ short(c.anim.path) }}
          @if (c.anim.from !== null || c.anim.to !== null) {
            <span class="caption-change">{{ fmt(c.anim.from) }} → {{ fmt(c.anim.to) }}</span>
          }
        </div>
        <div class="caption-reason">{{ c.anim.reason }}</div>
      </div>
    }
    <div class="sr-only" aria-live="polite">{{ announce() }}</div>
  `,
})
export class CaptionOverlayComponent {
  private readonly animator = inject(Animator);
  protected readonly fmt = formatJson;

  protected readonly announce = computed(() => {
    const last = this.animator.captions().at(-1);
    return last ? `${last.verb} ${shortTarget(last.path)}: ${last.reason}` : '';
  });

  protected readonly placed = computed<Placed[]>(() => {
    const now = this.animator.now();
    const taken: { left: number; top: number }[] = [];
    // newest first: it gets the spot next to its control, older captions move out of its way
    const out = [...this.animator.captions()].reverse().map((anim, rank) => {
      const age = now - anim.t0;
      const fade =
        (age > CAPTION_MS - 500 ? Math.max(0, (CAPTION_MS - age) / 500) : 1) *
        (rank === 0 ? 1 : 0.8);
      const el = anim.path.startsWith('event:')
        ? null
        : document.querySelector(`[data-path="${CSS.escape(anim.path)}"]`);
      const r = el?.getBoundingClientRect();
      let left: number;
      let top: number;
      let below: boolean;
      if (!r || (r.width === 0 && r.height === 0)) {
        // nothing on screen for this event (a note, or a removed track): float under the transport
        left = innerWidth / 2 - W / 2;
        top = 64;
        below = true;
      } else {
        left = Math.min(innerWidth - W - 8, Math.max(8, r.left + r.width / 2 - W / 2));
        below = r.top < 110;
        top = below ? r.bottom + 8 : r.top - 8;
      }
      // box top edge in viewport terms (captions above a control are translated up by 100%)
      let boxTop = below ? top : top - H;
      while (taken.some((t) => Math.abs(t.left - left) < W && Math.abs(t.top - boxTop) < H)) {
        boxTop += below ? H : -H;
      }
      taken.push({ left, top: boxTop });
      return { anim, left, top: below ? boxTop : boxTop + H, below, fade };
    });
    return out.reverse();
  });

  protected short(path: string): string {
    return path.startsWith('event:') ? '' : shortTarget(path);
  }
}
