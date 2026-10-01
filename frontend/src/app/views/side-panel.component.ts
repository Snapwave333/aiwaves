import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatTab, MatTabGroup, MatTabLabel } from '@angular/material/tabs';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'aw-side-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MatTabGroup, MatTab, MatTabLabel],
  host: { class: 'panel side', role: 'region', 'aria-label': 'History' },
  template: `
    @let h = store.history();
    <mat-tab-group mat-stretch-tabs="false" animationDuration="0ms" disableRipple>
      <mat-tab>
        <ng-template mat-tab-label>
          <span class="tab-label"><mat-icon aria-hidden="true">article</mat-icon>Changelog</span>
        </ng-template>
        <div class="side-body">
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
            <p class="empty"><mat-icon aria-hidden="true">commit</mat-icon>No commits yet.</p>
          }
        </div>
      </mat-tab>
    </mat-tab-group>
  `,
})
export class SidePanelComponent {
  protected readonly store = inject(WorkspaceStore);
}
