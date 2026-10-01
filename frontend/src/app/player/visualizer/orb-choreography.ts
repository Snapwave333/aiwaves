// Ported from CarbonCast IPTV (libs/portal/radio/feature/src/lib/radio-visualizer:
// radio-orb-choreography.ts, radio-orb-behaviours.ts, radio-orb-roster.ts; MIT, see
// THIRD_PARTY_NOTICES.md). Unchanged in behaviour except the orb hues, which now come from the
// AIWaves palette (`orbHue`).
import { EnergyFrame } from './audio-energy';

/**
 * Where the orbs go, and how they behave towards one another.
 *
 * Each orb rides its own Lissajous path, but they notice each other: one hangs back as the anchor,
 * two circle it from opposite sides, one keeps its distance from whatever approaches, one chases
 * its nearest neighbour, one bolts on the beat, and one ignores the lot. Which orb plays which part
 * rotates over time.
 *
 * The whole thing stays a pure function of `time`: one relaxation pass over the base paths, not an
 * integrated simulation, so the frame loop can park and resume without the orbs lurching.
 */

/** How each orb behaves towards the others. */
export type OrbTemperament =
  'anchor' | 'satellite' | 'shy' | 'clinger' | 'skittish' | 'mirror' | 'drifter';

/** Rotating this list by one is what reassigns the parts. */
export const ORB_TEMPERAMENTS: readonly OrbTemperament[] = [
  'anchor',
  'satellite',
  'shy',
  'clinger',
  'skittish',
  'drifter',
  'mirror',
];

/** Resolution order: `satellite` reads the resolved anchor and `mirror` the resolved satellite. */
const TEMPERAMENT_RESOLVE_ORDER: readonly OrbTemperament[] = [
  'anchor',
  'shy',
  'clinger',
  'skittish',
  'drifter',
  'satellite',
  'mirror',
];

const ROLE_CYCLE_SECONDS = 23;
/** Long enough that an orb changing part is never seen to jump. */
const ROLE_BLEND_SECONDS = 6;

const ANCHOR_TRAVEL = 0.3;
const SATELLITE_ORBIT_X = 0.3;
const SATELLITE_ORBIT_Y = 0.22;
const SATELLITE_RATE = 0.46;
const SHY_STRENGTH = 0.35;
const SHY_RANGE = 0.75;
const SHY_MAX_PUSH = 0.34;
/** Softens the repulsion so the orb flinches instead of snapping aside. */
const SHY_SOFTENING = 0.15;
const CLINGER_PULL = 0.42;
/** Must stay finite so the clinger's choice of target stays continuous. */
const CLINGER_FOCUS = 4;
const SKITTISH_DART = 0.26;
const MIRROR_REFLECTION = 0.9;

/**
 * The stage is a wide strip. Paths are written in the shader's aspect-corrected space (y spans
 * ±0.5), so orbit width is biased toward the aspect and the radii ramp with it, reaching the full
 * scale only on a strip-shaped canvas.
 */
const ORB_SPREAD_ASPECT_BIAS = 0.6;
const ORB_RADIUS_SCALE = 2.8;
const ORB_RADIUS_BASE_SCALE = 0.79;
const ORB_RADIUS_ASPECT_BIAS = 0.15;

const PARALLAX_TRAVEL_MIN = 0.74;
const PARALLAX_TRAVEL_RANGE = 0.52;
const PARALLAX_BULK_MIN = 0.78;
const PARALLAX_BULK_RANGE = 0.44;
/** One lead, two supporting, four extras; the mean multiplier is 1. */
const PROMINENCE_FLOOR = 0.78;
const PROMINENCE_GAIN = 0.45;

const GOLDEN_RATIO_CONJUGATE = 0.618033988749895;

/**
 * The AlienFX arc the orbs are coloured from, in hue revolutions: cyan #00e5ff (0.517) through
 * violet #b14dff to magenta #ff2bd6 (0.866). Kept under half a turn so two orbs' hues blend
 * through the arc, never across the wheel.
 */
export const ARC_START = 0.517;
export const ARC_SPAN = 0.349;
/** The lead orb: it takes the accent (the cover art's dominant colour). */
export const LEAD_ORB = 0;

interface OrbPath {
  rateX: number;
  rateY: number;
  phase: number;
  spreadX: number;
  spreadY: number;
  baseRadius: number;
  /** 0 far, 1 near: near orbs are larger, travel further and are lit more strongly. */
  layer: number;
  /** 0 extra, 1 lead. Belongs to the orb permanently, unlike its temperament. */
  prominence: number;
}

const ORB_PATHS: readonly OrbPath[] = [
  {
    rateX: 0.21,
    rateY: 0.29,
    phase: 0.0,
    spreadX: 0.34,
    spreadY: 0.2,
    baseRadius: 0.15,
    layer: 1.0,
    prominence: 1,
  },
  {
    rateX: 0.27,
    rateY: 0.19,
    phase: 1.3,
    spreadX: 0.42,
    spreadY: 0.16,
    baseRadius: 0.13,
    layer: 0.45,
    prominence: 0.3,
  },
  {
    rateX: 0.16,
    rateY: 0.35,
    phase: 2.6,
    spreadX: 0.28,
    spreadY: 0.24,
    baseRadius: 0.12,
    layer: 0.75,
    prominence: 0.6,
  },
  {
    rateX: 0.33,
    rateY: 0.23,
    phase: 3.9,
    spreadX: 0.46,
    spreadY: 0.18,
    baseRadius: 0.11,
    layer: 0.15,
    prominence: 0.3,
  },
  {
    rateX: 0.19,
    rateY: 0.41,
    phase: 5.1,
    spreadX: 0.36,
    spreadY: 0.22,
    baseRadius: 0.1,
    layer: 0.6,
    prominence: 0.3,
  },
  {
    rateX: 0.37,
    rateY: 0.26,
    phase: 0.7,
    spreadX: 0.5,
    spreadY: 0.14,
    baseRadius: 0.09,
    layer: 0.0,
    prominence: 0.3,
  },
  {
    rateX: 0.13,
    rateY: 0.31,
    phase: 4.4,
    spreadX: 0.22,
    spreadY: 0.26,
    baseRadius: 0.14,
    layer: 0.85,
    prominence: 0.6,
  },
];

export const ORB_COUNT = ORB_PATHS.length;

export interface OrbPlacement {
  /** Centre in the shader's aspect-corrected space (y spans ±0.5). */
  x: number;
  y: number;
  radius: number;
  layer: number;
  prominence: number;
  temperament: OrbTemperament;
}

interface Placed {
  x: number;
  y: number;
  radius: number;
}

interface StageMetrics {
  spread: number;
  radiusScale: number;
  boundX: number;
}

interface RosterPhase {
  rotation: number;
  nextRotation: number;
  /** 0 while settled, easing to 1 across the handover. */
  blend: number;
}

function fractional(value: number): number {
  return value - Math.floor(value);
}

function clamp(value: number, limit: number): number {
  return value < -limit ? -limit : value > limit ? limit : value;
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

/** Orb `index`'s hue in revolutions: the accent for the lead, golden-ratio steps along the arc. */
export function orbHue(index: number, accentHue: number): number {
  if (index === LEAD_ORB) return accentHue;
  return ARC_START + fractional(index * GOLDEN_RATIO_CONJUGATE) * ARC_SPAN;
}

export function rosterAt(time: number): RosterPhase {
  const cycles = time / ROLE_CYCLE_SECONDS;
  const rotation = Math.floor(cycles);
  const elapsed = (cycles - rotation) * ROLE_CYCLE_SECONDS;
  const handoverStarts = ROLE_CYCLE_SECONDS - ROLE_BLEND_SECONDS;
  if (elapsed < handoverStarts) return { rotation, nextRotation: rotation, blend: 0 };
  const t = Math.min(1, Math.max(0, (elapsed - handoverStarts) / ROLE_BLEND_SECONDS));
  return { rotation, nextRotation: rotation + 1, blend: t * t * (3 - 2 * t) };
}

/** The part orb `index` plays in a given rotation; `seed` picks the opening arrangement. */
export function temperamentFor(index: number, rotation: number, seed: number): OrbTemperament {
  const count = ORB_TEMPERAMENTS.length;
  return ORB_TEMPERAMENTS[(((index + rotation + seed) % count) + count) % count];
}

/**
 * A soft "nearest neighbour": every other orb pulls, weighted steeply by proximity. Picking the
 * single nearest outright teleports the clinger whenever two candidates are equidistant.
 */
function weightedNeighbour(bases: Placed[], index: number): { x: number; y: number; gap: number } {
  let x = 0;
  let y = 0;
  let total = 0;
  let nearest = Infinity;
  for (let other = 0; other < bases.length; other++) {
    if (other === index) continue;
    const distance = Math.hypot(bases[other].x - bases[index].x, bases[other].y - bases[index].y);
    const weight = 1 / (Math.pow(distance, CLINGER_FOCUS) + 1e-4);
    x += bases[other].x * weight;
    y += bases[other].y * weight;
    total += weight;
    nearest = Math.min(nearest, distance);
  }
  return { x: x / total, y: y / total, gap: nearest };
}

function repulsion(bases: Placed[], index: number): { x: number; y: number; crowding: number } {
  let x = 0;
  let y = 0;
  let crowding = 0;
  for (let other = 0; other < bases.length; other++) {
    if (other === index) continue;
    const dx = bases[index].x - bases[other].x;
    const dy = bases[index].y - bases[other].y;
    const distance = Math.hypot(dx, dy);
    if (distance >= SHY_RANGE) continue;
    // eases in as a neighbour enters range instead of switching on at the boundary
    const approach = (SHY_RANGE - distance) / SHY_RANGE;
    const falloff = approach * approach * (3 - 2 * approach);
    const scale = (SHY_STRENGTH * falloff) / (distance + SHY_SOFTENING);
    x += dx * scale;
    y += dy * scale;
    crowding += approach;
  }
  return { x: clamp(x, SHY_MAX_PUSH), y: clamp(y, SHY_MAX_PUSH), crowding };
}

interface BehaviourContext {
  index: number;
  time: number;
  pathPhase: number;
  pulse: number;
  bases: Placed[];
  placed: Placed[];
  assignment: readonly OrbTemperament[];
  spread: number;
}

/** Displaces `placed[index]` according to the part it plays. Every rule is continuous in time. */
function applyTemperament(role: OrbTemperament, c: BehaviourContext): void {
  const base = c.bases[c.index];
  const self = c.placed[c.index];
  switch (role) {
    case 'satellite': {
      const partner = c.placed[c.assignment.indexOf('anchor')];
      const angle = c.time * SATELLITE_RATE + c.pathPhase;
      self.x = partner.x + Math.cos(angle) * SATELLITE_ORBIT_X * c.spread;
      self.y = partner.y + Math.sin(angle) * SATELLITE_ORBIT_Y;
      break;
    }
    case 'mirror': {
      const partner = c.placed[c.assignment.indexOf('satellite')];
      self.x = -partner.x * MIRROR_REFLECTION;
      self.y = -partner.y * MIRROR_REFLECTION;
      break;
    }
    case 'shy': {
      const push = repulsion(c.bases, c.index);
      self.x += push.x;
      self.y += push.y;
      self.radius *= 1 - Math.min(0.3, push.crowding * 0.22);
      break;
    }
    case 'clinger': {
      const target = weightedNeighbour(c.bases, c.index);
      self.x += (target.x - base.x) * CLINGER_PULL;
      self.y += (target.y - base.y) * CLINGER_PULL;
      self.radius *= 1 + 0.28 * Math.max(0, 1 - target.gap);
      break;
    }
    case 'skittish':
      self.x += Math.cos(c.time * 3.1 + c.pathPhase) * SKITTISH_DART * c.pulse;
      self.y += Math.sin(c.time * 2.7 + c.pathPhase) * SKITTISH_DART * c.pulse;
      self.radius *= 1 + c.pulse * 0.45;
      break;
    case 'anchor':
    case 'drifter':
      break;
  }
}

function basePlacement(
  path: OrbPath,
  time: number,
  band: number,
  pulse: number,
  isAnchor: boolean,
  stage: StageMetrics,
): Placed {
  // louder bands push their orb outward: the cluster breathes apart and fuses back together
  const reach = 1 + band * 0.45;
  const travel =
    (PARALLAX_TRAVEL_MIN + path.layer * PARALLAX_TRAVEL_RANGE) * (isAnchor ? ANCHOR_TRAVEL : 1);
  const bulk = PARALLAX_BULK_MIN + path.layer * PARALLAX_BULK_RANGE;
  return {
    x: Math.cos(time * path.rateX + path.phase) * path.spreadX * reach * stage.spread * travel,
    y: Math.sin(time * path.rateY + path.phase * 1.7) * path.spreadY * reach * travel,
    radius:
      path.baseRadius *
      (0.68 + band * 0.7 + pulse * 0.22) *
      stage.radiusScale *
      bulk *
      (PROMINENCE_FLOOR + path.prominence * PROMINENCE_GAIN),
  };
}

function placeRoster(
  time: number,
  energy: EnergyFrame,
  stage: StageMetrics,
  assignment: readonly OrbTemperament[],
): Placed[] {
  const bases = ORB_PATHS.map((path, index) =>
    basePlacement(
      path,
      time,
      energy.bands[index] ?? 0,
      energy.pulse,
      assignment[index] === 'anchor',
      stage,
    ),
  );
  const placed = bases.map((b) => ({ ...b }));
  for (const role of TEMPERAMENT_RESOLVE_ORDER) {
    for (let index = 0; index < ORB_PATHS.length; index++) {
      if (assignment[index] !== role) continue;
      applyTemperament(role, {
        index,
        time,
        pathPhase: ORB_PATHS[index].phase,
        pulse: energy.pulse,
        bases,
        placed,
        assignment,
        spread: stage.spread,
      });
    }
  }
  return placed.map((orb) => ({
    x: clamp(orb.x, stage.boundX),
    y: clamp(orb.y, 0.48),
    radius: orb.radius,
  }));
}

/** Places the orbs for one frame. `seed` gives each song its own opening arrangement. */
export function computeOrbPlacements(
  time: number,
  energy: EnergyFrame,
  aspect: number,
  seed = 0,
): OrbPlacement[] {
  const wideness = Math.max(1, aspect) - 1;
  const stage: StageMetrics = {
    spread: 1 + wideness * ORB_SPREAD_ASPECT_BIAS,
    radiusScale: Math.min(
      ORB_RADIUS_SCALE,
      ORB_RADIUS_BASE_SCALE + wideness * ORB_RADIUS_ASPECT_BIAS,
    ),
    // nothing may leave the canvas; a near-square canvas still gets some room
    boundX: Math.max(0.9, aspect / 2),
  };
  const assignmentFor = (rotation: number) =>
    ORB_PATHS.map((_, index) => temperamentFor(index, rotation, seed));

  const phase = rosterAt(time);
  const assignment = assignmentFor(phase.rotation);
  const current = placeRoster(time, energy, stage, assignment);
  // outside a handover the second roster is the first, so it is only paid for while parts change
  const handingOver = phase.blend > 0;
  const nextAssignment = handingOver ? assignmentFor(phase.nextRotation) : assignment;
  const next = handingOver ? placeRoster(time, energy, stage, nextAssignment) : current;

  return ORB_PATHS.map((path, index) => ({
    x: mix(current[index].x, next[index].x, phase.blend),
    y: mix(current[index].y, next[index].y, phase.blend),
    radius: mix(current[index].radius, next[index].radius, phase.blend),
    layer: path.layer,
    prominence: path.prominence,
    temperament: phase.blend > 0.5 ? nextAssignment[index] : assignment[index],
  }));
}
