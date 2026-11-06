import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import {
  inlineHtmlRuntimeLight,
  protectInlineHtmlLight,
  restoreInlineHtmlFragmentsLight,
} from './html-light';

describe('Warm CY lightweight HTML enhancement', () => {
  it('preserves inline attributes through Markdown parsing and fragment sanitization', () => {
    const source = '<div class="cy-card" style="color:red;display:block">轻量模式</div>';
    const protectedSource = protectInlineHtmlLight(source);
    expect(protectedSource).toContain('CYCYINLINEATTRXdivX');

    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const restored = restoreInlineHtmlFragmentsLight(sanitizeHtml(parsed));

    expect(restored).toContain('class="cy-card"');
    expect(restored).toContain('CYCYINLINEATTRXdivX');
    expect(restored).toContain('cy-inline-html-pending');
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
