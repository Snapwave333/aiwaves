import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { Animator } from '../core/animator.service';
import { renderMarkdown } from '../core/markdown';
import { PanelLayout } from '../core/panel-layout';
import { WorkspaceStore } from '../core/workspace.store';
import { PanelStepsComponent } from '../ui/panel-steps.component';

/**
 * aiwave411.md, the project's agent handoff document (CONTRACT §11): what an agent reads before
 * it works on the song, kept current by the agents. Read-only here; it refreshes live.
 */
@Component({
  selector: 'aw-handoff',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, PanelStepsComponent],
  host: {
    class: 'panel handoff',
    role: 'region',
    'aria-label': 'aiwave411 handoff',
    '[class.compact]': 'compact()',
    '[class.collapsed]': 'collapsed()',
  },
  template: `
    <div class="panel-bar">
      <mat-icon aria-hidden="true">menu_book</mat-icon>
      <h2 class="panel-title">aiwave411</h2>
      @if (collapsed()) {
        <span class="panel-ticker" [class.fresh]="fresh()" [title]="ticker()">{{ ticker() }}</span>
      } @else if (doc().updated) {
        <span class="panel-sub">updated {{ doc().updated!.slice(0, 16).replace('T', ' ') }}</span>
      }
      <span class="panel-tools"><aw-panel-steps panel="handoff" name="aiwave411 handoff" /></span>
    </div>
    @if (!collapsed()) {
      @if (doc().exists) {
        <article class="md handoff-body" [innerHTML]="html()"></article>
      } @else {
        <p class="empty">
          <mat-icon aria-hidden="true">menu_book</mat-icon>
          No aiwave411.md yet. Agents create it with
          <code>aiwaves 411 init {{ store.project()?.id ?? 'PROJECT' }}</code> and keep it
          current with <code>aiwaves 411 append</code>.
        </p>
      }
    }
  `,
})
export class HandoffComponent {
  protected readonly store = inject(WorkspaceStore);
  private readonly animator = inject(Animator);
  private readonly layout = inject(PanelLayout);
  protected readonly doc = this.store.handoff;
  protected readonly compact = computed(() => this.layout.compact('handoff'));
  protected readonly collapsed = computed(() => this.layout.collapsed('handoff'));
  protected readonly html = computed(() => renderMarkdown(this.doc().text));
  private readonly lastUpdate = computed(
    () => [...this.store.events()].reverse().find((e) => e.verb === 'doc.update') ?? null,
  );
  /** Collapsed: who updated it last and why (or how big it is). */
  protected readonly ticker = computed(() => {
    const e = this.lastUpdate();
    if (e) return `${e.agent} · ${e.reason}`;
    const d = this.doc();
    return d.exists ? `${d.text.split('\n').length} lines` : 'not written yet';
  });
  protected readonly fresh = computed(() => {
    const e = this.lastUpdate();
    return !!e && e.seq === this.animator.highlightSeq();
  });
}
