import { Directive, ElementRef, computed, effect, inject, input, untracked } from '@angular/core';
import { Animator } from '../core/animator.service';
import { Clip } from '../core/model';
import { WorkspaceStore } from '../core/workspace.store';
import {
  CLIP_BORDER_PX,
  CLIP_CONTENT_TOP,
  CLIP_INSET_PX,
  DrumLane,
  noteRects,
  tint,
  wavePolygon,
} from './clip-render';

/** Browsers refuse canvases wider than this many device pixels. */
const MAX_CANVAS_PX = 16384;

/**
 * Draws the contents of every clip in one track lane on a single canvas: waveforms for audio
 * clips, a piano-roll preview for MIDI clips, one row per lane for drum clips. The canvas covers
 * only `win` (the viewport plus a margin), so its size doesn't grow with zoom, and it never
 * creates a DOM node per note. Clip boxes (`aw-clip`) sit underneath and keep the names, glow
 * and tooltips.
 */
@Directive({
  selector: 'canvas[awLane]',
  host: {
    class: 'lane-canvas',
    'aria-hidden': 'true',
    '[style.left.px]': 'win().start',
    '[style.top.px]': 'contentTop',
    '[style.width.px]': 'win().width',
    '[style.height.px]': 'contentH()',
  },
})
export class LaneCanvasDirective {
  private readonly el = inject<ElementRef<HTMLCanvasElement>>(ElementRef);
  private readonly animator = inject(Animator);
  private readonly store = inject(WorkspaceStore);

  readonly trackId = input.required<string>();
  readonly clips = input.required<readonly Clip[]>();
  readonly color = input.required<string>();
  readonly ppb = input.required<number>();
  readonly beatsPerBar = input(4);
  /** Lane height in px, including the row's 1 px bottom border. */
  readonly laneH = input.required<number>();
  /** Drum lanes of the track (top to bottom), or null for pitched notes. */
  readonly lanes = input<readonly DrumLane[] | null>(null);
  /** Waveform display gain for this track (`peakGain`). */
  readonly gain = input(1);
  /** Horizontal span to draw, in lane pixels (`laneWindow`). */
  readonly win = input.required<{ start: number; width: number }>();

  protected readonly contentTop = CLIP_CONTENT_TOP;
  protected readonly contentH = computed(() =>
    Math.max(0, this.laneH() - 1 - CLIP_CONTENT_TOP - CLIP_BORDER_PX - CLIP_INSET_PX),
  );

  constructor() {
    effect(() => {
      const track = 'tracks.' + this.trackId();
      const ppb = this.ppb();
      // animator.value() follows clip.move tweens; it only subscribes to the frame clock while
      // one of this lane's clips is actually moving
      const clips = this.clips().map((c) => ({
        clip: c,
        x: this.animator.value(`${track}.clips.${c.id}`, c.start_bar) * ppb,
      }));
      const ghosts = this.store.ghosts();
      const dim = (id: string) => !ghosts.has(track) && ghosts.has(`${track}.clips.${id}`);
      const args = {
        clips: clips.map((c) => ({ ...c, dim: dim(c.clip.id) })),
        ppb,
        bpb: this.beatsPerBar(),
        h: this.contentH(),
        lanes: this.lanes(),
        gain: this.gain(),
        ink: tint(this.color(), 0.55),
        win: this.win(),
      };
      untracked(() => this.draw(args));
    });
  }

  private draw(a: {
    clips: { clip: Clip; x: number; dim: boolean }[];
    ppb: number;
    bpb: number;
    h: number;
    lanes: readonly DrumLane[] | null;
    gain: number;
    ink: string;
    win: { start: number; width: number };
  }): void {
    const el = this.el.nativeElement;
    const { win, h } = a;
    const dpr = Math.min(
      2,
      globalThis.devicePixelRatio || 1,
      MAX_CANVAS_PX / Math.max(1, win.width),
    );
    const pw = Math.max(1, Math.round(win.width * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (el.width !== pw) el.width = pw;
    if (el.height !== ph) el.height = ph;
    const ctx = typeof CanvasRenderingContext2D === 'undefined' ? null : el.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, win.width, h);
    if (h < 2) return;
    ctx.fillStyle = a.ink;

    for (const { clip, x, dim } of a.clips) {
      // inside the clip box's border, in canvas coordinates
      const left = x - win.start + CLIP_BORDER_PX;
      const w = Math.max(2, clip.length_bars * a.ppb) - 2 * CLIP_BORDER_PX;
      if (w <= 0 || left + w < 0 || left > win.width) continue;
      const fade = dim ? 0.22 : 1;
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, 0, w, h);
      ctx.clip();
      ctx.translate(left, 0);

      if (clip.peaks?.length) {
        const pts = wavePolygon(clip.peaks, w, h, a.gain);
        if (pts.length) {
          ctx.globalAlpha = 0.92 * fade;
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.closePath();
          ctx.fill();
        }
      } else if (clip.notes?.length) {
        for (const r of noteRects(clip.notes, clip.length_bars * a.bpb, w, h, a.lanes)) {
          ctx.globalAlpha = r.alpha * fade;
          ctx.fillRect(r.x, r.y, r.w, r.h);
        }
        if (a.lanes) this.drumLabels(ctx, a.lanes, w, h, fade);
      }
      ctx.restore();
    }
  }

  /** Drum names at the clip's left edge, when the rows are tall enough to read. */
  private drumLabels(
    ctx: CanvasRenderingContext2D,
    lanes: readonly DrumLane[],
    w: number,
    h: number,
    fade: number,
  ): void {
    const rowH = h / lanes.length;
    if (rowH < 8 || w < 70) return;
    const size = Math.min(10, Math.floor(rowH) - 1);
    ctx.font = `${size}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    const ink = ctx.fillStyle;
    lanes.forEach((l, i) => {
      const text = l.label || String(l.lane);
      const tw = Math.min(56, ctx.measureText(text).width);
      const y = i * rowH;
      ctx.globalAlpha = 0.6 * fade;
      ctx.fillStyle = '#141516';
      ctx.fillRect(0, y, tw + 5, rowH);
      ctx.globalAlpha = 0.85 * fade;
      ctx.fillStyle = ink;
      ctx.fillText(text, 2, y + rowH / 2, 56);
    });
  }
}
