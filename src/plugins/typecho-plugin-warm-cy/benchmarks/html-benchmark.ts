import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import {
  inlineHtmlRuntimeLight,
  protectInlineHtmlLight,
  restoreInlineHtmlFragmentsLight,
} from '../html-light';
import {
  inlineHtmlRuntime,
  protectInlineHtml,
  restoreInlineHtmlFragments,
} from '../html-full';

type Mode = 'light' | 'full';
type Stage = 'protect' | 'restore' | 'pipeline' | 'runtime';
type Sample = { mode: Mode; stage: Stage; case: string; medianMs: number; p95Ms: number; iterations: number; inputBytes: number; outputBytes: number; outputSha256: string };

const cases: Array<{ name: string; source: string }> = [
  {
    name: 'plain-markdown',
    source: '# 普通文章\n\n这是一篇没有 HTML 标签的普通文章。\n\n- 列表一\n- 列表二\n\n```ts\nconst answer = 42;\n```\n',
  },
  {
    name: 'short-inline-html',
    source: '# 短文章\n\n<span class="note" style="color:red">短 HTML 片段</span>\n',
  },
  {
    name: 'long-article',
    source: Array.from({ length: 80 }, (_, i) => `## 第 ${i + 1} 节\n\n这是用于测量长文章 Markdown 路径的正文内容，包含普通文本、**强调**和列表。\n\n- 条目 A ${i}\n- 条目 B ${i}\n`).join('\n'),
  },
  {
    name: 'complex-html',
    source: '<div class="card" style="display:flex;gap:12px"><style>.card{display:flex;animation:fade 1s}</style><strong>复杂卡片</strong><svg viewBox="0 0 24 24"><path d="M1 1h22v22H1z"/></svg><a href="https://example.com" style="color:blue">链接</a><script>window.cyExample = true</script></div>\n',
  },
  {
    name: 'multi-container-html',
    source: Array.from({ length: 24 }, (_, i) => `<div class="panel panel-${i}" data-index="${i}" style="padding:12px"><h3>面板 ${i}</h3><p>内容 ${i}</p></div>`).join('\n\n'),
  },
];

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
};
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const ITERATIONS = Number(process.env.CY_HTML_BENCH_ITERATIONS || 250);
const WARMUPS = Number(process.env.CY_HTML_BENCH_WARMUPS || 30);

function functions(mode: Mode) {
  return mode === 'light'
    ? { protect: protectInlineHtmlLight, restore: restoreInlineHtmlFragmentsLight, runtime: () => inlineHtmlRuntimeLight(true) }
    : { protect: protectInlineHtml, restore: restoreInlineHtmlFragments, runtime: () => inlineHtmlRuntime() };
}

function pipeline(mode: Mode, source: string): string {
  const impl = functions(mode);
  const protectedSource = impl.protect(source);
  const markdown = marked.parse(protectedSource, { async: false }) as string;
  return impl.restore(sanitizeHtml(markdown));
}

function measure(mode: Mode, stage: Stage, caseName: string, input: string, fn: () => string): Sample {
  for (let i = 0; i < WARMUPS; i++) fn();
  const timings: number[] = [];
  let output = '';
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    output = fn();
    timings.push(performance.now() - start);
  }
  return {
    mode, stage, case: caseName,
    medianMs: Number(percentile(timings, 0.5).toFixed(4)),
    p95Ms: Number(percentile(timings, 0.95).toFixed(4)),
    iterations: ITERATIONS,
    inputBytes: bytes(input),
    outputBytes: bytes(output),
    outputSha256: sha256(output),
  };
}

const results: Sample[] = [];
const parity: Array<{ case: string; sameOutput: boolean; lightSha256: string; fullSha256: string }> = [];
for (const item of cases) {
  const lightOutput = pipeline('light', item.source);
  const fullOutput = pipeline('full', item.source);
  parity.push({
    case: item.name,
    sameOutput: lightOutput === fullOutput,
    lightSha256: sha256(lightOutput),
    fullSha256: sha256(fullOutput),
  });

  for (const mode of ['light', 'full'] as const) {
    const impl = functions(mode);
    const protectedInput = impl.protect(item.source);
    const markdown = marked.parse(protectedInput, { async: false }) as string;
    const sanitized = sanitizeHtml(markdown);
    results.push(measure(mode, 'protect', item.name, item.source, () => impl.protect(item.source)));
    results.push(measure(mode, 'restore', item.name, sanitized, () => impl.restore(sanitized)));
    results.push(measure(mode, 'pipeline', item.name, item.source, () => pipeline(mode, item.source)));
  }
}
for (const mode of ['light', 'full'] as const) {
  results.push(measure(mode, 'runtime', 'runtime-generation', '', () => functions(mode).runtime()));
}

const report = {
  generatedAt: new Date().toISOString(),
  runtime: { bun: process.versions.bun || null, node: process.version, platform: process.platform, arch: process.arch },
  note: 'CI Node/Bun benchmark of the actual plugin functions; not a Cloudflare Workers or browser end-to-end benchmark. Light/full output parity is reported, not assumed.',
  warmups: WARMUPS,
  iterations: ITERATIONS,
  parity,
  results,
};
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/warm-cy-html-benchmark.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (parity.some(item => !item.sameOutput)) {
  throw new Error('Light/full HTML output differs for one or more benchmark fixtures; inspect the report.');
}
