import { Engine, SPRITE, type Anchor, type EngineConfig, type Frame } from './engine.js';

export type Sprite = ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
type Surface = HTMLCanvasElement | OffscreenCanvas;
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface Viewport {
  width: number;
  height: number;
  dpr: number;
  anchor: Anchor;
}

export type StageMessage =
  | {
      type: 'init';
      canvas: Surface;
      config: EngineConfig;
      sprites: Sprite[];
      viewport: Viewport;
      progress: number;
      running: boolean;
    }
  | { type: 'viewport'; viewport: Viewport }
  | { type: 'progress'; progress: number }
  | { type: 'sprites'; sprites: Sprite[] }
  | { type: 'config'; config: EngineConfig; rebuild: boolean }
  | { type: 'running'; running: boolean }
  | { type: 'destroy' };

export type StageEvent = { type: 'hello' } | { type: 'frame' } | { type: 'error'; message: string };

const schedule: (cb: (now: number) => void) => number =
  typeof requestAnimationFrame === 'function'
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
const unschedule: (id: number) => void =
  typeof cancelAnimationFrame === 'function' ? (id) => cancelAnimationFrame(id) : (id) => clearTimeout(id);

export function drawFrame(ctx: Context, frame: Frame, sprites: readonly Sprite[], dpr: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const { order, drawn, glyph, x, y, size, alpha, visibility, rot } = frame;
  let identity = true;
  for (let q = 0; q < frame.count; q++) {
    const n = order[q];
    if (!drawn[n]) continue;
    const sprite = sprites[glyph[n]];
    if (!sprite) continue;
    ctx.globalAlpha = alpha[n] * visibility[n];
    if (rot[n] === 0) {
      if (!identity) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        identity = true;
      }
      const s = dpr * size[n];
      ctx.drawImage(sprite, dpr * x[n] - s / 2, dpr * y[n] - s / 2, s, s);
    } else {
      const m = (dpr * size[n]) / SPRITE;
      const rc = Math.cos(rot[n]) * m;
      const rs = Math.sin(rot[n]) * m;
      ctx.setTransform(rc, rs, -rs, rc, dpr * x[n], dpr * y[n]);
      ctx.drawImage(sprite, -SPRITE / 2, -SPRITE / 2, SPRITE, SPRITE);
      identity = false;
    }
  }
  ctx.globalAlpha = 1;
}

const release = (sprites: readonly Sprite[]) => {
  for (const s of sprites) if ('close' in s && typeof s.close === 'function') s.close();
};

export class Stage {
  private canvas: Surface | null = null;
  private ctx: Context | null = null;
  private engine: Engine | null = null;
  private sprites: Sprite[] = [];
  private viewport: Viewport = { width: 1, height: 1, dpr: 1, anchor: { x: 0.5, y: 0.5 } };
  private progress = 0;
  private running = false;
  private handle = 0;
  private last = 0;
  private firstFrame = true;

  constructor(private readonly emit: (event: StageEvent) => void) {}

  handleMessage(message: StageMessage): void {
    switch (message.type) {
      case 'init':
        this.canvas = message.canvas;
        this.ctx = message.canvas.getContext('2d') as Context | null;
        if (!this.ctx) throw new Error('glyph-ribbon: 2D canvas context unavailable');
        this.sprites = message.sprites;
        this.progress = message.progress;
        this.engine = new Engine(message.config);
        this.applyViewport(message.viewport);
        this.setRunning(message.running);
        break;
      case 'viewport':
        this.applyViewport(message.viewport);
        break;
      case 'progress':
        this.progress = message.progress;
        this.invalidate();
        break;
      case 'sprites':
        release(this.sprites);
        this.sprites = message.sprites;
        this.invalidate();
        break;
      case 'config':
        if (message.rebuild || !this.engine) {
          this.engine = new Engine(message.config);
          this.engine.resize(this.viewport.width, this.viewport.height);
        } else {
          this.engine.setRuntime(message.config);
        }
        this.invalidate();
        break;
      case 'running':
        this.setRunning(message.running);
        break;
      case 'destroy':
        this.setRunning(false);
        release(this.sprites);
        this.sprites = [];
        this.engine = null;
        this.ctx = null;
        this.canvas = null;
        break;
    }
  }

  private applyViewport(viewport: Viewport): void {
    this.viewport = viewport;
    if (this.canvas) {
      this.canvas.width = Math.max(1, Math.round(viewport.width * viewport.dpr));
      this.canvas.height = Math.max(1, Math.round(viewport.height * viewport.dpr));
    }
    this.engine?.resize(viewport.width, viewport.height);
    this.invalidate();
  }

  private setRunning(running: boolean): void {
    this.running = running;
    if (running) {
      this.last = 0;
      this.invalidate();
    } else if (this.handle) {
      unschedule(this.handle);
      this.handle = 0;
    }
  }

  private invalidate(): void {
    if (this.running && !this.handle && this.engine) this.handle = schedule(this.tick);
  }

  private tick = (now: number): void => {
    this.handle = 0;
    const engine = this.engine;
    const ctx = this.ctx;
    if (!this.running || !engine || !ctx) return;
    const dt = this.last ? now - this.last : 0;
    this.last = now;
    drawFrame(ctx, engine.step(dt, this.progress, this.viewport.anchor), this.sprites, this.viewport.dpr);
    if (this.firstFrame) {
      this.firstFrame = false;
      this.emit({ type: 'frame' });
    }
    if (!engine.reduced) this.invalidate();
  };
}
