import { Project } from '../core/model';
import { bucketMax } from '../views/clip-render';

/**
 * Local cover art for demo / offline mode (CONTRACT section 10: "the frontend draws its own
 * placeholder art"). Made from the song like the server's covers: its track colours, one orbit
 * per section, chord ticks, the master waveform wrapped round a circle, and a seeded random
 * nebula, so every seed gives a different piece. `coverPlan` is pure; `renderLocalCover` paints
 * it on a canvas.
 */

export interface Orb {
  x: number;
  y: number;
  r: number;
  color: string;
  alpha: number;
}

export interface Orbit {
  r: number;
  color: string;
  width: number;
  dash: [number, number];
  rot: number;
}

export interface CoverPlan {
  palette: string[];
  bg: [string, string];
  orbs: Orb[];
  orbits: Orbit[];
  /** Chord changes as angles (radians) round the outer orbit. */
  ticks: number[];
  /** Master waveform, one value per step round the circle. */
  wave: number[];
  /** Where round the circle the song starts (radians). */
  rot: number;
  stars: { x: number; y: number; r: number; a: number }[];
}

const FALLBACK_PALETTE = ['#00e5ff', '#b14dff', '#ff2bd6', '#3dffa2'];
const WAVE_STEPS = 240;
const STARS = 140;

/** A small, fast seeded PRNG (mulberry32): the same seed always paints the same cover. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable seed for a string (FNV-1a), for the art shown before the first playthrough. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** The song's colours: its tracks' colours, without duplicates or the master. */
export function coverPalette(p: Project): string[] {
  const out: string[] = [];
  for (const t of p.tracks) {
    const c = t.color?.toLowerCase();
    if (t.kind !== 'master' && c && /^#[0-9a-f]{6}$/.test(c) && !out.includes(c)) out.push(c);
  }
  return out.length ? out : FALLBACK_PALETTE;
}

export function coverPlan(p: Project, seed: number): CoverPlan {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const palette = coverPalette(p);
  const len = Math.max(1, p.length_bars);

  const orbs: Orb[] = Array.from({ length: 5 + Math.floor(rnd() * 4) }, () => ({
    x: 0.1 + rnd() * 0.8,
    y: 0.1 + rnd() * 0.8,
    r: 0.2 + rnd() * 0.35,
    color: pick(palette),
    alpha: 0.3 + rnd() * 0.35,
  }));

  const sections = p.sections.length ? p.sections : [{ name: '', start_bar: 0, end_bar: len }];
  const orbits: Orbit[] = sections.map((s, i) => ({
    r: 0.2 + (0.24 * (i + 1)) / sections.length,
    color: palette[(i + Math.floor(rnd() * palette.length)) % palette.length],
    width: 0.6 + ((s.end_bar - s.start_bar) / len) * 6,
    dash: [2 + rnd() * 18, 2 + rnd() * 10],
    rot: rnd() * Math.PI * 2,
  }));

  const ticks: number[] = [];
  let last = '';
  for (const c of p.chords) {
    if (c.name !== last) ticks.push((c.bar / len) * Math.PI * 2 - Math.PI / 2);
    last = c.name;
  }

  const stars = Array.from({ length: STARS }, () => ({
    x: rnd(),
    y: rnd(),
    r: rnd() < 0.92 ? 0.4 + rnd() * 0.8 : 1.2 + rnd() * 1.2,
    a: 0.25 + rnd() * 0.75,
  }));

  return {
    palette,
    bg: [pick(palette), pick(palette)],
    orbs,
    orbits,
    ticks,
    wave: bucketMax(p.audio.peaks ?? [], WAVE_STEPS),
    rot: (Math.floor(rnd() * 6) * Math.PI) / 6,
    stars,
  };
}

/** Point on a circle of radius r at angle t (radians), for wrapping the waveform. */
function onCircle(r: number, t: number): [number, number] {
  return [r * Math.cos(t), r * Math.sin(t)];
}

export function paintCover(ctx: CanvasRenderingContext2D, plan: CoverPlan, size: number): void {
  const c = size / 2;
  // deep space, tinted by two of the song's colours
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#05070b');
  bg.addColorStop(0.55, '#0b0f18');
  bg.addColorStop(1, '#05070b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  ctx.globalCompositeOperation = 'lighter';
  for (const o of plan.orbs) {
    const g = ctx.createRadialGradient(
      o.x * size,
      o.y * size,
      0,
      o.x * size,
      o.y * size,
      o.r * size,
    );
    g.addColorStop(0, o.color);
    g.addColorStop(1, 'transparent');
    ctx.globalAlpha = o.alpha;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

  ctx.fillStyle = '#ffffff';
  for (const s of plan.stars) {
    ctx.globalAlpha = s.a * 0.8;
    ctx.beginPath();
    ctx.arc(s.x * size, s.y * size, (s.r * size) / 512, 0, Math.PI * 2);
    ctx.fill();
  }

  // one orbit per section, dashed like a radar sweep
  for (const o of plan.orbits) {
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(o.rot);
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = o.color;
    ctx.lineWidth = (o.width * size) / 512;
    ctx.setLineDash(o.dash.map((d) => (d * size) / 512));
    ctx.beginPath();
    ctx.arc(0, 0, o.r * size, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.setLineDash([]);

  // the master waveform wrapped round a circle, in the brightest colour
  const r = size * 0.16;
  const amp = size * 0.13;
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = plan.bg[0];
  ctx.lineWidth = Math.max(1, size / 340);
  ctx.beginPath();
  plan.wave.forEach((v, i) => {
    const t = (i / plan.wave.length) * Math.PI * 2 - Math.PI / 2 + plan.rot;
    const [x0, y0] = onCircle(r, t);
    const [x1, y1] = onCircle(r + v * amp, t);
    ctx.moveTo(c + x0, c + y0);
    ctx.lineTo(c + x1, c + y1);
  });
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.lineWidth = Math.max(1.5, size / 220);
  ctx.strokeStyle = plan.bg[1];
  ctx.beginPath();
  ctx.arc(c, c, r * 0.94, 0, Math.PI * 2);
  ctx.stroke();

  // chord changes as ticks round the outside
  const outer = size * 0.47;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = Math.max(1, size / 400);
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  for (const t of plan.ticks) {
    ctx.moveTo(c + Math.cos(t) * outer, c + Math.sin(t) * outer);
    ctx.lineTo(c + Math.cos(t) * (outer - size * 0.025), c + Math.sin(t) * (outer - size * 0.025));
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** Paints a local cover; resolves to an object URL (revoke it when done), or null without canvas. */
export function renderLocalCover(p: Project, seed: number, size = 512): Promise<string | null> {
  if (typeof document === 'undefined' || typeof CanvasRenderingContext2D === 'undefined')
    return Promise.resolve(null);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  paintCover(ctx, coverPlan(p, seed), size);
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null), 'image/png'),
  );
}
