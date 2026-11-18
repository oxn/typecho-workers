import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import { optimizeImageUrl } from '@/lib/image-transform';
import katexCss from 'katex/dist/katex.min.css?inline';

let processorPromise: Promise<any> | null = null;

async function getProcessor(): Promise<any> {
  if (processorPromise) return processorPromise;
  processorPromise = (async () => {
    const [{ remarkAlert }, { default: rehypeKatex }] = await Promise.all([
      import('remark-github-blockquote-alert'),
      import('rehype-katex'),
    ]);
    return unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkMath)
      .use(remarkAlert)
      .use(remarkBreaks)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeKatex)
      .use(rehypeRaw)
      .use(rehypeStringify);
  })();
  return processorPromise;
}

function escapeText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function headingChildToString(child: ChildNode): string {
  return child.nodeType === Node.TEXT_NODE
    ? child.textContent || ''
    : '[object Object]';
}

function addHeadingIds(root: HTMLElement): void {
  const used = new Set<string>();
  root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6').forEach((heading) => {
    let id = heading.hasAttribute('id')
      ? heading.id
      : (() => {
          const children = Array.from(heading.childNodes);
          return children.length === 1
            ? headingChildToString(children[0])
            : children.map(headingChildToString).join(',');
        })();
    if (!id) id = 'section-' + (used.size + 1);
    const base = id;
    let suffix = 2;
    while (used.has(id)) id = base + '-' + suffix++;
    used.add(id);
    heading.id = id;

    const existingStyle = heading.getAttribute('style') || '';
    const withoutScrollMargin = existingStyle.replace(/(?:^|;)\s*scroll-margin-top\s*:[^;]*/gi, '');
    heading.setAttribute(
      'style',
      (withoutScrollMargin ? withoutScrollMargin.replace(/;?\s*$/, ';') : '') +
        'scroll-margin-top:var(--header-scroll-offset, 7rem)',
    );
  });
}

async function enhanceOptionalFeatures(root: HTMLElement): Promise<void> {
  if (root.querySelector('pre.rin-mermaid_default:not([data-processed]), pre.rin-mermaid_dark:not([data-processed])')) {
    const { initializeMermaid } = await import('./mermaid-runtime');
    await initializeMermaid(root);
  }
  if (root.querySelector('pre > code[class*="language-"]')) {
    const { initializeCodeBlocks } = await import('./markdown-code-runtime');
    initializeCodeBlocks(root);
  }
  if (root.querySelector('img')) {
    const { initializeImages } = await import('./markdown-image-runtime');
    initializeImages(root);
  }
}

function transformMermaidBlocks(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('pre > code.language-mermaid, pre > code.lang-mermaid').forEach((code) => {
    const pre = code.parentElement;
    if (!pre) return;
    const source = code.textContent || '';
    const light = document.createElement('pre');
    light.className = 'rin-mermaid_default dark:hidden';
    light.textContent = source;
    const dark = document.createElement('pre');
    dark.className = 'rin-mermaid_dark dark:block hidden';
    dark.textContent = source;
    pre.replaceWith(light, dark);
  });
}

function ensureKatexStyles(root: HTMLElement): void {
  if (!root.querySelector('.katex') || document.querySelector('[data-warm-katex-styles]')) return;
  const style = document.createElement('style');
  style.dataset.warmKatexStyles = '1';
  style.textContent = katexCss;
  document.head.append(style);
}

function wrapIframes(root: HTMLElement): void {
  root.querySelectorAll<HTMLIFrameElement>('iframe').forEach((frame) => {
    if (frame.parentElement?.classList.contains('rin-iframe-wrapper')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'rin-iframe-wrapper';
    frame.before(wrapper);
    wrapper.append(frame);
  });
}

function initializeArticleToc(root: HTMLElement): void {
  const articleBody = root.closest<HTMLElement>('.warm-article__body');
  const article = root.closest<HTMLElement>('.warm-article');
  const nav = articleBody?.querySelector<HTMLElement>('[data-warm-toc]');
  const list = nav?.querySelector<HTMLOListElement>('[data-warm-toc-list]');
  if (!articleBody || !article || !nav || !list) return;

  const headings = Array.from(root.querySelectorAll<HTMLElement>('h2, h3'));
  if (headings.length < 2) {
    nav.style.display = 'none';
    articleBody.classList.remove('warm-article__body--toc');
    article.classList.remove('has-toc');
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const heading of headings) {
    if (!heading.id) continue;
    const item = document.createElement('li');
    item.className = 'warm-toc__item';
    const link = document.createElement('a');
    link.className = 'warm-toc__link';
    link.setAttribute('href', '#' + encodeURIComponent(heading.id));
    link.setAttribute('data-warm-toc-link', '');
    const label = document.createElement('span');
    label.className = 'warm-toc__label';
    label.textContent = (heading.textContent || '').trim();
    link.append(label);
    item.append(link);
    fragment.append(item);
  }

  if (fragment.childNodes.length < 2) {
    nav.style.display = 'none';
    articleBody.classList.remove('warm-article__body--toc');
    article.classList.remove('has-toc');
    return;
  }

  list.replaceChildren(fragment);
  nav.style.removeProperty('display');
  articleBody.classList.add('warm-article__body--toc');
  article.classList.add('has-toc');
}

function normalizeImages(root: HTMLElement): void {
  root.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    image.loading ||= 'lazy';
    image.decoding ||= 'async';
    image.classList.add('max-w-full');
  });
}

export async function renderMarkdown(source: string): Promise<string> {
  if (!source) return '';
  const processor = await getProcessor();
  const file = await processor.process(
    source.replace(/^<!--markdown-->/, '').replace(/<!--more-->/g, ''),
  );
  return '<div class="toc-content min-w-0">' + String(file) + '</div>';
}

export interface RenderOptions {
  imageOptimizeParams?: string;
  siteUrl?: string;
}

export async function renderInto(root: HTMLElement, source: string, options: RenderOptions = {}): Promise<void> {
  root.setAttribute('aria-busy', 'true');
  try {
    root.innerHTML = await renderMarkdown(source);
    transformMermaidBlocks(root);
    addHeadingIds(root);
    ensureKatexStyles(root);
    wrapIframes(root);
    initializeArticleToc(root);
    if (options.imageOptimizeParams) {
      root.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => {
        const src = image.getAttribute('src') || '';
        const optimized = optimizeImageUrl(src, options.imageOptimizeParams || '', options.siteUrl || '');
        if (optimized !== src) image.setAttribute('src', optimized);
      });
    }
    normalizeImages(root);
    try {
      await enhanceOptionalFeatures(root);
    } catch (error) {
      // Optional browser enhancements must never replace successfully rendered article content.
      console.error('[Warm CY] optional content enhancement failed', error);
    }
    document.dispatchEvent(new CustomEvent('warm:client-content-rendered', { detail: { root } }));
  } catch (error) {
    console.error('[Warm CY] client Markdown render failed', error);
    root.innerHTML = '<p>文章内容加载失败。</p>';
  } finally {
    root.removeAttribute('aria-busy');
  }
}

export function renderPlainText(value: string): string {
  return escapeText(value);
}
