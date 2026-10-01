/**
 * The signal that drives the visualizer, measured from the song itself.
 *
 * CarbonCast's radio visualizer had to synthesise this (internet radio streams send no CORS
 * headers, so tapping them through Web Audio would mute them). AIWaves plays its own same-origin
 * render through an AnalyserNode, so the seven bands here are the song's real spectrum (log bands,
 * low first), the pulse is a real onset in the low end, and the envelope still swells on play and
 * settles on pause the way the original's did.
 */

export const BAND_COUNT = 7;

export interface EnergyFrame {
  /** Per-band levels in 0..1, low frequencies first. */
  bands: number[];
  /** Mean level across the bands, 0..1. */
  level: number;
  /** 0..1 impulse that spikes on each onset in the low end. */
  pulse: number;
}

/** Seconds for the envelope to travel most of the way to its target. */
const ENVELOPE_RISE = 0.6;
const ENVELOPE_FALL = 0.8;
/** Where every band rests when nothing plays: the orbs still show, small and slow. */
export const IDLE_LEVEL = 0.16;
/** Below this the envelope counts as settled (the frame loop may park). */
export const SETTLED = 0.02;
const BAND_ATTACK = 0.05;
const BAND_RELEASE = 0.25;
/**
 * Each band is read against its own running mean, so quiet and loud songs (and the bright top of
 * the spectrum against its heavy bottom) all move the orbs about the same amount.
 */
const MEAN_SECONDS = 3;
const CONTRAST = 1.8;
const LOUDNESS_WEIGHT = 0.35;
/** High bands sit a little lower, so the low-end orbs carry the most weight. */
const TILT = 0.12;
const BASS_MEAN_SECONDS = 0.35;
const PULSE_GAIN = 5;
const PULSE_ATTACK = 0.04;
const PULSE_DECAY = 0.2;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function approach(current: number, target: number, dt: number, seconds: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / seconds));
}

/** Turns per-frame band measurements into the visualizer's energy. Owns its smoothing state. */
export class EnergyTracker {
  envelope = 0;
  private readonly smooth = new Float32Array(BAND_COUNT);
  private readonly mean = new Float32Array(BAND_COUNT).fill(0.5);
  private bassMean = 0;
  private pulse = 0;
  private readonly bands = new Array<number>(BAND_COUNT).fill(IDLE_LEVEL);

  /**
   * One frame. `measured` holds this frame's band levels (0..1, low first), or null when there is
   * nothing to measure; the bands then hold still while the envelope settles them to rest.
   */
  step(measured: ArrayLike<number> | null, playing: boolean, dt: number): EnergyFrame {
    const target = playing ? 1 : 0;
    this.envelope = approach(
      this.envelope,
      target,
      dt,
      target > this.envelope ? ENVELOPE_RISE : ENVELOPE_FALL,
    );

    if (measured) {
      for (let i = 0; i < BAND_COUNT; i++) {
        const m = measured[i] ?? 0;
        this.smooth[i] = approach(
          this.smooth[i],
          m,
          dt,
          m > this.smooth[i] ? BAND_ATTACK : BAND_RELEASE,
        );
        this.mean[i] = approach(this.mean[i], m, dt, MEAN_SECONDS);
      }
      const bass = ((measured[0] ?? 0) + (measured[1] ?? 0)) / 2;
      const onset = clamp01((bass - this.bassMean) * PULSE_GAIN);
      this.bassMean = approach(this.bassMean, bass, dt, BASS_MEAN_SECONDS);
      this.pulse =
        onset > this.pulse
          ? approach(this.pulse, onset, dt, PULSE_ATTACK)
          : this.pulse * Math.exp(-dt / PULSE_DECAY);
    } else {
      this.pulse *= Math.exp(-dt / PULSE_DECAY);
    }

    let total = 0;
    for (let i = 0; i < BAND_COUNT; i++) {
      const shaped = clamp01(
        0.5 +
          (this.smooth[i] - this.mean[i]) * CONTRAST +
          (this.mean[i] - 0.5) * LOUDNESS_WEIGHT -
          (i / BAND_COUNT) * TILT,
      );
      const band = clamp01(IDLE_LEVEL + (shaped - IDLE_LEVEL) * this.envelope);
      this.bands[i] = band;
      total += band;
    }
    return { bands: this.bands, level: total / BAND_COUNT, pulse: this.pulse * this.envelope };
  }
}
