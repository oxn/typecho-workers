import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import rehypeRaw from 'rehype-raw';
import { renderMarkdown } from './index';

describe('Markdown Rehype safe SVG compatibility', () => {
  it('records the actual HAST property names used by raw SVG stroke attributes', async () => {
    const tree = await unified().use(rehypeRaw).run({
      type: 'root',
      children: [{ type: 'raw', value: '<svg><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 1"/></svg>' }],
    } as never);
    const svg = (tree as any).children[0];
    const path = svg.children[0];
    expect(path.properties).toBeTruthy();
  });

  it('recognizes all TeX delimiters inside mixed raw HTML content', async () => {
    const source = String.raw`<div class="callout"><p><strong>重点：</strong> $a^2+b^2=c^2$</p><p>另一种行内写法：\(\frac{1}{2}\)</p><p>块公式：\[x^2+y^2=z^2\]</p></div>`;
    const html = await renderMarkdown(source, { mathEngine: 'mathjax' });
    expect(html.match(/class="[^"]*language-math[^"]*"/g)).toHaveLength(3);
    expect(html).toContain('a^2+b^2=c^2');
    expect(html).toContain('\\frac{1}{2}');
    expect(html).toContain('x^2+y^2=z^2');
  });

  it('renders escaped inline and multiline display delimiters in ordinary Markdown', async () => {
    const source = String.raw`## 六、数学公式测试

### 行内公式

勾股定理：\(a^2+b^2=c^2\)。

欧拉公式：\(e^{i\pi}+1=0\)。

### 块级公式

二次方程求根公式：

\[
x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}
\]

积分公式：

\[
\int_0^1 x^2\,dx=\frac{1}{3}
\]

矩阵示例：

\[
A=
\begin{bmatrix}
1 & 2\\
3 & 4
\end{bmatrix}
\]`;
    const mathjaxHtml = await renderMarkdown(source, { mathEngine: 'mathjax' });
    expect(mathjaxHtml.match(/class="[^"]*language-math[^"]*"/g)).toHaveLength(5);
    expect(mathjaxHtml).toContain('a^2+b^2=c^2');
    expect(mathjaxHtml).toContain('frac{-b');
    expect(mathjaxHtml).toContain('begin{bmatrix}');

    const katexHtml = await renderMarkdown(source, { mathEngine: 'katex' });
    expect(katexHtml.match(/class="katex"/g)).toHaveLength(5);
    expect(katexHtml).toContain('katex-display');
    expect(katexHtml).not.toContain('language-math');
  });

  it('preserves escaped TeX delimiters literally inside fenced code', async () => {
    const source = ['\x60\x60\x60text', '\\(not math\\)', '\\[', 'not math', '\\]', '\x60\x60\x60'].join('\n');
    const html = await renderMarkdown(source, { mathEngine: 'katex' });
    expect(html).toContain('not math');
    expect(html).toMatch(/class="[^"]*language-text[^"]*"/);
    expect(html).not.toContain('class="katex"');
  });

  it('renders mixed raw HTML TeX through KaTeX instead of leaving source delimiters', async () => {
    const source = String.raw`<div class="callout"><p><strong>重点：</strong> $a^2+b^2=c^2$</p><p>另一种行内写法：\(\frac{1}{2}\)</p><p>块公式：\[x^2+y^2=z^2\]</p></div>`;
    const html = await renderMarkdown(source, { mathEngine: 'katex' });
    expect(html.match(/class="katex"/g)).toHaveLength(3);
    expect(html).toContain('katex-display');
    expect(html).not.toContain('language-math');
  });

  it('preserves mask/use/defs references and mask paint attributes', async () => {
    const html = await renderMarkdown(`
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 48 48">
  <defs><rect id="path_0" x="0" y="0" width="48" height="48"/></defs>
  <mask id="bg-mask-0" fill="white"><use xlink:href="#path_0"/></mask>
  <g mask="url(#bg-mask-0)"><path d="M0 0h48v48H0z" fill="#fff"/></g>
</svg>`);
    expect(html).toContain('<mask id="user-content-bg-mask-0" fill="white">');
    expect(html).toContain('id="user-content-path_0"');
    expect(html).toMatch(/(?:xlink:href|href)="#user-content-path_0"/);
    expect(html).toContain('mask="url(#user-content-bg-mask-0)"');
    expect(html).toContain('fill="#fff"');
  });

  it('preserves linear gradients, percentage coordinates and stop opacity', async () => {
    const html = await renderMarkdown(`
<svg viewBox="0 0 48 48">
  <defs><linearGradient id="linear_0" x1="50%" y1="100%" x2="51%" y2="0%" gradientUnits="objectBoundingBox">
    <stop offset="0" stop-color="#1176ff" stop-opacity="1"/>
    <stop offset="0.6163" stop-color="#23cbfd" stop-opacity="0.33"/>
    <stop offset="1" stop-color="#66e3ef" stop-opacity="0"/>
  </linearGradient></defs>
  <path d="M0 0h48v48H0z" fill="url(#linear_0)"/>
</svg>`);
    expect(html).toContain('<linearGradient id="user-content-linear_0"');
    expect(html).toContain('x1="50%"');
    expect(html).toContain('gradientUnits="objectBoundingBox"');
    expect(html).toContain('stop-color="#23cbfd"');
    expect(html).toContain('stop-opacity="0.33"');
    expect(html).toContain('fill="url(#user-content-linear_0)"');
  });

  it('preserves radial gradients, gradient transforms and gradient inheritance', async () => {
    const html = await renderMarkdown(`
<svg viewBox="0 0 48 48">
  <defs>
    <radialGradient id="base-gradient" cx="78.683%" cy="95.92%" fx="78.683%" fy="95.92%" r="0.18341" gradientTransform="translate(.78 .95) scale(.6 1) rotate(270)">
      <stop offset="0" stop-color="#a167b1"/>
      <stop offset="1" stop-color="#2878f8" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="derived-gradient" href="#base-gradient" fr="0.02"/>
  </defs>
  <path d="M0 0h48v48H0z" fill="url(#derived-gradient)"/>
</svg>`);
    expect(html).toContain('id="user-content-base-gradient"');
    expect(html).toContain('gradientTransform="translate(.78 .95) scale(.6 1) rotate(270)"');
    expect(html).toContain('id="user-content-derived-gradient"');
    expect(html).toContain('href="#user-content-base-gradient"');
    expect(html).toContain('fr="0.02"');
    expect(html).toContain('fill="url(#user-content-derived-gradient)"');
  });

  it('preserves common stroke, clipping, marker, pattern and filter attributes', async () => {
    const html = await renderMarkdown(`
<svg viewBox="0 0 24 24">
  <defs>
    <clipPath id="clip"><circle cx="12" cy="12" r="10"/></clipPath>
    <marker id="arrow" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto"><path d="M0 0L4 2L0 4z"/></marker>
    <pattern id="dots" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1"/></pattern>
    <filter id="soft"><feGaussianBlur stdDeviation="0.5"/></filter>
  </defs>
  <path d="M2 12L22 12" fill="none" stroke="url(#dots)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 1" clip-path="url(#clip)" marker-end="url(#arrow)" filter="url(#soft)"/>
</svg>`);
    expect(html).toContain('<clipPath id="user-content-clip">');
    expect(html).toContain('<marker id="user-content-arrow"');
    expect(html).toContain('<pattern id="user-content-dots"');
    expect(html).toContain('<filter id="user-content-soft"');
    expect(html).toContain('stroke-linecap="round"');
    expect(html).toContain('stroke-linejoin="round"');
    expect(html).toContain('stroke-dasharray="2 1"');
    expect(html).toContain('clip-path="url(#user-content-clip)"');
    expect(html).toContain('marker-end="url(#user-content-arrow)"');
    expect(html).toContain('filter="url(#user-content-soft)"');
  });

  it('rewrites Unicode fragment IDs and keeps safe SVG text elements', async () => {
    const html = await renderMarkdown(`
<svg viewBox="0 0 24 24" aria-labelledby="图标标题">
  <title id="图标标题">云盘图标</title>
  <text x="2" y="12" text-anchor="start" font-size="8"><tspan dx="1">云</tspan></text>
</svg>`);
    expect(html).toContain('id="user-content-图标标题"');
    expect(html).toContain('aria-labelledby="user-content-图标标题"');
    expect(html).toContain('<text');
    expect(html).toContain('<tspan');
    expect(html).toContain('text-anchor="start"');
  });

  it('rejects unsafe external SVG fragment references and active content', async () => {
    const html = await renderMarkdown(`
<svg onload="alert(1)">
  <use href="https://evil.example/icon.svg#x"/>
  <path d="M0 0" fill="url(javascript:alert(1))" onclick="alert(1)"/>
  <script>alert(1)</script>
</svg>`);
    expect(html).toContain('<svg');
    expect(html).toContain('<path d="M0 0"');
    expect(html).not.toContain(' onload=');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('<script');
  });
  it('preserves safe inline styles on links and nested colored spans inside Markdown alerts', async () => {
    const source = `<!-- # 红色警告 -->
> [!caution] 🟥 怸歪小站
> 怸歪小站建站与2011年11月19日，当时是因为CMP4建站，本着对互联网的热爱，一直坚持维护到现在。
> 站点分部：<a href="https://cycy.fun" target="_blank" rel="noopener noreferrer" style="font-weight:bold;word-break:break-all;text-decoration:none;font-size:16px;"><span style="color:#4285F4;">👆C</span><span style="color:#EA4335;">Y</span><span style="color:#FBBC05;">C</span></a> | <a href="https://347777.xyz" target="_blank" rel="noopener noreferrer" style="font-weight:bold;word-break:break-all;text-decoration:none;font-size:16px;"><span style="color:#4285F4;">👆3</span><span style="color:#EA4335;">4</span></a>
> YS168网盘：<a href="https://ago.ys168.com" target="_blank" rel="noopener noreferrer" style="font-weight:bold;color:var(--accent);word-break:break-all;">👆ago盘</a>`;
    const html = await renderMarkdown(source);
    expect(html).toContain('href="https://cycy.fun"');
    expect(html).toContain('style="font-weight:bold;word-break:break-all;text-decoration:none;font-size:16px;"');
    expect(html).toContain('style="color:#4285F4;"');
    expect(html).toContain('style="color:#EA4335;"');
    expect(html).toContain('style="font-weight:bold;color:var(--accent);word-break:break-all;"');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
  });

  it('preserves safe declarative countdown attributes through the Rehype sanitizer', async () => {
    const source = `<div class="countdown" data-countdown-target="2027-01-01T00:00:00">
  <span data-countdown-days>0</span> 天
  <span data-countdown-hours>00</span> 时
  <span data-countdown-minutes>00</span> 分
  <span data-countdown-seconds>00</span> 秒
</div>`;
    const html = await renderMarkdown(source);
    expect(html).toContain('data-countdown-target="2027-01-01T00:00:00"');
    expect(html).toContain('data-countdown-days');
    expect(html).toContain('data-countdown-hours');
    expect(html).toContain('data-countdown-minutes');
    expect(html).toContain('data-countdown-seconds');
    expect(html).not.toContain('<script');
  });


  it('applies legacy fragment dimensions to SVG and raster image URLs without losing other fragments', async () => {
    const html = await renderMarkdown([
      '![SVG](https://img.example/icon.svg#&width=48&height=48)',
      '![PNG](https://img.example/photo.png?token=abc#section&width=96)',
    ].join('\\n\\n'));
    expect(html).toContain('<img src="https://img.example/icon.svg" alt="SVG" width="48" height="48">');
    expect(html).toContain('src="https://img.example/photo.png?token=abc#section"');
    expect(html).toContain('alt="PNG" width="96"');
  });

  it('supports Markdown image attributes with numeric, pixel and percentage dimensions', async () => {
    const html = await renderMarkdown([
      '![Icon](https://img.example/icon.svg){width=48 height=48}',
      '![Banner](https://img.example/banner.webp){width=50% height=auto}',
      '![Pixel](https://img.example/pixel.png){width=64px}',
    ].join('\\n\\n'));
    expect(html).toContain('alt="Icon" width="48" height="48"');
    expect(html).toContain('alt="Banner" style="width:50%;height:auto"');
    expect(html).toContain('alt="Pixel" width="64"');
    expect(html).not.toContain('{width=');
  });

  it('preserves explicit HTML image dimensions and applies legacy fragment dimensions to raw HTML', async () => {
    const html = await renderMarkdown('<img src="https://img.example/a.svg" width="48" height="48" alt="HTML"><img src="https://img.example/b.jpg#&width=72" alt="Legacy HTML">');
    expect(html).toContain('src="https://img.example/a.svg" width="48" height="48" alt="HTML"');
    expect(html).toContain('src="https://img.example/b.jpg" alt="Legacy HTML" width="72"');
  });

  it('does not interpret unsafe or unrelated fragment parameters as dimensions', async () => {
    const html = await renderMarkdown('![Safe](https://img.example/a.svg#section&width=48&onload=alert(1)) ![Other](https://img.example/b.svg#height=48)');
    expect(html).toContain('src="https://img.example/a.svg#section&#x26;onload=alert(1)"');
    expect(html).toContain('width="48"');
    expect(html).toContain('src="https://img.example/b.svg"');
    expect(html).toContain('alt="Other" height="48"');
    expect(html).not.toMatch(/\sonload=/i);
  });

});
