import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { Animator } from '../core/animator.service';
import { AudioService } from '../core/audio.service';
import { Clip, Track } from '../core/model';
import { beatsPerBar, formatDb, secondsPerBar } from '../core/time';
import { WorkspaceStore } from '../core/workspace.store';
import {
  DrumLane,
  barLabelEvery,
  clampLane,
  clampPpb,
  defaultLaneHeight,
  drumLanes,
  fitAnchorPx,
  fitPpb,
  LANE_MAX_PX,
  LANE_MIN_PX,
  laneWindow,
  peakGain,
  wavePath,
  wheelFactor,
  zoomStep,
} from './clip-render';
import { ClipComponent } from './clip.component';
import { LaneCanvasDirective } from './lane-canvas.directive';
import { MeterDirective, PlayheadDirective } from '../ui/live-style.directives';
import { Playhead } from '../core/playhead';
import { PanelLayout } from '../core/panel-layout';
import { PanelStepsComponent } from '../ui/panel-steps.component';

const HEAD_W = 188;
const RULER_H = 26;
const CHORD_H = 20;
const BUTTON_ZOOM = 1.5;
/** Locator colours: the AlienFX palette, bright enough for dark text on the flags. */
const SECTION_COLORS = ['#00e5ff', '#b14dff', '#ff2bd6', '#3dffa2', '#ffc24d', '#4c8dff'];

@Component({
  selector: 'aw-arrangement',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ClipComponent,
    LaneCanvasDirective,
    MatIconButton,
    MatIcon,
    MatTooltip,
    MeterDirective,
    PlayheadDirective,
    PanelStepsComponent,
  ],
  host: {
    class: 'panel arrangement',
    role: 'region',
    'aria-label': 'Arrangement',
    '[class.collapsed]': 'collapsed()',
  },
  template: `
    <div class="panel-bar">
      <mat-icon aria-hidden="true">view_timeline</mat-icon>
      <h2 class="panel-title">Arrangement</h2>
      <span class="panel-sub">{{ ppb().toFixed(1) }} px/bar</span>
      <div class="panel-tools">
        <button
          mat-icon-button
          class="icon-btn-sm"
          type="button"
          (click)="zoomCenter(1 / buttonZoom)"
          aria-label="Zoom out"
          matTooltip="Zoom out (Ctrl/Cmd + wheel)"
        >
          <mat-icon>zoom_out</mat-icon>
        </button>
        <button
          mat-icon-button
          class="icon-btn-sm"
          type="button"
          (click)="zoomCenter(buttonZoom)"
          aria-label="Zoom in"
          matTooltip="Zoom in (Ctrl/Cmd + wheel)"
        >
          <mat-icon>zoom_in</mat-icon>
        </button>
        <button
          mat-icon-button
          class="icon-btn-sm"
          type="button"
          (click)="fit()"
          aria-label="Fit the whole song"
          matTooltip="Fit the whole song"
        >
          <mat-icon>fit_screen</mat-icon>
        </button>
        <aw-panel-steps panel="arrangement" name="arrangement" />
      </div>
    </div>
    @let p = store.project();
    <div class="arr-scroll" #scroller (wheel)="onWheel($event)" [class.is-hidden]="collapsed()">
      @if (p) {
        <div
          class="arr-grid"
          [class.beats]="ppb() >= 48"
          [style.width.px]="headW + lanesWidth()"
          [style.--ppb]="ppb() + 'px'"
          [style.--bpb]="bpb()"
        >
          <div class="arr-row ruler-row" [style.height.px]="rulerH">
            <div class="arr-head corner">
              <span>Locators</span>
              <span class="corner-bar">Bar</span>
            </div>
            <div
              class="arr-lane ruler"
              (click)="seekFromLane($event)"
              [style.width.px]="lanesWidth()"
              title="Click to move the playhead"
            >
              @for (s of p.sections; track s.start_bar; let i = $index) {
                <div
                  class="section-band"
                  [style.left.px]="s.start_bar * ppb()"
                  [style.width.px]="(s.end_bar - s.start_bar) * ppb()"
                  [style.--sec]="sectionColor(i)"
                  [class.current]="s === playhead.section()"
                ></div>
                <div
                  class="locator"
                  [style.left.px]="s.start_bar * ppb()"
                  [style.--sec]="sectionColor(i)"
                  [class.current]="s === playhead.section()"
                >
                  <span class="locator-flag">{{ s.name }}</span>
                </div>
              }
              @for (b of barTicks(); track b) {
                <span class="bar-tick" [style.left.px]="b * ppb()"></span>
              }
              @for (b of barLabels(); track b) {
                <span class="bar-num" [style.left.px]="b * ppb()">{{ b + 1 }}</span>
              }
              <span class="lane-playhead" [awPlayhead]="ppb()"></span>
            </div>
          </div>
          <div class="arr-row chord-row" [style.top.px]="rulerH" [style.height.px]="chordH">
            <div class="arr-head corner">Chords</div>
            <div class="arr-lane chords" [style.width.px]="lanesWidth()">
              @for (c of visibleChords(); track c.bar) {
                <span
                  class="chord"
                  [style.left.px]="c.bar * ppb()"
                  [class.current]="c.bar === playhead.barIndex()"
                  >{{ c.name }}</span
                >
              }
            </div>
          </div>
          <div class="arr-row master-row" [style.top.px]="rulerH + chordH">
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
              <span class="lane-playhead" [awPlayhead]="ppb()"></span>
            </div>
          </div>

          @for (t of p.tracks; track t.id) {
            @let laneH = laneHeight(t);
            <div
              class="arr-row track-row"
              [class.selected]="t.id === store.selectedTrack()?.id"
              [class.ghost]="store.ghosts().has('tracks.' + t.id)"
              [class.compact]="laneH < 40"
              [style.height.px]="laneH"
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
                <span class="head-meter" aria-hidden="true"><span [awMeter]="t"></span></span>
              </div>
              <div class="arr-lane clips-lane" [style.width.px]="lanesWidth()">
                @for (c of t.clips; track c.id) {
                  @let cp = 'tracks.' + t.id + '.clips.' + c.id;
                  <aw-clip
                    [clip]="c"
                    [path]="cp"
                    [color]="c.color ?? t.color"
                    [ppb]="ppb()"
                    [ghost]="store.ghosts().has(cp)"
                    [playing]="sounding().has(c)"
                  />
                }
                @if (t.clips.length) {
                  <canvas
                    awLane
                    [trackId]="t.id"
                    [clips]="t.clips"
                    [color]="t.color"
                    [ppb]="ppb()"
                    [beatsPerBar]="bpb()"
                    [laneH]="laneH"
                    [lanes]="drumLanesOf().get(t.id) ?? null"
                    [gain]="gainOf().get(t.id) ?? 1"
                    [win]="laneWin()"
                  ></canvas>
                }
              </div>
              <div
                class="lane-resize"
                role="separator"
                aria-orientation="horizontal"
                tabindex="0"
                [attr.aria-label]="'Height of track ' + t.name"
                [attr.aria-valuenow]="laneH"
                [attr.aria-valuemin]="laneMin"
                [attr.aria-valuemax]="laneMax"
                title="Drag to resize the lane"
                (pointerdown)="startResize($event, t)"
                (pointermove)="moveResize($event, t)"
                (pointerup)="endResize($event)"
                (pointercancel)="endResize($event)"
                (dblclick)="resetHeight(t)"
                (keydown)="resizeKey($event, t)"
              ></div>
            </div>
          }
          <div class="playhead" [awPlayhead]="ppb()" [offset]="headW" aria-hidden="true"></div>
        </div>
      } @else if (store.loadError()) {
        <div class="stage-empty" role="alert">
          <mat-icon aria-hidden="true">error</mat-icon>
          <span>The project couldn't be loaded.</span>
          <span class="stage-empty-sub">{{ store.loadError() }}</span>
        </div>
      } @else {
        <div class="stage-empty" role="status">
          <mat-icon class="spin" aria-hidden="true">progress_activity</mat-icon>
          <span>{{
            store.mode() === 'connecting' ? 'Looking for the AIWaves backend…' : 'Loading the song…'
          }}</span>
        </div>
      }
    </div>
  `,
})
export class ArrangementComponent {
  private readonly layout = inject(PanelLayout);
  protected readonly collapsed = computed(() => this.layout.collapsed('arrangement'));
  protected readonly store = inject(WorkspaceStore);
  protected readonly animator = inject(Animator);
  private readonly audio = inject(AudioService);
  protected readonly playhead = inject(Playhead);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');

  protected readonly headW = HEAD_W;
  protected readonly rulerH = RULER_H;
  protected readonly chordH = CHORD_H;
  protected readonly buttonZoom = BUTTON_ZOOM;
  protected readonly laneMin = LANE_MIN_PX;
  protected readonly laneMax = LANE_MAX_PX;
  protected readonly ppb = this.store.pxPerBar;
  protected readonly fmtDb = formatDb;
  /** Lane heights the viewer dragged; everything else uses the default for its kind. */
  private readonly laneHeights = signal<Readonly<Record<string, number>>>({});
  private resizing: { id: string; startY: number; startH: number } | null = null;

  /** Horizontal scroll and visible lane width, mirrored from the scroller. */
  private readonly scrollX = signal(0);
  private readonly viewW = signal(0);
  /** True until the viewer zooms: the song keeps fitting the window as it resizes. */
  private following = true;
  /** Where a smooth zoom is heading: the zoom, and the bar that stays under a viewport x. */
  private zoomTarget: { ppb: number; bar: number; px: number } | null = null;
  private zoomRaf = 0;

  protected readonly bpb = computed(() => {
    const p = this.store.project();
    return p ? beatsPerBar(p) : 4;
  });
  protected readonly songBars = computed(() => {
    const p = this.store.project();
    return p ? Math.max(p.length_bars, p.audio.duration_s / secondsPerBar(p)) : 0;
  });
  protected readonly lanesWidth = computed(() => Math.ceil(this.songBars() + 1) * this.ppb());
  /** The span every lane canvas draws; changes only when scrolling crosses a viewport tile. */
  protected readonly laneWin = computed(
    () => laneWindow(this.scrollX(), this.viewW(), this.lanesWidth()),
    { equal: (a, b) => a.start === b.start && a.width === b.width },
  );
  /** Drum tracks' lanes from all their clips, so every clip of a track draws the same rows. */
  protected readonly drumLanesOf = computed(() => {
    const out = new Map<string, DrumLane[]>();
    for (const t of this.store.project()?.tracks ?? [])
      if (t.kind === 'drum') out.set(t.id, drumLanes(t.clips.flatMap((c) => c.notes ?? [])));
    return out;
  });
  protected readonly gainOf = computed(
    () => new Map((this.store.project()?.tracks ?? []).map((t) => [t.id, peakGain(t.clips)])),
  );
  /** Clips under the playhead while playing; a new set only when the playhead crosses a clip edge. */
  protected readonly sounding = computed(
    () => {
      const out = new Set<Clip>();
      if (!this.audio.playing()) return out;
      const b = this.playhead.bar();
      for (const t of this.store.project()?.tracks ?? [])
        for (const c of t.clips)
          if (b >= c.start_bar && b < c.start_bar + c.length_bars) out.add(c);
      return out;
    },
    { equal: (a, b) => a.size === b.size && [...a].every((c) => b.has(c)) },
  );
  protected readonly barLabels = computed(() => {
    const p = this.store.project();
    if (!p) return [];
    const every = barLabelEvery(this.ppb());
    const out: number[] = [];
    for (let b = 0; b < p.length_bars; b += every) out.push(b);
    return out;
  });
  protected readonly barTicks = computed(() => {
    const p = this.store.project();
    if (!p || this.ppb() < 8) return [];
    return Array.from({ length: p.length_bars }, (_, b) => b);
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
  /** In viewBox units: one unit per peak across, 100 down. */
  protected readonly wavePath = computed(() => {
    const peaks = this.store.project()?.audio.peaks ?? [];
    return wavePath(peaks, peaks.length, 100);
  });

  constructor() {
    afterNextRender(() => {
      const el = this.scroller()?.nativeElement;
      if (!el) return;
      // a plain listener: scrolling only updates a signal, it doesn't re-render the arrangement
      const onScroll = () => this.scrollX.set(el.scrollLeft);
      const measure = () => this.viewW.set(Math.max(0, el.clientWidth - HEAD_W));
      el.addEventListener('scroll', onScroll, { passive: true });
      measure();
      const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
      ro?.observe(el);
      this.destroyRef.onDestroy(() => {
        el.removeEventListener('scroll', onScroll);
        ro?.disconnect();
        if (this.zoomRaf) cancelAnimationFrame(this.zoomRaf);
      });
    });
    // fit the whole song until the viewer zooms; refit when the window or the song length changes
    effect(() => {
      const bars = this.songBars();
      const w = this.viewW();
      if (bars && w && this.following) untracked(() => this.fitNow());
    });
    // keep the playhead in view while playing
    effect(() => {
      const x = this.playhead.bar() * this.ppb();
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

  // --- lane heights ----------------------------------------------------------------------------

  protected laneHeight(t: Track): number {
    return this.laneHeights()[t.id] ?? defaultLaneHeight(t.kind);
  }

  protected startResize(e: PointerEvent, t: Track): void {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.resizing = { id: t.id, startY: e.clientY, startH: this.laneHeight(t) };
    e.preventDefault();
  }

  protected moveResize(e: PointerEvent, t: Track): void {
    const r = this.resizing;
    if (!r || r.id !== t.id) return;
    this.setHeight(t.id, r.startH + (e.clientY - r.startY));
  }

  protected endResize(e: PointerEvent): void {
    if (!this.resizing) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    this.resizing = null;
  }

  protected resetHeight(t: Track): void {
    this.laneHeights.update((h) => {
      const next = { ...h };
      delete next[t.id];
      return next;
    });
  }

  protected resizeKey(e: KeyboardEvent, t: Track): void {
    const delta = e.key === 'ArrowUp' ? -8 : e.key === 'ArrowDown' ? 8 : 0;
    if (!delta) return;
    e.preventDefault();
    e.stopPropagation(); // the arrows otherwise step the replay
    this.setHeight(t.id, this.laneHeight(t) + delta);
  }

  private setHeight(id: string, h: number): void {
    this.laneHeights.update((all) => ({ ...all, [id]: clampLane(h) }));
  }

  // --- zoom and scroll -------------------------------------------------------------------------

  /**
   * Smoothly zooms by `factor` keeping the bar under `anchorPx` (viewport x from the lanes' left
   * edge) in place. Repeated calls (wheel notches) compound onto the zoom already in flight.
   */
  protected zoomBy(factor: number, anchorPx: number): void {
    this.following = false;
    const target = clampPpb((this.zoomTarget?.ppb ?? this.ppb()) * factor);
    this.zoomTo(target, anchorPx, (this.scrollX() + anchorPx) / this.ppb());
  }

  protected zoomCenter(factor: number): void {
    this.zoomBy(factor, this.viewW() / 2);
  }

  /** Smoothly zooms out (or in) to show the whole song, ending scrolled to its start. */
  protected fit(): void {
    if (!this.store.project() || !this.viewW()) return;
    this.following = true;
    const p0 = this.ppb();
    const s0 = this.scrollX();
    const target = this.fitTarget();
    const px = fitAnchorPx(s0, p0, target);
    this.zoomTo(target, px, (s0 + px) / p0);
  }

  protected onWheel(e: WheelEvent): void {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const el = this.scroller()?.nativeElement;
    const left = el ? el.getBoundingClientRect().left : 0;
    const dy = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 33 : e.deltaY;
    this.zoomBy(wheelFactor(dy), Math.max(0, e.clientX - left - HEAD_W));
  }

  private fitTarget(): number {
    return fitPpb(this.songBars() + 1, this.viewW() - 4);
  }

  private fitNow(): void {
    this.zoomTarget = null;
    this.ppb.set(this.fitTarget());
    this.setScroll(0);
  }

  private zoomTo(ppb: number, px: number, bar: number): void {
    this.zoomTarget = { ppb, bar, px };
    if (typeof requestAnimationFrame === 'undefined') this.zoomFrame(1);
    else if (!this.zoomRaf) this.zoomRaf = requestAnimationFrame(() => this.zoomFrame());
  }

  private zoomFrame(rate?: number): void {
    this.zoomRaf = 0;
    const z = this.zoomTarget;
    if (!z) return;
    const ppb = zoomStep(this.ppb(), z.ppb, rate);
    this.ppb.set(ppb);
    this.setScroll(Math.max(0, z.bar * ppb - z.px));
    if (ppb === z.ppb) this.zoomTarget = null;
    else this.zoomRaf = requestAnimationFrame(() => this.zoomFrame());
  }

  /** Scrolls once the new zoom has rendered (before that the grid has its old width). */
  private setScroll(x: number): void {
    this.scrollX.set(x);
    afterNextRender(
      {
        write: () => {
          const el = this.scroller()?.nativeElement;
          if (!el) return;
          el.scrollLeft = x;
          this.scrollX.set(el.scrollLeft);
        },
      },
      { injector: this.injector },
    );
  }

  protected seekFromLane(e: MouseEvent): void {
    const p = this.store.project();
    if (!p) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const bar = (e.clientX - rect.left) / this.ppb();
    this.audio.seek(bar * secondsPerBar(p));
  }
}
