import { AiEvent, Handoff, History, Project, ProjectSummary } from './model';

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
  /** aiwave411.md (CONTRACT §11). */
  abstract handoff(id: string): Promise<Handoff>;
  /** Null when the project's audio path is unusable. */
  abstract audioUrl(project: Project): string | null;
  /** Opens the live feed; returns a function that closes it for good. */
  abstract connect(id: string, handlers: LiveHandlers): () => void;
}

export const EMPTY_HISTORY: History = { changelog: [], commits: [], branch: null };
export const EMPTY_HANDOFF: Handoff = { exists: false, text: '', updated: null };
