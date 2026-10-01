import { Injectable, inject } from '@angular/core';
import { APP_CONFIG } from './config';
import { DataSource, EMPTY_HISTORY, LiveHandlers } from './data-source';
import { AiEvent, History, Project, ProjectSummary } from './model';

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

  audioUrl(): string {
    return this.cfg.audioUrl ?? `${this.cfg.demoBase}/audio/master.wav`;
  }

  connect(_id: string, handlers: LiveHandlers): () => void {
    handlers.status('demo');
    return () => undefined;
  }
}

export function parseJsonl(text: string): AiEvent[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as AiEvent)
    .sort((a, b) => a.seq - b.seq);
}
