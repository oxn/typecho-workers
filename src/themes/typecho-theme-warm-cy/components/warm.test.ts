import { describe, expect, it } from 'vitest';
import { renderMarkdown } from 'typecho-plugin-markdown-rehype';
import { getWarmMermaidConfig } from 'typecho-plugin-markdown-rehype/mermaid-config';
import { optimizeContentImages, parseImageFragment } from './warm-image';
import {
  isCurrentPageLink,
  normalizeCommentComponentLoadMode,
  normalizeCommentInitialLoadMode,
  normalizeContinuousLoadMode,
  parsePinnedIds,
  renderWarmIframes,
  renderArticleDeclaration,
  renderFooterCustomHtml,
  warmArticleSummary,
  plainExcerpt,
  prepareArticleToc,
  readingMinutes,
  safeEmail,
  safeExternalUrl,
  warmSettings,
} from './warm';

describe('Warm CY theme helpers', () => {
  it('parses the exact basic Mermaid flowchart emitted by the Rehype pipeline', async () => {
    const diagram = [
      'flowchart TD',
      '    A[开始] --> B{条件判断}',
      '    B -->|是| C[执行操作]',
      '    B -->|否| D[跳过]',
      '    C --> E[结束]',
      '    D --> E',
    ].join('\n');
    const html = await renderMarkdown('```mermaid\n' + diagram + '\n```');
    const lightMarker = '<pre class="mermaid_default dark:hidden">';
    const darkMarker = '<pre class="mermaid_dark dark:block hidden">';
    const lightStart = html.indexOf(lightMarker);
    const lightEnd = html.indexOf('</pre>', lightStart + lightMarker.length);
    const darkStart = html.indexOf(darkMarker);
    const darkEnd = html.indexOf('</pre>', darkStart + darkMarker.length);
    expect(lightStart).toBeGreaterThanOrEqual(0);
    expect(lightEnd).toBeGreaterThan(lightStart);
    expect(darkStart).toBeGreaterThanOrEqual(0);
    expect(darkEnd).toBeGreaterThan(darkStart);
    const renderedSource = html.slice(lightStart + lightMarker.length, lightEnd);
    const darkSource = html.slice(darkStart + darkMarker.length, darkEnd);
    expect(renderedSource.trim()).toBe(diagram);
    expect(darkSource.trim()).toBe(diagram);
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    try {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
      Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
      const { default: mermaid } = await import('mermaid');
      for (const config of [getWarmMermaidConfig(false), getWarmMermaidConfig(true)]) {
        mermaid.initialize({ ...config, securityLevel: 'strict' });
        await expect(mermaid.parse(renderedSource)).resolves.toBeTruthy();
      }
    } finally {
      dom.window.close();
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else delete (globalThis as any).window;
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
      else delete (globalThis as any).document;
    }
  });
  it('parses unique positive pinned content IDs', () => {
    expect(parsePinnedIds('12, 8，12 0 -3 9007199254740992 invalid')).toEqual([12, 8]);
    expect(parsePinnedIds(7)).toEqual([7]);
    expect(parsePinnedIds(null)).toEqual([]);
  });

  it('normalizes loading modes and rejects unknown values', () => {
    expect(normalizeContinuousLoadMode('infinite')).toBe('infinite');
    expect(normalizeContinuousLoadMode('unknown')).toBe('manual');
    expect(normalizeCommentComponentLoadMode('dwell')).toBe('dwell');
    expect(normalizeCommentComponentLoadMode('unknown')).toBe('manual');
    expect(normalizeCommentInitialLoadMode('dwell-auto-2')).toBe('auto-2');
    expect(normalizeCommentInitialLoadMode('unknown')).toBe('manual');
  });

  it('accepts safe external URLs and rejects unsupported protocols', () => {
    expect(safeExternalUrl('example.com/docs')).toBe('https://example.com/docs');
    expect(safeExternalUrl('//example.com/path')).toBe('https://example.com/path');
    expect(safeExternalUrl('/about')).toBe('/about');
    expect(safeExternalUrl('mailto:hello@example.com')).toBe('mailto:hello@example.com');
    expect(safeExternalUrl('javascript:alert(1)')).toBe('');
    expect(safeExternalUrl('ftp://example.com/file')).toBe('');
  });

  it('matches navigation pages by exact normalized path', () => {
    expect(isCurrentPageLink('https://example.com/about/', '/about', 'https://example.com')).toBe(true);
    expect(isCurrentPageLink('/about', '/about/', 'https://example.com')).toBe(true);
    expect(isCurrentPageLink('/about-me/', '/about', 'https://example.com')).toBe(false);
    expect(isCurrentPageLink('https://other.example/about/', '/about', 'https://example.com')).toBe(false);
  });

  it('validates email addresses', () => {
    expect(safeEmail('hello@example.com')).toBe('hello@example.com');
    expect(safeEmail('not-an-email')).toBe('');
    expect(safeEmail('')).toBe('');
  });

  it('loads namespaced settings and preserves legacy comment mode', () => {
    const options = {
      'theme:typecho-theme-warm-cy': JSON.stringify({
        pinnedIds: '12, 8, 12',
        footerCustomHtml: '<strong>footer</strong>',
        articleDeclarationHtml: '<p>{post.title}</p>',
        linktxt01: 'Docs',
        links01: 'example.com/docs',
        linkblank01: '1',
        imageOptimizeParams: 'quality=80',
        commentInitialLoadMode: 'dwell',
      }),
    };
    const settings = warmSettings(options as never);
    expect(settings.pinnedIds).toEqual([12, 8]);
    expect(settings.footerCustomHtml).toBe('<strong>footer</strong>');
    expect(settings.articleDeclarationHtml).toBe('<p>{post.title}</p>');
    expect(settings.footerLinks).toEqual([
      { text: 'Docs', url: 'https://example.com/docs', newWindow: true },
    ]);
    expect(settings.commentComponentLoadMode).toBe('dwell');
    expect(settings.commentInitialLoadMode).toBe('auto-first');
    expect(settings.thumbOptimizeParams).toBe('quality=80');
  });

  it('reads the formula engine from the Rehype plugin settings', () => {
    const mathjax = warmSettings({
      'plugin:typecho-plugin-markdown-rehype': JSON.stringify({ mathEngine: 'mathjax' }),
      'theme:typecho-theme-warm-cy': JSON.stringify({ markdownMathEngine: 'katex' }),
    } as never);
    expect(mathjax.markdownMathEngine).toBe('mathjax');

    const katex = warmSettings({
      'plugin:typecho-plugin-markdown-rehype': JSON.stringify({ mathEngine: 'katex' }),
    } as never);
    expect(katex.markdownMathEngine).toBe('katex');
  });

  it('returns manifest-equivalent defaults when no saved settings exist', () => {
    const settings = warmSettings({} as never);
    expect(settings.pinnedIds).toEqual([]);
    expect(settings.footerLinks).toEqual([]);
    expect(settings.footerCustomHtml).toBe('');
    expect(settings.articleDeclarationHtml).toBe('');
    expect(settings.continuousLoadMode).toBe('manual');
    expect(settings.commentComponentLoadMode).toBe('manual');
    expect(settings.commentInitialLoadMode).toBe('manual');
    expect(settings.imageOptimizeParams).toBe('');
    expect(settings.thumbOptimizeParams).toBe('');
  });

  it('keeps the existing footer custom HTML independent from article declaration processing', () => {
    const footerCustomHtml = `<style>.footer-widget { color: var(--txt); }</style>
<div class="footer-widget" style="padding: 16px">
  <a href="https://example.com" target="_blank" rel="noopener">footer link</a>
</div>
<script>window.footerWidgetReady = true;</script>`;
    const options = {
      'theme:typecho-theme-warm-cy': JSON.stringify({
        footerCustomHtml,
        articleDeclarationHtml: '<style>.notice { color: red; }</style><p>{post.title}</p>',
      }),
    };

    const settings = warmSettings(options as never);
    expect(settings.footerCustomHtml).toBe(footerCustomHtml);

    const renderedDeclaration = renderArticleDeclaration(
      settings.articleDeclarationHtml,
      { siteName: '', siteUrl: '', siteDescription: '', postTitle: 'Article', postUrl: '' },
    );
    expect(renderedDeclaration).toContain('.warm-article__declaration .notice');
    const renderedFooter = renderFooterCustomHtml(settings.footerCustomHtml);
    expect(renderedFooter).toContain('.warm-footer__custom .footer-widget');
    expect(renderedFooter).toContain('color: var(--txt)');
    expect(renderedFooter).toContain('style="padding: 16px"');
    expect(renderedFooter).toContain('<script>window.footerWidgetReady = true;</script>');
    expect(renderedFooter).not.toContain('@layer');
    expect(renderedFooter).not.toContain('.warm-theme a');
    expect(settings.footerCustomHtml).toBe(footerCustomHtml);
  });

  it('expands article declaration placeholders and escapes inserted values', () => {
    const html = renderArticleDeclaration(
      '<p>{site.name} · {site.url} · {site.description}</p><a href="{post.url}">{post.title}</a>',
      {
        siteName: '<Site>',
        siteUrl: 'https://example.com/?a=1&b=2',
        siteDescription: 'A "description"',
        postTitle: '<script>alert(1)</script>',
        postUrl: 'https://example.com/post?a=1&b=2',
      },
    );
    expect(html).toContain('<p>&lt;Site&gt; · https://example.com/?a=1&amp;b=2 · A "description"</p>');
    expect(html).toContain('<a href="https://example.com/post?a=1&amp;b=2">&lt;script&gt;alert(1)&lt;/script&gt;</a>');
    expect(renderArticleDeclaration('{unknown}', {
      siteName: '', siteUrl: '', siteDescription: '', postTitle: '', postUrl: '',
    })).toBe('{unknown}');
  });

  it('repairs malformed declaration fragments and blocks executable or document-level markup', () => {
    const html = renderArticleDeclaration(
      '<div><p>first paragraph<ul><li>one<li>two</ul><script>alert(1)</script><html><body>blocked</body></html>',
      { siteName: '', siteUrl: '', siteDescription: '', postTitle: '', postUrl: '' },
    );
    expect(html).toContain('<div><p>first paragraph</p><ul><li>one</li><li>two</li></ul>blocked</div>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<html');
  });

  it('preserves administrator-authored style blocks and unrestricted CSS declarations', () => {
    const html = renderArticleDeclaration(
      '<style>.custom-declaration{position:absolute;top:0;right:0;z-index:9;transform:translateX(2px);color:var(--txt)} @media (max-width:600px){.custom-declaration{display:none}}</style><div class="custom-declaration" style="position:relative;overflow:hidden;box-shadow:0 2px 8px #000;border:1px solid #e5e7eb">custom</div>',
      { siteName: '', siteUrl: '', siteDescription: '', postTitle: '', postUrl: '' },
    );
    expect(html).toContain('<style>');
    expect(html).not.toContain('@layer warm-article-declaration-custom');
    expect(html).toContain('.warm-article__declaration .custom-declaration');
    expect(html).toContain('position:absolute');
    expect(html).toContain('top:0');
    expect(html).toContain('right:0');
    expect(html).toContain('@media (max-width:600px)');
    expect(html).toContain('.warm-article__declaration .custom-declaration');
    expect(html).toContain('var(--txt)');
    expect(html).toContain('position:relative');
    expect(html).toContain('overflow:hidden');
    expect(html).toContain('box-shadow:0 2px 8px #000');
    expect(html).toContain('border:1px solid #e5e7eb');
    expect(html).toContain('warm-declaration-inline-1');
  });

  it('moves inline important styles into scoped rules that override theme defaults', () => {
    const html = renderArticleDeclaration(
      '<div style="color:red!important;padding:12px">declaration</div>',
      { siteName: '', siteUrl: '', siteDescription: '', postTitle: '', postUrl: '' },
    );
    expect(html).not.toContain('@layer warm-article-declaration-custom');
    expect(html).toContain('color:red');
    expect(html).toContain('padding:12px');
    expect(html).not.toContain('!important');
    expect(html).not.toContain('style="');
    expect(html).toContain('warm-declaration-inline-1');
  });

  it('scopes declaration CSS, keeps theme rules higher priority, and drops global CSS constructs', () => {
    const html = renderArticleDeclaration(
      '<style>body{display:none}html body .root-test{color:red}:root{--local:1}.outside,.notice:hover{color:var(--txt)}@font-face{font-family:bad;src:url(https://example.com/a)}@media(max-width:600px){.notice{padding:8px}}@keyframes fade{from{opacity:0}to{opacity:1}}.notice{animation:fade 1s}</style><div class="notice">notice</div>',
      { siteName: '', siteUrl: '', siteDescription: '', postTitle: '', postUrl: '' },
    );
    expect(html).toContain('.warm-article__declaration{display:none}');
    expect(html).toContain('.warm-article__declaration .root-test{color:red}');
    expect(html).toContain('.warm-article__declaration{--local:1}');
    expect(html).not.toContain('.warm-article__declaration body');
    expect(html).toContain('.warm-article__declaration .outside');
    expect(html).toContain('.warm-article__declaration .notice:hover');
    expect(html).toContain('var(--txt)');
    expect(html).toContain('.warm-article__declaration .notice{padding:8px}');
    expect(html).toContain('@keyframes warm-declaration-fade');
    expect(html).toContain('animation:warm-declaration-fade 1s');
    expect(html).not.toContain('@font-face');
  });

  it('keeps safe inline styles and common media/table markup', () => {
    const html = renderArticleDeclaration(
      '<div style="border:2px solid #e67e22;padding:12px;border-radius:8px"><img src="https://example.com/a.png" alt="demo"><table><tr><td>cell</td></tr></table></div>',
      { siteName: '', siteUrl: '', siteDescription: '', postTitle: '', postUrl: '' },
    );
    expect(html).toContain('border:2px solid #e67e22');
    expect(html).toContain('padding:12px');
    expect(html).toContain('border-radius:8px');
    expect(html).toContain('warm-declaration-inline-1');
    expect(html).toContain('<img src="https://example.com/a.png" alt="demo" />');
    expect(html).toContain('<table><tr><td>cell</td></tr></table>');
  });

  it('builds unique table-of-contents IDs while retaining the heading markup', () => {
    const result = prepareArticleToc('<h2 id="same">One</h2><h3 id="same">Two</h3>');
    expect(result.items).toEqual([
      { id: 'same', text: 'One', level: 2 },
      { id: 'same-2', text: 'Two', level: 3 },
    ]);
    expect(result.html).toContain('<h3 id="same-2">Two</h3>');
  });

  it('excludes generated heading permalink marks from table-of-contents labels', () => {
    const result = prepareArticleToc('<h2 id="user-content-first">First <a class="warm-heading-anchor" href="#user-content-first">¶</a></h2><h2 id="user-content-second">Second <a class="warm-heading-anchor" href="#user-content-second">¶</a></h2>');
    expect(result.items.map(item => item.text)).toEqual(['First', 'Second']);
  });

  it('excludes CY HTML enhancement placeholders from table-of-contents labels and slugs', () => {
    const result = prepareArticleToc(
      '<h2>CYCYINLINEATTRXh2X636c6173733d2268656164696e6722XENDFirst section</h2>'
      + '<h2>Second <span>CYCYINLINEBLOCKX3c7376673e3c2f7376673eXEND</span></h2>',
    );
    expect(result.items.map(item => item.text)).toEqual(['First section', 'Second']);
    expect(result.items.map(item => item.id)).toEqual(['first-section', 'second']);
  });

  it('does not show a table of contents for fewer than two headings', () => {
    const result = prepareArticleToc('<h2>Only heading</h2>');
    expect(result.items).toEqual([]);
    expect(result.html).toContain('id="only-heading"');
  });

  it('creates plain excerpts and estimates a minimum reading time', () => {
    expect(plainExcerpt('## Title\n\nA **short** [link](https://example.com).')).toBe('Title A short link.');
    expect(readingMinutes('')).toBe(1);
    expect(readingMinutes('<p>' + '字'.repeat(421) + '</p>')).toBe(2);
  });
  it('hides intelligence summaries behind an unverified password', () => {
    expect(warmArticleSummary({ hasPassword: true, passwordVerified: false }, 'private summary')).toBe('');
    expect(warmArticleSummary({ hasPassword: true, passwordVerified: true }, '  visible summary  ')).toBe('visible summary');
    expect(warmArticleSummary({ hasPassword: false, passwordVerified: false }, null)).toBe('');
  });

  it('preserves iframe markup and every author-supplied attribute verbatim', () => {
    const youtube = '<iframe src="https://www.youtube.com/embed/demo" width="560" height="315" allow="autoplay; encrypted-media" referrerpolicy="no-referrer"></iframe>';
    expect(renderWarmIframes(youtube)).toBe(youtube);

    const bilibili = '<iframe src="https://player.bilibili.com/player.html?bvid=BV1xx&page=1" sandbox="allow-scripts allow-same-origin"></iframe>';
    expect(renderWarmIframes(bilibili)).toBe(bilibili);
    expect(renderWarmIframes('<p>plain content</p>')).toBe('<p>plain content</p>');
  });

});

describe('Warm CY Mermaid chart-family compatibility', () => {
  it('parses representative diagram types with the default Mermaid configuration', async () => {
    const diagrams: Array<[string, string[]]> = [
      ['flowchart', ['flowchart TD', '  A[Start] --> B[Finish]']],
      ['sequence', ['sequenceDiagram', '  Alice->>Bob: Hello']],
      ['class', ['classDiagram', '  class Animal']],
      ['er', ['erDiagram', '  CUSTOMER ||--o{ ORDER : places']],
      ['state', ['stateDiagram-v2', '  [*] --> Active']],
      ['gantt', ['gantt', '  dateFormat YYYY-MM-DD', '  section Plan', '  Draft :a1, 2026-01-01, 1d']],
      ['pie', ['pie showData', '  title Distribution', '  "A": 60', '  "B": 40']],
      ['mindmap', ['mindmap', '  root((Topic))', '    Branch']],
      ['gitGraph', ['gitGraph', '  commit', '  branch feature', '  commit']],
      ['timeline', ['timeline', '  title Release history', '  2026 : First release']],
      ['quadrant', ['quadrantChart', '  x-axis Low --> High', '  y-axis Low --> High', '  quadrant-1 Strong', '  Sample: [0.7, 0.8]']],
      ['xychart', ['xychart-beta', '  x-axis [Jan, Feb]', '  y-axis "Value" 0 --> 100', '  bar [25, 75]']],
    ];

    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    try {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
      Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
      const { default: mermaid } = await import('mermaid');
      mermaid.initialize({ startOnLoad: false, theme: 'default' });
        for (const [type, lines] of diagrams) {
          await expect(mermaid.parse(lines.join('\\n')), type).resolves.toBeTruthy();
        }
      }
    } finally {
      dom.window.close();
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else delete (globalThis as any).window;
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
      else delete (globalThis as any).document;
    }
  });
});


describe('Warm CY image fragment compatibility', () => {
  it('decodes BlurHash and valid dimensions from a URL fragment', () => {
    expect(parseImageFragment(
      'https://cdn.example/image.webp#blurhash=LfLp%7Bl%2509GXo.T-S%251tSIWj%3Dt7f9&width=1536&height=1024',
    )).toEqual({
      blurhash: 'LfLp{l%09GXo.T-S%1tSIWj=t7f9',
      width: '1536',
      height: '1024',
    });
  });

  it('keeps BlurHash metadata while removing the fragment from the image request', () => {
    const html = '<img src="https://cdn.example/image.webp#blurhash=LfLp%7Bl%2509GXo.T-S%251tSIWj%3Dt7f9&amp;width=1536&amp;height=1024" alt="image">';
    const result = optimizeContentImages(html, '', 'https://site.example');
    expect(result).toContain('src="https://cdn.example/image.webp"');
    expect(result).toContain('data-blurhash="LfLp{l%09GXo.T-S%1tSIWj=t7f9"');
    expect(result).toContain('width="1536"');
    expect(result).toContain('height="1024"');
    expect(result).toContain('width:1536px');
    expect(result).toContain('height:1024px');
  });

  it('preserves existing image attributes and leaves legacy image URLs compatible', () => {
    const html = '<img src="/uploads/legacy.webp" alt="legacy" width="320" loading="lazy">';
    expect(optimizeContentImages(html, '', 'https://site.example')).toBe(html);
    const withExistingDimensions = '<img src="https://cdn.example/image.webp#width=640&amp;height=480" width="320" height="240">';
    const result = optimizeContentImages(withExistingDimensions, '', 'https://site.example');
    expect(result).toContain('width="320"');
    expect(result).toContain('height="240"');
    expect(result).not.toContain('data-blurhash');
    expect(result).toContain('src="https://cdn.example/image.webp"');
  });

  it('keeps literal plus characters in BlurHash values', () => {
    const hash = '1234+5678901234567890123456';
    expect(parseImageFragment('image.webp#blurhash=' + hash).blurhash).toBe(hash);
  });

  it('rejects malformed BlurHash values and unsafe dimensions', () => {
    expect(parseImageFragment('image.webp#blurhash=bad%20hash&width=0&height=20001')).toEqual({
      blurhash: '',
      width: null,
      height: null,
    });
  });
});
