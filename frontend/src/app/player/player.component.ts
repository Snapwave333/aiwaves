// The audio player, ported from CarbonCast IPTV / IPTVnator (libs/ui/playback/src/lib/audio-player,
// MIT licence: see THIRD_PARTY_NOTICES.md) and re-themed for AIWaves. Changes from the original:
// no NgRx store, ngx-translate or channel switching; no audio element of its own (it drives the
// app's one AudioService); the song's readouts (bar.beat, BPM, key, section, chord, version)
// live here; the cover art, its dominant colour and a hexagonal spectrum ring are new. The GLSL
// visualizer behind it comes from CarbonCast's radio player (see visualizer/).
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { MatButton, MatFabButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSlider, MatSliderThumb } from '@angular/material/slider';
import { MatTooltip } from '@angular/material/tooltip';
import { Animator, reducedMotion } from '../core/animator.service';
import { AudioService } from '../core/audio.service';
import { CoverService } from '../core/cover.service';
import { accentFor, applyAccent } from '../core/dynamic-color';
import { PlayerStatus } from '../core/player-state';
import { Playhead } from '../core/playhead';
import { formatClock } from '../core/time';
import { WorkspaceStore } from '../core/workspace.store';
import { extractDominantColor } from './extract-color';
import { RingPainter } from './ring-painter';
import { VisualizerComponent } from './visualizer/visualizer.component';

const STATUS_TEXT: Record<PlayerStatus, string> = {
  idle: 'No audio',
  loading: 'Loading',
  ready: 'Ready',
  playing: 'Playing',
  buffering: 'Buffering',
  paused: 'Paused',
  ended: 'Ended',
  error: 'No signal',
};

@Component({
  selector: 'aw-player',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButton,
    MatFabButton,
    MatIconButton,
    MatIcon,
    MatSlider,
    MatSliderThumb,
    MatTooltip,
    VisualizerComponent,
  ],
  host: {
    class: 'player',
    role: 'region',
    'aria-label': 'Player',
    '[class.is-playing]': 'audio.playing()',
  },
  template: `
    @let p = store.project();
    <div class="player-hero">
      @if (backdrop(); as bd) {
        <div class="backdrop" aria-hidden="true" [style.background-image]="cssUrl(bd)"></div>
      }
      <div class="vignette" aria-hidden="true"></div>
      @defer (on idle) {
        <aw-visualizer />
      }

      <div class="stage">
        <div class="art-block">
          <canvas class="ring" #ring aria-hidden="true"></canvas>
          <div
            class="artwork"
            #art
            [class.generating]="covers.busy()"
            role="img"
            [attr.aria-label]="coverLabel()"
          >
            <div class="artwork-fallback" aria-hidden="true">
              <mat-icon>hexagon</mat-icon>
            </div>
            @for (l of layers(); track l.key) {
              <img
                [src]="l.src"
                alt=""
                [class.shown]="l.shown"
                (load)="onCoverLoad(l.key)"
                (error)="onCoverError(l.key)"
              />
            }
          </div>
          @if (covers.current(); as c) {
            <button
              mat-icon-button
              type="button"
              class="save-btn icon-btn-sm"
              [class.on]="c.saved"
              (click)="covers.toggleSave()"
              [attr.aria-pressed]="c.saved"
              [attr.aria-label]="
                c.saved ? 'Unsave this cover' : 'Save this cover for every playthrough'
              "
              [matTooltip]="
                c.saved
                  ? 'Saved: shown on every playthrough. Click to unsave.'
                  : 'Save this cover for every playthrough'
              "
            >
              <mat-icon>{{ c.saved ? 'bookmark_added' : 'bookmark_add' }}</mat-icon>
            </button>
          }
        </div>

        <div class="info">
          <h2 class="song-name" [title]="p?.title ?? ''">{{ p?.title ?? 'AIWaves' }}</h2>
          <span class="song-artist">{{ p?.artist ?? '' }}</span>
          <div class="badges">
            <span
              class="station-badge"
              [class.live]="audio.playing()"
              [class.error]="audio.status() === 'error'"
              role="status"
            >
              <span class="equalizer" aria-hidden="true">
                <i #eqBar></i><i #eqBar></i><i #eqBar></i><i #eqBar></i>
              </span>
              {{ statusText() }}
            </span>
            <span
              class="cover-note"
              [class.problem]="covers.problem()"
              [title]="covers.problem() ?? ''"
              >{{ coverNote() }}</span
            >
            <div class="volume-row">
              <button
                mat-icon-button
                type="button"
                class="vol-icon"
                (click)="audio.toggleMute()"
                [attr.aria-label]="audio.muted() ? 'Unmute' : 'Mute'"
                [matTooltip]="(audio.muted() ? 'Unmute' : 'Mute') + ' (M)'"
              >
                <mat-icon>{{ volumeIcon() }}</mat-icon>
              </button>
              <mat-slider class="vol-slider" min="0" max="1" step="0.05">
                <input
                  matSliderThumb
                  [value]="audio.muted() ? 0 : audio.volume()"
                  (valueChange)="audio.setVolume($event)"
                  aria-label="Volume"
                />
              </mat-slider>
            </div>
          </div>

          <div class="control-deck">
            <div class="transport">
              <button
                mat-icon-button
                type="button"
                class="skip-btn"
                (click)="audio.seek(0)"
                aria-label="Back to the start"
                matTooltip="Back to the start"
              >
                <mat-icon>skip_previous</mat-icon>
              </button>
              <button
                mat-fab
                type="button"
                class="play-btn"
                [class.busy]="busy()"
                (click)="audio.toggle()"
                [disabled]="audio.status() === 'idle'"
                [attr.aria-label]="audio.playing() ? 'Pause' : 'Play'"
                [attr.aria-pressed]="audio.playing()"
                [matTooltip]="(audio.playing() ? 'Pause' : 'Play') + ' (Space)'"
              >
                <mat-icon>{{
                  busy() ? 'progress_activity' : audio.playing() ? 'pause' : 'play_arrow'
                }}</mat-icon>
              </button>
              <button
                mat-icon-button
                type="button"
                class="skip-btn"
                (click)="audio.stop()"
                aria-label="Stop"
                matTooltip="Stop"
              >
                <mat-icon>stop</mat-icon>
              </button>
            </div>

            <div class="seek-row">
              <span class="time mono">{{ clock() }}</span>
              <mat-slider class="seek" min="0" [max]="total()" step="0.25" [disabled]="!total()">
                <input
                  matSliderThumb
                  [value]="seekValue()"
                  (valueChange)="audio.seek($event)"
                  aria-label="Position"
                  [attr.aria-valuetext]="clock() + ' of ' + totalText()"
                />
              </mat-slider>
              <span class="time mono dim">{{ totalText() }}</span>
            </div>
          </div>
        </div>

        @if (p) {
          <dl class="readouts">
            <div class="lcd lcd-hero" aria-label="Position (bar.beat.sixteenth)">
              <dt>Bar · beat</dt>
              <dd class="mono">{{ playhead.bbt() }}</dd>
            </div>
            <div
              class="lcd lcd-hero"
              data-path="bpm"
              [class.glow]="animator.glow('bpm')"
              aria-label="Tempo"
            >
              <dt>BPM</dt>
              <dd class="mono">{{ bpm() }}</dd>
            </div>
            <div class="lcd" data-path="key" [class.glow]="animator.glow('key')" aria-label="Key">
              <dt>Key</dt>
              <dd>{{ p.key }}</dd>
            </div>
            <div class="lcd" aria-label="Time signature">
              <dt>Sig</dt>
              <dd class="mono">{{ p.time_signature[0] }}/{{ p.time_signature[1] }}</dd>
            </div>
            <div class="lcd" aria-label="Section at the playhead">
              <dt>Section</dt>
              <dd>{{ playhead.section()?.name ?? '—' }}</dd>
            </div>
            <div class="lcd" aria-label="Chord at the playhead">
              <dt>Chord</dt>
              <dd class="mono">{{ playhead.chord()?.name ?? '—' }}</dd>
            </div>
            <div
              class="lcd"
              data-path="version"
              [class.glow]="animator.glow('version')"
              aria-label="Song version"
            >
              <dt>Version</dt>
              <dd class="mono">{{ store.versionLabel() ? 'v' + store.versionLabel() : '—' }}</dd>
            </div>
            <div class="lcd" aria-label="Time">
              <dt>Time</dt>
              <dd class="mono">{{ clock() }}</dd>
            </div>
          </dl>
        }
      </div>

      @if (audio.error(); as err) {
        <div class="player-error" role="alert">
          <mat-icon aria-hidden="true">error</mat-icon>
          <span>{{ err }}</span>
          <button mat-button type="button" class="cut-btn" (click)="audio.reload()">Retry</button>
        </div>
      }
    </div>
  `,
})
export class PlayerComponent {
  protected readonly audio = inject(AudioService);
  protected readonly store = inject(WorkspaceStore);
  protected readonly animator = inject(Animator);
  protected readonly covers = inject(CoverService);
  protected readonly playhead = inject(Playhead);
  private readonly ring = viewChild<ElementRef<HTMLCanvasElement>>('ring');
  private readonly art = viewChild<ElementRef<HTMLElement>>('art');
  private readonly eqBars = viewChildren<ElementRef<HTMLElement>>('eqBar');

  /** Cover images on screen: the newest fades and morphs in over the previous one. */
  protected readonly layers = signal<{ key: string; src: string; shown: boolean }[]>([]);
  protected readonly backdrop = computed(
    () =>
      this.layers()
        .filter((l) => l.shown)
        .at(-1)?.src ?? null,
  );
  protected readonly coverLabel = computed(() => {
    const c = this.covers.current();
    return c ? `Cover art, seed ${c.seed}${c.saved ? ', saved' : ''}` : 'No cover art yet';
  });
  protected readonly coverNote = computed(() => {
    if (this.covers.busy()) return 'Generating cover…';
    if (this.covers.problem()) return 'Local cover art';
    const c = this.covers.current();
    if (!c) return '';
    return `Cover #${c.seed}${c.saved ? ' · saved' : ''}`;
  });
  private painter: RingPainter | null = null;

  protected readonly statusText = computed(() => STATUS_TEXT[this.audio.status()]);
  protected readonly busy = computed(
    () => this.audio.status() === 'loading' || this.audio.status() === 'buffering',
  );
  protected readonly volumeIcon = computed(() => {
    const v = this.audio.volume();
    if (v === 0 || this.audio.muted()) return 'volume_off';
    return v < 0.5 ? 'volume_down' : 'volume_up';
  });

  protected readonly total = computed(
    () => this.audio.duration() || this.store.project()?.audio.duration_s || 0,
  );
  protected readonly totalText = computed(() => formatClock(this.total()));
  /** The seek bar moves in quarter seconds: no change detection every frame. */
  protected readonly seekValue = computed(() => Math.round(this.audio.time() * 4) / 4);
  protected readonly clock = computed(() => formatClock(this.audio.time()));
  protected readonly bpm = computed(() => {
    const p = this.store.project();
    return p ? this.animator.value('bpm', p.bpm).toFixed(2) : '';
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const canvas = this.ring()?.nativeElement;
      if (!canvas) return;
      const painter = new RingPainter(canvas, this.audio);
      this.painter = painter;
      painter.refresh();
      const off = this.audio.onFrame(() => this.frame(painter));
      destroyRef.onDestroy(off);
    });
    effect(() => {
      const c = this.covers.current();
      if (!c) return;
      untracked(() =>
        this.layers.update((ls) =>
          ls.some((l) => l.key === c.key)
            ? ls
            : [...ls.slice(-1), { key: c.key, src: c.src, shown: false }],
        ),
      );
    });
  }

  protected cssUrl(src: string): string {
    return `url("${src}")`;
  }

  protected onCoverLoad(key: string): void {
    this.layers.update((ls) => ls.map((l) => (l.key === key ? { ...l, shown: true } : l)));
    // once the new cover has faded in, drop the ones under it
    setTimeout(() => {
      this.layers.update((ls) =>
        ls.slice(
          Math.max(
            0,
            ls.findIndex((l) => l.key === key),
          ),
        ),
      );
    }, 1200);
    void this.takeAccent(key);
  }

  protected onCoverError(key: string): void {
    this.layers.update((ls) => ls.filter((l) => l.key !== key));
  }

  /** Dynamic colour: the cover's dominant colour becomes the UI's accent. */
  private async takeAccent(key: string): Promise<void> {
    const layer = this.layers().find((l) => l.key === key);
    if (!layer) return;
    const dominant = await extractDominantColor(layer.src);
    const cover = this.covers.current();
    if (cover?.key !== key || typeof document === 'undefined') return;
    applyAccent(document.documentElement, accentFor(dominant, cover.palette));
    // the accent glides for 900 ms (see _tokens.scss); redraw the resting ring after it
    setTimeout(() => {
      if (!this.audio.playing()) this.painter?.refresh();
    }, 950);
  }

  /** Per-frame visuals, written straight to the DOM / canvas (no change detection). */
  private frame(painter: RingPainter): void {
    const playing = this.audio.playing();
    painter.draw(playing);
    const bands = painter.bands;
    const bars = this.eqBars();
    const per = Math.floor(bands.length / bars.length);
    bars.forEach((bar, i) => {
      let sum = 0;
      for (let j = i * per; j < (i + 1) * per; j++) sum += bands[j];
      const v = playing ? Math.max(0.15, Math.min(1, (sum / per) * 1.4)) : 0.28;
      bar.nativeElement.style.transform = `scaleY(${v.toFixed(3)})`;
    });
    if (!reducedMotion)
      this.art()?.nativeElement.style.setProperty('--lvl', this.audio.level().toFixed(3));
  }
}
