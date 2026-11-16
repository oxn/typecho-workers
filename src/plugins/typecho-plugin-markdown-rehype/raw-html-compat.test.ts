import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './index';

describe('Typecho-compatible raw HTML rendering', () => {
  it('preserves authored HTML elements and attributes without plugin-side filtering', async () => {
    const html = await renderMarkdown(
      '<custom-card data-state="ready" aria-label="custom element"><span class="note" title="kept">内容</span></custom-card>',
    );

    expect(html).toContain('<custom-card data-state="ready" aria-label="custom element">');
    expect(html).toContain('<span class="note" title="kept">内容</span>');
  });

  it('preserves iframe attributes without plugin-side filtering', async () => {
    const html = await renderMarkdown(
      '<iframe src="https://player.example.test/embed/1" data-player-mode="wide" allow="autoplay; fullscreen" sandbox="allow-scripts" loading="lazy" onload="window.frameReady = true" srcdoc="<p>embedded</p>"></iframe>',
    );

    expect(html).toContain('data-player-mode="wide"');
    expect(html).toContain('allow="autoplay; fullscreen"');
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('onload="window.frameReady = true"');
    expect(html).toContain('srcdoc=');
  });
});
