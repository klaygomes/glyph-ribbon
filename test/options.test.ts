import { describe, expect, test } from 'vitest';
import {
  DEFAULT_GLYPHS,
  DEFAULT_OPTIONS,
  defaultAnchor,
  normalizeWeights,
  resolveAnchor,
  resolveOptions,
  sameGlyphs,
} from '../src/options.js';

describe('normalizeWeights', () => {
  test('unweighted glyphs share what explicit weights leave', () => {
    expect(normalizeWeights([0.15, undefined, undefined]).map((w) => +w.toFixed(3))).toEqual([0.15, 0.425, 0.425]);
  });

  test('all unweighted glyphs are equally likely', () => {
    expect(normalizeWeights([undefined, undefined, undefined, undefined])).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  test('explicit weights summing past 1 are normalised', () => {
    expect(normalizeWeights([2, 2])).toEqual([0.5, 0.5]);
  });

  test('negative and non-finite weights are treated safely', () => {
    const w = normalizeWeights([-1, Number.NaN, 1]);
    expect(w.every((v) => v >= 0)).toBe(true);
    expect(w.reduce((s, v) => s + v, 0)).toBeCloseTo(1);
  });
});

describe('resolveOptions', () => {
  test('defaults reproduce the original demo', () => {
    expect(resolveOptions()).toEqual(DEFAULT_OPTIONS);
    expect(DEFAULT_OPTIONS.glyphs).toBe(DEFAULT_GLYPHS);
  });

  test('partial timeline keeps unspecified ranges', () => {
    const t = resolveOptions({ timeline: { zoom: [0.2, 0.6] } }).timeline;
    expect(t.zoom).toEqual([0.2, 0.6]);
    expect(t.centre).toEqual(DEFAULT_OPTIONS.timeline.centre);
  });

  test('inverted timeline ranges are rejected', () => {
    expect(() => resolveOptions({ timeline: { scatter: [0.8, 0.2] } })).toThrow(RangeError);
  });

  test('maxGlyphs is clamped to a safe range', () => {
    expect(resolveOptions({ maxGlyphs: 1e9 }).maxGlyphs).toBe(20000);
    expect(resolveOptions({ maxGlyphs: -5 }).maxGlyphs).toBe(1);
  });

  test('advanced merges known constants and ignores unknown ones', () => {
    const a = resolveOptions({ advanced: { FOCAL: 3, NOPE: 1 } as never }).advanced;
    expect(a.FOCAL).toBe(3);
    expect('NOPE' in a).toBe(false);
  });

  test('later calls layer on top of earlier ones', () => {
    const first = resolveOptions({ seed: 5 });
    expect(resolveOptions({ speed: 0 }, first).seed).toBe(5);
  });

  test('invalid motion is rejected', () => {
    expect(() => resolveOptions({ motion: 'fast' as never })).toThrow(TypeError);
  });
});

describe('anchor', () => {
  test('default keeps the original 900px breakpoint', () => {
    expect(defaultAnchor(1280)).toEqual({ x: 0.62, y: 0.5 });
    expect(defaultAnchor(600)).toEqual({ x: 0.5, y: 0.68 });
  });

  test('accepts a value or a function', () => {
    expect(resolveAnchor({ x: 0.1, y: 0.2 }, 100, 100)).toEqual({ x: 0.1, y: 0.2 });
    expect(resolveAnchor((w, h) => ({ x: w / 1000, y: h / 1000 }), 300, 400)).toEqual({ x: 0.3, y: 0.4 });
  });
});

describe('sameGlyphs', () => {
  test('equal content compares equal across new arrays', () => {
    expect(sameGlyphs(['a', { text: 'b', weight: 1 }], ['a', { text: 'b', weight: 1 }])).toBe(true);
    expect(sameGlyphs(['a'], ['b'])).toBe(false);
  });
});
