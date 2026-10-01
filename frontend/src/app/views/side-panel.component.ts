import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatTab, MatTabGroup, MatTabLabel } from '@angular/material/tabs';
import { PanelLayout } from '../core/panel-layout';
import { WorkspaceStore } from '../core/workspace.store';
import { CompactToggleComponent } from '../ui/compact-toggle.component';

@Component({
  selector: 'aw-side-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MatTabGroup, MatTab, MatTabLabel, CompactToggleComponent],
  host: {
    class: 'panel side',
    role: 'region',
    'aria-label': 'History',
    '[class.compact]': 'compact()',
  },
  template: `
    @let h = store.history();
    <mat-tab-group
      mat-stretch-tabs="false"
      animationDuration="0ms"
      disableRipple
      (selectedIndexChange)="tab.set($event)"
    >
      <mat-tab>
        <ng-template mat-tab-label>
          <span class="tab-label"><mat-icon aria-hidden="true">article</mat-icon>Changelog</span>
        </ng-template>
        <div class="side-body">
          @for (c of h.changelog; track c.version) {
            @let current = '' + c.version === store.versionLabel();
            @if (layout.compact('changelog')) {
              <details class="cl-line" [class.current]="current">
                <summary
                  [title]="
                    'v' +
                    c.version +
                    ' · ' +
                    c.date +
                    '
' +
                    c.title
                  "
                >
                  <span class="cl-ver">v{{ c.version }}</span>
                  <span class="cl-title">{{ c.title }}</span>
                </summary>
                <div class="cl-detail">
                  <div class="cl-date">{{ c.date }}</div>
                  @for (g of c.groups; track g.name) {
                    <h4>{{ g.name }}</h4>
                    <ul>
                      @for (it of g.items; track $index) {
                        <li>{{ it }}</li>
                      }
                    </ul>
                  }
                </div>
              </details>
            } @else {
              <article class="cl-entry" [class.current]="current">
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
            }
          } @empty {
            <p class="empty"><mat-icon aria-hidden="true">article</mat-icon>No changelog yet.</p>
          }
        </div>
      </mat-tab>
      <mat-tab>
        <ng-template mat-tab-label>
          <span class="tab-label"><mat-icon aria-hidden="true">commit</mat-icon>Git</span>
        </ng-template>
        <div class="side-body">
          @if (h.branch) {
            <div class="branch" title="branch">
              <mat-icon aria-hidden="true">fork_right</mat-icon>{{ h.branch }}
            </div>
          }
          @for (c of h.commits; track c.hash) {
            <details class="commit" [class.commit-line]="layout.compact('git')">
              <summary [title]="c.short + ' ' + c.subject">
                <code class="hash">{{ c.short }}</code>
                <span class="subject">{{ c.subject }}</span>
                @if (!layout.compact('git')) {
                  <span class="stat"
                    ><span class="add">+{{ c.added }}</span>
                    <span class="del">−{{ c.removed }}</span></span
                  >
                }
              </summary>
              <div class="commit-meta">
                {{ c.author }} · {{ c.date }}
                @if (layout.compact('git')) {
                  · <span class="add">+{{ c.added }}</span>
                  <span class="del">−{{ c.removed }}</span>
                }
              </div>
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
            <p class="empty"><mat-icon aria-hidden="true">commit</mat-icon>No commits yet.</p>
          }
        </div>
      </mat-tab>
    </mat-tab-group>
    <aw-compact-toggle
      class="side-tools"
      [panel]="tab() === 0 ? 'changelog' : 'git'"
      [name]="tab() === 0 ? 'changelog' : 'git log'"
    />
  `,
})
export class SidePanelComponent {
  protected readonly store = inject(WorkspaceStore);
  protected readonly layout = inject(PanelLayout);
  /** The selected tab: 0 changelog, 1 git. Each has its own compact / expanded setting. */
  protected readonly tab = signal(0);
  protected readonly compact = computed(() =>
    this.layout.compact(this.tab() === 0 ? 'changelog' : 'git'),
  );
}
