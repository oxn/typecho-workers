import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { inlineHtmlRuntime, protectInlineHtml, restoreInlineHtmlFragments } from './html-full';

describe('Warm CY full HTML enhancement module', () => {
  it('protects complete HTML containers before Markdown parsing and restores them safely', () => {
    const source = '<div class="custom-card" style="display:flex;gap:12px"><strong>独立 HTML</strong><a href="https://example.com">查看</a></div>';
    const protectedSource = protectInlineHtml(source);
    expect(protectedSource).toContain('CYCYINLINECONTAINERX');
    expect(protectedSource).not.toContain('<div class="custom-card">');

    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const sanitized = sanitizeHtml(parsed);
    const restored = restoreInlineHtmlFragments(sanitized);
    expect(restored).toContain('class="custom-card"');
    expect(restored).toContain('display:flex');
    expect(restored).toContain('gap:12px');
    expect(restored).toContain('href="https://example.com"');
    expect(restored).toContain('独立 HTML');
    expect(restored).not.toContain('CYCYINLINECONTAINERX');
  });

  it('keeps scripts and styles inert until the optional browser runtime hydrates them', () => {
    const source = '<div class="card"><style>.card{display:flex}</style><script>window.example = true</script>正文</div>';
    const protectedSource = protectInlineHtml(source);
    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const restored = restoreInlineHtmlFragments(sanitizeHtml(parsed));
    expect(restored).toContain('CYCYINLINEBLOCKX');
    expect(restored).not.toContain('<script>window.example = true</script>');
    const runtime = inlineHtmlRuntime();
    expect(runtime).toContain('data-cy-inline-html-enhancement');
    expect(runtime).toContain('new DOMParser()');
    expect(runtime).toContain('safeStylesheetText');
  });
});
