import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Animator } from '../core/animator.service';
import { AudioService } from '../core/audio.service';
import { barAt, chordAt, formatBBT, formatClock, sectionAt } from '../core/time';
import { WorkspaceStore } from '../core/workspace.store';

@Component({
  selector: 'aw-transport',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'transport', role: 'toolbar', 'aria-label': 'Transport' },
  template: `
    @let p = store.project();
    <div class="brand">
      <span class="logo" aria-hidden="true">≋</span>
      <span class="brand-name">AIWaves</span>
    </div>
    @if (p) {
      <div class="song" [title]="p.artist">
        <span class="song-title">{{ p.title }}</span>
        <span class="song-artist">{{ p.artist }}</span>
      </div>
    }

    <div class="tp-group">
      <button
        type="button"
        class="tp-btn"
        [class.on]="audio.playing()"
        (click)="audio.toggle()"
        [attr.aria-label]="audio.playing() ? 'Pause' : 'Play'"
        [attr.aria-pressed]="audio.playing()"
        title="Play / pause (Space)"
      >
        @if (audio.playing()) {
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="3" y="2" width="3.5" height="12" />
            <rect x="9.5" y="2" width="3.5" height="12" />
          </svg>
        } @else {
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2 L14 8 L3 14 Z" /></svg>
        }
      </button>
      <button type="button" class="tp-btn" (click)="audio.stop()" aria-label="Stop" title="Stop">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="3" y="3" width="10" height="10" />
        </svg>
      </button>
    </div>

    <div
      class="tp-field lcd"
      aria-label="Position (bar.beat.sixteenth)"
      title="bar . beat . sixteenth"
    >
      <span class="lcd-big">{{ bbt() }}</span>
    </div>
    <div class="tp-field lcd" aria-label="Time">
      <span>{{ clock() }}</span
      ><span class="dim"> / {{ total() }}</span>
    </div>

    @if (p) {
      <div class="tp-field" data-path="bpm" [class.glow]="animator.glow('bpm')" aria-label="Tempo">
        <span class="lbl">BPM</span><span class="lcd-big">{{ bpm() }}</span>
      </div>
      <div class="tp-field" aria-label="Time signature">
        <span class="lcd-big">{{ p.time_signature[0] }}/{{ p.time_signature[1] }}</span>
      </div>
      <div class="tp-field" data-path="key" [class.glow]="animator.glow('key')" aria-label="Key">
        <span class="lbl">Key</span><span class="lcd-big">{{ p.key }}</span>
      </div>
      <div class="tp-field" aria-label="Section at playhead">
        <span class="lbl">Section</span><span class="lcd-big">{{ section() ?? '—' }}</span>
      </div>
      <div class="tp-field" aria-label="Chord at playhead">
        <span class="lbl">Chord</span><span class="lcd-big">{{ chord() ?? '—' }}</span>
      </div>
      <div
        class="tp-field"
        data-path="version"
        [class.glow]="animator.glow('version')"
        aria-label="Song version"
      >
        <span class="lbl">Version</span
        ><span class="lcd-big">{{ store.versionLabel() ? 'v' + store.versionLabel() : '—' }}</span>
      </div>
    }

    <div class="tp-spacer"></div>
    @if (audio.error()) {
      <span class="tp-warn" role="status">{{ audio.error() }}</span>
    }
    <span
      class="pill"
      [class]="'pill pill-' + store.link()"
      role="status"
      [attr.aria-label]="'Connection: ' + linkText()"
    >
      <span class="pill-dot" aria-hidden="true"></span>{{ linkText() }}
    </span>
  `,
})
export class TransportComponent {
  protected readonly store = inject(WorkspaceStore);
  protected readonly audio = inject(AudioService);
  protected readonly animator = inject(Animator);

  private readonly bar = computed(() => {
    const p = this.store.project();
    return p ? barAt(p, this.audio.time()) : 0;
  });
  protected readonly bbt = computed(() => {
    const p = this.store.project();
    return p ? formatBBT(p, this.audio.time()) : '1.1.1';
  });
  protected readonly clock = computed(() => formatClock(this.audio.time()));
  protected readonly total = computed(() =>
    formatClock(this.audio.duration() || this.store.project()?.audio.duration_s || 0),
  );
  protected readonly bpm = computed(() => {
    const p = this.store.project();
    if (!p) return '';
    return this.animator.value('bpm', p.bpm).toFixed(2);
  });
  protected readonly section = computed(
    () => sectionAt(this.store.project()?.sections ?? [], this.bar())?.name ?? null,
  );
  protected readonly chord = computed(
    () => chordAt(this.store.project()?.chords ?? [], this.bar())?.name ?? null,
  );
  protected readonly linkText = computed(() => {
    switch (this.store.link()) {
      case 'open':
        return 'LIVE';
      case 'reconnecting':
        return 'RECONNECTING';
      case 'demo':
        return 'DEMO';
      default:
        return 'CONNECTING';
    }
  });
}
