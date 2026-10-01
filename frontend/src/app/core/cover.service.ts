import { Injectable, inject, signal } from '@angular/core';
import { coverPalette, renderLocalCover, seedOf } from '../player/cover-art';
import { APP_CONFIG } from './config';
import { Project } from './model';

/** A cover as the server returns it (CONTRACT section 10). */
export interface Cover {
  name: string;
  url: string;
  seed: number;
  saved: boolean;
  palette: string[];
  created: string;
}

/** The cover on screen: from the server, or local art (demo mode, or the cover engine is down). */
export interface ShownCover {
  /** Unique per image, for the cross-fade. */
  key: string;
  src: string;
  seed: number;
  saved: boolean;
  /** The server's file name; null for local art. */
  name: string | null;
  palette: string[];
}

export const COVER_NAME = /^cover-[0-9a-z-]{1,64}\.png$/;
/** The server gives up after 30 s (503); allow for that plus the trip. */
const GENERATE_TIMEOUT_MS = 35_000;
const REQUEST_TIMEOUT_MS = 5_000;
const SAVED_KEY = 'aiwaves.cover.saved.';

export function isCover(x: unknown): x is Cover {
  const c = x as Cover;
  return (
    !!c &&
    typeof c === 'object' &&
    typeof c.name === 'string' &&
    COVER_NAME.test(c.name) &&
    typeof c.seed === 'number' &&
    typeof c.saved === 'boolean'
  );
}

/**
 * Cover art per playthrough (CONTRACT section 10). These routes are the only writes the
 * workspace makes, and they are a viewer preference: they never touch the song. In demo mode,
 * or when the server's cover engine doesn't answer, the art is drawn locally from the project
 * and "saving" keeps its seed in localStorage.
 */
@Injectable({ providedIn: 'root' })
export class CoverService {
  private readonly base = inject(APP_CONFIG).apiBase;

  readonly current = signal<ShownCover | null>(null);
  /** A cover is being generated. */
  readonly busy = signal(false);
  /** The last cover request failed (shown as a note; the art falls back to local). */
  readonly problem = signal<string | null>(null);

  /** Overridable in tests (jsdom has no canvas). */
  renderLocal: (p: Project, seed: number) => Promise<string | null> = renderLocalCover;

  private project: Project | null = null;
  private live = false;
  private request = 0;

  /** Before the first playthrough: the saved cover, else the newest, else local art. */
  async init(project: Project, live: boolean): Promise<void> {
    this.project = project;
    this.live = live;
    const req = ++this.request;
    this.problem.set(null);
    if (live) {
      try {
        const res = await this.fetch('GET', '', REQUEST_TIMEOUT_MS);
        const body = (await res.json()) as { saved?: unknown; recent?: unknown };
        const first = [body.saved, ...(Array.isArray(body.recent) ? body.recent : [])].find(
          isCover,
        );
        if (req !== this.request) return;
        if (first) {
          this.show(this.fromServer(first));
          return;
        }
      } catch {
        // an older backend without covers: local art until a playthrough asks again
      }
    }
    const saved = this.savedSeed();
    await this.showLocal(saved ?? seedOf(project.id), saved !== null, req);
  }

  /** A playthrough started: the saved cover, or a new one. */
  async playthrough(): Promise<void> {
    const p = this.project;
    if (!p) return;
    const req = ++this.request;
    this.problem.set(null);
    if (this.live) {
      this.busy.set(true);
      try {
        const res = await this.fetch('POST', '', GENERATE_TIMEOUT_MS);
        const cover: unknown = await res.json();
        if (!isCover(cover)) throw new Error('unexpected cover');
        if (req === this.request) this.show(this.fromServer(cover));
        return;
      } catch (e) {
        if (req === this.request) this.problem.set(`Cover engine unavailable (${errorText(e)})`);
      } finally {
        if (req === this.request) this.busy.set(false);
      }
    }
    const saved = this.savedSeed();
    await this.showLocal(saved ?? randomSeed(), saved !== null, req);
  }

  /** Saves the cover on screen for every playthrough, or unsaves it. */
  async toggleSave(): Promise<void> {
    const c = this.current();
    if (!c) return;
    this.problem.set(null);
    if (c.name === null) {
      if (c.saved) localStorage.removeItem(this.savedKey());
      else localStorage.setItem(this.savedKey(), String(c.seed));
      this.current.set({ ...c, saved: !c.saved });
      return;
    }
    try {
      if (c.saved) {
        await this.fetch('DELETE', '/saved', REQUEST_TIMEOUT_MS);
        if (this.current() === c) this.current.set({ ...c, saved: false });
      } else {
        const res = await this.fetch(
          'POST',
          `/${encodeURIComponent(c.name)}/save`,
          REQUEST_TIMEOUT_MS,
        );
        const saved: unknown = await res.json();
        if (this.current() === c)
          this.current.set(isCover(saved) ? this.fromServer(saved) : { ...c, saved: true });
      }
    } catch (e) {
      this.problem.set(`Couldn't ${c.saved ? 'unsave' : 'save'} the cover (${errorText(e)})`);
    }
  }

  private fromServer(c: Cover): ShownCover {
    const id = encodeURIComponent(this.project?.id ?? '');
    return {
      key: c.name,
      // built from the validated name rather than trusting `url`
      src: `${this.base}/api/projects/${id}/covers/${encodeURIComponent(c.name)}`,
      seed: c.seed,
      saved: c.saved,
      name: c.name,
      palette: Array.isArray(c.palette) ? c.palette.filter((x) => typeof x === 'string') : [],
    };
  }

  private async showLocal(seed: number, saved: boolean, req: number): Promise<void> {
    const p = this.project;
    if (!p) return;
    const prev = this.current();
    if (prev?.name === null && prev.seed === seed) {
      this.current.set({ ...prev, saved });
      return;
    }
    const src = await this.renderLocal(p, seed);
    if (!src || req !== this.request) {
      if (src) URL.revokeObjectURL(src);
      return;
    }
    this.show({ key: `local-${seed}`, src, seed, saved, name: null, palette: coverPalette(p) });
  }

  private show(next: ShownCover): void {
    const prev = this.current();
    this.current.set(next);
    // local art is an object URL: free it once the cross-fade is over
    if (prev?.name === null && prev.src !== next.src)
      setTimeout(() => URL.revokeObjectURL(prev.src), 2000);
  }

  private fetch(method: string, path: string, timeoutMs: number): Promise<Response> {
    const id = encodeURIComponent(this.project?.id ?? '');
    return fetch(`${this.base}/api/projects/${id}/covers${path}`, {
      method,
      signal: AbortSignal.timeout(timeoutMs),
    }).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    });
  }

  private savedKey(): string {
    return SAVED_KEY + (this.project?.id ?? '');
  }

  private savedSeed(): number | null {
    const v = Number(globalThis.localStorage?.getItem(this.savedKey()) ?? NaN);
    return Number.isInteger(v) && v >= 0 ? v : null;
  }
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

function errorText(e: unknown): string {
  if (e instanceof DOMException && e.name === 'TimeoutError') return 'timed out';
  return e instanceof Error ? e.message : String(e);
}
