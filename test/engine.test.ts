import { describe, expect, test } from 'vitest';
import { DEFAULT_CONSTANTS, computeFrame, type Frame, type FrameRequest } from '../src/engine.js';

const VIEW = { width: 1280, height: 800, anchor: { x: 0.62, y: 0.5 } };

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

function digest(frame: Frame) {
  const drawn: number[] = [];
  for (let q = 0; q < frame.count; q++) if (frame.drawn[frame.order[q]]) drawn.push(frame.order[q]);
  const sum = (arr: Float32Array) => round(drawn.reduce((s, n) => s + arr[n], 0), 1);
  return {
    count: frame.count,
    drawn: drawn.length,
    sumX: sum(frame.x),
    sumY: sum(frame.y),
    sumAlpha: sum(frame.alpha),
    sample: drawn.slice(0, 8).map((n) => [n, frame.glyph[n], round(frame.x[n], 1), round(frame.y[n], 1), round(frame.size[n], 2)]),
  };
}

const frame = (request: Partial<FrameRequest>) => computeFrame({ ...VIEW, timeMs: 2000, progress: 0, ...request });

describe('golden frames', () => {
  test.each([0, 0.25, 0.5, 1])('progress %s', (progress) => {
    expect(digest(frame({ progress }))).toMatchSnapshot();
  });

  test('reduced motion at progress 0.5', () => {
    expect(digest(frame({ progress: 0.5, config: { reduced: true } }))).toMatchSnapshot();
  });
});

describe('determinism', () => {
  test('same seed produces identical frames', () => {
    expect(digest(frame({ progress: 0.3 }))).toEqual(digest(frame({ progress: 0.3 })));
  });

  test('a different seed produces a different packing', () => {
    expect(digest(frame({ config: { seed: 7 } }))).not.toEqual(digest(frame({})));
  });

  test('maxGlyphs caps the packing', () => {
    expect(frame({ config: { maxGlyphs: 200 } }).count).toBe(200);
  });
});

describe('occlusion', () => {
  test('no two fully visible glyphs on the same plane overlap', () => {
    const f = frame({ progress: 0 });
    const live: number[] = [];
    for (let n = 0; n < f.count; n++) if (f.drawn[n] && f.visibility[n] === 1 && f.alpha[n] >= 0.125) live.push(n);
    expect(live.length).toBeGreaterThan(100);
    let overlaps = 0;
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i];
        const b = live[j];
        if (Math.abs(f.z[a] - f.z[b]) > DEFAULT_CONSTANTS.PLANE_NEAR) continue;
        const gap = Math.hypot(f.x[a] - f.x[b], f.y[a] - f.y[b]) - f.radius[a] - f.radius[b];
        if (gap <= 0) overlaps++;
      }
    }
    expect(overlaps).toBe(0);
  });
});

describe('reduced motion', () => {
  const positions = (f: Frame) => {
    const out = new Map<number, [number, number]>();
    for (let n = 0; n < f.count; n++) if (f.drawn[n]) out.set(n, [f.x[n], f.y[n]]);
    return out;
  };

  test('glyphs never move as progress changes', () => {
    const start = positions(frame({ progress: 0, config: { reduced: true } }));
    const later = positions(frame({ progress: 0.6, config: { reduced: true } }));
    expect(later.size).toBeGreaterThan(0);
    for (const [n, xy] of later) expect(start.get(n) ?? xy).toEqual(xy);
  });

  test('glyphs never move over time', () => {
    const early = positions(frame({ timeMs: 0, config: { reduced: true } }));
    const late = positions(frame({ timeMs: 3000, config: { reduced: true } }));
    expect(late).toEqual(early);
  });

  test('progress dissolves glyphs until none are left', () => {
    const count = (p: number) => {
      const f = frame({ progress: p, config: { reduced: true } });
      return f.drawn.reduce((s, d) => s + d, 0);
    };
    const [a, b, c] = [count(0), count(0.45), count(1)];
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBe(0);
  });
});
