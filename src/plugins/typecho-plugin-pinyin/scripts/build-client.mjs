import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = resolve(pluginDir, 'client', 'dist');

await mkdir(outputDir, { recursive: true });
await build({
  entryPoints: [resolve(pluginDir, 'browser', 'pinyin-editor.ts')],
  outfile: resolve(outputDir, 'pinyin-editor.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  sourcemap: false,
  logLevel: 'warning',
});
console.log('[typecho-plugin-pinyin] Built client/dist/pinyin-editor.js');
