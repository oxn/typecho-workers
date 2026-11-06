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

  it('preserves inline attributes through Markdown parsing and fragment sanitization', () => {
    const source = '<span class="cy-card" style="color:red;display:block">轻量模式</span>';
    const protectedSource = protectInlineHtmlLight(source);
    expect(protectedSource).toContain('CYCYINLINEATTRXspanX');

    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const restored = restoreInlineHtmlFragmentsLight(sanitizeHtml(parsed));

    expect(restored).toContain('CYCYINLINEATTRXspanX');
    expect(restored).toContain('轻量模式');
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
