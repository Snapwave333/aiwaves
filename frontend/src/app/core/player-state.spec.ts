import { INITIAL_PLAYER, PlayerInput, PlayerState, playerStep } from './player-state';

const run = (inputs: PlayerInput[], from: PlayerState = INITIAL_PLAYER) =>
  inputs.reduce(playerStep, from);

const loaded: PlayerInput[] = [{ type: 'load' }, { type: 'loaded', at: 0 }];

describe('player state machine', () => {
  it('loads to ready, and the first play from the start is playthrough 1', () => {
    expect(run([{ type: 'load' }]).status).toBe('loading');
    expect(run(loaded)).toEqual({ status: 'ready', playthrough: 0 });
    expect(run([...loaded, { type: 'play', at: 0 }])).toEqual({
      status: 'playing',
      playthrough: 1,
    });
  });

  it('pausing and resuming mid-song is the same playthrough', () => {
    const s = run([
      ...loaded,
      { type: 'play', at: 0 },
      { type: 'pause', at: 42 },
      { type: 'play', at: 42 },
    ]);
    expect(s).toEqual({ status: 'playing', playthrough: 1 });
  });

  it('playing again after the song ended starts a new playthrough', () => {
    const ended = run([
      ...loaded,
      { type: 'play', at: 0 },
      { type: 'pause', at: 201 },
      { type: 'ended' },
    ]);
    expect(ended.status).toBe('ended');
    expect(run([{ type: 'play', at: 201 }], ended)).toEqual({ status: 'playing', playthrough: 2 });
  });

  it('stop (pause, then back to 0) and play is a new playthrough', () => {
    const s = run([
      ...loaded,
      { type: 'play', at: 0 },
      { type: 'pause', at: 42 },
      { type: 'seek', at: 0 },
    ]);
    expect(s.status).toBe('ready');
    expect(run([{ type: 'play', at: 0 }], s).playthrough).toBe(2);
  });

  it('seeking into the middle after the end, then playing, continues the playthrough', () => {
    const ended = run([...loaded, { type: 'play', at: 0 }, { type: 'ended' }]);
    const s = run(
      [
        { type: 'seek', at: 60 },
        { type: 'play', at: 60 },
      ],
      ended,
    );
    expect(s).toEqual({ status: 'playing', playthrough: 1 });
  });

  it('buffering while playing, then back to playing', () => {
    const playing = run([...loaded, { type: 'play', at: 0 }]);
    const buffering = playerStep(playing, { type: 'waiting' });
    expect(buffering.status).toBe('buffering');
    expect(playerStep(buffering, { type: 'playing' }).status).toBe('playing');
    // waiting while paused (a seek) is not buffering
    expect(run([{ type: 'waiting' }], run(loaded)).status).toBe('ready');
  });

  it('a new render loaded while playing resumes without a new playthrough', () => {
    const s = run([
      ...loaded,
      { type: 'play', at: 0 },
      { type: 'load' },
      { type: 'play', at: 30 },
      { type: 'loaded', at: 30 },
    ]);
    expect(s).toEqual({ status: 'playing', playthrough: 1 });
  });

  it('an error sticks through pause, and a retry loads again', () => {
    const err = run([
      ...loaded,
      { type: 'play', at: 0 },
      { type: 'error' },
      { type: 'pause', at: 3 },
    ]);
    expect(err.status).toBe('error');
    expect(run([{ type: 'load' }, { type: 'loaded', at: 3 }], err).status).toBe('paused');
  });
});
