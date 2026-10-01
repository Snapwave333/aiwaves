import { Injectable, computed, inject } from '@angular/core';
import { AudioService } from './audio.service';
import { barAt, chordAt, formatBBT, sectionAt } from './time';
import { WorkspaceStore } from './workspace.store';

/**
 * Where the playhead is in the song. `bar` changes every frame while playing; the others only
 * when their value does (computed equality), so templates that read them re-render per beat,
 * section or chord, not per frame.
 */
@Injectable({ providedIn: 'root' })
export class Playhead {
  private readonly audio = inject(AudioService);
  private readonly store = inject(WorkspaceStore);

  /** Bars from the start (0-based, fractional). */
  readonly bar = computed(() => {
    const p = this.store.project();
    return p ? barAt(p, this.audio.time()) : 0;
  });
  readonly barIndex = computed(() => Math.floor(this.bar()));
  /** Ableton-style bar.beat.sixteenth. */
  readonly bbt = computed(() => {
    const p = this.store.project();
    return p ? formatBBT(p, this.audio.time()) : '1.1.1';
  });
  readonly section = computed(() => sectionAt(this.store.project()?.sections ?? [], this.bar()));
  readonly chord = computed(() => chordAt(this.store.project()?.chords ?? [], this.bar()));
}
