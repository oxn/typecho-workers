import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './index';

describe('Markdown Rehype render cache compatibility', () => {
  it('keeps cached output isolated when the math engine changes for identical source', async () => {
    const source = String.raw`公式：\\(x^2 + y^2 = z^2\\)`;

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
