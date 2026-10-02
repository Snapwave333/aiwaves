import { Injectable, computed, inject } from '@angular/core';
import { AiEvent } from '../core/model';
import { PanelId, panelOf } from '../core/panel-layout';
import { WorkspaceStore } from '../core/workspace.store';
import { describeChange, shortTarget } from './format';

/** "growl › hp › cutoff  90 → 70": one line for a collapsed panel's title row. */
export function tickerLine(e: AiEvent): string {
  const c = describeChange(e);
  const where = shortTarget(e.target) || e.verb;
  if (!c) return `${e.verb} · ${e.reason}`;
  if (c.to === null) return `${where} · ${c.from}`;
  return c.from === null ? `${where} · ${c.to}` : `${where}  ${c.from} → ${c.to}`;
}

/**
 * What each collapsed panel says in its one row: the latest change that belongs to it (the
 * activity panel: any change; history: the latest version).
 */
@Injectable({ providedIn: 'root' })
export class PanelTicker {
  private readonly store = inject(WorkspaceStore);

  private readonly latest = computed(() => {
    const out = new Map<PanelId, AiEvent>();
    const ev = this.store.events();
    for (let i = ev.length - 1; i >= 0 && out.size < 4; i--) {
      const e = ev[i];
      if (!out.has('activity')) out.set('activity', e);
      if (!out.has('history') && e.verb === 'version.tag') out.set('history', e);
      const p = panelOf(e);
      if (p && !out.has(p)) out.set(p, e);
    }
    return out;
  });

  /** The latest event for a panel (its seq makes the row pulse when it changes). */
  event(id: PanelId): AiEvent | null {
    return this.latest().get(id) ?? null;
  }

  text(id: PanelId): string {
    const e = this.event(id);
    if (!e) return '';
    if (id === 'history' && typeof e.to === 'string') return `v${e.to} · ${e.reason}`;
    return tickerLine(e);
  }
}
