import { Injectable, inject } from '@angular/core';
import { APP_CONFIG } from './config';
import { DataSource, EMPTY_HANDOFF, EMPTY_HISTORY, LiveHandlers } from './data-source';
import { AiEvent, History, Project, ProjectSummary, Handoff } from './model';
import { isAiEvent } from './validate';

/** Serves the Longing fixture copied into public/demo/longing (scripts/copy-fixtures.mjs). */
@Injectable({ providedIn: 'root' })
export class MockApiService extends DataSource {
  readonly kind = 'demo' as const;
  private readonly cfg = inject(APP_CONFIG);

  async listProjects(): Promise<ProjectSummary[]> {
    const p = await this.project('longing');
    return [
      {
        id: p.id,
        title: p.title,
        bpm: p.bpm,
        key: p.key,
        version: p.version,
        length_bars: p.length_bars,
      },
    ];
  }

  async project(_id: string): Promise<Project> {
    const res = await fetch(`${this.cfg.demoBase}/project.json`);
    if (!res.ok) throw new Error(`demo project.json: HTTP ${res.status} (run "npm run fixtures")`);
    return (await res.json()) as Project;
  }

  async events(_id: string, since: number): Promise<AiEvent[]> {
    const res = await fetch(`${this.cfg.demoBase}/events.jsonl`);
    if (!res.ok) return [];
    return parseJsonl(await res.text()).filter((e) => e.seq > since);
  }

  async history(): Promise<History> {
    const res = await fetch(`${this.cfg.demoBase}/history.json`);
    return res.ok ? ((await res.json()) as History) : EMPTY_HISTORY;
  }

  async handoff(): Promise<Handoff> {
    const res = await fetch(`${this.cfg.demoBase}/aiwave411.md`).catch(() => null);
    return res?.ok ? { exists: true, text: await res.text(), updated: null } : EMPTY_HANDOFF;
  }

  audioUrl(): string {
    return this.cfg.audioUrl ?? `${this.cfg.demoBase}/audio/master.wav`;
  }

  connect(_id: string, handlers: LiveHandlers): () => void {
    handlers.status('demo');
    return () => undefined;
  }
}

/** Events from JSON lines, ascending; blank, unparsable and malformed lines are skipped. */
export function parseJsonl(text: string): AiEvent[] {
  const out: AiEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const e: unknown = JSON.parse(line);
      if (isAiEvent(e)) out.push(e);
    } catch {
      // one bad line must not lose the rest of the log
    }
  }
  return out.sort((a, b) => a.seq - b.seq);
}
