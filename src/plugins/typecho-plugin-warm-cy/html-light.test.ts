import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import {
  inlineHtmlRuntimeLight,
  protectInlineHtmlLight,
  restoreInlineHtmlFragmentsLight,
} from './html-light';

describe('Warm CY lightweight HTML enhancement', () => {
  it('returns ordinary Markdown output unchanged when no enhancement markers exist', () => {
    const content = '<p>普通文章内容，没有 HTML 增强标记。</p>';
    expect(restoreInlineHtmlFragmentsLight(content)).toBe(content);
  });

  it('neutralizes user-authored restoration markers before they can reach the runtime', () => {
    const forgedPayload = Array.from(new TextEncoder().encode('<script>window.__cyForged = true</script>'), byte =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    const source = 'CYCYINLINEBLOCKX' + forgedPayload + 'XEND';
    const protectedSource = protectInlineHtmlLight(source);
    expect(protectedSource).not.toContain('CYCYINLINEBLOCKX');
    expect(protectedSource).toContain('CY' + String.fromCharCode(0x200b) + 'CYINLINEBLOCKX');
    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const restored = restoreInlineHtmlFragmentsLight(sanitizeHtml(parsed));
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
      const protectedSource = protectInlineHtmlLight(source);
      expect(protectedSource).toContain('CY' + String.fromCharCode(0x200b) + 'CYINLINEBLOCKX');
      const parsed = marked.parse(protectedSource, { async: false }) as string;
      const restored = restoreInlineHtmlFragmentsLight(sanitizeHtml(parsed));
      expect(restored).not.toContain('<script>window.__cyEntityForged');
      expect(restored).not.toContain('CYCYINLINEBLOCKX');
    }
  });

  it('returns Markdown without literal HTML tags unchanged before scanning', () => {
    const source = '# 标题\n\n普通 Markdown、列表和代码块均无 HTML 标签。\n\n```ts\nconst value = 1;\n```';
    expect(protectInlineHtmlLight(source)).toBe(source);
  });

  it('preserves inline attributes through Markdown parsing and fragment sanitization', () => {
    const source = '<span class="cy-card" style="color:red;display:block">轻量模式</span>';
    const protectedSource = protectInlineHtmlLight(source);
    expect(protectedSource).toContain('CYCYINLINEATTRXspanX');

    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const restored = restoreInlineHtmlFragmentsLight(sanitizeHtml(parsed));

    expect(restored).toContain('CYCYINLINEATTRXspanX');
    expect(restored).toContain('轻量模式');
  });

  it('removes executable event handlers and dangerous link/style values after restoration', () => {
    const source = '<a href="javascript:alert(1)" onclick="alert(1)" style="color:red;background-image:url(https://attacker.invalid/x)">危险链接</a>';
    const protectedSource = protectInlineHtmlLight(source);
    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const restored = restoreInlineHtmlFragmentsLight(sanitizeHtml(parsed));

    expect(restored).toContain('危险链接');
    expect(restored).not.toMatch(/onclick|javascript:|attacker\.invalid/i);
  });

  it('keeps HTML-looking examples inside fenced code as escaped text', () => {
    const source = '```html\n<div onclick="alert(1)">示例</div>\n```';
    const protectedSource = protectInlineHtmlLight(source);
    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const restored = restoreInlineHtmlFragmentsLight(sanitizeHtml(parsed));

    expect(restored).toContain('&lt;div');
    expect(restored).toContain('示例');
    expect(restored).not.toContain('CYCYINLINE');
  });

  it('filters SVG external references when the lightweight runtime rebuilds SVG nodes', () => {
    const runtime = inlineHtmlRuntimeLight(true);

    expect(runtime).toContain('!/^#[');
    expect(runtime).toContain('!/^\\s*url');
    expect(runtime).toContain('javascript:|data:text');
  });

  it('keeps script and style blocks inert as markers until runtime hydration', () => {
    const source = '<div class="card"><style>.card{display:flex}</style><script>window.cyUnsafe = true</script>正文</div>';
    const protectedSource = protectInlineHtmlLight(source);
    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const restored = restoreInlineHtmlFragmentsLight(sanitizeHtml(parsed));

    expect(restored).toContain('CYCYINLINEBLOCKX');
    expect(restored).not.toContain('<script>window.cyUnsafe = true</script>');
  });

  it('retains SVG external-reference guards in the browser runtime', () => {
    const runtime = inlineHtmlRuntimeLight(true);
    expect(runtime).toContain('xlink:href');
    expect(runtime).toContain('javascript:');
    expect(runtime).toContain('url');
  });

  it('uses a marker parser that accepts the same lowercase HTML tag alphabet as full mode', () => {
    const runtime = inlineHtmlRuntimeLight(true);
    expect(runtime).toContain('CYCYINLINEATTRX([a-z][a-z0-9_:-]*)X([0-9a-f]+)XEND');
  });

  it('does not activate inline HTML when the lightweight runtime is disabled', () => {
    const runtime = inlineHtmlRuntimeLight(false);
    expect(runtime).toContain('const enabled = false');
    expect(runtime).toContain('.cy-inline-html-pending{display:none!important}');
  });
});
