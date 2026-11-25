# @klaygomes/glyph-ribbon

A high-performance canvas animation: a scroll-driven coil of glyphs, projected by hand. No baked frames, no WebGL.

**[Live demo and playground](https://www.estacouveflor.com/glyph-ribbon/)**

```bash
npm install @klaygomes/glyph-ribbon
```

## Use it

### Custom element (any framework, or none)

```html
<script type="module">import '@klaygomes/glyph-ribbon/element';</script>

<div class="pin" style="height: 260vh">
  <section style="position: sticky; top: 0; height: 100vh">
    <glyph-ribbon scroll-target=".pin" style="position: absolute; inset: 0; color: #f2f2f2"></glyph-ribbon>
  </section>
</div>
```

```jsx
// React 19
<glyph-ribbon progress={p} onprogress={(e) => setFade(e.detail)} />
```

### Core

```js
import { createGlyphRibbon } from '@klaygomes/glyph-ribbon';
import { bindScroll } from '@klaygomes/glyph-ribbon/scroll';

const ribbon = createGlyphRibbon(canvas, { glyphs: ['•', 'a', 'b'] });
const unbind = bindScroll(ribbon, document.querySelector('.pin'));
ribbon.on('progress', (p) => (headline.style.opacity = String(1 - p / 0.3)));

// or drive it yourself (GSAP, Lenis, a slider):
createGlyphRibbon(canvas, { smoothing: 0 }).setProgress(0.4);
```

## API

| Member | Description |
| --- | --- |
| `setProgress(p)` | Sets the target progress, `0..1`. Eased by `smoothing`. |
| `progress` | Current (eased) progress. |
| `on('progress', fn)` | Fires with eased progress; returns an unsubscribe function. |
| `setOptions(partial)` | Merges options. Changes to glyphs, seed, turns or `advanced` rebuild the packing. |
| `play()` / `pause()` | Starts or stops rendering. Also pauses automatically when offscreen or the tab is hidden. |
| `refreshColor()` | Re-reads CSS `color`. Needed only when it changes through means the ribbon cannot observe. |
| `destroy()` | Stops everything. The canvas cannot be reused; create a new one. |
| `ready` | Resolves after the first frame is drawn. |
| `mode` | `'worker'`, `'main'` or `'pending'`. |

## Options

| Option | Default | Notes |
| --- | --- | --- |
| `glyphs` | dot (0.15) + `t u n r s` | Strings, `{ text, weight }`, `{ image, weight, tint }` or `{ shape: 'dot', weight }`. Unweighted glyphs share the remaining weight. |
| `maxGlyphs` | `1400` | Clamped to `1..20000`. |
| `font` | `500 46px ui-monospace, …` | CSS font shorthand at the 64px sprite scale. |
| `color` | CSS `currentColor` | Text and tinted images only. |
| `seed` | `1337` | Same seed, same packing. |
| `speed` | `0.085` | Drift along the coil. |
| `turns` | `3.5` | |
| `anchor` | `w >= 900 ? {x:.62,y:.5} : {x:.5,y:.68}` | `{x, y}` fractions, or `(width, height) => {x, y}`. Where the coil starts before centring. |
| `timeline` | `centre [0,.45]`, `zoom [.05,.85]`, `scatter [.05,.85]` | Progress ranges for each phase. |
| `smoothing` | `220` | Easing time constant in ms; `0` when another library already smooths scroll. |
| `motion` | `'auto'` | `'auto'` follows `prefers-reduced-motion`. `'reduced'` keeps the coil still and dissolves it as progress grows. |
| `intro` | `true` | Load-in scatter. |
| `autoplay` | `true` | |
| `worker` | `true` | `false` forces main-thread rendering. |
| `advanced` | | Any internal constant (`FOCAL`, `WIDTH_NOISE`, …). Unstable: may change in any release. |

Element attributes: `glyphs`, `font`, `seed`, `speed`, `turns`, `max-glyphs`, `smoothing`, `motion`, `intro`, `autoplay`, `worker`, `scroll-target`. Everything else goes through the `options` property.

## Bundlers and CSP

The renderer loads `dist/worker.js` with `new Worker(new URL('./worker.js', import.meta.url))`. Vite, webpack 5, Parcel and Rollup pick it up. With Vite, add the package to `optimizeDeps.exclude`. The page needs `worker-src 'self'`. If the worker cannot load, rendering falls back to the main thread silently.

How it works inside: [docs/architecture.md](docs/architecture.md).

## Develop

```bash
npm install
npm run build && npm run dev   # demo and playground at http://127.0.0.1:4173
npm test                       # engine goldens and options
npm run test:e2e               # Playwright smoke test (worker and fallback)
```

MIT licensed.
