import { TestBed } from '@angular/core/testing';
import { Animator, TWEEN_MS } from '../core/animator.service';
import { WorkspaceStore } from '../core/workspace.store';
import { longing } from '../testing/fixtures';
import { formatJson, shortTarget } from './activity-feed.component';
import { ActivityFeedComponent } from './activity-feed.component';
import { ArrangementComponent } from './arrangement.component';
import { DeviceChainComponent } from './device-chain.component';
import { MixerComponent } from './mixer.component';

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
    expect(el.querySelectorAll('.strip').length).toBe(10);
    expect(el.querySelector('[data-path="tracks.drums.mixer.volume_db"]')!.textContent).toContain(
      '-3.0 dB',
    );
    expect(el.querySelector('[data-path="tracks.zither.mixer.pan"]')!.textContent).toContain('10R');
  });

  it('arrangement renders lanes, clips, sections and ghosts tracks added later', async () => {
    const f = TestBed.createComponent(ArrangementComponent);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.track-row').length).toBe(10);
    expect(el.querySelectorAll('.section').length).toBe(6);
    expect(el.querySelector('[data-path="tracks.vocal.clips.v1"]')).toBeTruthy();
    expect(el.querySelector('.track-row.ghost')).toBeNull();
    store.seekSeq(20, false);
    await f.whenStable();
    expect(el.querySelectorAll('.track-row.ghost').length).toBe(5); // strings, zither, chops, handpan, doubles
  });

  it('activity feed lists events newest first and dims the future while replaying', async () => {
    const f = TestBed.createComponent(ActivityFeedComponent);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const items = el.querySelectorAll('.feed-item');
    expect(items.length).toBe(42);
    expect(items[0].getAttribute('data-seq')).toBe('42');
    store.seekSeq(40, false);
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
