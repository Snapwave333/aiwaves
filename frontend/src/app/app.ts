import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { AudioService } from './core/audio.service';
import { WorkspaceStore } from './core/workspace.store';
import { ActivityFeedComponent } from './views/activity-feed.component';
import { ArrangementComponent } from './views/arrangement.component';
import { CaptionOverlayComponent } from './views/caption-overlay.component';
import { DeviceChainComponent } from './views/device-chain.component';
import { MixerComponent } from './views/mixer.component';
import { ReplayBarComponent } from './views/replay-bar.component';
import { SidePanelComponent } from './views/side-panel.component';
import { TransportComponent } from './views/transport.component';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TransportComponent,
    ArrangementComponent,
    MixerComponent,
    DeviceChainComponent,
    ActivityFeedComponent,
    ReplayBarComponent,
    SidePanelComponent,
    CaptionOverlayComponent,
  ],
  host: { '(document:keydown)': 'onKey($event)' },
  templateUrl: './app.html',
})
export class App {
  protected readonly store = inject(WorkspaceStore);
  private readonly audio = inject(AudioService);

  constructor() {
    void this.store.init();
    effect(() => {
      const url = this.store.audioUrl();
      const b = this.store.base();
      if (url && b) this.audio.load(url, b.audio.peaks, b.audio.duration_s);
    });
  }

  /** Space: play / pause. Left / right: step the replay one event. */
  protected onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    const tag = el?.tagName ?? '';
    const typing =
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      el?.isContentEditable ||
      (tag === 'INPUT' && (el as HTMLInputElement).type !== 'range');
    if (typing) return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.audio.toggle();
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && tag !== 'INPUT') {
      e.preventDefault();
      this.store.stopReplay();
      this.store.step(e.key === 'ArrowLeft' ? -1 : 1);
    }
  }
}
