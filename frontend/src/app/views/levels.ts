import { Project, Track } from '../core/model';
import { dbToGain } from '../core/time';

/**
 * Level for a track's meter. Only the master is measured; a track shows the master level, scaled
 * by its fader, while one of its clips is under the playhead and it isn't muted or soloed out.
 */
export function trackLevel(
  p: Project,
  t: Track,
  bar: number,
  playing: boolean,
  master: number,
): number {
  if (!playing) return 0;
  if (t.kind === 'master') return master;
  if (t.mixer.mute) return 0;
  if (p.tracks.some((o) => o.mixer.solo && o.kind !== 'master') && !t.mixer.solo) return 0;
  const sounding = t.clips.some((c) => bar >= c.start_bar && bar < c.start_bar + c.length_bars);
  return sounding ? Math.min(1, master * dbToGain(t.mixer.volume_db)) : 0;
}
