import { describe, expect, it } from 'vitest';
import {
  createBoundedConcurrencyGate,
  MarkdownRenderCapacityError,
  PreviewRequestBodyTooLargeError,
  readPreviewRequestBodyText,
  renderMarkdown,
} from './index';

describe('Markdown Rehype render cache compatibility', () => {
  it('keeps cached output isolated when the math engine changes for identical source', async () => {
    const source = '公式：$x^2 + y^2 = z^2$';

    const katex = await renderMarkdown(source, { mathEngine: 'katex' });
    const mathjax = await renderMarkdown(source, { mathEngine: 'mathjax' });
    const katexAgain = await renderMarkdown(source, { mathEngine: 'katex' });

    expect(katex).toContain('class="katex"');
    expect(mathjax).toContain('language-math');
    expect(mathjax).not.toContain('class="katex"');
    expect(katexAgain).toBe(katex);
  });

  it('keeps TOC-enabled and TOC-disabled output isolated for identical source', async () => {
    const source = '# 示例文章\n\n## 目录\n\n## 第一章\n\n正文内容。';

    const withoutToc = await renderMarkdown(source, {
      mathEngine: 'mathjax',
      tocEnabled: false,
    });
    const withToc = await renderMarkdown(source, {
      mathEngine: 'mathjax',
      tocEnabled: true,
    });

    expect(withToc).not.toBe(withoutToc);
    expect(withToc).toContain('<ul>');
    expect(withoutToc).not.toContain('<ul>');
  });
});


describe('Markdown preview request protection', () => {
  it('reads UTF-8 request bodies within the byte limit', async () => {
    const body = JSON.stringify({ text: '公式与中文内容' });
    const request = new Request('https://example.test/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    await expect(readPreviewRequestBodyText(request, new TextEncoder().encode(body).byteLength))
      .resolves.toBe(body);
  });

  it('rejects an oversized declared Content-Length before reading the body', async () => {
    const request = new Request('https://example.test/preview', {
      method: 'POST',
      headers: { 'Content-Length': '1024' },
    });

    await expect(readPreviewRequestBodyText(request, 128))
      .rejects.toBeInstanceOf(PreviewRequestBodyTooLargeError);
  });

  it('rejects a streamed request body as soon as its byte limit is exceeded', async () => {
    const request = new Request('https://example.test/preview', {
      method: 'POST',
      body: 'x'.repeat(256),
    });

    await expect(readPreviewRequestBodyText(request, 128))
      .rejects.toBeInstanceOf(PreviewRequestBodyTooLargeError);
  });

  it('limits distinct render tasks and rejects excess queued work', async () => {
    const run = createBoundedConcurrencyGate(1, 1, 1_000);
    let active = 0;
    let maximumActive = 0;
    let releaseFirst!: () => void;
    let signalFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { signalFirstStarted = resolve; });
    const firstHold = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = run(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      signalFirstStarted();
      await firstHold;
      active -= 1;
      return 'first';
    });
    await firstStarted;

    const second = run(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      active -= 1;
      return 'second';
    });

    await expect(run(async () => 'third')).rejects.toBeInstanceOf(MarkdownRenderCapacityError);
    releaseFirst();

    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(maximumActive).toBe(1);
  });

  it('releases the render slot when a task rejects', async () => {
    const run = createBoundedConcurrencyGate(1, 1, 1_000);
    await expect(run(async () => { throw new Error('render failed'); }))
      .rejects.toThrow('render failed');
    await expect(run(async () => 'slot-released')).resolves.toBe('slot-released');
  });

  it('removes a queued task when its maximum wait expires', async () => {
    const run = createBoundedConcurrencyGate(1, 1, 10);
    let releaseFirst!: () => void;
    let signalFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { signalFirstStarted = resolve; });
    const firstHold = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = run(async () => {
      signalFirstStarted();
      await firstHold;
    });
    await firstStarted;
    const waiting = run(async () => 'waiting');

    await expect(waiting).rejects.toBeInstanceOf(MarkdownRenderCapacityError);
    releaseFirst();
    await expect(first).resolves.toBeUndefined();
    await expect(run(async () => 'after-timeout')).resolves.toBe('after-timeout');
  });
});

describe('Markdown image BlurHash compatibility', () => {
  it('extracts encoded BlurHash and dimensions before sanitizing the image URL', async () => {
    const html = await renderMarkdown(
      '![markdown.webp](https://cdn.jsdelivr.net/gh/xoxx/xoxx/img/rin/markdown.webp#blurhash=LfLp%7Bl%2509GXo.T-S%251tSIWj%3Dt7f9&width=1536&height=1024)',
      { mathEngine: 'mathjax' },
    );

    expect(html).toContain('src="https://cdn.jsdelivr.net/gh/xoxx/xoxx/img/rin/markdown.webp"');
    expect(html).toContain('data-blurhash="LfLp{l%09GXo.T-S%1tSIWj=t7f9"');
    expect(html).toContain('width="1536"');
    expect(html).toContain('height="1024"');
    expect(html).not.toContain('#blurhash=');
  });
});

describe('Markdown Rehype sanitizer safety', () => {
  it('removes raw style elements but preserves supported inline style attributes', async () => {
    const html = await renderMarkdown(
      '<style>.unsafe-article-rule { display: none }</style>\n\n<div style="color: red">保留内联样式</div>',
      { mathEngine: 'katex' },
    );

    expect(html).not.toContain('<style');
    expect(html).not.toContain('.unsafe-article-rule');
    expect(html).toContain('style="color: red"');
    expect(html).toContain('保留内联样式');
  });
});

describe('Markdown Rehype complex-content compatibility', () => {
  it('preserves Mermaid labels containing HTML-sensitive characters as diagram text', async () => {
    const source = [
      '```mermaid',
      'flowchart TD',
      '  A["x < y & y > z"] --> B["<b>普通文本</b>"]',
      '```',
    ].join('\n');
    const html = await renderMarkdown(source, { mathEngine: 'katex' });

    expect(html).toContain('x &lt; y &amp; y &gt; z');
    expect(html).toContain('&lt;b&gt;普通文本&lt;/b&gt;');
    expect(html).not.toContain('<b>普通文本</b>');
    expect(html).toContain('mermaid_default');
    expect(html).toContain('mermaid_dark');
  });

  it('keeps multiple real-world Mermaid diagram types as literal text in both theme variants', async () => {
    const source = [
      '```mermaid',
      'graph LR',
      '  A[GraphCommand] --> B[update] --> C[goto] --> D[send]',
      '```',
      '',
      '```mermaid',
      'graph TD',
      '  A[开始] --> B[结束]',
      '```',
      '',
      '```mermaid',
      'pie',
      '  title Mineral composition',
      '  "Calcium" : 40',
      '  "Potassium" : 30',
      '  "Magnesium" : 20',
      '  "Iron" : 10',
      '```',
      '',
      '```mermaid',
      'pie',
      '  title 中文矿物分类',
      '  "钙" : 40',
      '  "钾" : 30',
      '  "镁" : 20',
      '  "铁" : 10',
      '```',
    ].join('\n');

    const html = await renderMarkdown(source, { mathEngine: 'katex' });

    expect(html.match(/class="mermaid_default dark:hidden"/g)).toHaveLength(4);
    expect(html.match(/class="mermaid_dark dark:block hidden"/g)).toHaveLength(4);
    expect(html).toContain('GraphCommand');
    expect(html).toContain('Potassium');
    expect(html).toContain('中文矿物分类');
    expect(html).toContain('钙');
  });

  it('preserves Mermaid mindmap hierarchy with the native layout', async () => {
    const source = [
      '```mermaid',
      'mindmap',
      '  root((Warm CY))',
      '    一级节点',
      '      节点<br/>说明',
      '\u00a0\u00a0二级节点',
      '\u3000\u3000三级节点',
      '```',
    ].join('\n');

    const html = await renderMarkdown(source, { mathEngine: 'katex' });

    expect(html.match(/class="mermaid_default dark:hidden"/g)).toHaveLength(1);
    expect(html.match(/class="mermaid_dark dark:block hidden"/g)).toHaveLength(1);
    expect(html).toContain('root((Warm CY))');
    expect(html).toContain('    一级节点');
    expect(html).toContain('&lt;br/&gt;');
    expect(html).toContain('<pre class="mermaid_default dark:hidden">');
    expect(html).toContain('<pre class="mermaid_dark dark:block hidden">');
    expect(html).toContain('        二级节点');
    expect(html).toContain('        三级节点');
    expect(html).not.toContain('layout: tidy-tree');
  });

  it('keeps math, highlighting, Mermaid variants, raw HTML and GFM output in one full render', async () => {
    const codeBlocks = Array.from({ length: 12 }, (_, index) =>
      '\x60\x60\x60ts\nconst item' + index + ' = ' + index + ';\n\x60\x60\x60',
    ).join('\n\n');
    const formulas = Array.from({ length: 12 }, (_, index) =>
      '公式 ' + index + '：$x_' + index + '^2 + y^2 = z^2$',
    ).join('\n\n');
    const source = [
      '# 复杂内容回归',
      formulas,
      codeBlocks,
      '\x60\x60\x60mermaid\nflowchart TD\n  A[开始] --> B[结束]\n\x60\x60\x60',
      '<div class="custom-block" style="color: red"><span>原始 HTML</span></div>',
      '| 名称 | 值 |',
      '| --- | --- |',
      '| alpha | 1 |',
      '| beta | 2 |',
    ].join('\n\n');

    const html = await renderMarkdown(source, { mathEngine: 'katex', tocEnabled: true });

    expect(html).toContain('class="katex"');
    expect(html).toContain('language-ts');
    expect(html).toContain('mermaid_default');
    expect(html).toContain('mermaid_dark');
    expect(html).toContain('<div');
    expect(html).toContain('<table>');
    expect(html).toContain('item11');
    expect(html).toContain('beta');
  });
});
