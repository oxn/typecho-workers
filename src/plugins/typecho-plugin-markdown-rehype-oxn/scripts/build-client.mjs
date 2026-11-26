import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
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
    outfile: join(outputDir, entry.slice(0, -3) + '.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: false,
    sourcemap: false,
    logLevel: 'warning',
  });
  console.log(`[markdown-rehype-oxn] Built client/${entry} → client/dist/${entry.slice(0, -3)}.js`);
}

// KaTeX CSS is served inline by the plugin. Inline its font files too, so
// browsers never request fonts from public/, a CDN, or the article URL.
const katexCssPath = require.resolve('katex/dist/katex.min.css');
const katexCss = await readFile(katexCssPath, 'utf8');
const fontCache = new Map();
const inlineKatexCss = await replaceAsync(
  katexCss,
  /url\((['"]?)(fonts\/[^)'"]+)\1\)/g,
  async (_match, _quote, relativeFont) => {
    if (!fontCache.has(relativeFont)) {
      const fontPath = join(dirname(katexCssPath), relativeFont);
      const font = await readFile(fontPath);
      const mime = ({
        '.woff2': 'font/woff2',
        '.woff': 'font/woff',
        '.ttf': 'font/ttf',
      })[extname(fontPath)] || 'application/octet-stream';
      fontCache.set(relativeFont, `url(data:${mime};base64,${font.toString('base64')})`);
    }
    return fontCache.get(relativeFont);
  },
);
await writeFile(join(outputDir, 'katex-inline.css'), inlineKatexCss, 'utf8');
console.log('[markdown-rehype-oxn] Built plugin-local KaTeX CSS with embedded fonts');

async function replaceAsync(input, pattern, replacer) {
  const matches = [...input.matchAll(pattern)];
  if (!matches.length) return input;
  let output = '';
  let offset = 0;
  for (const match of matches) {
    output += input.slice(offset, match.index);
    output += await replacer(...match);
    offset = match.index + match[0].length;
  }
  return output + input.slice(offset);
}
