import { TestBed } from '@angular/core/testing';
import { ev, tiny } from '../testing/fixtures';
import { ApiService, STALE_MS } from './api.service';
import { APP_CONFIG, readConfig } from './config';
import { LinkStatus } from './data-source';
import { AiEvent, Project } from './model';

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  close() {
    this.closed = true;
    this.onclose?.();
  }
  send() {
    throw new Error('the workspace must never send');
  }
}

describe('ApiService', () => {
  let api: ApiService;

  beforeEach(() => {
    FakeSocket.all = [];
    TestBed.configureTestingModule({
      providers: [{ provide: APP_CONFIG, useValue: readConfig('?api=http://127.0.0.1:8787/') }],
    });
    api = TestBed.inject(ApiService);
    api.wsFactory = (url) => new FakeSocket(url) as unknown as WebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('streams hello and events, ignores pings and garbage', () => {
    const got: string[] = [];
    const statuses: LinkStatus[] = [];
    api.connect('longing', {
      hello: (p: Project, last: number) => got.push(`hello ${p.id} ${last}`),
      event: (e: AiEvent) => got.push(`event ${e.seq}`),
      status: (s) => statuses.push(s),
    });
    const s = FakeSocket.all[0];
    expect(s.url).toBe('ws://127.0.0.1:8787/api/projects/longing/live');
    s.onopen!();
    s.onmessage!({ data: JSON.stringify({ type: 'hello', project: tiny(), last_seq: 5 }) });
    s.onmessage!({ data: JSON.stringify({ type: 'ping' }) });
    s.onmessage!({ data: 'not json' });
    s.onmessage!({
      data: JSON.stringify({ type: 'event', event: ev(6, 'note', null, null, null) }),
    });
    expect(got).toEqual(['hello tiny 5', 'event 6']);
    expect(statuses).toEqual(['connecting', 'open']);
  });

  it('reconnects with backoff after the socket drops, and stops when disposed', () => {
    vi.useFakeTimers();
    const statuses: LinkStatus[] = [];
    const dispose = api.connect('longing', {
      hello: () => undefined,
      event: () => undefined,
      status: (s) => statuses.push(s),
    });
    FakeSocket.all[0].onclose!();
    expect(statuses.at(-1)).toBe('reconnecting');
    vi.advanceTimersByTime(999);
    expect(FakeSocket.all.length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all.length).toBe(2);
    FakeSocket.all[1].onclose!();
    vi.advanceTimersByTime(1999);
    expect(FakeSocket.all.length).toBe(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all.length).toBe(3);
    FakeSocket.all[2].onopen!();
    expect(statuses.at(-1)).toBe('open');
    dispose();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all.length).toBe(3);
    expect(FakeSocket.all[2].closed).toBe(true);
  });

  it('drops malformed live messages instead of passing them on', () => {
    const got: string[] = [];
    api.connect('longing', {
      hello: (p: Project) => got.push(`hello ${p.id}`),
      event: (e: AiEvent) => got.push(`event ${e.seq}`),
      status: () => undefined,
    });
    const s = FakeSocket.all[0];
    const send = (x: unknown) => s.onmessage!({ data: JSON.stringify(x) });
    send({ type: 'event', event: { ...ev(7, 'note', null, null, null), seq: -1 } });
    send({ type: 'event', event: { ...ev(8, 'note', null, null, null), verb: 42 } });
    send({ type: 'event', event: { seq: 9 } });
    send({ type: 'event' });
    send({ type: 'hello', project: { id: 'x' }, last_seq: 3 });
    send({ type: 'hello', project: tiny(), last_seq: 'many' });
    send(null);
    send({ type: 'event', event: ev(10, 'note', null, null, '<img src=x onerror=alert(1)>') });
    expect(got).toEqual(['event 10']);
  });

  it('gives up on a silent socket (no message, not even a ping) and reconnects', () => {
    vi.useFakeTimers();
    const statuses: LinkStatus[] = [];
    api.connect('longing', {
      hello: () => undefined,
      event: () => undefined,
      status: (s) => statuses.push(s),
    });
    const s = FakeSocket.all[0];
    s.onopen!();
    // pings keep it alive
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(20_000);
      s.onmessage!({ data: JSON.stringify({ type: 'ping' }) });
    }
    expect(FakeSocket.all.length).toBe(1);
    vi.advanceTimersByTime(STALE_MS);
    expect(s.closed).toBe(true);
    expect(statuses.at(-1)).toBe('reconnecting');
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.all.length).toBe(2);
  });

  it('pages through /events?since= until a short page', async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      urls.push(url);
      const since = Number(new URL(url).searchParams.get('since'));
      const n = since === 0 ? 500 : 3;
      const page = Array.from({ length: n }, (_, i) => ev(since + i + 1, 'note', null, null, null));
      return new Response(JSON.stringify(page));
    });
    const events = await api.events('longing', 0);
    expect(events.length).toBe(503);
    expect(urls).toEqual([
      'http://127.0.0.1:8787/api/projects/longing/events?since=0&limit=500',
      'http://127.0.0.1:8787/api/projects/longing/events?since=500&limit=500',
    ]);
  });

  it('health is false when the backend is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('connection refused'));
    expect(await api.health()).toBe(false);
  });

  it('builds the audio URL from audio.master, encoded, refusing to climb out of the project', () => {
    expect(api.audioUrl(tiny())).toBe('http://127.0.0.1:8787/api/projects/tiny/audio/master.wav');
    const p = tiny();
    p.audio.master = 'audio/take 2#.wav';
    expect(api.audioUrl(p)).toBe('http://127.0.0.1:8787/api/projects/tiny/audio/take%202%23.wav');
    p.audio.master = '../../secrets.wav';
    expect(api.audioUrl(p)).toBeNull();
  });

  it('skips malformed events in /events pages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([ev(1, 'note', null, null, null), { seq: 'two' }, null])),
    );
    expect((await api.events('longing', 0)).map((e) => e.seq)).toEqual([1]);
  });
});
