// Bundles the main process and the preload script (both CommonJS: sandboxed preloads can't be modules).
import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron'], sourcemap: true, logLevel: 'warning' };
await Promise.all([
  build({ ...common, entryPoints: ['src/main/index.ts'], outfile: 'dist/main.cjs' }),
  build({ ...common, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload.cjs' }),
]);
console.log('[desktop] built dist/main.cjs and dist/preload.cjs');
