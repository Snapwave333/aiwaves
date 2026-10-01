/**
 * Dynamic colour: the cover art's dominant colour becomes the UI's accent (M3 primary). The raw
 * colour can be anything (a dark blue, a grey), so it is first turned into a scheme that keeps
 * WCAG AA contrast on the workspace's near-black surfaces.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface AccentScheme {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
}

/** The darkest and lightest surfaces the accent is drawn on (see styles/_tokens.scss). */
export const SURFACES = ['#07090d', '#1c2230'] as const;
/** Text contrast target for the accent on every surface: AA (4.5) with some headroom. */
export const MIN_CONTRAST = 6;
/** Below this saturation a colour is a grey; the default accent is kept instead. */
const GREY = 0.12;

export const DEFAULT_ACCENT: AccentScheme = {
  primary: '#00e5ff',
  onPrimary: '#00363d',
  primaryContainer: '#004f58',
  onPrimaryContainer: '#9cf0ff',
};

export function parseColor(css: string): Rgb | null {
  const s = css.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255 };
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  return null;
}

export function toHex({ r, g, b }: Rgb): string {
  const h = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** WCAG relative luminance. */
export function luminance({ r, g, b }: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0);
  else if (max === gg) h = (bb - rr) / d + 2;
  else h = (rr - gg) / d + 4;
  return { h: h * 60, s, l };
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 };
}

export function isVivid(c: Rgb): boolean {
  return rgbToHsl(c).s >= GREY;
}

/**
 * The accent for a cover: its dominant colour, or (when that is a grey, as on a mostly dark
 * cover) the first vivid colour of the cover's palette, else the default.
 */
export function accentFor(dominant: Rgb | null, palette: readonly string[] = []): AccentScheme {
  const candidates = [dominant, ...palette.map(parseColor)];
  return accentScheme(candidates.find((c): c is Rgb => !!c && isVivid(c)) ?? null);
}

/**
 * The accent scheme for a dominant colour: the hue is kept, saturation is lifted so it reads as
 * light rather than paint, and lightness rises until the colour clears MIN_CONTRAST on every
 * surface. Greys fall back to the default cyan.
 */
export function accentScheme(color: Rgb | null): AccentScheme {
  if (!color) return DEFAULT_ACCENT;
  if (!isVivid(color)) return DEFAULT_ACCENT;
  const { h, s } = rgbToHsl(color);
  const sat = Math.max(s, 0.75);
  const surfaces = SURFACES.map((c) => parseColor(c)!);
  let l = 0.55;
  let primary = hslToRgb(h, sat, l);
  while (l < 0.92 && surfaces.some((bg) => contrast(primary, bg) < MIN_CONTRAST)) {
    l += 0.02;
    primary = hslToRgb(h, sat, l);
  }
  let dark = 0.16;
  let onPrimary = hslToRgb(h, sat * 0.9, dark);
  while (dark > 0 && contrast(onPrimary, primary) < 4.5) {
    dark -= 0.02;
    onPrimary = hslToRgb(h, sat * 0.9, dark);
  }
  return {
    primary: toHex(primary),
    onPrimary: toHex(onPrimary),
    primaryContainer: toHex(hslToRgb(h, sat * 0.8, 0.2)),
    onPrimaryContainer: toHex(hslToRgb(h, sat, 0.86)),
  };
}

const VARS: Record<keyof AccentScheme, string> = {
  primary: '--mat-sys-primary',
  onPrimary: '--mat-sys-on-primary',
  primaryContainer: '--mat-sys-primary-container',
  onPrimaryContainer: '--mat-sys-on-primary-container',
};

/** Sets the scheme on `root` (the registered properties glide to it, see _tokens.scss). */
export function applyAccent(root: HTMLElement, scheme: AccentScheme): void {
  for (const k of Object.keys(VARS) as (keyof AccentScheme)[])
    root.style.setProperty(VARS[k], scheme[k]);
}
