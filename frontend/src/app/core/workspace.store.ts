import { Injectable, computed, inject, signal } from '@angular/core';
import { Animator } from './animator.service';
import { PanelLayout, panelOf } from './panel-layout';
import { ApiService } from './api.service';
import {
  MIRRORED_VERBS,
  apply,
  controlPath,
  mergeEvents,
  pendingAdds,
  stateAt,
  trackIdOf,
  versionAt,
} from './apply';
import { APP_CONFIG } from './config';
import { DataSource, EMPTY_HANDOFF, EMPTY_HISTORY, LinkStatus } from './data-source';
import { MockApiService } from './mock-api.service';
import { AiEvent, Handoff, History, Project } from './model';
import { Render, renderAt, versionSpans, versionStep } from './timeline';
import { isProject, sanitizeProject } from './validate';

export const REPLAY_STEP_MS = 1500;
const BACKEND_RECHECK_MS = 15_000;
/** Live events after which `/history` has something new. */
const HISTORY_VERBS: ReadonlySet<string> = new Set(['version.tag', 'render.done']);
/** Verbs that never change project.json: no need to re-fetch the project after them. */
const STATELESS_VERBS: ReadonlySet<string> = new Set(['note', 'version.tag', 'doc.update']);

/**
 * All workspace state. Data (project, events, history) comes only from the DataSource; everything
 * else here is local view state (replay position, selection, zoom). Nothing is ever sent back.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceStore {
  private readonly cfg = inject(APP_CONFIG);
  private readonly api = inject(ApiService);
  private readonly mock = inject(MockApiService);
  private readonly animator = inject(Animator);
  private readonly layout = inject(PanelLayout);

  readonly mode = signal<'connecting' | 'live' | 'demo'>('connecting');
  readonly link = signal<LinkStatus>('connecting');
  readonly loadError = signal<string | null>(null);

  /** Latest known project (what the server has now). */
  readonly base = signal<Project | null>(null);
  readonly events = signal<AiEvent[]>([]);
  readonly history = signal<History>(EMPTY_HISTORY);
  /** aiwave411.md, the agent handoff document (CONTRACT §11). */
  readonly handoff = signal<Handoff>(EMPTY_HANDOFF);

  /** Replay position; null follows the live head. */
  readonly viewSeq = signal<number | null>(null);
  readonly replaying = signal(false);
  readonly selectedTrackId = signal<string | null>(null);
  /** Arrangement zoom, pixels per bar. */
  readonly pxPerBar = signal(22);

  readonly lastSeq = computed(() =>
    Math.max(this.events().at(-1)?.seq ?? 0, this.base()?.version ?? 0),
  );
  readonly seq = computed(() => this.viewSeq() ?? this.lastSeq());
  readonly atHead = computed(() => this.seq() >= this.lastSeq());
  /** The project as the whole UI shows it: the state right after event `seq`. */
  readonly project = computed(() => {
    const b = this.base();
    return b ? stateAt(b, this.events(), this.seq()) : null;
  });
  /** Tracks, devices and clips that don't exist yet at `seq` (drawn as ghosts). */
  readonly ghosts = computed(() => pendingAdds(this.events(), this.seq()));
  readonly versionLabel = computed(() => versionAt(this.events(), this.seq()));
  /** Each version's stretch of the log (the version timeline's labels). */
  readonly versions = computed(() => versionSpans(this.events(), this.lastSeq()));
  /** An older render being listened to (A/B against the current one); null: the current render. */
  readonly audition = signal<Render | null>(null);
  /** The render of the version on screen, when its file still holds it (older renders were
   * written over by later ones and can't be heard any more). */
  readonly renderOnScreen = computed(() => renderAt(this.events(), this.seq()));
  readonly selectedTrack = computed(() => {
    const p = this.project();
    return p?.tracks.find((t) => t.id === this.selectedTrackId()) ?? p?.tracks[0] ?? null;
  });
  /** The render to play, cache-busted by the seq of the last render.done. */
  readonly audioUrl = computed(() => {
    const b = this.base();
    const src = this.mode() === 'connecting' ? null : this.source;
    if (!b || !src) return null;
    const a = this.audition();
    const url = src.audioUrl(a ? { ...b, audio: { ...b.audio, master: a.audio } } : b);
    return url && src.kind === 'live' ? `${url}?v=${a?.seq ?? this.renderSeq()}` : url;
  });

  private source: DataSource | null = null;
  private projectId = 'longing';
  private disconnect: (() => void) | null = null;
  private queue: Promise<void> = Promise.resolve();
  private replayTimer: ReturnType<typeof setInterval> | undefined;
  private recheckTimer: ReturnType<typeof setInterval> | undefined;
  private readonly renderSeq = computed(() => {
    const ev = this.events().filter((e) => e.verb === 'render.done');
    return ev.at(-1)?.seq ?? 0;
  });

  async init(): Promise<void> {
    this.disconnect?.();
    clearInterval(this.recheckTimer);
    this.mode.set('connecting');
    const live = !this.cfg.forceMock && (await this.api.health());
    const src: DataSource = live ? this.api : this.mock;
    this.source = src;
    try {
      this.projectId =
        this.cfg.projectId ?? (live ? (await this.api.listProjects())[0]?.id : null) ?? 'longing';
      const [project, events, history, handoff] = await Promise.all([
        src.project(this.projectId),
        src.events(this.projectId, 0),
        src.history(this.projectId).catch(() => EMPTY_HISTORY),
        src.handoff(this.projectId).catch(() => EMPTY_HANDOFF),
      ]);
      if (!isProject(project)) throw new Error('the project is malformed');
      this.base.set(sanitizeProject(project));
      this.events.set(mergeEvents([], events));
      this.history.set(history);
      this.handoff.set(handoff);
      this.loadError.set(null);
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : String(e));
    }
    this.mode.set(src.kind);
    this.disconnect = src.connect(this.projectId, {
      status: (s) => this.link.set(s),
      hello: (p, last) => this.enqueue(() => this.onHello(p, last)),
      event: (e) => this.enqueue(() => this.onEvent(e)),
    });
    if (!live && !this.cfg.forceMock) {
      this.recheckTimer = setInterval(async () => {
        if (await this.api.health()) void this.init();
      }, BACKEND_RECHECK_MS);
    }
  }

  // --- replay (local view state) ------------------------------------------------------------

  /** Moves the replay position; a single step animates the event that was crossed. */
  seekSeq(target: number, animate = true): void {
    const last = this.lastSeq();
    const to = Math.max(0, Math.min(last, Math.round(target)));
    const from = this.seq();
    if (to === from) return;
    this.viewSeq.set(to >= last ? null : to);
    if (to >= last) this.audition.set(null);                 // back at now: the current render
    if (!animate || Math.abs(to - from) !== 1) return;
    const crossed = this.events().find((e) => e.seq === (to > from ? to : from));
    if (crossed) this.present(crossed, to > from ? 1 : -1);
  }

  step(delta: number): void {
    this.seekSeq(this.seq() + delta);
  }

  /** To the end of the next (1) or previous (-1) version. */
  stepVersion(delta: 1 | -1): void {
    const to = versionStep(this.versions(), this.seq(), delta);
    if (to === null) return;
    this.stopReplay();
    this.seekSeq(to, false);
  }

  /** Listen to the render of the version on screen (or, with null, back to the current one). */
  hear(render: Render | null): void {
    this.audition.set(render && render.audio !== this.base()?.audio.master ? render : null);
  }

  goLive(): void {
    this.stopReplay();
    this.viewSeq.set(null);
    this.audition.set(null);
  }

  startReplay(): void {
    this.stopReplay();
    if (this.seq() >= this.lastSeq()) this.viewSeq.set(0);
    this.animator.clear();
    this.replaying.set(true);
    this.replayTimer = setInterval(() => {
      if (this.seq() >= this.lastSeq()) {
        this.stopReplay();
        return;
      }
      this.step(1);
    }, REPLAY_STEP_MS);
  }

  stopReplay(): void {
    clearInterval(this.replayTimer);
    this.replaying.set(false);
  }

  toggleReplay(): void {
    if (this.replaying()) this.stopReplay();
    else this.startReplay();
  }

  // --- selection and the animated mapping ---------------------------------------------------

  selectTrack(id: string): void {
    this.selectedTrackId.set(id);
  }

  /** Animates the control an event touches, selecting its track so the control is on screen
   * (opening its panel for a moment if it is collapsed). */
  present(event: AiEvent, direction: 1 | -1 = 1): void {
    const tid = trackIdOf(event.target);
    if (tid) this.selectedTrackId.set(tid);
    const panel = panelOf(event);
    if (panel) this.layout.peek(panel);
    const anim = this.animator.trigger(event, direction);
    this.revealSoon(anim.path);
  }

  /** Feed click: select the event's track, glow its control and scroll it into view. */
  reveal(event: AiEvent): void {
    const tid = trackIdOf(event.target);
    if (tid) this.selectedTrackId.set(tid);
    const path = controlPath(event);
    if (path) {
      this.animator.trigger(event, 1, false);
      this.revealSoon(path);
    }
  }

  private revealSoon(path: string): void {
    if (typeof document === 'undefined') return;
    // after the selection change has rendered the device chain
    setTimeout(() => {
      const el = document.querySelector(`[data-path="${CSS.escape(path)}"]`);
      const scroller = el?.closest('.arr-scroll');
      if (el && scroller && el.closest('.arr-head')) {
        // sticky track headers: scrollIntoView would also scroll the timeline sideways
        const r = el.getBoundingClientRect();
        const s = scroller.getBoundingClientRect();
        if (r.top < s.top + 50 || r.bottom > s.bottom)
          scroller.scrollBy({ top: r.top - s.top - 60, behavior: 'smooth' });
        return;
      }
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }, 30);
  }

  // --- live feed -----------------------------------------------------------------------------

  private enqueue(job: () => Promise<void>): void {
    this.queue = this.queue.then(job).catch((e) => console.error(e));
  }

  private async onHello(project: Project, lastSeq: number): Promise<void> {
    const known = this.lastSeq();
    if (lastSeq > known && this.source) {
      const missed = await this.source.events(this.projectId, known);
      this.events.update((ev) => mergeEvents(ev, missed));
    }
    if (project.version >= (this.base()?.version ?? 0)) this.base.set(sanitizeProject(project));
  }

  private async onEvent(event: AiEvent): Promise<void> {
    const known = this.lastSeq();
    if (event.seq <= known) return;
    let batch = [event];
    if (event.seq > known + 1 && this.source) {
      batch = mergeEvents(await this.source.events(this.projectId, known), [event]);
    }
    let needsRefetch = false;
    for (const e of batch) {
      this.events.update((ev) => mergeEvents(ev, [e]));
      this.base.update((b) => (b ? apply(b, e) : b));
      needsRefetch ||= !MIRRORED_VERBS.has(e.verb) && !STATELESS_VERBS.has(e.verb);
    }
    const following = this.viewSeq() === null;
    if (following) this.present(event, 1);
    if (needsRefetch && this.source) {
      const fresh = await this.source.project(this.projectId);
      if (isProject(fresh) && fresh.version >= (this.base()?.version ?? 0))
        this.base.set(sanitizeProject(fresh));
    }
    // a new version or render means a new changelog entry / commit: the side panel shows it
    // an agent updated the handoff document: show the new text
    if (batch.some((e) => e.verb === 'doc.update') && this.source) {
      const doc = await this.source.handoff(this.projectId).catch(() => null);
      if (doc) this.handoff.set(doc);
    }
    if (batch.some((e) => HISTORY_VERBS.has(e.verb)) && this.source) {
      const history = await this.source.history(this.projectId).catch(() => null);
      if (history) this.history.set(history);
    }
  }
}
