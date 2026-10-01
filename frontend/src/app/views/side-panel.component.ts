import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'aw-side-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel side' },
  template: `
    @let h = store.history();
    <div class="panel-bar tabs" role="tablist" aria-label="History">
      <button
        type="button"
        role="tab"
        id="tab-changelog"
        class="tab"
        [class.on]="tab() === 'changelog'"
        [attr.aria-selected]="tab() === 'changelog'"
        aria-controls="tabpanel-history"
        (click)="tab.set('changelog')"
      >
        Changelog
      </button>
      <button
        type="button"
        role="tab"
        id="tab-git"
        class="tab"
        [class.on]="tab() === 'git'"
        [attr.aria-selected]="tab() === 'git'"
        aria-controls="tabpanel-history"
        (click)="tab.set('git')"
      >
        Git
      </button>
      @if (tab() === 'git' && h.branch) {
        <span class="panel-sub branch" title="branch">⎇ {{ h.branch }}</span>
      }
    </div>
    <div
      class="side-body"
      id="tabpanel-history"
      role="tabpanel"
      [attr.aria-labelledby]="tab() === 'changelog' ? 'tab-changelog' : 'tab-git'"
    >
      @if (tab() === 'changelog') {
        @for (c of h.changelog; track c.version) {
          <article class="cl-entry" [class.current]="'' + c.version === store.versionLabel()">
            <h3>
              <span class="cl-ver">v{{ c.version }}</span> {{ c.title }}
            </h3>
            <div class="cl-date">{{ c.date }}</div>
            @for (g of c.groups; track g.name) {
              <h4>{{ g.name }}</h4>
              <ul>
                @for (it of g.items; track $index) {
                  <li>{{ it }}</li>
                }
              </ul>
            }
          </article>
        } @empty {
          <p class="empty">No changelog.</p>
        }
      } @else {
        @for (c of h.commits; track c.hash) {
          <details class="commit">
            <summary>
              <code class="hash">{{ c.short }}</code>
              <span class="subject">{{ c.subject }}</span>
              <span class="stat"
                ><span class="add">+{{ c.added }}</span>
                <span class="del">−{{ c.removed }}</span></span
              >
            </summary>
            <div class="commit-meta">{{ c.author }} · {{ c.date }}</div>
            @if (c.body) {
              <pre class="commit-body">{{ c.body }}</pre>
            }
            <ul class="commit-files">
              @for (f of c.files; track f) {
                <li>
                  <code>{{ f }}</code>
                </li>
              }
            </ul>
          </details>
        } @empty {
          <p class="empty">No commits.</p>
        }
      }
    </div>
  `,
})
export class SidePanelComponent {
  protected readonly store = inject(WorkspaceStore);
  protected readonly tab = signal<'changelog' | 'git'>('changelog');
}
