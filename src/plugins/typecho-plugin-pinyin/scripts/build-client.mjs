import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = resolve(pluginDir, 'client', 'dist');

await mkdir(outputDir, { recursive: true });

const result = await Bun.build({
  entrypoints: [resolve(pluginDir, 'browser', 'pinyin-editor.ts')],
  outdir: outputDir,
  target: 'browser',
  minify: true,
  sourcemap: 'none',
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error('拼音插件客户端资源构建失败');
}

console.log('[typecho-plugin-pinyin] Built client/dist/pinyin-editor.js');
