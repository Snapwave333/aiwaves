import { TestBed } from '@angular/core/testing';
import { ev, longing } from '../testing/fixtures';
import { Animator } from './animator.service';
import { ApiService } from './api.service';
import { APP_CONFIG, readConfig } from './config';
import { LiveHandlers } from './data-source';
import { AiEvent, Project } from './model';
import { WorkspaceStore } from './workspace.store';

/** A backend that is "up", serving the Longing fixture; the test drives the live socket. */
function fakeBackend(project: Project, events: AiEvent[]) {
  const fake = {
    handlers: null as LiveHandlers | null,
    eventsCalls: [] as number[],
    kind: 'live' as const,
    health: async () => true,
    listProjects: async () => [{ id: project.id }],
    project: async () => project,
    events: async (_id: string, since: number) => {
      fake.eventsCalls.push(since);
      return events.filter((e) => e.seq > since);
    },
    history: async () => ({ changelog: [], commits: [], branch: null }),
    audioUrl: () => '/api/projects/longing/audio/master.wav',
    connect: (_id: string, h: LiveHandlers) => {
      fake.handlers = h;
      h.status('open');
      return () => undefined;
    },
  };
  return fake;
}

describe('WorkspaceStore', () => {
  let store: WorkspaceStore;
  let backend: ReturnType<typeof fakeBackend>;
  let serverEvents: AiEvent[];
  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(async () => {
    const { project, events } = longing();
    serverEvents = [...events];
    backend = fakeBackend(project, serverEvents);
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: backend },
        { provide: APP_CONFIG, useValue: readConfig('') },
      ],
    });
    store = TestBed.inject(WorkspaceStore);
    await store.init();
  });

  it('loads the project and events from the live backend', () => {
    expect(store.mode()).toBe('live');
    expect(store.link()).toBe('open');
    expect(store.lastSeq()).toBe(42);
    expect(store.project()!.bpm).toBe(80);
  });

  it('scrubbing shows the state at that seq; one step animates the crossed event', () => {
    const animator = TestBed.inject(Animator);
    store.seekSeq(16);
    expect(store.project()!.bpm).toBe(140);
    expect(store.ghosts().has('tracks.zither')).toBe(true);
    store.step(1);
    expect(store.seq()).toBe(17);
    expect(store.project()!.bpm).toBe(80);
    expect(animator.highlightSeq()).toBe(17);
  });

  it('a device event auto-selects its track', () => {
    store.selectTrack('vocal');
    store.seekSeq(37);
    store.step(1);
    expect(store.selectedTrack()!.id).toBe('zither');
  });

  it('stepping back past the head and returning to it follows live again', () => {
    store.step(-1);
    expect(store.viewSeq()).toBe(41);
    store.step(1);
    expect(store.viewSeq()).toBeNull();
  });

  it('applies live events, catching up on any gap via /events?since=', async () => {
    const e43 = ev(43, 'param.set', 'tracks.zither.devices.echo.params.feedback', 0.62, 0.7);
    const e44 = ev(44, 'song.set', 'bpm', 80, 82);
    serverEvents.push(e43, e44);
    backend.handlers!.event(e44);
    await flush();
    expect(backend.eventsCalls.at(-1)).toBe(42);
    expect(store.lastSeq()).toBe(44);
    const p = store.project()!;
    expect(p.bpm).toBe(82);
    expect(
      p.tracks
        .find((t) => t.id === 'zither')!
        .devices.find((d) => d.id === 'echo')!
        .params.find((x) => x.id === 'feedback')!.value,
    ).toBe(0.7);
    backend.handlers!.event(e44);
    await flush();
    expect(store.events().length).toBe(44);
  });

  it('after a reconnect, hello with a newer last_seq fetches the missed events', async () => {
    const e43 = ev(43, 'note', null, null, null);
    serverEvents.push(e43);
    const newer = { ...store.base()!, version: 43 };
    backend.handlers!.hello(newer, 43);
    await flush();
    expect(store.events().at(-1)!.seq).toBe(43);
    expect(store.base()!.version).toBe(43);
  });
});
