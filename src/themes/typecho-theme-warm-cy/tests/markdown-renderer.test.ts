import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderInto, renderMarkdown } from './markdown-renderer';

describe('Warm CY client article renderer', () => {
  it('preserves authored HTML, attributes, inline CSS, style blocks and SVG', async () => {
    const source = [
      '<style>.custom-card { color: rgb(1, 2, 3); }</style>',
      '<custom-card data-state="ready" aria-label="custom element" style="color: red">',
      '  <svg viewBox="0 0 48 48" aria-labelledby="icon-title">',
      '    <title id="icon-title">云盘图标</title>',
      '    <path d="M0 0h48v48H0z" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
      '  </svg>',
      '</custom-card>',
    ].join('\n');

    const html = await renderMarkdown(source);

    expect(html).toContain('<style>.custom-card { color: rgb(1, 2, 3); }</style>');
    expect(html).toContain('<custom-card data-state="ready" aria-label="custom element" style="color: red">');
    expect(html).toContain('viewBox="0 0 48 48"');
    expect(html).toContain('aria-labelledby="icon-title"');
    expect(html).toContain('stroke-width="2"');
    expect(html).toContain('stroke-linecap="round"');
    expect(html).toContain('stroke-linejoin="round"');
    expect(html).toContain('id="icon-title"');
  });

  it('supports Markdown and raw HTML mixed in the same paragraph', async () => {
    const html = await renderMarkdown(
      '**Markdown 粗体** <span data-inline="kept" title="保留属性">HTML 内容</span> _Markdown 斜体_',
    );

    expect(html).toContain('<strong>Markdown 粗体</strong>');
    expect(html).toContain('<span data-inline="kept" title="保留属性">HTML 内容</span>');
    expect(html).toContain('<em>Markdown 斜体</em>');
  });

  it('creates heading IDs, a client TOC and responsive iframe wrappers from rendered DOM', async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <article class="warm-article">
        <div class="warm-article__body">
          <div class="warm-prose" data-warm-client-content></div>
          <nav class="warm-toc" data-warm-toc style="display:none">
            <div class="warm-toc__inner"><ol data-warm-toc-list></ol></div>
          </nav>
        </div>
      </article>
    </body></html>`);
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const previousCustomEvent = Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent');
    const previousNode = Object.getOwnPropertyDescriptor(globalThis, 'Node');

    try {
      Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
      Object.defineProperty(globalThis, 'CustomEvent', { configurable: true, value: dom.window.CustomEvent });
      Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });

      const root = dom.window.document.querySelector<HTMLElement>('[data-warm-client-content]')!;
      await renderInto(root, [
        '# 一级标题',
        '',
        '## 第一节',
        '',
        '### 子章节',
        '',
        '## 第二节',
        '',
        '<iframe src="https://player.example.test/embed/1" data-player-mode="wide" allow="autoplay; fullscreen" sandbox="allow-scripts" onload="window.frameReady = true" srcdoc="<p>embedded</p>"></iframe>',
      ].join('\n'));

      expect(root.querySelectorAll('h1[id], h2[id], h3[id]')).toHaveLength(4);
      const toc = dom.window.document.querySelector('[data-warm-toc]')!;
      expect(toc.querySelectorAll('[data-warm-toc-link]')).toHaveLength(3);
      expect((toc as HTMLElement).style.display).not.toBe('none');
      expect(dom.window.document.querySelector('.warm-article__body')?.classList.contains('warm-article__body--toc')).toBe(true);

      const iframe = root.querySelector('iframe')!;
      expect(iframe.parentElement?.classList.contains('rin-iframe-wrapper')).toBe(true);
      expect(iframe.getAttribute('data-player-mode')).toBe('wide');
      expect(iframe.getAttribute('allow')).toBe('autoplay; fullscreen');
      expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
      expect(iframe.getAttribute('onload')).toBe('window.frameReady = true');
      expect(iframe.getAttribute('srcdoc')).toBe('<p>embedded</p>');
    } finally {
      dom.window.close();
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
      else delete (globalThis as any).document;
      if (previousCustomEvent) Object.defineProperty(globalThis, 'CustomEvent', previousCustomEvent);
      else delete (globalThis as any).CustomEvent;
      if (previousNode) Object.defineProperty(globalThis, 'Node', previousNode);
      else delete (globalThis as any).Node;
    }
  });
});
