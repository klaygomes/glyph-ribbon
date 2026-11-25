import { SPRITE } from './engine.js';
import { glyphWeight, normalizeWeights, type GlyphImageSource, type GlyphSpec } from './options.js';

export type GlyphSource =
  | { kind: 'text'; text: string }
  | { kind: 'dot' }
  | { kind: 'image'; image: CanvasImageSource; tint: boolean };

export interface LoadedGlyphs {
  sources: GlyphSource[];
  weights: number[];
}

export interface RenderedSprites {
  sprites: ImageBitmap[];
  ink: number[];
}

const DOT_RADIUS = 13;
const IMAGE_BOX = 56;
const TEXT_BOX = 60;
const INK_THRESHOLD = 40;
const imageCache = new Map<string, Promise<HTMLImageElement>>();

const surface = (): HTMLCanvasElement | OffscreenCanvas => {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(SPRITE, SPRITE);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SPRITE;
  return canvas;
};

function loadImage(url: string): Promise<HTMLImageElement> {
  let pending = imageCache.get(url);
  if (!pending) {
    pending = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`glyph-ribbon: failed to load glyph image ${url}`));
      img.src = url;
    });
    imageCache.set(url, pending);
    pending.catch(() => imageCache.delete(url));
  }
  return pending;
}

async function resolveImage(source: GlyphImageSource): Promise<CanvasImageSource> {
  return typeof source === 'string' ? loadImage(source) : source;
}

export async function loadGlyphs(specs: readonly GlyphSpec[], font: string): Promise<LoadedGlyphs> {
  const settled = await Promise.allSettled(
    specs.map(async (spec): Promise<GlyphSource> => {
      if (typeof spec === 'string') return { kind: 'text', text: spec };
      if ('text' in spec) return { kind: 'text', text: spec.text };
      if ('shape' in spec) return { kind: 'dot' };
      return { kind: 'image', image: await resolveImage(spec.image), tint: spec.tint === true };
    }),
  );

  const sources: GlyphSource[] = [];
  const raw: (number | undefined)[] = [];
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      sources.push(result.value);
      raw.push(glyphWeight(specs[i]));
    } else {
      console.warn(result.reason);
    }
  });
  if (!sources.length) {
    sources.push({ kind: 'dot' });
    raw.push(1);
  }

  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (fonts) {
    const texts = sources.flatMap((s) => (s.kind === 'text' ? [s.text] : []));
    if (texts.length) await fonts.load(font, texts.join('')).catch(() => undefined);
  }
  return { sources, weights: normalizeWeights(raw) };
}

const dimensions = (image: CanvasImageSource): [number, number] => {
  const img = image as { naturalWidth?: number; naturalHeight?: number; width?: number | SVGAnimatedLength; height?: number | SVGAnimatedLength };
  const w = img.naturalWidth || (typeof img.width === 'number' ? img.width : 0) || SPRITE;
  const h = img.naturalHeight || (typeof img.height === 'number' ? img.height : 0) || SPRITE;
  return [w, h];
};

function paint(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, source: GlyphSource, color: string, font: string) {
  const mid = SPRITE / 2;
  ctx.fillStyle = color;
  if (source.kind === 'dot') {
    ctx.beginPath();
    ctx.arc(mid, mid, DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  } else if (source.kind === 'text') {
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const width = ctx.measureText(source.text).width;
    const k = width > TEXT_BOX ? TEXT_BOX / width : 1;
    ctx.setTransform(k, 0, 0, k, mid, mid + 2 * k);
    ctx.fillText(source.text, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    const [w, h] = dimensions(source.image);
    const k = IMAGE_BOX / Math.max(w, h);
    ctx.drawImage(source.image, mid - (w * k) / 2, mid - (h * k) / 2, w * k, h * k);
    if (source.tint) {
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillRect(0, 0, SPRITE, SPRITE);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}

function measureInk(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D): number {
  const data = ctx.getImageData(0, 0, SPRITE, SPRITE).data;
  const mid = SPRITE / 2;
  let max = 0;
  for (let y = 0; y < SPRITE; y++) {
    for (let x = 0; x < SPRITE; x++) {
      if (data[(y * SPRITE + x) * 4 + 3] < INK_THRESHOLD) continue;
      const d = Math.hypot(x + 0.5 - mid, y + 0.5 - mid);
      if (d > max) max = d;
    }
  }
  return max > 0 ? max / SPRITE : 0.25;
}

export async function renderSprites(sources: readonly GlyphSource[], color: string, font: string): Promise<RenderedSprites> {
  const sprites: ImageBitmap[] = [];
  const ink: number[] = [];
  for (const source of sources) {
    const canvas = surface();
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D;
    paint(ctx, source, color, font);
    try {
      ink.push(measureInk(ctx));
    } catch {
      ink.push(0.3);
    }
    sprites.push(await createImageBitmap(canvas));
  }
  return { sprites, ink };
}
