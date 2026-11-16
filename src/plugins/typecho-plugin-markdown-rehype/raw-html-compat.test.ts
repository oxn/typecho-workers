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
  it('renders Rin image URL dimensions from the original Markdown fragment', async () => {
    const html = await renderMarkdown(
      '![logo.ico](https://cycy.fun/CYlogo.ico#&width=48&height=48)',
    );

    expect(html).toContain('src="https://cycy.fun/CYlogo.ico"');
    expect(html).toContain('width="48"');
    expect(html).toContain('height="48"');
    expect(html).not.toContain('#&width=48&height=48');
  });

  it('matches Rin image layout classification for adjacent Markdown images', async () => {
    const html = await renderMarkdown(
      '![first](https://example.test/first.png)![second](https://example.test/second.png)',
    );

    expect(html).toMatch(/<img(?=[^>]*src="https:\/\/example\.test\/first\.png")(?=[^>]*data-rin-image-layout="block")[^>]*>/);
    expect(html).toMatch(/<img(?=[^>]*src="https:\/\/example\.test\/second\.png")(?=[^>]*data-rin-image-layout="inline")[^>]*>/);
  });

  it('keeps an image following a newline classified as a block image', async () => {
    const html = await renderMarkdown(
      '正文内容\n![block](https://example.test/block.png)',
    );

    expect(html).toMatch(/<img(?=[^>]*src="https:\/\/example\.test\/block\.png")(?=[^>]*data-rin-image-layout="block")[^>]*>/);
  });


  it('classifies leading and inline images using their original Markdown offsets', async () => {
    const html = await renderMarkdown([
      '![leading](https://example.test/leading.png)',
      '',
      '这是一段包含 ![inline](https://example.test/inline.png) 的正文。',
    ].join('\n'));

    expect(html).toMatch(/<img(?=[^>]*src="https:\/\/example\.test\/leading\.png")(?=[^>]*data-rin-image-layout="block")[^>]*>/);
    expect(html).toMatch(/<img(?=[^>]*src="https:\/\/example\.test\/inline\.png")(?=[^>]*data-rin-image-layout="inline")[^>]*>/);
  });

  it('classifies an image after a blank line as block even after paragraph text', async () => {
    const html = await renderMarkdown(
      '前一段文字。\n\n![next](https://example.test/next.png)',
    );

    expect(html).toMatch(/<img(?=[^>]*src="https:\/\/example\.test\/next\.png")(?=[^>]*data-rin-image-layout="block")[^>]*>/);
  });

  it('preserves image blurhash while extracting dimensions', async () => {
    const html = await renderMarkdown(
      '![logo.ico](https://cycy.fun/CYlogo.ico#&blurhash=LEHV6nWB2yk8pyo0adR*.7kCMdnj&width=48&height=48)',
    );

    expect(html).toContain('src="https://cycy.fun/CYlogo.ico"');
    expect(html).toContain('width="48"');
    expect(html).toContain('height="48"');
    expect(html).toContain('data-rin-blurhash=');
  });

});
