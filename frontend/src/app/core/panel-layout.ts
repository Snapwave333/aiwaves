import { Injectable, signal } from '@angular/core';

export type PanelId = 'mixer' | 'devices' | 'activity' | 'changelog' | 'git';

const PANELS: readonly PanelId[] = ['mixer', 'devices', 'activity', 'changelog', 'git'];
const key = (id: PanelId) => `aiwaves.panel.${id}`;

/**
 * Compact or expanded, per panel (local view state). Compact is the default; each panel's choice
 * is remembered in localStorage.
 */
@Injectable({ providedIn: 'root' })
export class PanelLayout {
  private readonly expanded = signal<ReadonlySet<PanelId>>(
    new Set(PANELS.filter((id) => globalThis.localStorage?.getItem(key(id)) === 'expanded')),
  );

  compact(id: PanelId): boolean {
    return !this.expanded().has(id);
  }

  toggle(id: PanelId): void {
    const next = new Set(this.expanded());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expanded.set(next);
    globalThis.localStorage?.setItem(key(id), next.has(id) ? 'expanded' : 'compact');
  }
}
