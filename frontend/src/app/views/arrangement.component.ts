import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { Animator } from '../core/animator.service';
import { AudioService } from '../core/audio.service';
import { Clip, Track } from '../core/model';
import { barAt, formatDb, secondsPerBar } from '../core/time';
import { WorkspaceStore } from '../core/workspace.store';
import { trackLevel } from './levels';

const HEAD_W = 188;
const MIN_PPB = 6;
const MAX_PPB = 120;
const SECTION_COLORS = ['#3b4a5c', '#4a3f5c', '#5c3f45', '#3f5c4a', '#5c523f', '#3f525c'];

@Component({
  selector: 'aw-arrangement',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel arrangement', role: 'region', 'aria-label': 'Arrangement' },
  template: `
    <div class="panel-bar">
      <h2 class="panel-title">Arrangement</h2>
      <div class="panel-tools">
        <button
          type="button"
          class="mini-btn"
          (click)="zoom(1 / 1.4)"
          aria-label="Zoom out"
          title="Zoom out (Ctrl+wheel)"
        >
          −
        </button>
        <button
          type="button"
          class="mini-btn"
          (click)="zoom(1.4)"
          aria-label="Zoom in"
          title="Zoom in (Ctrl+wheel)"
        >
          +
        </button>
        <button type="button" class="mini-btn" (click)="fit()" title="Fit the song to the window">
          Fit
        </button>
      </div>
    </div>
    @let p = store.project();
    <div class="arr-scroll" #scroller (wheel)="onWheel($event)">
      @if (p) {
        <div class="arr-grid" [style.width.px]="headW + lanesWidth()" [style.--ppb]="ppb() + 'px'">
          <div class="arr-row ruler-row">
            <div class="arr-head corner">Bar</div>
            <div
              class="arr-lane ruler"
              (click)="seekFromLane($event)"
              [style.width.px]="lanesWidth()"
              title="Click to move the playhead"
            >
              @for (s of p.sections; track s.start_bar; let i = $index) {
                <div
                  class="section"
                  [style.left.px]="s.start_bar * ppb()"
                  [style.width.px]="(s.end_bar - s.start_bar) * ppb()"
                  [style.background]="sectionColor(i)"
                  [class.current]="s === currentSection()"
                >
                  {{ s.name }}
                </div>
              }
              @for (b of barLabels(); track b) {
                <span class="bar-num" [style.left.px]="b * ppb()">{{ b + 1 }}</span>
              }
            </div>
          </div>
          <div class="arr-row chord-row">
            <div class="arr-head corner">Chords</div>
            <div class="arr-lane chords" [style.width.px]="lanesWidth()">
              @for (c of visibleChords(); track c.bar) {
                <span
                  class="chord"
                  [style.left.px]="c.bar * ppb()"
                  [class.current]="c.bar === currentBarInt()"
                  >{{ c.name }}</span
                >
              }
            </div>
          </div>
          <div class="arr-row master-row">
            <div class="arr-head">
              <span class="head-name">Master render</span>
              <span class="head-sub">{{ p.audio.master }}</span>
            </div>
            <div
              class="arr-lane wave-lane"
              data-path="audio"
              [class.glow]="animator.glow('audio')"
              (click)="seekFromLane($event)"
              [style.width.px]="lanesWidth()"
              title="Click to move the playhead"
            >
              <svg
                class="wave"
                [attr.viewBox]="'0 0 ' + peakCount() + ' 100'"
                preserveAspectRatio="none"
                [style.width.px]="waveWidth()"
                aria-label="Master waveform"
                role="img"
              >
                <path [attr.d]="wavePath()" />
              </svg>
            </div>
          </div>

          @for (t of p.tracks; track t.id) {
            <div
              class="arr-row track-row"
              [class.selected]="t.id === store.selectedTrack()?.id"
              [class.ghost]="store.ghosts().has('tracks.' + t.id)"
            >
              <div
                class="arr-head track-head"
                [attr.data-path]="'tracks.' + t.id"
                [class.glow]="animator.glow('tracks.' + t.id)"
                [class.touched]="animator.glowUnder('tracks.' + t.id)"
                role="button"
                tabindex="0"
                [attr.aria-pressed]="t.id === store.selectedTrack()?.id"
                [attr.aria-label]="'Select track ' + t.name"
                (click)="store.selectTrack(t.id)"
                (keydown.enter)="store.selectTrack(t.id)"
              >
                <span class="swatch" [style.background]="t.color"></span>
                <span class="head-text">
                  <span class="head-name">{{ t.name }}</span>
                  <span class="head-sub">{{ t.kind }} · {{ fmtDb(t.mixer.volume_db) }}</span>
                </span>
                <span
                  class="light light-m"
                  [class.on]="t.mixer.mute"
                  [attr.aria-label]="t.mixer.mute ? 'Muted' : 'Not muted'"
                  role="img"
                  >M</span
                >
                <span
                  class="light light-s"
                  [class.on]="t.mixer.solo"
                  [attr.aria-label]="t.mixer.solo ? 'Soloed' : 'Not soloed'"
                  role="img"
                  >S</span
                >
                <span class="head-meter" aria-hidden="true"
                  ><span [style.height.%]="meter(t) * 100"></span
                ></span>
              </div>
              <div class="arr-lane clips-lane" [style.width.px]="lanesWidth()">
                @for (c of t.clips; track c.id) {
                  @let cp = 'tracks.' + t.id + '.clips.' + c.id;
                  <div
                    class="clip"
                    [attr.data-path]="cp"
                    [class.glow]="animator.glow(cp)"
                    [class.ghost]="store.ghosts().has(cp)"
                    [class.playing]="isUnderPlayhead(c)"
                    [style.left.px]="animator.value(cp, c.start_bar) * ppb()"
                    [style.width.px]="c.length_bars * ppb()"
                    [style.--clip]="c.color ?? t.color"
                    [title]="c.name + ' — bar ' + (c.start_bar + 1).toFixed(2)"
                  >
                    <span class="clip-name">{{ c.name }}</span>
                  </div>
                }
              </div>
            </div>
          }
          <div
            class="playhead"
            [style.left.px]="headW + playheadBar() * ppb()"
            aria-hidden="true"
          ></div>
        </div>
      }
    </div>
  `,
})
export class ArrangementComponent {
  protected readonly store = inject(WorkspaceStore);
  protected readonly animator = inject(Animator);
  private readonly audio = inject(AudioService);
  private readonly scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');

  protected readonly headW = HEAD_W;
  protected readonly ppb = this.store.pxPerBar;
  protected readonly fmtDb = formatDb;
  private fitted = false;

  protected readonly lanesWidth = computed(() => {
    const p = this.store.project();
    if (!p) return 0;
    const bars = Math.max(p.length_bars, p.audio.duration_s / secondsPerBar(p));
    return Math.ceil(bars + 1) * this.ppb();
  });
  protected readonly playheadBar = computed(() => {
    const p = this.store.project();
    return p ? barAt(p, this.audio.time()) : 0;
  });
  protected readonly currentBarInt = computed(() => Math.floor(this.playheadBar()));
  protected readonly currentSection = computed(() => {
    const b = this.playheadBar();
    return this.store.project()?.sections.find((s) => b >= s.start_bar && b < s.end_bar) ?? null;
  });
  protected readonly barLabels = computed(() => {
    const p = this.store.project();
    if (!p) return [];
    const ppb = this.ppb();
    const every = ppb < 12 ? 8 : ppb < 24 ? 4 : ppb < 48 ? 2 : 1;
    const out: number[] = [];
    for (let b = 0; b < p.length_bars; b += every) out.push(b);
    return out;
  });
  protected readonly visibleChords = computed(() => {
    const chords = this.store.project()?.chords ?? [];
    const minGap = 30 / this.ppb(); // bars between labels so they never overlap
    let lastBar = -Infinity;
    let lastName = '';
    return chords.filter((c) => {
      if (c.name === lastName || c.bar - lastBar < minGap) return false;
      lastBar = c.bar;
      lastName = c.name;
      return true;
    });
  });
  protected readonly peakCount = computed(() => this.store.project()?.audio.peaks.length ?? 0);
  protected readonly waveWidth = computed(() => {
    const p = this.store.project();
    return p ? (p.audio.duration_s / secondsPerBar(p)) * this.ppb() : 0;
  });
  protected readonly wavePath = computed(() => {
    const peaks = this.store.project()?.audio.peaks ?? [];
    if (!peaks.length) return '';
    const top = peaks.map((v, i) => `${i} ${(50 - Math.min(1, v) * 48).toFixed(1)}`);
    const bottom = peaks.map((v, i) => `${i} ${(50 + Math.min(1, v) * 48).toFixed(1)}`).reverse();
    return `M ${top.join(' L ')} L ${bottom.join(' L ')} Z`;
  });

  constructor() {
    effect(() => {
      if (this.store.project() && this.scroller() && !this.fitted) {
        this.fitted = true;
        setTimeout(() => this.fit());
      }
    });
    // keep the playhead in view while playing
    effect(() => {
      const x = this.playheadBar() * this.ppb();
      const el = this.scroller()?.nativeElement;
      if (!el || !untracked(this.audio.playing)) return;
      const visible = el.clientWidth - HEAD_W;
      if (x < el.scrollLeft || x > el.scrollLeft + visible - 40)
        el.scrollLeft = Math.max(0, x - 40);
    });
  }

  protected sectionColor(i: number): string {
    return SECTION_COLORS[i % SECTION_COLORS.length];
  }

  protected meter(t: Track): number {
    const p = this.store.project();
    return p ? trackLevel(p, t, this.playheadBar(), this.audio.playing(), this.audio.level()) : 0;
  }

  protected isUnderPlayhead(c: Clip): boolean {
    const b = this.playheadBar();
    return this.audio.playing() && b >= c.start_bar && b < c.start_bar + c.length_bars;
  }

  protected zoom(factor: number): void {
    const el = this.scroller()?.nativeElement;
    const old = this.ppb();
    const next = Math.min(MAX_PPB, Math.max(MIN_PPB, old * factor));
    const centerBar = el ? (el.scrollLeft + (el.clientWidth - HEAD_W) / 2) / old : 0;
    this.ppb.set(next);
    if (el)
      setTimeout(
        () => (el.scrollLeft = Math.max(0, centerBar * next - (el.clientWidth - HEAD_W) / 2)),
      );
  }

  protected fit(): void {
    const el = this.scroller()?.nativeElement;
    const p = this.store.project();
    if (!el || !p) return;
    const bars = Math.max(p.length_bars, p.audio.duration_s / secondsPerBar(p)) + 1;
    this.ppb.set(Math.min(MAX_PPB, Math.max(MIN_PPB, (el.clientWidth - HEAD_W - 4) / bars)));
    el.scrollLeft = 0;
  }

  protected onWheel(e: WheelEvent): void {
    if (!e.ctrlKey) return;
    e.preventDefault();
    this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }

  protected seekFromLane(e: MouseEvent): void {
    const p = this.store.project();
    if (!p) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const bar = (e.clientX - rect.left) / this.ppb();
    this.audio.seek(bar * secondsPerBar(p));
  }
}
