import { Injectable, inject } from '@angular/core';
import { APP_CONFIG } from './config';
import { DataSource, LiveHandlers } from './data-source';
import { AiEvent, Handoff, History, LiveMessage, Project, ProjectSummary } from './model';
import { audioPath, isAiEvent, isProject } from './validate';

const PAGE = 500;
const MAX_BACKOFF_MS = 10_000;
/** The server pings every 20 s (CONTRACT section 6); this long without a message = a dead link. */
export const STALE_MS = 50_000;

/** The real backend (CONTRACT sections 5 and 6). */
@Injectable({ providedIn: 'root' })
export class ApiService extends DataSource {
  readonly kind = 'live' as const;
  private readonly base = inject(APP_CONFIG).apiBase;

  /** Overridable in tests. */
  wsFactory: (url: string) => WebSocket = (url) => new WebSocket(url);

  async health(timeoutMs = 1500): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/api/health`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { ok?: boolean };
      return body.ok === true;
    } catch {
      return false;
    }
  }

  listProjects(): Promise<ProjectSummary[]> {
    return this.get('/api/projects');
  }

  project(id: string): Promise<Project> {
    return this.get(`/api/projects/${encodeURIComponent(id)}`);
  }

  async events(id: string, since: number): Promise<AiEvent[]> {
    const out: AiEvent[] = [];
    for (;;) {
      const page = await this.get<AiEvent[]>(
        `/api/projects/${encodeURIComponent(id)}/events?since=${since}&limit=${PAGE}`,
      );
      out.push(...page.filter(isAiEvent));
      if (page.length < PAGE) return out;
      const last = page[page.length - 1];
      if (!isAiEvent(last) || last.seq <= since) return out;
      since = last.seq;
    }
  }

  history(id: string): Promise<History> {
    return this.get(`/api/projects/${encodeURIComponent(id)}/history`);
  }

  handoff(id: string): Promise<Handoff> {
    return this.get(`/api/projects/${encodeURIComponent(id)}/411`);
  }

  audioUrl(project: Project): string | null {
    // audio.master is relative to the project folder ("audio/master.wav") and the server
    // exposes that folder at /api/projects/{id}/audio/{file}.
    const path = audioPath(project.audio.master);
    return path && `${this.base}/api/projects/${encodeURIComponent(project.id)}/${path}`;
  }

  connect(id: string, handlers: LiveHandlers): () => void {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let closed = false;

    // a half-open socket (sleep, network change) never fires onclose: give up on it ourselves
    const alive = (sock: WebSocket) => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        sock.onclose = null;
        sock.close();
        lost(sock);
      }, STALE_MS);
    };

    const lost = (sock: WebSocket) => {
      clearTimeout(watchdog);
      if (closed || ws !== sock) return;
      handlers.status('reconnecting');
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
      attempt++;
      timer = setTimeout(open, delay);
    };

    const open = () => {
      handlers.status(attempt === 0 ? 'connecting' : 'reconnecting');
      const sock = this.wsFactory(this.wsUrl(id));
      ws = sock;
      alive(sock);
      sock.onopen = () => {
        attempt = 0;
        handlers.status('open');
        alive(sock);
      };
      sock.onmessage = (m: MessageEvent) => {
        alive(sock);
        let msg: LiveMessage;
        try {
          msg = JSON.parse(String(m.data)) as LiveMessage;
        } catch {
          return;
        }
        if (msg?.type === 'hello' && isProject(msg.project) && Number.isInteger(msg.last_seq))
          handlers.hello(msg.project, msg.last_seq);
        else if (msg?.type === 'event' && isAiEvent(msg.event)) handlers.event(msg.event);
      };
      sock.onclose = () => lost(sock);
    };

    open();
    return () => {
      closed = true;
      clearTimeout(timer);
      clearTimeout(watchdog);
      ws?.close();
    };
  }

  private wsUrl(id: string): string {
    const path = `/api/projects/${encodeURIComponent(id)}/live`;
    if (this.base) return this.base.replace(/^http/, 'ws') + path;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}${path}`;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(this.base + path);
    if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}
