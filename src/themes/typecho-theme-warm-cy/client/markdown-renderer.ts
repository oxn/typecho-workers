import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import { optimizeImageUrl } from '@/lib/image-transform';

let processorPromise: Promise<any> | null = null;

async function getProcessor(): Promise<any> {
  if (processorPromise) return processorPromise;
  processorPromise = (async () => {
    const [{ default: remarkAlert }, { default: rehypeKatex }] = await Promise.all([
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

function addHeadingIds(root: HTMLElement): void {
  const used = new Set<string>();
  root.querySelectorAll<HTMLElement>('h2,h3').forEach((heading) => {
    const existing = heading.id.trim();
    let id = existing || (heading.textContent || '')
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 150) || 'section-' + (used.size + 1);
    const base = id;
    let suffix = 2;
    while (used.has(id)) id = base + '-' + suffix++;
    used.add(id);
    heading.id = id;
  });
}

async function enhanceOptionalFeatures(root: HTMLElement): Promise<void> {
  if (root.querySelector('pre > code.language-mermaid, pre > code.lang-mermaid')) {
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
    addHeadingIds(root);
    if (options.imageOptimizeParams) {
      root.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => {
        const src = image.getAttribute('src') || '';
        const optimized = optimizeImageUrl(src, options.imageOptimizeParams || '', options.siteUrl || '');
        if (optimized !== src) image.setAttribute('src', optimized);
      });
    }
    normalizeImages(root);
    await enhanceOptionalFeatures(root);
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
