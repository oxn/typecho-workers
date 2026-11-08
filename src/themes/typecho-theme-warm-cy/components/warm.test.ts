import { describe, expect, it } from 'vitest';
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

  it('adds safe loading attributes only to supported video iframe providers', () => {
    const youtube = '<iframe src="https://www.youtube.com/embed/demo"></iframe>';
    const result = renderWarmIframes(youtube);
    expect(result).toContain('loading="lazy"');
    expect(result).toContain('allowfullscreen=""');
    expect(result).toContain('title="视频播放器"');

    const external = '<iframe src="https://video.example/embed/demo"></iframe>';
    expect(renderWarmIframes(external)).toBe(external);
    expect(renderWarmIframes('<p>plain content</p>')).toBe('<p>plain content</p>');
  });

});
