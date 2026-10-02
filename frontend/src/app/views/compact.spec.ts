import { TestBed } from '@angular/core/testing';
import { Animator, TWEEN_MS } from '../core/animator.service';
import { ApiService } from '../core/api.service';
import { APP_CONFIG, readConfig } from '../core/config';
import { LiveHandlers } from '../core/data-source';
import { AiEvent, History, Json, Project } from '../core/model';
import { PanelLayout } from '../core/panel-layout';
import { WorkspaceStore } from '../core/workspace.store';
import { ev, longing } from '../testing/fixtures';
import { ActivityFeedComponent } from './activity-feed.component';
import { DeviceChainComponent } from './device-chain.component';
import { MixerComponent } from './mixer.component';
import { SidePanelComponent } from './side-panel.component';

const LAST = longing().events.length;
const flush = () => new Promise((r) => setTimeout(r, 0));

/** A backend that is "up": serves `project` (replaceable) and lets the test drive the socket. */
function fakeBackend(project: Project, events: AiEvent[]) {
  const fake = {
    handlers: null as LiveHandlers | null,
    current: project,
    kind: 'live' as const,
    health: async () => true,
    listProjects: async () => [{ id: project.id }],
    project: async () => structuredClone(fake.current),
    events: async (_id: string, since: number) => events.filter((e) => e.seq > since),
    history: async (): Promise<History> => ({ changelog: [], commits: [], branch: null }),
    audioUrl: () => '/api/projects/longing/audio/master.wav',
    connect: (_id: string, h: LiveHandlers) => {
      fake.handlers = h;
      h.status('open');
      return () => undefined;
    },
  };
  return fake;
}

describe('compact panels', () => {
  let store: WorkspaceStore;
  let animator: Animator;
  let backend: ReturnType<typeof fakeBackend>;
  let serverEvents: AiEvent[];
  let clock: number;

  /** Applies an event on the "server" and pushes it down the live socket. */
  async function push(e: AiEvent, after?: (p: Project) => void): Promise<void> {
    serverEvents.push(e);
    if (after) {
      after(backend.current);
      backend.current.version = e.seq;
    }
    backend.handlers!.event(e);
    await flush();
    await flush();
  }

  function at(ms: number): void {
    clock = ms;
    animator.now.set(clock);
  }

  beforeEach(async () => {
    // these tests are about the compact view: every panel starts there (the default is collapsed)
    for (const id of ['mixer', 'devices', 'activity', 'history', 'timeline'])
      localStorage.setItem(`aiwaves.panel.v2.${id}`, 'compact');
    clock = 5000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    // jsdom has no scrollIntoView; revealing a control calls it
    Element.prototype.scrollIntoView ??= () => undefined;
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
    animator = TestBed.inject(Animator);
    await store.init();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('each panel remembers its own size', () => {
    const layout = TestBed.inject(PanelLayout);
    for (const id of ['mixer', 'devices', 'activity', 'history', 'timeline'] as const)
      expect(layout.view(id)).toBe('compact');
    layout.more('mixer');
    expect(layout.compact('mixer')).toBe(false);
    expect(layout.compact('devices')).toBe(true);
    expect(localStorage.getItem('aiwaves.panel.v2.mixer')).toBe('expanded');
    // a fresh session reads it back
    expect(new PanelLayout().compact('mixer')).toBe(false);
    layout.less('mixer');
    expect(new PanelLayout().view('mixer')).toBe('compact');
  });

  it('the compact mixer is one narrow strip per track: short name, mini fader, pan, M / S dots', async () => {
    const f = TestBed.createComponent(MixerComponent);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const tracks = store.project()!.tracks;
    expect(el.classList).toContain('compact');
    expect(el.querySelectorAll('.mini-strip').length).toBe(tracks.length);
    expect(el.querySelectorAll('.strip').length).toBe(0);
    const drums = el.querySelector('[aria-label="Channel Tribal kit"]')!;
    expect(drums.querySelector('.mini-name')!.textContent!.trim()).toBe('drums');
    const fader = drums.querySelector('[data-path="tracks.drums.mixer.volume_db"]')!;
    expect(fader.classList).toContain('mini');
    expect(fader.querySelector('.fader-scale')).toBeNull();
    expect(fader.textContent).toContain('-3.0 dB');
    expect(drums.querySelector('[data-path="tracks.drums.mixer.pan"].knob.mini')).toBeTruthy();
    expect(drums.querySelector('.dot-m[data-path="tracks.drums.mixer.mute"]')).toBeTruthy();
    expect(drums.querySelector('.dot-s[data-path="tracks.drums.mixer.solo"]')).toBeTruthy();
  });

  it('the arrows in the panel bar expand the mixer to full strips and back', async () => {
    const f = TestBed.createComponent(MixerComponent);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const more = el.querySelector('.step-more') as HTMLButtonElement;
    expect(more.getAttribute('aria-label')).toBe('Expand the mixer');
    expect(el.querySelector('.step-less')!.getAttribute('aria-label')).toBe('Collapse the mixer');
    more.click();
    await f.whenStable();
    expect(el.querySelectorAll('.strip').length).toBe(store.project()!.tracks.length);
    expect(el.querySelector('.mini-strip')).toBeNull();
    expect(el.querySelector('.step-more')).toBeNull();
    const less = el.querySelector('.step-less') as HTMLButtonElement;
    expect(less.getAttribute('aria-label')).toBe('Compact the mixer');
    less.click();
    await f.whenStable();
    expect(el.querySelector('.strip')).toBeNull();
  });

  it('a live mixer.set animates the exact mini fader from -> to, glows it and highlights its line', async () => {
    const mixer = TestBed.createComponent(MixerComponent);
    const feed = TestBed.createComponent(ActivityFeedComponent);
    await mixer.whenStable();
    await feed.whenStable();
    const e = ev(LAST + 1, 'mixer.set', 'tracks.drums.mixer.volume_db', -3, -9);
    await push(e);
    await mixer.whenStable();
    await feed.whenStable();

    const fader = (mixer.nativeElement as HTMLElement).querySelector(
      '[data-path="tracks.drums.mixer.volume_db"]',
    ) as HTMLElement;
    const cap = () => parseFloat((fader.querySelector('.fader-cap') as HTMLElement).style.bottom);
    expect(fader.getAttribute('aria-valuenow')).toBe('-9');
    expect(fader.classList).toContain('glow');
    expect(fader.querySelector('.fader-value')!.textContent).toBe('-3.0 dB');
    const start = cap();
    // no other control moves
    expect((mixer.nativeElement as HTMLElement).querySelectorAll('.glow').length).toBe(1);

    at(clock + TWEEN_MS / 2);
    await mixer.whenStable();
    expect(cap()).toBeLessThan(start);
    expect(fader.querySelector('.fader-value')!.textContent).not.toBe('-3.0 dB');

    at(clock + TWEEN_MS);
    await mixer.whenStable();
    expect(fader.querySelector('.fader-value')!.textContent).toBe('-9.0 dB');

    const line = (feed.nativeElement as HTMLElement).querySelector(
      `.feed-line[data-seq="${LAST + 1}"]`,
    ) as HTMLElement;
    expect(line.classList).toContain('hot');
    expect(line.querySelector('.fl-agent')!.textContent).toBe('test');
    expect(line.querySelector('.fi-verb')!.textContent).toBe('mixer.set');
    expect(line.querySelector('.fl-target')!.textContent).toBe('volume_db');
    expect(line.querySelector('.fl-change')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      '-3 → -9',
    );
    expect(line.querySelector('.fl-reason')!.textContent).toBe(e.reason);
    expect(line.title).toContain(e.reason);
  });

  it('a live mixer.set on pan turns the mini pan knob', async () => {
    const mixer = TestBed.createComponent(MixerComponent);
    await mixer.whenStable();
    await push(ev(LAST + 1, 'mixer.set', 'tracks.zither.mixer.pan', 0.2, -0.5));
    await mixer.whenStable();
    const pan = (mixer.nativeElement as HTMLElement).querySelector(
      '[data-path="tracks.zither.mixer.pan"]',
    )!;
    expect(pan.classList).toContain('mini');
    expect(pan.classList).toContain('glow');
    expect(pan.querySelector('.knob-value')!.textContent).toBe('10R');
    at(clock + TWEEN_MS);
    await mixer.whenStable();
    expect(pan.querySelector('.knob-value')!.textContent).toBe('25L');
  });

  it('a live param.set selects the track and animates the exact mini knob in its device chip', async () => {
    store.selectTrack('vocal');
    const chain = TestBed.createComponent(DeviceChainComponent);
    const feed = TestBed.createComponent(ActivityFeedComponent);
    await chain.whenStable();
    const target = 'tracks.zither.devices.echo.params.feedback';
    await push(ev(LAST + 1, 'param.set', target, 0.62, 0.3));
    await chain.whenStable();
    await feed.whenStable();

    const el = chain.nativeElement as HTMLElement;
    expect(el.classList).toContain('compact');
    expect(el.querySelector('.device')).toBeNull();
    expect(el.querySelectorAll('.chip').length).toBe(
      store.project()!.tracks.find((t) => t.id === 'zither')!.devices.length,
    );
    const knob = el.querySelector(`[data-path="${target}"]`)!;
    expect(knob.classList).toContain('mini');
    expect(knob.classList).toContain('glow');
    expect(knob.querySelector('.knob-name')).toBeNull();
    expect(knob.getAttribute('aria-label')).toBe('Feedback');
    expect(knob.getAttribute('aria-valuenow')).toBe('0.3');
    expect(knob.querySelector('.knob-value')!.textContent).toBe('0.62');
    // its chip is lit as the device being touched; the other knobs stay still
    expect(knob.closest('.chip')!.classList).toContain('touched');
    expect(el.querySelectorAll('.knob.glow').length).toBe(1);

    at(clock + TWEEN_MS);
    await chain.whenStable();
    expect(knob.querySelector('.knob-value')!.textContent).toBe('0.3');
    expect(
      (feed.nativeElement as HTMLElement).querySelector(`[data-seq="${LAST + 1}"]`)!.classList,
    ).toContain('hot');
  });

  it('live device.add / device.remove re-fetch the project: the chip appears, glows, then goes', async () => {
    store.selectTrack('zither');
    const chain = TestBed.createComponent(DeviceChainComponent);
    const feed = TestBed.createComponent(ActivityFeedComponent);
    await chain.whenStable();
    const el = chain.nativeElement as HTMLElement;
    const before = el.querySelectorAll('.chip').length;
    const path = 'tracks.zither.devices.grit';
    const device = {
      id: 'grit',
      type: 'saturator',
      name: 'Grit',
      enabled: true,
      params: [
        { id: 'drive', name: 'Drive', value: 0.4, min: 0, max: 1, unit: '', display: '0.4' },
      ],
    };
    await push(ev(LAST + 1, 'device.add', path, null, device), (p) =>
      p.tracks.find((t) => t.id === 'zither')!.devices.push(structuredClone(device)),
    );
    await chain.whenStable();
    await feed.whenStable();
    const chip = el.querySelector(`.chip[data-path="${path}"]`)!;
    expect(el.querySelectorAll('.chip').length).toBe(before + 1);
    expect(chip.classList).toContain('glow');
    expect(
      chip.querySelector('[data-path="tracks.zither.devices.grit.params.drive"]'),
    ).toBeTruthy();
    const added = (feed.nativeElement as HTMLElement).querySelector(
      `.feed-line[data-seq="${LAST + 1}"]`,
    )!;
    expect(added.querySelector('.fl-change')!.textContent).toContain('Grit');
    expect(added.textContent).not.toContain('{');

    await push(ev(LAST + 2, 'device.remove', path, { ...device, index: before }, null), (p) => {
      const t = p.tracks.find((x) => x.id === 'zither')!;
      t.devices = t.devices.filter((d) => d.id !== 'grit');
    });
    await chain.whenStable();
    await feed.whenStable();
    expect(el.querySelector(`.chip[data-path="${path}"]`)).toBeNull();
    expect(el.querySelectorAll('.chip').length).toBe(before);
    const removed = (feed.nativeElement as HTMLElement).querySelector(
      `.feed-line[data-seq="${LAST + 2}"]`,
    )!;
    expect(removed.classList).toContain('hot');
    expect(removed.querySelector('.fl-change')!.textContent!.trim()).toBe('removed Grit');
  });

  it('live track.add / track.remove show up as mini strips', async () => {
    const mixer = TestBed.createComponent(MixerComponent);
    await mixer.whenStable();
    const el = mixer.nativeElement as HTMLElement;
    const n = el.querySelectorAll('.mini-strip').length;
    const track = {
      ...structuredClone(store.project()!.tracks.find((t) => t.id === 'handpan')!),
      id: 'kalimba',
      name: 'Kalimba',
    };
    await push(ev(LAST + 1, 'track.add', 'tracks.kalimba', null, track as unknown as Json), (p) =>
      p.tracks.splice(1, 0, structuredClone(track)),
    );
    await mixer.whenStable();
    expect(el.querySelectorAll('.mini-strip').length).toBe(n + 1);
    expect(el.querySelector('[data-path="tracks.kalimba.mixer.volume_db"]')).toBeTruthy();

    await push(
      ev(LAST + 2, 'track.remove', 'tracks.kalimba', track as unknown as Json, null),
      (p) => {
        p.tracks = p.tracks.filter((t) => t.id !== 'kalimba');
      },
    );
    await mixer.whenStable();
    expect(el.querySelectorAll('.mini-strip').length).toBe(n);
  });

  it('compact changelog and git: one line per version / commit, expandable', async () => {
    store.history.set({
      branch: 'main',
      changelog: [
        {
          version: '5.2',
          date: '2026-09-30',
          title: 'A talking bass',
          groups: [{ name: 'Added', items: ['Surge XT bass'] }],
        },
        { version: '5.1', date: '2026-09-29', title: 'Film VFX', groups: [] },
      ],
      commits: [
        {
          hash: 'a'.repeat(40),
          short: 'aaaaaaa',
          date: '2026-09-30',
          author: 'claude',
          subject: 'Longing v5.2',
          body: '',
          files: ['song.py'],
          added: 3,
          removed: 1,
        },
      ],
    });
    const f = TestBed.createComponent(SidePanelComponent);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const lines = el.querySelectorAll('details.cl-line');
    expect(lines.length).toBe(2);
    expect(lines[0].querySelector('summary .cl-ver')!.textContent).toBe('v5.2');
    expect(lines[0].querySelector('summary .cl-title')!.textContent).toBe('A talking bass');
    expect(lines[0].querySelector('.cl-detail')!.textContent).toContain('Surge XT bass');
    expect(el.querySelector('.cl-entry')).toBeNull();
    expect(el.querySelector('.side-tools .step-more')!.getAttribute('aria-label')).toBe(
      'Expand the history',
    );
    TestBed.inject(PanelLayout).more('history');
    await f.whenStable();
    expect(el.querySelectorAll('.cl-entry').length).toBe(2);
  });

  it('a live version.tag or render.done refreshes the changelog', async () => {
    const side = TestBed.createComponent(SidePanelComponent);
    await side.whenStable();
    backend.history = async () => ({
      changelog: [{ version: '5.3', date: '2026-10-01', title: 'Brighter hook', groups: [] }],
      commits: [],
      branch: 'main',
    });
    await push(ev(LAST + 1, 'version.tag', null, '5.2', '5.3'));
    await side.whenStable();
    expect(store.history().changelog[0].version).toBe('5.3');
    expect(
      (side.nativeElement as HTMLElement).querySelector('.cl-line .cl-title')!.textContent,
    ).toBe('Brighter hook');
    backend.history = async () => ({ changelog: [], commits: [], branch: 'render' });
    await push(ev(LAST + 2, 'render.done', null, null, { audio: 'audio/master.wav' }));
    expect(store.history().branch).toBe('render');
    // other verbs leave it alone
    backend.history = async () => ({ changelog: [], commits: [], branch: 'other' });
    await push(ev(LAST + 3, 'note', null, null, null));
    expect(store.history().branch).toBe('render');
  });
});
