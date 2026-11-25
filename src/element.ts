import { createGlyphRibbon, type GlyphRibbon } from './core.js';
import type { GlyphRibbonOptions, GlyphSpec, Motion } from './options.js';
import { bindScroll } from './scroll.js';

const CSS = ':host{display:block;position:relative;contain:layout paint}canvas{position:absolute;inset:0;width:100%;height:100%;display:block}';

const ATTRIBUTES = [
  'glyphs',
  'font',
  'seed',
  'speed',
  'turns',
  'max-glyphs',
  'smoothing',
  'motion',
  'intro',
  'autoplay',
  'worker',
  'scroll-target',
] as const;

const Base = (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) as typeof HTMLElement;

const number = (value: string | null): number | undefined => {
  if (value === null || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};
const flag = (value: string | null): boolean | undefined => (value === null ? undefined : value !== 'false');

function splitGlyphs(text: string): GlyphSpec[] {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  const parts = Segmenter
    ? Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment)
    : Array.from(text);
  return parts.filter((g) => g.trim() !== '');
}

export class GlyphRibbonElement extends Base {
  static readonly observedAttributes = ATTRIBUTES;

  private instance: GlyphRibbon | null = null;
  private unbindScroll: (() => void) | null = null;
  private hostObserver: MutationObserver | null = null;
  private extra: GlyphRibbonOptions = {};
  private pendingProgress: number | null = null;

  get ribbon(): GlyphRibbon | null {
    return this.instance;
  }

  get options(): GlyphRibbonOptions {
    return { ...this.attributeOptions(), ...this.extra };
  }

  set options(value: GlyphRibbonOptions) {
    this.extra = { ...value };
    this.instance?.setOptions(this.options);
  }

  get progress(): number {
    return this.instance?.progress ?? this.pendingProgress ?? 0;
  }

  set progress(value: number) {
    if (this.instance) this.instance.setProgress(value);
    else this.pendingProgress = value;
  }

  connectedCallback(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    if (!root.adoptedStyleSheets.length && 'replaceSync' in CSSStyleSheet.prototype) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
    }
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    root.replaceChildren(canvas);

    const ribbon = createGlyphRibbon(canvas, this.options);
    this.instance = ribbon;
    ribbon.on('progress', (detail) => this.dispatchEvent(new CustomEvent('progress', { detail })));
    if (this.pendingProgress !== null) {
      ribbon.setProgress(this.pendingProgress);
      this.pendingProgress = null;
    }
    this.hostObserver = new MutationObserver(() => ribbon.refreshColor());
    this.hostObserver.observe(this, { attributes: true, attributeFilter: ['class', 'style'] });
    this.bindScrollTarget();
  }

  disconnectedCallback(): void {
    this.unbindScroll?.();
    this.unbindScroll = null;
    this.hostObserver?.disconnect();
    this.hostObserver = null;
    if (this.instance) this.pendingProgress = this.instance.progress;
    this.instance?.destroy();
    this.instance = null;
  }

  attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
    if (!this.instance || previous === next) return;
    if (name === 'scroll-target') this.bindScrollTarget();
    else this.instance.setOptions(this.options);
  }

  private bindScrollTarget(): void {
    this.unbindScroll?.();
    this.unbindScroll = null;
    const selector = this.getAttribute('scroll-target');
    if (!selector || !this.instance) return;
    const pin = this.closest(selector) ?? document.querySelector(selector);
    if (pin) this.unbindScroll = bindScroll(this.instance, pin);
    else console.warn(`glyph-ribbon: scroll-target "${selector}" matched no element`);
  }

  private attributeOptions(): GlyphRibbonOptions {
    const out: GlyphRibbonOptions = {};
    const glyphs = this.getAttribute('glyphs');
    if (glyphs) out.glyphs = splitGlyphs(glyphs);
    const font = this.getAttribute('font');
    if (font) out.font = font;
    out.seed = number(this.getAttribute('seed'));
    out.speed = number(this.getAttribute('speed'));
    out.turns = number(this.getAttribute('turns'));
    out.maxGlyphs = number(this.getAttribute('max-glyphs'));
    out.smoothing = number(this.getAttribute('smoothing'));
    const motion = this.getAttribute('motion');
    if (motion === 'auto' || motion === 'full' || motion === 'reduced') out.motion = motion satisfies Motion;
    out.intro = flag(this.getAttribute('intro'));
    out.autoplay = flag(this.getAttribute('autoplay'));
    out.worker = flag(this.getAttribute('worker'));
    for (const key of Object.keys(out) as (keyof GlyphRibbonOptions)[]) if (out[key] === undefined) delete out[key];
    return out;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('glyph-ribbon')) {
  customElements.define('glyph-ribbon', GlyphRibbonElement);
}

declare global {
  interface HTMLElementTagNameMap {
    'glyph-ribbon': GlyphRibbonElement;
  }
}
