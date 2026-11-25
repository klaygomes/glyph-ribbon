import {
  DEFAULT_CONSTANTS,
  DEFAULT_TIMELINE,
  MAX_GLYPHS_LIMIT,
  type Anchor,
  type Constants,
  type Range,
  type Timeline,
} from './engine.js';

export type GlyphImageSource = string | HTMLImageElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas | SVGImageElement;

export type GlyphSpec =
  | string
  | { text: string; weight?: number }
  | { image: GlyphImageSource; weight?: number; tint?: boolean }
  | { shape: 'dot'; weight?: number };

export type AnchorOption = Anchor | ((width: number, height: number) => Anchor);
export type Motion = 'auto' | 'full' | 'reduced';

export interface GlyphRibbonOptions {
  glyphs?: readonly GlyphSpec[];
  maxGlyphs?: number;
  font?: string;
  color?: string;
  seed?: number;
  speed?: number;
  turns?: number;
  anchor?: AnchorOption;
  timeline?: Partial<Timeline>;
  smoothing?: number;
  motion?: Motion;
  intro?: boolean;
  autoplay?: boolean;
  worker?: boolean;
  advanced?: Partial<Constants>;
}

export interface ResolvedOptions {
  glyphs: readonly GlyphSpec[];
  maxGlyphs: number;
  font: string;
  color: string | undefined;
  seed: number;
  speed: number;
  turns: number;
  anchor: AnchorOption;
  timeline: Timeline;
  smoothing: number;
  motion: Motion;
  intro: boolean;
  autoplay: boolean;
  worker: boolean;
  advanced: Constants;
}

export const DEFAULT_GLYPHS: readonly GlyphSpec[] = [{ shape: 'dot', weight: 0.15 }, 't', 'u', 'n', 'r', 's'];
export const DEFAULT_FONT = '500 46px ui-monospace, SFMono-Regular, Menlo, monospace';

export const defaultAnchor = (width: number): Anchor =>
  width >= 900 ? { x: 0.62, y: 0.5 } : { x: 0.5, y: 0.68 };

export const DEFAULT_OPTIONS: ResolvedOptions = {
  glyphs: DEFAULT_GLYPHS,
  maxGlyphs: 1400,
  font: DEFAULT_FONT,
  color: undefined,
  seed: 1337,
  speed: 0.085,
  turns: 3.5,
  anchor: defaultAnchor,
  timeline: DEFAULT_TIMELINE,
  smoothing: 220,
  motion: 'auto',
  intro: true,
  autoplay: true,
  worker: true,
  advanced: { ...DEFAULT_CONSTANTS },
};

const ADVANCED_LIMITS: Partial<Record<keyof Constants, [number, number]>> = {
  DARTS: [1, 500000],
  CELL_MIN: [1, 1000],
  INTRO_MS: [1, 60000],
  VIS_MS: [1, 10000],
};

const finite = (value: unknown, name: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`glyph-ribbon: ${name} must be a finite number`);
  }
  return value;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function resolveRange(value: Range | undefined, fallback: Range, name: string): Range {
  if (value === undefined) return fallback;
  const a = clamp(finite(value[0], `timeline.${name}[0]`), 0, 1);
  const b = clamp(finite(value[1], `timeline.${name}[1]`), 0, 1);
  if (b <= a) throw new RangeError(`glyph-ribbon: timeline.${name} must have start < end, got [${a}, ${b}]`);
  return [a, b];
}

function resolveAdvanced(value: Partial<Constants> | undefined, base: Constants): Constants {
  if (!value) return base;
  const out = { ...base };
  for (const key of Object.keys(DEFAULT_CONSTANTS) as (keyof Constants)[]) {
    if (!(key in value) || value[key] === undefined) continue;
    let v = finite(value[key], `advanced.${key}`);
    const limit = ADVANCED_LIMITS[key];
    if (limit) v = clamp(v, limit[0], limit[1]);
    out[key] = v;
  }
  return out;
}

export function resolveOptions(input: GlyphRibbonOptions = {}, base: ResolvedOptions = DEFAULT_OPTIONS): ResolvedOptions {
  const pick = <K extends keyof ResolvedOptions>(key: K, value: ResolvedOptions[K] | undefined) =>
    value === undefined ? base[key] : value;

  const glyphs = input.glyphs === undefined ? base.glyphs : input.glyphs.length ? input.glyphs : DEFAULT_GLYPHS;
  const timeline = input.timeline
    ? {
        centre: resolveRange(input.timeline.centre, base.timeline.centre, 'centre'),
        zoom: resolveRange(input.timeline.zoom, base.timeline.zoom, 'zoom'),
        scatter: resolveRange(input.timeline.scatter, base.timeline.scatter, 'scatter'),
      }
    : base.timeline;
  const motion = pick('motion', input.motion);
  if (motion !== 'auto' && motion !== 'full' && motion !== 'reduced') {
    throw new TypeError(`glyph-ribbon: motion must be 'auto', 'full' or 'reduced'`);
  }

  return {
    glyphs,
    maxGlyphs:
      input.maxGlyphs === undefined
        ? base.maxGlyphs
        : clamp(Math.round(finite(input.maxGlyphs, 'maxGlyphs')), 1, MAX_GLYPHS_LIMIT),
    font: pick('font', input.font),
    color: 'color' in input ? input.color || undefined : base.color,
    seed: input.seed === undefined ? base.seed : Math.trunc(finite(input.seed, 'seed')),
    speed: input.speed === undefined ? base.speed : finite(input.speed, 'speed'),
    turns: input.turns === undefined ? base.turns : clamp(finite(input.turns, 'turns'), 0.5, 12),
    anchor: pick('anchor', input.anchor),
    timeline,
    smoothing: input.smoothing === undefined ? base.smoothing : Math.max(0, finite(input.smoothing, 'smoothing')),
    motion,
    intro: pick('intro', input.intro),
    autoplay: pick('autoplay', input.autoplay),
    worker: pick('worker', input.worker),
    advanced: resolveAdvanced(input.advanced, base.advanced),
  };
}

export function resolveAnchor(anchor: AnchorOption, width: number, height: number): Anchor {
  const a = typeof anchor === 'function' ? anchor(width, height) : anchor;
  return { x: Number.isFinite(a?.x) ? a.x : 0.5, y: Number.isFinite(a?.y) ? a.y : 0.5 };
}

export function glyphWeight(spec: GlyphSpec): number | undefined {
  return typeof spec === 'string' ? undefined : spec.weight;
}

export function normalizeWeights(raw: readonly (number | undefined)[]): number[] {
  const explicit = raw.map((w) => (w === undefined || !Number.isFinite(w) ? undefined : Math.max(0, w)));
  const fixed = explicit.reduce<number>((sum, w) => sum + (w ?? 0), 0);
  const free = explicit.filter((w) => w === undefined).length;
  const share = free ? (fixed < 1 ? (1 - fixed) / free : fixed / free) : 0;
  const weights = explicit.map((w) => w ?? share);
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return weights.map(() => 1 / weights.length);
  return weights.map((w) => w / total);
}

export const sameConstants = (a: Constants, b: Constants): boolean =>
  (Object.keys(a) as (keyof Constants)[]).every((key) => a[key] === b[key]);

const glyphKey = (spec: GlyphSpec): unknown[] => {
  if (typeof spec === 'string') return ['text', spec, undefined];
  if ('text' in spec) return ['text', spec.text, spec.weight];
  if ('shape' in spec) return ['shape', spec.shape, spec.weight];
  return ['image', spec.image, spec.weight, spec.tint];
};

export const sameGlyphs = (a: readonly GlyphSpec[], b: readonly GlyphSpec[]): boolean =>
  a === b ||
  (a.length === b.length &&
    a.every((spec, i) => {
      const x = glyphKey(spec);
      const y = glyphKey(b[i]);
      return x.every((v, j) => v === y[j]);
    }));
