import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { AudioService } from './core/audio.service';
import { CoverService } from './core/cover.service';
import { PanelLayout } from './core/panel-layout';
import { WorkspaceStore } from './core/workspace.store';
import { PlayerComponent } from './player/player.component';
import { AppBarComponent } from './shell/app-bar.component';
import { ActivityFeedComponent } from './views/activity-feed.component';
import { ArrangementComponent } from './views/arrangement.component';
import { CaptionOverlayComponent } from './views/caption-overlay.component';
import { DeviceChainComponent } from './views/device-chain.component';
import { HandoffComponent } from './views/handoff.component';
import { MixerComponent } from './views/mixer.component';
import { VersionTimelineComponent } from './views/version-timeline.component';
import { SidePanelComponent } from './views/side-panel.component';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButton,
    MatIconButton,
    MatIcon,
    AppBarComponent,
    PlayerComponent,
    ArrangementComponent,
    MixerComponent,
    DeviceChainComponent,
    ActivityFeedComponent,
    VersionTimelineComponent,
    SidePanelComponent,
    HandoffComponent,
    CaptionOverlayComponent,
  ],
  host: { '(document:keydown)': 'onKey($event)' },
  templateUrl: './app.html',
})
export class App {
  protected readonly store = inject(WorkspaceStore);
  protected readonly layout = inject(PanelLayout);
  private readonly audio = inject(AudioService);
  private readonly covers = inject(CoverService);
  protected readonly sheetOpen = signal(true);
  protected readonly demoDismissed = signal(false);
  /** Compact mixer and devices: the bottom row shrinks to fit them and the arrangement grows. */
  protected readonly bottomCompact = computed(
    () => this.layout.compact('mixer') && this.layout.compact('devices'),
  );
  /** Every panel in the side sheet compact: the sheet narrows and the arrangement widens. */
  protected readonly sheetCompact = computed(
    () => this.layout.compact('activity') && this.layout.compact('history'),
  );
  /** Collapsed panels are one row tall: their rows shrink and the arrangement takes the room. */
  protected readonly feedCollapsed = computed(() => this.layout.collapsed('activity'));
  protected readonly historyCollapsed = computed(() => this.layout.collapsed('history'));

  constructor() {
    void this.store.init();
    effect(() => {
      const url = this.store.audioUrl();
      const b = this.store.base();
      const a = this.store.audition(); // an older render: its own waveform and length
      if (url && b)
        this.audio.load(url, a?.peaks ?? b.audio.peaks, a?.duration_s ?? b.audio.duration_s);
    });
    // cover art (CONTRACT section 10): once per project and source, then one per playthrough
    const coverSource = computed(() => {
      const b = this.store.base();
      const mode = this.store.mode();
      return b && mode !== 'connecting' ? `${mode}:${b.id}` : null;
    });
    effect(() => {
      if (!coverSource()) return;
      untracked(() => void this.covers.init(this.store.base()!, this.store.mode() === 'live'));
    });
    effect(() => {
      if (this.audio.playthrough() > 0) untracked(() => void this.covers.playthrough());
    });
  }

  /** Space: play / pause. M: mute. Left / right: step one event (with Shift: one version).
   * Home / End: the start of the history / now. */
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
    } else if (e.key === 'm' || e.key === 'M') {
      this.audio.toggleMute();
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && tag !== 'INPUT') {
      e.preventDefault();
      this.store.stopReplay();
      if (e.shiftKey) this.store.stepVersion(e.key === 'ArrowLeft' ? -1 : 1);
      else this.store.step(e.key === 'ArrowLeft' ? -1 : 1);
    } else if ((e.key === 'Home' || e.key === 'End') && tag !== 'INPUT') {
      e.preventDefault();
      if (e.key === 'End') this.store.goLive();
      else {
        this.store.stopReplay();
        this.store.seekSeq(0, false);
      }
    }
  }
}
