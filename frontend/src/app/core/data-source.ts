import { AiEvent, History, Project, ProjectSummary } from './model';

export type LinkStatus = 'connecting' | 'open' | 'reconnecting' | 'demo';

export interface LiveHandlers {
  hello(project: Project, lastSeq: number): void;
  event(event: AiEvent): void;
  status(status: LinkStatus): void;
}

/** Everything the workspace reads. Read-only by design: there is no method that sends a command. */
export abstract class DataSource {
  abstract readonly kind: 'live' | 'demo';
  abstract listProjects(): Promise<ProjectSummary[]>;
  abstract project(id: string): Promise<Project>;
  /** All events with seq > since, ascending. */
  abstract events(id: string, since: number): Promise<AiEvent[]>;
  abstract history(id: string): Promise<History>;
  abstract audioUrl(project: Project): string;
  /** Opens the live feed; returns a function that closes it for good. */
  abstract connect(id: string, handlers: LiveHandlers): () => void;
}

export const EMPTY_HISTORY: History = { changelog: [], commits: [], branch: null };
