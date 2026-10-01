import { TestBed } from '@angular/core/testing';
import { coverPlan, coverPalette, mulberry32, seedOf } from '../player/cover-art';
import { longing, tiny } from '../testing/fixtures';
import { APP_CONFIG, readConfig } from './config';
import { Cover, CoverService } from './cover.service';

const cover = (name: string, seed: number, saved = false): Cover => ({
  name,
  url: `/api/projects/tiny/covers/${name}`,
  seed,
  saved,
  palette: ['#d9a45b'],
  created: '2026-09-30T00:00:00Z',
});

type Route = (url: string, init: RequestInit) => Response | Promise<Response>;

describe('CoverService', () => {
  let covers: CoverService;
  let calls: string[];
  let route: Route;
  let rendered: number[];

  beforeEach(() => {
    calls = [];
    rendered = [];
    route = () => new Response('not found', { status: 404 });
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [{ provide: APP_CONFIG, useValue: readConfig('?api=http://h:1') }],
    });
    covers = TestBed.inject(CoverService);
    covers.renderLocal = async (_p, seed) => {
      rendered.push(seed);
      return `blob:local-${seed}`;
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url.replace('http://h:1', '')}`);
      return route(url, init ?? {});
    });
  });

  afterEach(() => vi.restoreAllMocks());

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('before any playthrough shows the saved cover, else the newest one', async () => {
    route = () => json({ saved: null, recent: [cover('cover-b.png', 2), cover('cover-a.png', 1)] });
    await covers.init(tiny(), true);
    expect(calls).toEqual(['GET /api/projects/tiny/covers']);
    expect(covers.current()).toMatchObject({ name: 'cover-b.png', seed: 2, saved: false });
    expect(covers.current()!.src).toBe('http://h:1/api/projects/tiny/covers/cover-b.png');

    route = () => json({ saved: cover('cover-s.png', 9, true), recent: [cover('cover-b.png', 2)] });
    await covers.init(tiny(), true);
    expect(covers.current()).toMatchObject({ name: 'cover-s.png', saved: true });
  });

  it('each playthrough asks the server for a new cover', async () => {
    route = () => json({ saved: null, recent: [] });
    await covers.init(tiny(), true);
    let n = 0;
    route = (_u, init) =>
      init.method === 'POST' ? json(cover(`cover-n${++n}.png`, n), 201) : json({});
    const first = covers.playthrough();
    expect(covers.busy()).toBe(true);
    await first;
    expect(covers.busy()).toBe(false);
    expect(covers.current()!.name).toBe('cover-n1.png');
    await covers.playthrough();
    expect(covers.current()!.name).toBe('cover-n2.png');
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual([
      'POST /api/projects/tiny/covers',
      'POST /api/projects/tiny/covers',
    ]);
  });

  it('a saved cover comes back on every playthrough; unsaving lets new ones through', async () => {
    route = () => json({ saved: null, recent: [cover('cover-a.png', 1)] });
    await covers.init(tiny(), true);
    route = (url, init) => {
      if (url.endsWith('/covers/cover-a.png/save')) return json(cover('cover-a.png', 1, true));
      if (init.method === 'POST') return json(cover('cover-a.png', 1, true), 200);
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      return json({});
    };
    await covers.toggleSave();
    expect(covers.current()).toMatchObject({ name: 'cover-a.png', saved: true });
    await covers.playthrough();
    expect(covers.current()).toMatchObject({ name: 'cover-a.png', saved: true });
    await covers.toggleSave();
    expect(covers.current()!.saved).toBe(false);
    expect(calls).toContain('POST /api/projects/tiny/covers/cover-a.png/save');
    expect(calls).toContain('DELETE /api/projects/tiny/covers/saved');
  });

  it('encodes the project id and refuses cover names that are not cover-*.png', async () => {
    const p = { ...tiny(), id: 'my song/1' };
    route = () =>
      json({ saved: null, recent: [cover('../../etc/passwd', 1), cover('cover-ok.png', 2)] });
    await covers.init(p, true);
    expect(calls[0]).toBe('GET /api/projects/my%20song%2F1/covers');
    expect(covers.current()!.name).toBe('cover-ok.png');
    expect(covers.current()!.src).toBe('http://h:1/api/projects/my%20song%2F1/covers/cover-ok.png');

    route = () => json(cover('cover-"x.png', 3), 201);
    await covers.playthrough();
    // malformed answer: local art instead, and a note
    expect(covers.current()!.name).toBeNull();
    expect(covers.problem()).toContain('unexpected cover');
  });

  it('falls back to local art when the cover engine is down (503 or an older backend)', async () => {
    route = () => new Response('{"error":"timeout"}', { status: 503 });
    await covers.init(tiny(), true);
    expect(covers.current()).toMatchObject({ name: null, seed: seedOf('tiny'), saved: false });
    await covers.playthrough();
    expect(covers.problem()).toContain('HTTP 503');
    expect(covers.current()!.name).toBeNull();
    expect(rendered.length).toBe(2);
  });

  it('in demo mode draws local art, new per playthrough unless saved', async () => {
    await covers.init(tiny(), false);
    expect(calls).toEqual([]);
    const first = covers.current()!;
    expect(first).toMatchObject({ name: null, src: `blob:local-${seedOf('tiny')}` });
    await covers.playthrough();
    const second = covers.current()!;
    expect(second.key).not.toBe(first.key);
    await covers.toggleSave();
    expect(covers.current()!.saved).toBe(true);
    expect(localStorage.getItem('aiwaves.cover.saved.tiny')).toBe(String(second.seed));
    const before = rendered.length;
    await covers.playthrough();
    expect(covers.current()).toMatchObject({ seed: second.seed, saved: true });
    expect(rendered.length).toBe(before);
    // a reload keeps it: init picks the saved seed
    await covers.init(tiny(), false);
    expect(covers.current()).toMatchObject({ seed: second.seed, saved: true });
    await covers.toggleSave();
    expect(localStorage.getItem('aiwaves.cover.saved.tiny')).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('local cover art', () => {
  it('is made from the song: its colours, sections, chords and waveform', () => {
    const { project } = longing();
    const plan = coverPlan(project, 42);
    expect(plan.palette).toEqual(coverPalette(project));
    expect(plan.palette.length).toBe(
      new Set(project.tracks.filter((t) => t.kind !== 'master').map((t) => t.color.toLowerCase()))
        .size,
    );
    expect(plan.orbits.length).toBe(project.sections.length);
    expect(plan.ticks.length).toBeGreaterThan(4);
    expect(plan.wave.length).toBe(240);
    for (const o of plan.orbs) expect(plan.palette).toContain(o.color);
  });

  it('the same seed paints the same cover, another seed a different one', () => {
    const { project } = longing();
    expect(coverPlan(project, 7)).toEqual(coverPlan(project, 7));
    expect(coverPlan(project, 7)).not.toEqual(coverPlan(project, 8));
    const r = mulberry32(1);
    const xs = Array.from({ length: 1000 }, r);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(seedOf('longing')).toBe(seedOf('longing'));
    expect(seedOf('longing')).not.toBe(seedOf('tiny'));
  });
});
