import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import rehypeRaw from 'rehype-raw';
import { renderMarkdown } from './index';

describe('Rin Markdown KaTeX and SVG compatibility', () => {
  it('records the HAST property names used by raw SVG stroke attributes', async () => {
    const tree = await unified().use(rehypeRaw).run({
      type: 'root',
      children: [{ type: 'raw', value: '<svg><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 1"/></svg>' }],
    } as never);
    const svg = (tree as any).children[0];
    const path = svg.children[0];
    expect(path.properties).toBeTruthy();
    expect(path.properties.strokeWidth).toBe('2');
    expect(path.properties.strokeLinecap).toBe('round');
  });

  it('renders TeX delimiters in mixed raw HTML through the fixed KaTeX pipeline', async () => {
    const source = '<div class="callout"><p><strong>重点：</strong> $a^2+b^2=c^2$</p><p>另一种行内写法：\\(\\frac{1}{2}\\)</p><p>块公式：\\[x^2+y^2=z^2\\]</p></div>';
    const html = await renderMarkdown(source);
    expect(html.match(/class="katex"/g)?.length).toBe(3);
    expect(html).toContain('katex-display');
    expect(html).not.toContain('language-math');
  });

  it('renders inline and multiline display math in ordinary Markdown', async () => {
    const source = [
      '## 数学公式测试',
      '',
      '行内公式：\\(a^2+b^2=c^2\\)。',
      '',
      '欧拉公式：\\(e^{i\\pi}+1=0\\)。',
      '',
      '块级公式：',
      '',
      '\\[',
      'x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}',
      '\\]',
      '',
      '积分公式：',
      '',
      '\\[',
      '\\int_0^1 x^2\\,dx=\\frac{1}{3}',
      '\\]',
      '',
      '矩阵示例：',
      '',
      '\\[',
      'A=',
      '\\begin{bmatrix}',
      '1 & 2\\\\',
      '3 & 4',
      '\\end{bmatrix}',
      '\\]',
    ].join('\n');
    const html = await renderMarkdown(source);
    expect(html.match(/class="katex"/g)?.length).toBe(5);
    expect(html).toContain('katex-display');
    expect(html).not.toContain('language-math');
  });

  it('preserves TeX delimiters literally inside fenced code', async () => {
    const source = ['```text', '\\(not math\\)', '\\[', 'not math', '\\]', '```'].join('\n');
    const html = await renderMarkdown(source);
    expect(html).toContain('not math');
    expect(html).toMatch(/class="[^"]*language-text[^"]*"/);
    expect(html).not.toContain('class="katex"');
  });

  it('preserves authored SVG structure, identifiers and presentation attributes', async () => {
    const source = [
      '<svg viewBox="0 0 48 48" aria-labelledby="图标标题">',
      '  <title id="图标标题">云盘图标</title>',
      '  <defs><linearGradient id="linear_0" x1="50%" y1="100%" x2="51%" y2="0%"><stop offset="0" stop-color="#1176ff"/><stop offset="1" stop-color="#66e3ef"/></linearGradient></defs>',
      '  <path d="M0 0h48v48H0z" fill="url(#linear_0)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
      '</svg>',
    ].join('\n');
    const html = await renderMarkdown(source);
    expect(html).toContain('<svg');
    expect(html).toContain('id="图标标题"');
    expect(html).toContain('id="linear_0"');
    expect(html).toContain('aria-labelledby="图标标题"');
    expect(html).toContain('stop-color="#1176ff"');
    expect(html).toContain('stroke-linecap="round"');
    expect(html).toContain('fill="url(#linear_0)"');
  });
});