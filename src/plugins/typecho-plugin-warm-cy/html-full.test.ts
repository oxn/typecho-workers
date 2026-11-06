import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { inlineHtmlRuntime, protectInlineHtml, restoreInlineHtmlFragments } from './html-full';

describe('Warm CY full HTML enhancement module', () => {
  it('keeps article scripts inert unless the separate execution option is enabled', () => {
    expect(inlineHtmlRuntime()).toContain('const allowScripts = false;');
    expect(inlineHtmlRuntime()).toContain("if (tag === 'script' && !allowScripts) return null;");
    expect(inlineHtmlRuntime(true)).toContain('const allowScripts = true;');
  });

  it('returns ordinary Markdown output unchanged when no enhancement markers exist', () => {
    const content = '<p>普通文章内容，没有 HTML 增强标记。</p>';
    expect(restoreInlineHtmlFragments(content)).toBe(content);
  });

  it('neutralizes user-authored restoration markers before they can reach the runtime', () => {
    const forgedPayload = Array.from(new TextEncoder().encode('<script>window.__cyForged = true</script>'), byte =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    const source = 'CYCYINLINEBLOCKX' + forgedPayload + 'XEND';
    const protectedSource = protectInlineHtml(source);
    expect(protectedSource).not.toContain('CYCYINLINEBLOCKX');
    expect(protectedSource).toContain('CY' + String.fromCharCode(0x200b) + 'CYINLINEBLOCKX');
    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const restored = restoreInlineHtmlFragments(sanitizeHtml(parsed));
    expect(restored).not.toContain('<script>window.__cyForged');
    expect(restored).not.toContain('CYCYINLINEBLOCKX');
  });

  it('neutralizes numeric-entity encoded restoration marker prefixes', () => {
    const payload = Array.from(new TextEncoder().encode('<script>window.__cyEntityForged = true</script>'), byte =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    const variants = [
      '&#67;YCYINLINEBLOCKX' + payload + 'XEND',
      '&#x43;YCYINLINEBLOCKX' + payload + 'XEND',
    ];
    for (const source of variants) {
      const protectedSource = protectInlineHtml(source);
      expect(protectedSource).toContain('CY' + String.fromCharCode(0x200b) + 'CYINLINEBLOCKX');
      const parsed = marked.parse(protectedSource, { async: false }) as string;
      const restored = restoreInlineHtmlFragments(sanitizeHtml(parsed));
      expect(restored).not.toContain('<script>window.__cyEntityForged');
      expect(restored).not.toContain('CYCYINLINEBLOCKX');
    }
  });

  it('returns Markdown without literal HTML tags unchanged before scanning', () => {
    const source = '# 标题\n\n普通 Markdown、列表和代码块均无 HTML 标签。\n\n```ts\nconst value = 1;\n```';
    expect(protectInlineHtml(source)).toBe(source);
  });

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

  it('removes executable event handlers and dangerous link/style values after restoration', () => {
    const source = '<a href="javascript:alert(1)" onclick="alert(1)" style="color:red;background-image:url(https://attacker.invalid/x)">危险链接</a>';
    const protectedSource = protectInlineHtml(source);
    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const restored = restoreInlineHtmlFragments(sanitizeHtml(parsed));

    expect(restored).toContain('危险链接');
    expect(restored).not.toMatch(/onclick|javascript:|attacker\.invalid/i);
  });

  it('keeps HTML-looking examples inside fenced code as escaped text', () => {
    const source = '```html\n<div onclick="alert(1)">示例</div>\n```';
    const protectedSource = protectInlineHtml(source);
    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const restored = restoreInlineHtmlFragments(sanitizeHtml(parsed));

    expect(restored).toContain('&lt;div');
    expect(restored).toContain('示例');
    expect(restored).not.toContain('CYCYINLINE');
  });

  it('filters SVG external references before encoding protected SVG payloads', () => {
    const source = '<svg viewBox="0 0 10 10"><use href="#local-icon"></use><use href="https://attacker.invalid/external.svg#icon"></use><path fill="url(https://attacker.invalid/paint.svg#paint)" d="M0 0"></path></svg>';
    const protectedSource = protectInlineHtml(source);
    const hex = (value: string) => Array.from(new TextEncoder().encode(value), byte =>
      byte.toString(16).padStart(2, '0'),
    ).join('');

    expect(protectedSource).toContain(hex('href="#local-icon"'));
    expect(protectedSource).not.toContain(hex('attacker.invalid'));
  });

  it('collects SVG references only from elements retained by the safe SVG tree builder', () => {
    const runtime = inlineHtmlRuntime();
    expect(runtime).toContain('const collectSvgIds = (node, idMap, duplicateIds = new Set()) =>');
    expect(runtime).toContain("node.nodeType !== Node.ELEMENT_NODE || !svgTags.has(node.localName.toLowerCase())");
  });

  it('retains SVG external-reference guards in the browser runtime', () => {
    const runtime = inlineHtmlRuntime();
    expect(runtime).toContain('xlink:href');
    expect(runtime).toContain('javascript:');
    expect(runtime).toContain('url');
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
