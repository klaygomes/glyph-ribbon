export type Range = readonly [number, number];

export interface Timeline {
  centre: Range;
  zoom: Range;
  scatter: Range;
}

export interface Anchor {
  x: number;
  y: number;
}

export const DEFAULT_TIMELINE: Timeline = {
  centre: [0, 0.45],
  zoom: [0.05, 0.85],
  scatter: [0.05, 0.85],
};

export const DEFAULT_CONSTANTS = {
  HALF: 1,
  BAND_RATIO: 0.2,
  RADIUS: 0.33,
  SQUARE: 0.97,
  VIEW_TILT: 0.04,
  FOCAL: 2.4,
  WIDTH_NOISE: 0.38,
  BAND_NOISE: 0.35,
  STRAND_FREQ: 0.5,
  AXIS_NOISE: 0.07,
  WALL_JITTER: 0.1,
  FADE_START: 0.62,
  PLANE_NEAR: 0.02,
  PLANE_FAR: 0.045,
  GAP: 0.004,
  SHEAR: 0.45,
  DARTS: 60000,
  VIS_MS: 90,
  ZOOM: 1.6,
  GLYPH_PX: 11,
  INTRO_MS: 1600,
  SPREAD: 0.7,
  CELL_MIN: 6,
  PAD: 40,
};

export type Constants = { [K in keyof typeof DEFAULT_CONSTANTS]: number };

export const DEFAULT_INK: readonly number[] = [0.21, 0.3, 0.27, 0.27, 0.26, 0.25];
export const DEFAULT_WEIGHTS: readonly number[] = [0.15, 0.17, 0.17, 0.17, 0.17, 0.17];

export const SPRITE = 64;
export const MAX_GLYPHS_LIMIT = 20000;

export interface EngineConfig {
  seed: number;
  maxGlyphs: number;
  turns: number;
  speed: number;
  weights: readonly number[];
  ink: readonly number[];
  timeline: Timeline;
  intro: boolean;
  reduced: boolean;
  constants: Constants;
}

export interface Frame {
  readonly count: number;
  readonly order: Uint32Array;
  readonly drawn: Uint8Array;
  readonly glyph: Uint16Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly size: Float32Array;
  readonly radius: Float32Array;
  readonly alpha: Float32Array;
  readonly visibility: Float32Array;
  readonly rot: Float32Array;
}

interface Point {
  arc: number;
  band: number;
  wall: number;
  glyph: number;
  sizeMul: number;
  alphaMul: number;
  dx: number;
  dy: number;
  spin: number;
  delay: number;
  rank: number;
}

const TAU = Math.PI * 2;
const STEPS = 8192;
const STRIDE = 8;
const FINE = STEPS * 4;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number) => {
  v = clamp01(v);
  return v * v * (3 - 2 * v);
};
const smoother = (v: number) => {
  v = clamp01(v);
  return v * v * v * (v * (6 * v - 15) + 10);
};
const easeInOut = (v: number) => {
  if (v < 0.5) return 4 * v * v * v;
  const u = 2 - 2 * v;
  return 1 - (u * u * u) / 2;
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const span = (p: number, [a, b]: Range) => clamp01((p - a) / (b - a));

const gradient = (i: number) => {
  let h = Math.imul(i, 374761393);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h & 0xffff) / 0xffff) * 2 - 1;
};
const perlin = (x: number) => {
  const i = Math.floor(x);
  const f = x - i;
  const a = gradient(i) * f;
  const b = gradient(i + 1) * (f - 1);
  return 2 * (a + (b - a) * f * f * f * (f * (f * 6 - 15) + 10));
};
const fbm = (x: number, offset: number) => 0.65 * perlin(x + offset) + 0.35 * perlin(2.03 * x + offset + 17.3);

export function createRandom(seed: number): () => number {
  let state = (Math.abs(Math.trunc(seed)) % 2147483646) + 1;
  return () => (state = (state * 16807) % 2147483647) / 2147483647;
}

export function defaultEngineConfig(): EngineConfig {
  return {
    seed: 1337,
    maxGlyphs: 1400,
    turns: 3.5,
    speed: 0.085,
    weights: DEFAULT_WEIGHTS,
    ink: DEFAULT_INK,
    timeline: DEFAULT_TIMELINE,
    intro: true,
    reduced: false,
    constants: { ...DEFAULT_CONSTANTS },
  };
}

export class Engine {
  readonly frame: Frame;
  private cfg: EngineConfig;
  private readonly c: Constants;
  private readonly coil: Float32Array;
  private readonly arcLength: number;
  private readonly points: Point[];
  private readonly next: Int32Array;
  private readonly band: number;
  private readonly glyphWorld: number;
  private heads = new Int32Array(0);
  private width = 1;
  private height = 1;
  private time = 0;
  private elapsed = 0;

  constructor(config: EngineConfig) {
    this.cfg = config;
    this.c = config.constants;
    const c = this.c;
    const turns = config.turns;
    const pitch = (2 * c.HALF) / turns;
    this.band = c.BAND_RATIO * pitch;
    this.glyphWorld = c.GLYPH_PX / (900 * 0.42);
    const phiMax = turns * TAU;
    const asinSquare = Math.asin(c.SQUARE);

    const sweep = (phi: number) => Math.asin(c.SQUARE * Math.sin(phi)) / asinSquare;
    const radiusAt = (y: number) =>
      c.RADIUS *
      (1 - 0.72 * Math.exp(-(((y - 0.05) / 0.13) ** 2))) *
      (0.7 + 0.3 * smooth((c.HALF - Math.abs(y)) / 0.35));
    const heightOf = (phi: number) => -c.HALF + (pitch * phi) / TAU;
    const spineRadius = (yc: number) => radiusAt(yc) * (1 + c.WIDTH_NOISE * fbm(yc * 2.4, 3.1));
    const spineAxis = (yc: number) => c.AXIS_NOISE * fbm(yc * 1.6, 23.9);

    const travelled = new Float64Array(FINE + 1);
    for (let i = 0, prevX = 0, prevY = 0; i <= FINE; i++) {
      const phi = (i * phiMax) / FINE;
      const yc = heightOf(phi);
      const r = spineRadius(yc);
      const depth = Math.cos(phi);
      const k = c.FOCAL / (c.FOCAL - depth * r);
      const x = (spineAxis(yc) + r * sweep(phi)) * k;
      const y = (yc - c.VIEW_TILT * r * depth) * k;
      if (i) travelled[i] = travelled[i - 1] + Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
      prevX = x;
      prevY = y;
    }
    const arcLength = travelled[FINE];
    this.arcLength = arcLength;

    const coil = new Float32Array((STEPS + 1) * STRIDE);
    for (let i = 0, j = 0; i <= STEPS; i++) {
      const target = (i * arcLength) / STEPS;
      while (j < FINE - 1 && travelled[j + 1] < target) j++;
      const seg = travelled[j + 1] - travelled[j];
      const phi = ((j + (target - travelled[j]) / seg) * phiMax) / FINE;
      const yc = heightOf(phi);
      const o = i * STRIDE;
      coil[o] = yc;
      coil[o + 1] = spineRadius(yc);
      coil[o + 2] = this.band * Math.max(0.15, 1 + c.BAND_NOISE * 2 * fbm(phi * c.STRAND_FREQ, 11.7));
      coil[o + 3] = this.band * Math.max(0.15, 1 + c.BAND_NOISE * 2 * fbm(phi * c.STRAND_FREQ, 41.3));
      coil[o + 4] = spineAxis(yc);
      coil[o + 5] = sweep(phi);
      coil[o + 6] = Math.cos(phi);
      coil[o + 7] = smooth((c.HALF - Math.abs(yc)) / 0.22);
    }
    this.coil = coil;

    this.points = this.pack(createRandom(config.seed));
    const n = this.points.length;
    const order = Uint32Array.from(
      this.points.map((_, i) => i).sort((a, b) => this.points[a].rank - this.points[b].rank),
    );
    const glyph = Uint16Array.from(this.points.map((p) => p.glyph));
    this.next = new Int32Array(n);
    this.frame = {
      count: n,
      order,
      drawn: new Uint8Array(n),
      glyph,
      x: new Float32Array(n),
      y: new Float32Array(n),
      z: new Float32Array(n),
      size: new Float32Array(n),
      radius: new Float32Array(n),
      alpha: new Float32Array(n),
      visibility: new Float32Array(n).fill(1),
      rot: new Float32Array(n),
    };
  }

  get reduced(): boolean {
    return this.cfg.reduced;
  }

  setRuntime(config: EngineConfig): void {
    this.cfg = { ...this.cfg, speed: config.speed, timeline: config.timeline, reduced: config.reduced };
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const { CELL_MIN, PAD } = this.c;
    this.heads = new Int32Array(
      (Math.ceil((this.width + 2 * PAD) / CELL_MIN) + 1) * (Math.ceil((this.height + 2 * PAD) / CELL_MIN) + 1),
    );
  }

  private pack(rand: () => number): Point[] {
    const c = this.c;
    const { weights, ink, maxGlyphs } = this.cfg;
    const arcLength = this.arcLength;
    const band = this.band;
    const cumulative: number[] = [];
    let total = 0;
    for (const w of weights) cumulative.push((total += w));
    const pick = (r: number) => {
      const t = r * total;
      for (let i = 0; i < cumulative.length; i++) if (t < cumulative[i]) return i;
      return cumulative.length - 1;
    };

    const maxInk = Math.max(...ink);
    const reach = 2 * maxInk * 1.25 * this.glyphWorld + c.GAP;
    const cellsA = Math.max(1, Math.floor(arcLength / reach));
    const cellsB = Math.max(1, Math.ceil((2 * band) / reach));
    const cellA = arcLength / cellsA;
    const buckets: { arc: number; across: number; reach: number }[][] = Array.from(
      { length: cellsA * cellsB },
      () => [],
    );
    const points: Point[] = [];

    for (let dart = 0; dart < c.DARTS && points.length < maxGlyphs; dart++) {
      const arc = rand() * arcLength;
      const bandPos = rand() * 2 - 1;
      const glyph = pick(rand());
      const sheetEdge = smooth((Math.abs(bandPos) - 0.55) / 0.45);
      const sizeMul = (0.75 + 0.5 * rand()) * (1 - 0.3 * sheetEdge);
      const r = ink[glyph] * sizeMul * this.glyphWorld;
      const across = (bandPos + 1) * band;
      const ca = Math.min(cellsA - 1, Math.floor(arc / cellA));
      const cb = Math.min(cellsB - 1, Math.floor(across / reach));
      let free = true;
      for (let db = -1; db <= 1 && free; db++) {
        const b = cb + db;
        if (b < 0 || b >= cellsB) continue;
        for (let da = -1; da <= 1 && free; da++) {
          for (const q of buckets[b * cellsA + ((ca + da + cellsA) % cellsA)]) {
            let u = Math.abs(arc - q.arc);
            if (u > arcLength / 2) u = arcLength - u;
            const v = Math.abs(across - q.across);
            const need = r + q.reach + c.GAP;
            if (u * u + v * v - 2 * c.SHEAR * u * v < need * need) {
              free = false;
              break;
            }
          }
        }
      }
      if (!free) continue;
      const heading = rand() * TAU;
      const speed = 0.6 + 1.1 * rand();
      points.push({
        arc,
        band: bandPos,
        glyph,
        sizeMul,
        wall: Math.max(-1, Math.min(1, 2.2 * fbm(arc * 5 + bandPos * 1.7, 71.9))),
        alphaMul: 1 - 0.85 * sheetEdge,
        dx: Math.cos(heading) * speed,
        dy: Math.sin(heading) * speed - 0.35,
        spin: 3 * (rand() - 0.5),
        delay: 0.45 * rand(),
        rank: rand(),
      });
      buckets[cb * cellsA + ca].push({ arc, across, reach: r });
    }
    return points;
  }

  step(dtMs: number, progress: number, anchor: Anchor): Frame {
    const c = this.c;
    const cfg = this.cfg;
    const reduced = cfg.reduced;
    const coil = this.coil;
    const arcLength = this.arcLength;
    const points = this.points;
    const f = this.frame;
    const N = f.count;
    const W = this.width;
    const H = this.height;
    const PAD = c.PAD;

    const dt = Math.min(64, Math.max(0, dtMs));
    const seconds = reduced ? 0 : dt / 1000;
    this.time += seconds;
    this.elapsed += dt;
    const P = clamp01(progress);
    const tl = cfg.timeline;

    const intro = reduced || !cfg.intro ? 0 : 1 - smoother(this.elapsed / c.INTRO_MS);
    const scatter = reduced ? 0 : Math.max(smooth(span(P, tl.scatter)), intro);
    const zoom = reduced ? 1 : 1 + c.ZOOM * easeInOut(smooth(span(P, tl.zoom)));
    const centre = reduced ? 0 : easeInOut(span(P, tl.centre));
    const dissolve = reduced ? span(P, tl.scatter) : 0;
    const cx = lerp(anchor.x * W, W / 2, centre);
    const cy = lerp(anchor.y * H, H / 2, centre);
    const scale = Math.min(W, H) * 0.42 * zoom;
    const spread = c.SPREAD * Math.sqrt(W * W + H * H);
    const glyphPx = c.GLYPH_PX * Math.sqrt(zoom) * Math.max(0.8, Math.min(W, H) / 900);
    const spinRate = 1 + 0.3 * this.time;
    const travel = cfg.speed * seconds;
    const fadeTop = c.FADE_START * H;
    const fadeSpan = (1 - c.FADE_START) * H;
    const settle = reduced ? 1 : 1 - Math.exp(-dt / c.VIS_MS);
    const ink = cfg.ink;

    const { x: gX, y: gY, z: gZ, size: gSize, radius: gRad, alpha: gAlpha, rot: gRot, drawn, visibility: vis } = f;
    let maxRad = 0;

    for (let n = 0; n < N; n++) {
      const p = points[n];
      if (travel) {
        p.arc += travel;
        if (p.arc >= arcLength) p.arc -= arcLength;
      }

      const t = (p.arc / arcLength) * STEPS;
      const i = t >= STEPS ? STEPS - 1 : t | 0;
      const fr = t - i;
      const o = i * STRIDE;
      const m = o + STRIDE;
      const yc = coil[o] + (coil[m] - coil[o]) * fr;
      const r = (coil[o + 1] + (coil[m + 1] - coil[o + 1]) * fr) * (1 + c.WALL_JITTER * p.wall);
      const s = p.band >= 0 ? 2 : 3;
      const thickness = coil[o + s] + (coil[m + s] - coil[o + s]) * fr;
      const axis = coil[o + 4] + (coil[m + 4] - coil[o + 4]) * fr;
      const sw = coil[o + 5] + (coil[m + 5] - coil[o + 5]) * fr;
      const depth = coil[o + 6] + (coil[m + 6] - coil[o + 6]) * fr;
      const ends = coil[o + 7] + (coil[m + 7] - coil[o + 7]) * fr;
      const k = c.FOCAL / (c.FOCAL - depth * r);

      const fog = smooth((0.25 - depth) / 1.1);
      let X = cx + (axis + r * sw) * k * scale;
      let Y = cy - (yc + thickness * p.band - c.VIEW_TILT * r * depth) * k * scale;
      let alpha = (1 - 0.65 * fog) * p.alphaMul * ends;
      let size = glyphPx * p.sizeMul * k * (1 - 0.3 * fog) * (0.6 + 0.4 * ends);
      let rot = 0;

      if (scatter > 0) {
        const a = smooth((scatter - p.delay) / (1 - p.delay));
        X += p.dx * spread * a;
        Y += p.dy * spread * a;
        rot = p.spin * a * spinRate;
        size *= 1 + 0.6 * a;
        alpha *= 1 - 0.7 * a;
      }
      if (dissolve > 0) alpha *= clamp01((1 - p.rank - dissolve * 1.1 + 0.1) / 0.1);

      drawn[n] = 0;
      if (Y > fadeTop) alpha *= clamp01((H - Y) / fadeSpan);
      if (alpha < 0.01 || X < -PAD || X > W + PAD || Y < -PAD || Y > H + PAD) {
        gAlpha[n] = 0;
        continue;
      }

      const rad = ink[p.glyph] * size;
      if (rad > maxRad) maxRad = rad;
      gX[n] = X;
      gY[n] = Y;
      gZ[n] = depth * r;
      gRad[n] = rad;
      gSize[n] = size;
      gAlpha[n] = alpha;
      gRot[n] = rot;
    }

    const clear = 0.9 * c.GAP * scale;
    const cell = Math.max(c.CELL_MIN, 2 * maxRad + clear);
    const cols = Math.ceil((W + 2 * PAD) / cell) + 1;
    const rows = Math.ceil((H + 2 * PAD) / cell) + 1;
    const heads = this.heads;
    const next = this.next;
    heads.fill(-1, 0, cols * rows);

    for (let q = 0; q < N; q++) {
      const n = f.order[q];
      if (gAlpha[n] === 0) continue;
      const X = gX[n];
      const Y = gY[n];
      const Z = gZ[n];
      const rad = gRad[n];
      const col = ((X + PAD) / cell) | 0;
      const row = ((Y + PAD) / cell) | 0;
      const c0 = col > 0 ? col - 1 : 0;
      const c1 = col < cols - 1 ? col + 1 : col;
      const r0 = row > 0 ? row - 1 : 0;
      const r1 = row < rows - 1 ? row + 1 : row;

      let open = 1;
      for (let rr = r0; rr <= r1; rr++) {
        for (let cc = c0; cc <= c1; cc++) {
          for (let b = heads[rr * cols + cc]; b >= 0; b = next[b]) {
            let dz = Z - gZ[b];
            if (dz < 0) dz = -dz;
            if (dz >= c.PLANE_FAR) continue;
            const ddx = X - gX[b];
            const ddy = Y - gY[b];
            const gap = Math.sqrt(ddx * ddx + ddy * ddy) - rad - gRad[b];
            if (gap >= clear) continue;
            const block =
              vis[b] *
              (gAlpha[b] < 0.125 ? gAlpha[b] * 8 : 1) *
              (dz <= c.PLANE_NEAR ? 1 : (c.PLANE_FAR - dz) / (c.PLANE_FAR - c.PLANE_NEAR)) *
              (gap <= 0 ? 1 : 1 - gap / clear);
            if (1 - block < open) open = 1 - block;
          }
        }
      }

      let v = vis[n];
      v = open < v ? open : v + (open - v) * settle;
      if (v < 0.01) v = 0;
      else if (v > 0.99) v = 1;
      vis[n] = v;
      if (v === 0) continue;

      const slot = row * cols + col;
      next[n] = heads[slot];
      heads[slot] = n;
      drawn[n] = 1;
    }
    return f;
  }
}

export interface FrameRequest {
  timeMs: number;
  progress: number;
  width: number;
  height: number;
  anchor?: Anchor;
  config?: Partial<EngineConfig>;
}

export function computeFrame(request: FrameRequest): Frame {
  const engine = new Engine({ ...defaultEngineConfig(), ...request.config });
  const anchor = request.anchor ?? { x: 0.5, y: 0.5 };
  engine.resize(request.width, request.height);
  let frame = engine.step(0, request.progress, anchor);
  for (let t = 0; t < request.timeMs; t += 16) frame = engine.step(16, request.progress, anchor);
  return frame;
}
