import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });

const shared = { bundle: true, format: 'esm', target: 'es2022', sourcemap: true, outdir: 'dist', logLevel: 'info' };

await build({
  ...shared,
  entryPoints: { index: 'src/index.ts', element: 'src/element.ts', scroll: 'src/scroll.ts' },
  splitting: true,
  chunkNames: 'chunk-[hash]',
});
await build({ ...shared, entryPoints: { worker: 'src/worker.ts' } });
