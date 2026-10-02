import { Injectable, signal } from '@angular/core';
import { AiEvent } from './model';

export type PanelId = 'mixer' | 'devices' | 'activity' | 'history' | 'timeline';
/** collapsed: one row (icon, title, a ticker, the expand arrow); compact; expanded. */
export type PanelState = 'collapsed' | 'compact' | 'expanded';

/** Panels that fold down to one row. Collapsed is their default. */
const FOLDING: readonly PanelId[] = ['mixer', 'devices', 'activity', 'history', 'timeline'];
/** v2: everyone starts collapsed once, whatever they chose before (Eli, 2026-10-01). */
const key = (id: PanelId) => `aiwaves.panel.v2.${id}`;
/** How long a collapsed panel stays open after the last change shown in it. */
export const PEEK_MS = 4000;

const ORDER: readonly PanelState[] = ['collapsed', 'compact', 'expanded'];

function stored(id: PanelId): PanelState {
  const v = globalThis.localStorage?.getItem(key(id));
  const fallback: PanelState = FOLDING.includes(id) ? 'collapsed' : 'compact';
  if (v !== 'collapsed' && v !== 'compact' && v !== 'expanded') return fallback;
  return v === 'collapsed' && !FOLDING.includes(id) ? 'compact' : v;
}

/** The panel that shows the control an event changes (it opens while the change plays). */
export function panelOf(e: Pick<AiEvent, 'verb' | 'target'>): PanelId | null {
  const t = e.target ?? '';
  if (e.verb === 'mixer.set' || /^tracks\.[^.]+\.mixer\./.test(t)) return 'mixer';
  if (e.verb.startsWith('device.') || /^tracks\.[^.]+\.devices\./.test(t)) return 'devices';
  return null;
}

/**
 * Per panel: collapsed, compact or expanded (local view state, remembered in localStorage).
 * A collapsed panel that an agent's change lands in opens to compact while the change plays
 * (a "peek") and folds back PEEK_MS after the last change, unless the viewer opened it.
 */
@Injectable({ providedIn: 'root' })
export class PanelLayout {
  private readonly states = signal<ReadonlyMap<PanelId, PanelState>>(
    new Map(FOLDING.map((id) => [id, stored(id)])),
  );
  private readonly peeks = signal<ReadonlySet<PanelId>>(new Set());
  private readonly timers = new Map<PanelId, ReturnType<typeof setTimeout>>();

  /** The chosen state. */
  state(id: PanelId): PanelState {
    return this.states().get(id) ?? 'compact';
  }

  /** What the panel shows right now: a peeking collapsed panel shows its compact view. */
  view(id: PanelId): PanelState {
    const s = this.state(id);
    return s === 'collapsed' && this.peeks().has(id) ? 'compact' : s;
  }

  collapsed(id: PanelId): boolean {
    return this.view(id) === 'collapsed';
  }

  /** Compact or collapsed (anything but expanded). */
  compact(id: PanelId): boolean {
    return this.view(id) !== 'expanded';
  }

  peeking(id: PanelId): boolean {
    return this.peeks().has(id) && this.state(id) === 'collapsed';
  }

  canFold(id: PanelId): boolean {
    return FOLDING.includes(id);
  }

  /** One step bigger: collapsed -> compact -> expanded. */
  more(id: PanelId): void {
    const i = ORDER.indexOf(this.state(id));
    if (i < ORDER.length - 1) this.set(id, ORDER[i + 1]);
  }

  /** One step smaller: expanded -> compact -> collapsed (compact is the floor for the tabs). */
  less(id: PanelId): void {
    const i = ORDER.indexOf(this.state(id));
    const floor = FOLDING.includes(id) ? 0 : 1;
    if (i > floor) this.set(id, ORDER[i - 1]);
  }

  /** Compact <-> expanded (the history tabs' switch). */
  toggle(id: PanelId): void {
    this.set(id, this.state(id) === 'expanded' ? 'compact' : 'expanded');
  }

  /** Open a collapsed panel while a change plays in it; a burst keeps it open until it is quiet. */
  peek(id: PanelId): void {
    if (this.state(id) !== 'collapsed') return;
    if (!this.peeks().has(id)) this.peeks.set(new Set([...this.peeks(), id]));
    clearTimeout(this.timers.get(id));
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        const next = new Set(this.peeks());
        next.delete(id);
        this.peeks.set(next);
      }, PEEK_MS),
    );
  }

  private set(id: PanelId, s: PanelState): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    if (this.peeks().has(id)) {
      const next = new Set(this.peeks());
      next.delete(id);
      this.peeks.set(next);
    }
    this.states.set(new Map(this.states()).set(id, s));
    globalThis.localStorage?.setItem(key(id), s);
  }
}
