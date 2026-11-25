export interface ProgressTarget {
  setProgress(progress: number): void;
}

export interface BindScrollOptions {
  root?: Element | Window;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function bindScroll(target: ProgressTarget, pin: Element, options: BindScrollOptions = {}): () => void {
  const root = options.root ?? window;
  const isWindow = root === window;
  let frame = 0;

  const update = () => {
    frame = 0;
    const rect = pin.getBoundingClientRect();
    const viewportTop = isWindow ? 0 : (root as Element).getBoundingClientRect().top;
    const viewportHeight = isWindow ? window.innerHeight : (root as Element).clientHeight;
    const range = Math.max(1, rect.height - viewportHeight);
    target.setProgress(clamp01((viewportTop - rect.top) / range));
  };
  const request = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };

  const resizeObserver = new ResizeObserver(request);
  resizeObserver.observe(pin);
  root.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', request, { passive: true });
  update();

  return () => {
    if (frame) cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    root.removeEventListener('scroll', request);
    window.removeEventListener('resize', request);
  };
}
