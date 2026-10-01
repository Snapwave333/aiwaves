import { TestBed } from '@angular/core/testing';
import { Animator, TWEEN_MS } from '../core/animator.service';
import { WorkspaceStore } from '../core/workspace.store';
import { longing } from '../testing/fixtures';
import { formatJson, shortTarget } from './activity-feed.component';
import { ActivityFeedComponent } from './activity-feed.component';
import { ArrangementComponent } from './arrangement.component';
import { DeviceChainComponent } from './device-chain.component';
import { MixerComponent } from './mixer.component';

// the demo fixture keeps growing as the song gets new versions: count, don't hard-code
const LAST = longing().events.length;

describe('workspace views', () => {
  let store: WorkspaceStore;

  beforeEach(() => {
    const { project, events } = longing();
    store = TestBed.inject(WorkspaceStore);
    store.base.set(project);
    store.events.set(events);
  });

  afterEach(() => vi.restoreAllMocks());

  it('device chain renders a knob per param of the selected track, labelled for screen readers', async () => {
    store.selectTrack('zither');
    const f = TestBed.createComponent(DeviceChainComponent);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const knob = el.querySelector('[data-path="tracks.zither.devices.echo.params.feedback"]')!;
    expect(knob).toBeTruthy();
    expect(knob.getAttribute('aria-label')).toBe('Feedback');
    expect(knob.textContent).toContain('0.62');
    expect(el.querySelectorAll('.device').length).toBe(7);
  });

  it('a knob animates from `from` while its event is fresh', async () => {
    let clock = 5000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    store.selectTrack('zither');
    const f = TestBed.createComponent(DeviceChainComponent);
    await f.whenStable();
    const animator = TestBed.inject(Animator);
    animator.trigger(store.events().find((e) => e.seq === 38)!);
    await f.whenStable();
    const knob = (f.nativeElement as HTMLElement).querySelector(
      '[data-path="tracks.zither.devices.echo.params.feedback"]',
    )!;
    expect(knob.getAttribute('aria-valuenow')).toBe('0.62');
    expect(knob.querySelector('.knob-value')!.textContent).toBe('0');
    expect(knob.classList).toContain('glow');
    clock += TWEEN_MS;
    animator.now.set(clock);
    await f.whenStable();
    expect(knob.querySelector('.knob-value')!.textContent).toBe('0.62');
  });

  it('mixer renders a strip per track with fader, pan and lights', async () => {
    const f = TestBed.createComponent(MixerComponent);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.strip').length).toBe(longing().project.tracks.length);
    expect(el.querySelector('[data-path="tracks.drums.mixer.volume_db"]')!.textContent).toContain(
      '-3.0 dB',
    );
    expect(el.querySelector('[data-path="tracks.zither.mixer.pan"]')!.textContent).toContain('10R');
  });

  it('arrangement renders lanes, clips, sections and ghosts tracks added later', async () => {
    const f = TestBed.createComponent(ArrangementComponent);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.track-row').length).toBe(longing().project.tracks.length);
    expect(el.querySelectorAll('.locator').length).toBe(6);
    expect(el.querySelector('.locator-flag')!.textContent).toBe('intro');
    expect(el.querySelector('[data-path="tracks.vocal.clips.v1"]')).toBeTruthy();
    expect(el.querySelector('.track-row.ghost')).toBeNull();
    store.seekSeq(20, false);
    await f.whenStable();
    // every track the build log adds after seq 20 (strings, zither, chops, handpan, doubles, vfx, ...)
    const { project, events } = longing();
    const later = new Set(
      events.filter((e) => e.seq > 20 && e.verb === 'track.add').map((e) => String(e.target).split('.')[1]),
    );
    expect(el.querySelectorAll('.track-row.ghost').length).toBe(
      project.tracks.filter((tr) => later.has(tr.id)).length,
    );
  });

  it('arrangement draws clip contents on one canvas per lane, not a node per note', async () => {
    store.pxPerBar.set(10);
    const f = TestBed.createComponent(ArrangementComponent);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const tracks = store.project()!.tracks;
    const clips = tracks.reduce((n, t) => n + t.clips.length, 0);
    const notes = tracks.reduce(
      (n, t) => n + t.clips.reduce((m, c) => m + (c.notes?.length ?? 0), 0),
      0,
    );
    expect(notes).toBeGreaterThan(2000);
    expect(el.querySelectorAll('aw-clip').length).toBe(clips);
    // every track with clips (all but the master) gets exactly one canvas
    expect(el.querySelectorAll('canvas.lane-canvas').length).toBe(
      tracks.filter((t) => t.clips.length).length,
    );
    expect(el.querySelectorAll('*').length).toBeLessThan(notes);

    const v1 = el.querySelector('[data-path="tracks.vocal.clips.v1"]') as HTMLElement;
    expect(v1.title).toContain('bar 2.68');
    expect(v1.title).toContain('audio');
    // a 2.2-bar clip at 10 px/bar is narrower than a readable name
    expect(v1.classList).toContain('narrow');
    expect(v1.style.width).toBe('22.34px');
    store.pxPerBar.set(40);
    await f.whenStable();
    expect(v1.classList).not.toContain('narrow');
    expect(v1.style.left).toBe(`${1.683 * 40}px`);
  });

  it('a clip.move slides the clip box from its old bar', async () => {
    let clock = 5000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    store.pxPerBar.set(10);
    const f = TestBed.createComponent(ArrangementComponent);
    await f.whenStable();
    const animator = TestBed.inject(Animator);
    const z2 = store.project()!.tracks.find((t) => t.id === 'zither')!.clips[1];
    animator.trigger({
      seq: 999,
      ts: '2026-09-30T00:00:00Z',
      agent: 'test',
      verb: 'clip.move',
      target: `tracks.zither.clips.${z2.id}`,
      from: z2.start_bar - 4,
      to: z2.start_bar,
      reason: 'test',
    });
    await f.whenStable();
    const box = (f.nativeElement as HTMLElement).querySelector(
      `[data-path="tracks.zither.clips.${z2.id}"]`,
    ) as HTMLElement;
    expect(box.style.left).toBe(`${(z2.start_bar - 4) * 10}px`);
    expect(box.classList).toContain('glow');
    clock += TWEEN_MS;
    animator.now.set(clock);
    await f.whenStable();
    expect(box.style.left).toBe(`${z2.start_bar * 10}px`);
  });

  it('activity feed lists events newest first and dims the future while replaying', async () => {
    const f = TestBed.createComponent(ActivityFeedComponent);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const items = el.querySelectorAll('.feed-item');
    expect(items.length).toBe(LAST);
    expect(items[0].getAttribute('data-seq')).toBe(String(LAST));
    store.seekSeq(LAST - 2, false);
    await f.whenStable();
    expect(el.querySelectorAll('.feed-item.future').length).toBe(2);
  });

  it('formats targets and values for the feed', () => {
    expect(shortTarget('tracks.zither.devices.echo.params.feedback')).toBe(
      'zither › echo › feedback',
    );
    expect(shortTarget('tracks.drums.mixer.volume_db')).toBe('drums › volume_db');
    expect(formatJson(null)).toBe('—');
    expect(formatJson(0.62)).toBe('0.62');
    expect(formatJson({ audio: 'audio/master.wav' })).toBe('{"audio":"audio/master.wav"}');
  });
});
