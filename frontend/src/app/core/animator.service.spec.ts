import { TestBed } from '@angular/core/testing';
import { ev } from '../testing/fixtures';
import {
  Animator,
  CAPTION_MS,
  GLOW_MS,
  TWEEN_MS,
  easeInOutCubic,
  numericOf,
} from './animator.service';

const PATH = 'tracks.zither.devices.echo.params.feedback';

describe('Animator', () => {
  let animator: Animator;
  let clock: number;

  beforeEach(() => {
    clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    animator = TestBed.inject(Animator);
  });

  afterEach(() => vi.restoreAllMocks());

  it('tweens a control from `from` to `to` with easing, then shows the real value', () => {
    animator.trigger(ev(38, 'param.set', PATH, 0, 0.62));
    expect(animator.value(PATH, 0.62)).toBe(0);
    animator.now.set(clock + TWEEN_MS / 2);
    expect(animator.value(PATH, 0.62)).toBeCloseTo(0.31, 5);
    animator.now.set(clock + TWEEN_MS / 4);
    expect(animator.value(PATH, 0.62)).toBeCloseTo(0.62 * easeInOutCubic(0.25), 5);
    animator.now.set(clock + TWEEN_MS);
    expect(animator.value(PATH, 0.62)).toBe(0.62);
  });

  it('runs backwards when an event is un-applied', () => {
    animator.trigger(ev(38, 'param.set', PATH, 0, 0.62), -1);
    expect(animator.value(PATH, 0)).toBe(0.62);
  });

  it('a reveal glows and captions without moving the control', () => {
    animator.trigger(ev(38, 'param.set', PATH, 0, 0.62), 1, false);
    expect(animator.value(PATH, 0.62)).toBe(0.62);
    expect(animator.glow(PATH)).toBe(true);
    expect(animator.captions()[0].from).toBe(0);
  });

  it('leaves other controls alone', () => {
    animator.trigger(ev(38, 'param.set', PATH, 0, 0.62));
    expect(animator.value('bpm', 80)).toBe(80);
    expect(animator.glow('bpm')).toBe(false);
  });

  it('glows, highlights the event and keeps the caption for a few seconds', () => {
    animator.trigger(ev(38, 'param.set', PATH, 0, 0.62));
    expect(animator.glow(PATH)).toBe(true);
    expect(animator.glowUnder('tracks.zither')).toBe(true);
    expect(animator.glowUnder('tracks.zit')).toBe(false);
    expect(animator.highlightSeq()).toBe(38);
    expect(animator.captions().map((c) => c.reason)).toEqual(['r38']);
    animator.now.set(clock + GLOW_MS + 1);
    expect(animator.glow(PATH)).toBe(false);
    expect(animator.captions().length).toBe(1);
    animator.now.set(clock + CAPTION_MS + 1);
    expect(animator.captions().length).toBe(0);
  });

  it('events without a control get their own caption key', () => {
    const a = animator.trigger(ev(18, 'note', null, null, null));
    expect(a.path).toBe('event:18');
  });

  it('numericOf reads numbers and clip positions', () => {
    expect(numericOf(3)).toBe(3);
    expect(numericOf({ start_bar: 4 })).toBe(4);
    expect(numericOf('x')).toBeNull();
    expect(numericOf(null)).toBeNull();
  });
});
