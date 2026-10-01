import { TestBed } from '@angular/core/testing';
import { Animator, TWEEN_MS } from '../core/animator.service';
import { WorkspaceStore } from '../core/workspace.store';
import { longing } from '../testing/fixtures';
import { PlayerComponent } from './player.component';

describe('PlayerComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  async function render() {
    const store = TestBed.inject(WorkspaceStore);
    const { project, events } = longing();
    store.base.set(project);
    store.events.set(events);
    const f = TestBed.createComponent(PlayerComponent);
    await f.whenStable();
    return { f, el: f.nativeElement as HTMLElement };
  }

  it('shows the song, its readouts and the idle state', async () => {
    const { el } = await render();
    expect(el.querySelector('.song-name')!.textContent).toContain('Longing');
    expect(el.querySelector('[data-path="bpm"]')!.textContent).toContain('80.00');
    expect(el.querySelector('[data-path="key"]')!.textContent).toContain('A minor');
    expect(el.querySelector('[data-path="version"]')!.textContent).toMatch(/v\d/);
    expect(el.querySelector('.station-badge')!.textContent).toContain('No audio');
    // nothing to play yet: the play button is disabled
    const play = el.querySelector('.play-btn') as HTMLButtonElement;
    expect(play.disabled).toBe(true);
    // the old transport's controls live here now: back to start, play, stop, seek, volume
    expect(el.querySelector('[aria-label="Back to the start"]')).toBeTruthy();
    expect(el.querySelector('[aria-label="Stop"]')).toBeTruthy();
    expect(el.querySelector('input[aria-label="Position"]')).toBeTruthy();
    expect(el.querySelector('input[aria-label="Volume"]')).toBeTruthy();
  });

  it('the BPM readout animates and glows for a song.set event', async () => {
    let clock = 5000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const { f, el } = await render();
    const animator = TestBed.inject(Animator);
    animator.trigger({
      seq: 999,
      ts: '2026-09-30T00:00:00Z',
      agent: 'test',
      verb: 'song.set',
      target: 'bpm',
      from: 140,
      to: 80,
      reason: 'test',
    });
    await f.whenStable();
    const bpm = el.querySelector('[data-path="bpm"]')!;
    expect(bpm.textContent).toContain('140.00');
    expect(bpm.classList).toContain('glow');
    clock += TWEEN_MS;
    animator.now.set(clock);
    await f.whenStable();
    expect(bpm.textContent).toContain('80.00');
  });
});
