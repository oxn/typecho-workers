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

describe('Markdown Rehype complex-content compatibility', () => {
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
