import { describe, expect, it } from 'vitest';
import {
  markdownAlertIconStyles,
  markdownAlertStyleEditorHtml,
  normalizeMarkdownAlertStyleSettings,
  restoreMarkdownAlertIcons,
} from './markdown-alerts';

describe('Warm CY Markdown Alert presentation module', () => {
  it('normalizes five alert styles and clamps icon dimensions', () => {
    const settings = normalizeMarkdownAlertStyleSettings({
      types: {
        NOTE: { background: '#ABCDEF', radius: 99, borderStyle: 'dashed' },
        TIP: { background: 'red', radius: -10, borderStyle: 'unsafe' },
      },
      icon: { visible: false, size: 80, gap: -4 },
    });
    expect(settings.types.NOTE.background).toBe('#abcdef');
    expect(settings.types.NOTE.radius).toBe(32);
    expect(settings.types.NOTE.borderStyle).toBe('dashed');
    expect(settings.types.TIP.radius).toBe(0);
    expect(settings.types.TIP.borderStyle).toBe('solid');
    expect(settings.enabled).toBe(true);
    expect(settings.icon).toEqual({ visible: false, size: 32, gap: 0 });
    expect(Object.keys(settings.types)).toEqual(['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']);
  });

  it('renders an editable settings panel for each Markdown Alert type', () => {
    const html = markdownAlertStyleEditorHtml({});
    expect(html).toContain('五种 Note 与图标样式');
    for (const type of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
      expect(html).toContain(type);
      expect(html).toContain(type + '.background');
    }
    expect(html).toContain('data-cy-alert-style-enabled');
    expect(html).toContain('data-cy-alert-icon-visible');
    expect(html).toContain('data-cy-alert-reset');
    expect(html).toContain('data-cy-default-value="#eef2ff"');
    expect(html).toContain('data-cy-default-value="#c7d2fe"');
    expect(html).toContain('data-cy-default-value="#4338ca"');
    expect(html).toContain('data-cy-default-value="#bbf7d0"');
    expect(html).toContain('data-cy-default-value="#15803d"');
    expect(html).toContain('data-cy-default-value="#e9d5ff"');
    expect(html).toContain('data-cy-default-value="#9333ea"');
    expect(html).toContain('data-cy-default-value="#fde68a"');
    expect(html).toContain('data-cy-default-value="#a16207"');
    expect(html).toContain('data-cy-default-value="#fecaca"');
    expect(html).toContain('data-cy-default-value="#dc2626"');
    expect(html).toContain('data-cy-default-value="8"');
    expect(html).toContain('data-cy-default-value="18"');
    expect(html).toContain('data-cy-default-checked="true"');
    expect(html).toContain('data-cy-default-value="18"');
    expect(html).toContain('data-cy-default-value="8"');
    expect((html.match(/data-cy-alert-style-field=/g) || []).length).toBe(35);
    expect((html.match(/data-cy-default-value="solid"/g) || []).length).toBe(5);
  });

  it('restores the correct SVG icon without duplicating an existing icon', () => {
    const source = '<blockquote data-alert="TIP"><p class="markdown-alert-title">提示</p><p>正文</p></blockquote>';
    const restored = restoreMarkdownAlertIcons(source);
    expect(restored).toContain('<svg class="markdown-alert-icon"');
    expect(restored).toContain('cy-markdown-alert-has-icon');
    expect(restoreMarkdownAlertIcons(restored)).toBe(restored);
  });

  it('restores no custom SVG when the master or icon visibility toggle is off', () => {
    const source = '<blockquote data-alert="NOTE"><p class="markdown-alert-title">标题</p><p>正文</p></blockquote>';
    expect(restoreMarkdownAlertIcons(source, { enabled: false })).toBe(source);
    expect(restoreMarkdownAlertIcons(source, { enabled: true, icon: { visible: false } })).toBe(source);
    expect(markdownAlertIconStyles({ enabled: false })).toBe('');
  });

  it('returns ordinary content unchanged without alert markers', () => {
    const source = '<p>这是一篇普通文章，没有 Markdown Alert。</p>';
    expect(restoreMarkdownAlertIcons(source)).toBe(source);
  });

  it('generates per-alert style rules and suppresses legacy pseudo-icons', () => {
    const css = markdownAlertIconStyles({
      types: { NOTE: { background: '#ffffff', border: '#000000' } },
      icon: { visible: false, size: 24, gap: 4 },
    });
    expect(css).toContain('data-cy-markdown-alert-icons');
    expect(css).toContain('background:#ffffff!important');
    expect(css).toContain('border-color:#000000!important');
    expect(css).toContain('display:none!important');
    expect(css).toContain('content:none!important');
  });
});
