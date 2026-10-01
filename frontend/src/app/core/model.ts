/** Types mirroring docs/CONTRACT.md sections 3, 4 and 6. */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface Section {
  name: string;
  start_bar: number;
  end_bar: number;
}

export interface Chord {
  bar: number;
  name: string;
}

export interface AudioInfo {
  master: string;
  duration_s: number;
  peaks: number[];
}

export interface Param {
  id: string;
  name: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  display: string;
}

export interface Device {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  params: Param[];
}

export interface Note {
  start_beat: number;
  length_beats: number;
  /** Pitch; on `kind: "drum"` tracks a lane number. */
  midi: number;
  velocity: number;
  /** Drum name on drum tracks, optional elsewhere. */
  label?: string;
}

export interface Clip {
  id: string;
  name: string;
  start_bar: number;
  length_bars: number;
  color: string | null;
  notes: Note[] | null;
  /** The clip's own waveform (audio clips), evenly spread over its length. */
  peaks?: number[] | null;
}

export interface Mixer {
  volume_db: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  sends: Record<string, number>;
}

export type TrackKind = 'audio' | 'instrument' | 'drum' | 'bus' | 'return' | 'master';

export interface Track {
  id: string;
  name: string;
  kind: TrackKind | string;
  color: string;
  mixer: Mixer;
  devices: Device[];
  clips: Clip[];
}

export interface Project {
  schema: string;
  id: string;
  title: string;
  artist: string;
  bpm: number;
  time_signature: [number, number];
  key: string;
  length_bars: number;
  version: number;
  sections: Section[];
  chords: Chord[];
  audio: AudioInfo;
  tracks: Track[];
}

export interface ProjectSummary {
  id: string;
  title: string;
  bpm: number;
  key: string;
  version: number;
  length_bars: number;
}

export interface AiEvent {
  seq: number;
  ts: string;
  agent: string;
  verb: string;
  target: string | null;
  from: Json;
  to: Json;
  reason: string;
  evidence?: Json;
  version?: string | null;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  groups: { name: string; items: string[] }[];
}

export interface Commit {
  hash: string;
  short: string;
  date: string;
  author: string;
  subject: string;
  body: string;
  files: string[];
  added: number;
  removed: number;
}

export interface History {
  changelog: ChangelogEntry[];
  commits: Commit[];
  branch: string | null;
}

export type LiveMessage =
  | { type: 'hello'; project: Project; last_seq: number }
  | { type: 'event'; event: AiEvent }
  | { type: 'ping' };
