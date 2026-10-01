/**
 * The player's state machine, driven by the media element's events (AudioService feeds it).
 * Pure, so the rules about what counts as a new playthrough (CONTRACT section 10: new cover
 * art) are testable without an audio element.
 */

export type PlayerStatus =
  | 'idle' // no render to play
  | 'loading' // a render is being fetched
  | 'ready' // loaded, paused at the start
  | 'playing'
  | 'buffering' // playing, waiting for data
  | 'paused' // paused somewhere after the start
  | 'ended' // reached the end
  | 'error';

export type PlayerInput =
  | { type: 'load' }
  | { type: 'loaded'; at: number }
  | { type: 'play'; at: number }
  | { type: 'waiting' }
  | { type: 'playing' }
  | { type: 'pause'; at: number }
  | { type: 'seek'; at: number }
  | { type: 'ended' }
  | { type: 'error' };

export interface PlayerState {
  status: PlayerStatus;
  /** Counts playthroughs: plays that start from the start or after the song ended. */
  playthrough: number;
}

/** A position (seconds) this close to 0 counts as "the start". */
export const START_WINDOW_S = 0.5;

export const INITIAL_PLAYER: PlayerState = { status: 'idle', playthrough: 0 };

const atStart = (at: number) => at < START_WINDOW_S;

export function playerStep(s: PlayerState, input: PlayerInput): PlayerState {
  switch (input.type) {
    case 'load':
      return { ...s, status: 'loading' };
    case 'loaded':
      return s.status === 'loading' || s.status === 'idle'
        ? { ...s, status: atStart(input.at) ? 'ready' : 'paused' }
        : s;
    case 'play': {
      const fresh = s.status === 'ended' || s.status === 'ready' || atStart(input.at);
      return { status: 'playing', playthrough: s.playthrough + (fresh ? 1 : 0) };
    }
    case 'waiting':
      return s.status === 'playing' ? { ...s, status: 'buffering' } : s;
    case 'playing':
      return s.status === 'buffering' || s.status === 'loading' ? { ...s, status: 'playing' } : s;
    case 'pause':
      // the element pauses itself right before 'ended'; an error stays an error
      return s.status === 'ended' || s.status === 'error'
        ? s
        : { ...s, status: atStart(input.at) ? 'ready' : 'paused' };
    case 'seek':
      if (s.status === 'ended' || s.status === 'ready' || s.status === 'paused')
        return { ...s, status: atStart(input.at) ? 'ready' : 'paused' };
      return s;
    case 'ended':
      return { ...s, status: 'ended' };
    case 'error':
      return { ...s, status: 'error' };
  }
}

export function isPlaying(status: PlayerStatus): boolean {
  return status === 'playing' || status === 'buffering';
}
