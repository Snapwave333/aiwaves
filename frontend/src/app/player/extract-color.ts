// Ported from CarbonCast IPTV / IPTVnator (libs/ui/playback/src/lib/audio-player/extract-color.ts),
// MIT licence: see THIRD_PARTY_NOTICES.md. Changes: the pixel bucketing is a pure function over
// RGBA data (so it is unit-testable without a canvas) and the result is an Rgb, not a string.
import { Rgb } from '../core/dynamic-color';

const SAMPLE_PX = 64;

/**
 * Extracts the most vibrant dominant colour from an image URL.
 *
 * Loads the image in a separate Image object with crossOrigin="anonymous" so the canvas isn't
 * tainted. If the server doesn't support CORS, the extraction fails quietly and returns null.
 */
export function extractDominantColor(url: string): Promise<Rgb | null> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(sampleImage(img));
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function sampleImage(img: HTMLImageElement): Rgb | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_PX;
    canvas.height = SAMPLE_PX;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, SAMPLE_PX, SAMPLE_PX);
    return dominantColor(ctx.getImageData(0, 0, SAMPLE_PX, SAMPLE_PX).data);
  } catch {
    // a tainted canvas (cross-origin image without CORS) throws on getImageData
    return null;
  }
}

/**
 * Buckets every 4th pixel into a 4x4x4 colour grid (64 buckets) and picks the most frequent
 * bucket, weighted towards saturated colours. Transparent, near-black and near-white pixels are
 * skipped. `data` is RGBA, as from `getImageData`.
 */
export function dominantColor(data: Uint8ClampedArray): Rgb | null {
  const buckets = new Map<number, { r: number; g: number; b: number; count: number }>();

  for (let i = 0; i < data.length; i += 16) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 128) continue;

    const lum = r * 0.299 + g * 0.587 + b * 0.114;
    if (lum < 30 || lum > 230) continue;

    const key = ((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6);
    const existing = buckets.get(key);
    if (existing) {
      existing.r += r;
      existing.g += g;
      existing.b += b;
      existing.count++;
    } else {
      buckets.set(key, { r, g, b, count: 1 });
    }
  }

  let best: { r: number; g: number; b: number; count: number } | null = null;
  let bestScore = 0;
  for (const bucket of buckets.values()) {
    const r = bucket.r / bucket.count;
    const g = bucket.g / bucket.count;
    const b = bucket.b / bucket.count;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const score = bucket.count * (0.3 + saturation * 0.7);
    if (score > bestScore) {
      bestScore = score;
      best = bucket;
    }
  }
  if (!best) return null;
  return {
    r: Math.round(best.r / best.count),
    g: Math.round(best.g / best.count),
    b: Math.round(best.b / best.count),
  };
}
