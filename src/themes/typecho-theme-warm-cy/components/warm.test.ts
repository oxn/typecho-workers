import { describe, expect, it } from 'vitest';
import {
  isCurrentPageLink,
  normalizeCommentComponentLoadMode,
  normalizeCommentInitialLoadMode,
  normalizeContinuousLoadMode,
  parsePinnedIds,
  renderWarmIframes,
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
    expect(settings.continuousLoadMode).toBe('manual');
    expect(settings.commentComponentLoadMode).toBe('manual');
    expect(settings.commentInitialLoadMode).toBe('manual');
    expect(settings.imageOptimizeParams).toBe('');
    expect(settings.thumbOptimizeParams).toBe('');
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

  it('adds only the referrer policy to YouTube iframes', () => {
    const youtube = '<iframe src="https://www.youtube.com/embed/demo" width="560" height="315" allowfullscreen frameborder="0"></iframe>';
    const expectedYoutube = '<iframe src="https://www.youtube.com/embed/demo" width="560" height="315" allowfullscreen frameborder="0" referrerpolicy="strict-origin-when-cross-origin"></iframe>';
    const bilibili = '<iframe src="https://player.bilibili.com/player.html?bvid=demo" width="560" height="315" allowfullscreen frameborder="0"></iframe>';

    expect(renderWarmIframes(youtube)).toBe(expectedYoutube);
    expect(renderWarmIframes(bilibili)).toBe(bilibili);
    expect(renderWarmIframes('<iframe src="https://video.example/embed/demo"></iframe>'))
      .toBe('<iframe src="https://video.example/embed/demo"></iframe>');
    expect(renderWarmIframes('<p>plain content</p>')).toBe('<p>plain content</p>');
  });

  it('does not overwrite an existing YouTube referrer policy', () => {
    const youtube = '<iframe src="https://www.youtube.com/embed/demo" referrerpolicy="origin"></iframe>';
    expect(renderWarmIframes(youtube)).toBe(youtube);
  });

});
