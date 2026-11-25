import type { EngineConfig } from './engine.js';
import {
  resolveAnchor,
  resolveOptions,
  sameConstants,
  sameGlyphs,
  type GlyphRibbonOptions,
  type ResolvedOptions,
} from './options.js';
import { loadGlyphs, renderSprites, type GlyphSource } from './sprites.js';
import { Stage, type StageEvent, type StageMessage, type Viewport } from './stage.js';

export type RenderMode = 'pending' | 'worker' | 'main';
export type ProgressListener = (progress: number) => void;

export interface GlyphRibbon {
  readonly ready: Promise<void>;
  readonly mode: RenderMode;
  readonly progress: number;
  setProgress(progress: number): void;
  setOptions(options: GlyphRibbonOptions): void;
  on(event: 'progress', listener: ProgressListener): () => void;
  play(): void;
  pause(): void;
  refreshColor(): void;
  destroy(): void;
}

interface Backend {
  mode: 'worker' | 'main';
  post(message: StageMessage, transfer?: Transferable[]): void;
  close(): void;
}

const WORKER_TIMEOUT_MS = 5000;

const supportsOffscreen = (): boolean => {
  if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function') return false;
  if (!('transferControlToOffscreen' in HTMLCanvasElement.prototype)) return false;
  try {
    return new OffscreenCanvas(1, 1).getContext('2d') !== null;
  } catch {
    return false;
  }
};

function spawnWorker(onEvent: (event: StageEvent) => void): Promise<Worker | null> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    } catch {
      resolve(null);
      return;
    }
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      worker.removeEventListener('error', onError);
      if (!ok) worker.terminate();
      resolve(ok ? worker : null);
    };
    const onError = (event: Event) => {
      event.preventDefault();
      finish(false);
    };
    const timer = setTimeout(() => finish(false), WORKER_TIMEOUT_MS);
    worker.addEventListener('error', onError);
    worker.addEventListener('message', (event: MessageEvent<StageEvent>) => {
      if (event.data.type === 'hello') finish(true);
      else onEvent(event.data);
    });
  });
}

async function openBackend(
  canvas: HTMLCanvasElement,
  useWorker: boolean,
  onEvent: (event: StageEvent) => void,
): Promise<{ backend: Backend; surface: HTMLCanvasElement | OffscreenCanvas }> {
  if (useWorker && supportsOffscreen()) {
    const worker = await spawnWorker(onEvent);
    if (worker) {
      try {
        const surface = canvas.transferControlToOffscreen();
        return {
          surface,
          backend: {
            mode: 'worker',
            post: (message, transfer = []) => worker.postMessage(message, transfer),
            close: () => worker.terminate(),
          },
        };
      } catch {
        worker.terminate();
      }
    }
  }
  const stage = new Stage(onEvent);
  return {
    surface: canvas,
    backend: {
      mode: 'main',
      post: (message) => stage.handleMessage(message),
      close: () => stage.handleMessage({ type: 'destroy' }),
    },
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function createGlyphRibbon(canvas: HTMLCanvasElement, options: GlyphRibbonOptions = {}): GlyphRibbon {
  let opts = resolveOptions(options);
  let applied = opts;
  let destroyed = false;
  let playing = opts.autoplay;
  let visible = true;
  let target = 0;
  let progress = 0;
  let committed = Number.NaN;
  let backend: Backend | null = null;
  let mode: RenderMode = 'pending';
  let color = '';
  let sources: GlyphSource[] = [];
  let weights: number[] = [];
  let ink: number[] = [];
  let introAllowed = opts.intro;
  let running = false;
  let smoothHandle = 0;
  let lastTick = 0;
  let queue: Promise<void> = Promise.resolve();
  let applyQueued = false;
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => (resolveReady = resolve));
  const listeners = new Set<ProgressListener>();
  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const schemeQuery = matchMedia('(prefers-color-scheme: dark)');

  const isReduced = () => opts.motion === 'reduced' || (opts.motion === 'auto' && reducedQuery.matches);
  const smoothingMs = () => (isReduced() ? 0 : opts.smoothing);
  const readColor = () => opts.color || getComputedStyle(canvas).color || '#fff';
  const post = (message: StageMessage, transfer?: Transferable[]) => backend?.post(message, transfer);

  const viewport = (): Viewport => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    return {
      width,
      height,
      dpr: Math.min(globalThis.devicePixelRatio || 1, 2),
      anchor: resolveAnchor(opts.anchor, width, height),
    };
  };

  const engineConfig = (): EngineConfig => ({
    seed: opts.seed,
    maxGlyphs: opts.maxGlyphs,
    turns: opts.turns,
    speed: opts.speed,
    weights,
    ink,
    timeline: opts.timeline,
    intro: introAllowed,
    reduced: isReduced(),
    constants: opts.advanced,
  });

  const onStageEvent = (event: StageEvent) => {
    if (event.type === 'frame') resolveReady();
    else if (event.type === 'error') console.error(`glyph-ribbon: ${event.message}`);
  };

  const enqueue = (task: () => Promise<void>) => {
    queue = queue.then(task).catch((error: unknown) => console.error(error));
  };

  const updateRunning = () => {
    const next = playing && visible && !document.hidden;
    if (next === running) return;
    running = next;
    post({ type: 'running', running });
  };

  const commit = () => {
    if (progress === committed) return;
    committed = progress;
    post({ type: 'progress', progress });
    for (const listener of listeners) listener(progress);
  };

  const tick = (now: number) => {
    smoothHandle = 0;
    if (destroyed) return;
    const ms = smoothingMs();
    const dt = lastTick ? Math.min(64, now - lastTick) : 16;
    lastTick = now;
    progress = ms > 0 ? progress + (target - progress) * (1 - Math.exp(-dt / ms)) : target;
    if (Math.abs(target - progress) < 1e-4) progress = target;
    commit();
    if (progress !== target) smoothHandle = requestAnimationFrame(tick);
  };

  const setProgress = (value: number) => {
    if (destroyed) return;
    target = clamp01(Number(value) || 0);
    if (Number.isNaN(committed) || smoothingMs() === 0) {
      if (smoothHandle) cancelAnimationFrame(smoothHandle);
      smoothHandle = 0;
      progress = target;
      commit();
    } else if (!smoothHandle) {
      lastTick = 0;
      smoothHandle = requestAnimationFrame(tick);
    }
  };

  const recolor = () => {
    const next = readColor();
    if (next === color || !backend) return;
    color = next;
    enqueue(async () => {
      const rendered = await renderSprites(sources, color, opts.font);
      if (destroyed) return rendered.sprites.forEach((s) => s.close());
      post({ type: 'sprites', sprites: rendered.sprites }, rendered.sprites);
    });
  };

  const apply = async () => {
    applyQueued = false;
    const prev = applied;
    const next: ResolvedOptions = opts;
    applied = next;
    if (destroyed || !backend) return;
    let rebuild =
      prev.seed !== next.seed ||
      prev.maxGlyphs !== next.maxGlyphs ||
      prev.turns !== next.turns ||
      !sameConstants(prev.advanced, next.advanced);
    const glyphsChanged = !sameGlyphs(prev.glyphs, next.glyphs);
    if (glyphsChanged || prev.font !== next.font || prev.color !== next.color) {
      const loaded = await loadGlyphs(next.glyphs, next.font);
      color = readColor();
      const rendered = await renderSprites(loaded.sources, color, next.font);
      if (destroyed) return rendered.sprites.forEach((s) => s.close());
      sources = loaded.sources;
      weights = loaded.weights;
      rebuild ||= glyphsChanged || ink.some((v, i) => v !== rendered.ink[i]);
      ink = rendered.ink;
      post({ type: 'sprites', sprites: rendered.sprites }, rendered.sprites);
    }
    post({ type: 'config', config: engineConfig(), rebuild });
    if (prev.anchor !== next.anchor) post({ type: 'viewport', viewport: viewport() });
  };

  const setOptions = (input: GlyphRibbonOptions) => {
    if (destroyed) return;
    opts = resolveOptions(input, opts);
    if ('autoplay' in input && input.autoplay !== undefined) {
      playing = input.autoplay;
      updateRunning();
    }
    if (!applyQueued) {
      applyQueued = true;
      enqueue(apply);
    }
  };

  const resizeObserver = new ResizeObserver(() => {
    post({ type: 'viewport', viewport: viewport() });
    recolor();
  });
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    updateRunning();
  });
  const mutationObserver = new MutationObserver(() => recolor());
  const onVisibility = () => updateRunning();
  const onReducedChange = () => {
    if (opts.motion !== 'auto') return;
    post({ type: 'config', config: engineConfig(), rebuild: false });
    if (isReduced()) setProgress(target);
  };

  enqueue(async () => {
    const loaded = await loadGlyphs(opts.glyphs, opts.font);
    if (destroyed) return;
    sources = loaded.sources;
    weights = loaded.weights;
    color = readColor();
    const rendered = await renderSprites(sources, color, opts.font);
    ink = rendered.ink;
    const opened = await openBackend(canvas, opts.worker, onStageEvent);
    if (destroyed) {
      opened.backend.close();
      rendered.sprites.forEach((s) => s.close());
      return;
    }
    backend = opened.backend;
    mode = backend.mode;
    applied = opts;
    running = playing && visible && !document.hidden;
    const transfer: Transferable[] = [...rendered.sprites];
    if (opened.surface !== canvas) transfer.push(opened.surface as OffscreenCanvas);
    post(
      {
        type: 'init',
        canvas: opened.surface,
        config: engineConfig(),
        sprites: rendered.sprites,
        viewport: viewport(),
        progress,
        running,
      },
      transfer,
    );
    introAllowed = false;
    resizeObserver.observe(canvas);
    intersectionObserver.observe(canvas);
    mutationObserver.observe(canvas, { attributes: true, attributeFilter: ['class', 'style'] });
    document.addEventListener('visibilitychange', onVisibility);
    reducedQuery.addEventListener('change', onReducedChange);
    schemeQuery.addEventListener('change', recolor);
  });

  return {
    ready,
    get mode() {
      return mode;
    },
    get progress() {
      return progress;
    },
    setProgress,
    setOptions,
    on(_event, listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    play() {
      playing = true;
      updateRunning();
    },
    pause() {
      playing = false;
      updateRunning();
    },
    refreshColor: recolor,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (smoothHandle) cancelAnimationFrame(smoothHandle);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      mutationObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      reducedQuery.removeEventListener('change', onReducedChange);
      schemeQuery.removeEventListener('change', recolor);
      listeners.clear();
      post({ type: 'destroy' });
      backend?.close();
      backend = null;
    },
  };
}
