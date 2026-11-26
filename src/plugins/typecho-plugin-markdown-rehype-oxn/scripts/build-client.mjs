import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDir = join(pluginDir, 'client', 'src');
const outputDir = join(pluginDir, 'client', 'dist');

await mkdir(outputDir, { recursive: true });

for (const entry of [
  'rehype-runtime.ts',
  'math-runtime.ts',
  'mermaid-runtime.ts',
  'highlight-runtime.ts',
]) {
  await build({
    entryPoints: [join(sourceDir, entry)],
    outfile: join(outputDir, entry.replace(/\\.ts$/, '.js')),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: false,
    sourcemap: false,
    logLevel: 'warning',
  });
  console.log(`[markdown-rehype-oxn] Built client/${entry} → client/dist/${entry.replace(/\\.ts$/, '.js')}`);
}
