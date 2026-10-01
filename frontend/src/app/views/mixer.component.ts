import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { Animator } from '../core/animator.service';
import { Track } from '../core/model';
import { formatDb, formatPan } from '../core/time';
import { WorkspaceStore } from '../core/workspace.store';
import { FaderComponent } from '../ui/fader.component';
import { KnobComponent } from '../ui/knob.component';

@Component({
  selector: 'aw-mixer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [KnobComponent, FaderComponent, MatIcon],
  host: { class: 'panel mixer', role: 'region', 'aria-label': 'Mixer' },
  template: `
    <div class="panel-bar">
      <mat-icon aria-hidden="true">tune</mat-icon>
      <h2 class="panel-title">Mixer</h2>
    </div>
    <div class="strips">
      @for (t of store.project()?.tracks ?? []; track t.id) {
        @let base = 'tracks.' + t.id + '.mixer';
        <div
          class="strip"
          [class.selected]="t.id === store.selectedTrack()?.id"
          [class.master]="t.kind === 'master'"
          [class.ghost]="store.ghosts().has('tracks.' + t.id)"
          [class.touched]="animator.glowUnder(base)"
          (click)="store.selectTrack(t.id)"
          role="group"
          [attr.aria-label]="'Channel ' + t.name"
        >
          <div class="strip-name" [style.border-top-color]="t.color" [title]="t.name">
            {{ t.name }}
          </div>
          @for (s of sendsOf(t); track s.id) {
            <aw-knob
              [path]="base + '.sends.' + s.id"
              [label]="'Send ' + s.id"
              [value]="s.db"
              [min]="-60"
              [max]="6"
              [format]="fmtDb"
              [display]="fmtDb(s.db)"
              [size]="24"
              [color]="t.color"
            />
          }
          <div class="strip-row">
            <aw-knob
              [path]="base + '.pan'"
              [label]="'Pan'"
              [value]="t.mixer.pan"
              [min]="-1"
              [max]="1"
              [bipolar]="true"
              [format]="fmtPan"
              [size]="26"
              [color]="t.color"
            />
            <div class="strip-lights">
              <span
                class="light light-m"
                [attr.data-path]="base + '.mute'"
                [class.on]="t.mixer.mute"
                [class.glow]="animator.glow(base + '.mute')"
                role="img"
                [attr.aria-label]="t.name + (t.mixer.mute ? ' muted' : ' not muted')"
                >M</span
              >
              <span
                class="light light-s"
                [attr.data-path]="base + '.solo'"
                [class.on]="t.mixer.solo"
                [class.glow]="animator.glow(base + '.solo')"
                role="img"
                [attr.aria-label]="t.name + (t.mixer.solo ? ' soloed' : ' not soloed')"
                >S</span
              >
            </div>
          </div>
          <aw-fader
            [path]="base + '.volume_db'"
            [label]="t.name + ' volume'"
            [db]="t.mixer.volume_db"
            [track]="t"
          />
        </div>
      } @empty {
        <p class="empty"><mat-icon aria-hidden="true">tune</mat-icon>No tracks yet.</p>
      }
    </div>
  `,
})
export class MixerComponent {
  protected readonly store = inject(WorkspaceStore);
  protected readonly animator = inject(Animator);

  protected readonly fmtDb = formatDb;
  protected readonly fmtPan = formatPan;
  protected sendsOf(t: Track): { id: string; db: number }[] {
    return Object.entries(t.mixer.sends ?? {}).map(([id, db]) => ({ id, db }));
  }
}
