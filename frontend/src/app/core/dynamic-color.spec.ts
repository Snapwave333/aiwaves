import { dominantColor } from '../player/extract-color';
import {
  DEFAULT_ACCENT,
  SURFACES,
  accentFor,
  accentScheme,
  applyAccent,
  contrast,
  parseColor,
  rgbToHsl,
} from './dynamic-color';

/** RGBA pixels: `parts` of [r, g, b, count]; every pixel is opaque. */
function image(...parts: [number, number, number, number][]): Uint8ClampedArray {
  const px: number[] = [];
  for (const [r, g, b, n] of parts) for (let i = 0; i < n; i++) px.push(r, g, b, 255);
  return new Uint8ClampedArray(px);
}

const surfaces = SURFACES.map((s) => parseColor(s)!);

describe('dynamic colour', () => {
  it('picks the dominant, saturated colour of an image and ignores near-black / white', () => {
    // mostly near-black background, a big magenta area, a smaller muted grey-blue area
    const img = image([5, 5, 8, 4000], [230, 40, 200, 1600], [90, 100, 120, 800]);
    const c = dominantColor(img)!;
    expect(c).toEqual({ r: 230, g: 40, b: 200 });
  });

  it('returns null for an image with nothing but black, white or transparent pixels', () => {
    const px = image([0, 0, 0, 100], [255, 255, 255, 100]);
    expect(dominantColor(px)).toBeNull();
    expect(dominantColor(new Uint8ClampedArray([200, 50, 50, 0]))).toBeNull();
  });

  it('turns an image into an accent that keeps AA contrast on every surface', () => {
    // a dark, murky red cover: the raw colour would be unreadable on the dark panels
    const img = image([110, 22, 30, 2000], [12, 10, 14, 3000]);
    const raw = dominantColor(img)!;
    expect(contrast(raw, surfaces[1])).toBeLessThan(4.5);
    const scheme = accentScheme(raw);
    const primary = parseColor(scheme.primary)!;
    for (const bg of surfaces) expect(contrast(primary, bg)).toBeGreaterThanOrEqual(4.5);
    // same hue family (red), lifted
    expect(Math.abs(((rgbToHsl(primary).h - rgbToHsl(raw).h + 540) % 360) - 180)).toBeLessThan(8);
    expect(contrast(parseColor(scheme.onPrimary)!, primary)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['#00e5ff', '#ffd400', '#2b1aff', '#3dff7a', '#ff2bd6', '#402060'])(
    'accent for %s clears AA on the surfaces and for text on it',
    (hex) => {
      const s = accentScheme(parseColor(hex));
      const p = parseColor(s.primary)!;
      for (const bg of surfaces) expect(contrast(p, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(parseColor(s.onPrimary)!, p)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('keeps the default cyan for greys and when there is no colour', () => {
    expect(accentScheme(null)).toEqual(DEFAULT_ACCENT);
    expect(accentScheme({ r: 128, g: 130, b: 129 })).toEqual(DEFAULT_ACCENT);
  });

  it('a mostly dark, grey cover takes its accent from its palette instead', () => {
    // a near-grey nebula dominates; a smaller purple area is not enough to win
    const img = image([40, 37, 44, 3000], [43, 45, 77, 1200], [5, 5, 5, 2000]);
    const dominant = dominantColor(img)!;
    expect(accentScheme(dominant)).toEqual(DEFAULT_ACCENT);
    const viaPalette = accentFor(dominant, ['#808080', '#d9a45b']);
    expect(viaPalette).toEqual(accentScheme(parseColor('#d9a45b')));
    expect(accentFor(dominant, [])).toEqual(DEFAULT_ACCENT);
    // a vivid dominant colour wins over the palette
    expect(accentFor({ r: 230, g: 40, b: 200 }, ['#d9a45b'])).toEqual(
      accentScheme({ r: 230, g: 40, b: 200 }),
    );
  });

  it('applies the scheme as M3 system colours on the root element', () => {
    const el = document.createElement('div');
    applyAccent(el, accentScheme(parseColor('#ff2bd6')));
    expect(el.style.getPropertyValue('--mat-sys-primary')).toMatch(/^#[0-9a-f]{6}$/);
    expect(el.style.getPropertyValue('--mat-sys-on-primary-container')).toMatch(/^#/);
  });

  it('parses hex and rgb() colours', () => {
    expect(parseColor('#0a141e')).toEqual({ r: 10, g: 20, b: 30 });
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3 });
    expect(parseColor('teal')).toBeNull();
  });
});
