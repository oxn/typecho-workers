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

/** Match Rin: image URL dimensions become numeric HTML width/height attributes. */
function parseImageDimension(value: string): number | undefined {
  const normalized = value.trim().toLowerCase().replace(/px$/, '');
  if (!/^\d+$/.test(normalized)) return undefined;
  const dimension = Number(normalized);
  return Number.isSafeInteger(dimension) && dimension > 0 ? dimension : undefined;
}

function applyImageDimension(properties: Record<string, any>, name: 'width' | 'height', value: string): void {
  const dimension = parseImageDimension(value);
  if (dimension === undefined || properties[name] != null) return;
  properties[name] = dimension;
}

function toRinPositiveInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** Match Rin's URLSearchParams-based fragment parsing exactly. */
function parseRinImageUrlMetadata(url: string): {
  src: string;
  blurhash?: string;
  width?: number;
  height?: number;
} {
  const [src, fragment = ''] = url.split('#', 2);
  const params = new URLSearchParams(fragment.replace(/&amp;/gi, '&'));
  return {
    src,
    blurhash: params.get('blurhash') || undefined,
    width: toRinPositiveInteger(params.get('width')),
    height: toRinPositiveInteger(params.get('height')),
  };
}

/**
 * Preserve the original Markdown image URL through remark-rehype.
 * Parse image metadata once from the final HAST img src after rehypeRaw,
 * avoiding loss of fragment data during mdast-to-HAST property conversion.
 */
function countRinNewlinesBeforeNode(text: string, offset: number): number {
  let count = 0;
  for (let index = offset - 1; index >= 0 && text[index] === '\n'; index--) count++;
  return count;
}
function isRinMarkdownImageLinkAtEnd(text: string): boolean {
  const trimmed = text.trim();
  const match = trimmed.match(/(.*)(!\\[.*?\\]\\(.*?\\))$/s);
  if (!match) return false;
  const beforeImage = match[1];
  return beforeImage.trim().length === 0 || beforeImage.endsWith('\n');
}
/** Do not treat a missing source position as offset zero (the start of the article). */
function getRinImageLayout(source: string, node: any): 'block' | 'inline' | undefined {
  const offset = node?.position?.start?.offset;
  if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0) return undefined;
  const previousContent = source.slice(0, offset);
  return countRinNewlinesBeforeNode(previousContent, offset) >= 1
    || previousContent.trim().length === 0
    || isRinMarkdownImageLinkAtEnd(previousContent)
    ? 'block'
    : 'inline';
}
function remarkRinImageMetadata() {
  return (tree: any, file: any): void => {
    const source = typeof file?.value === 'string' ? file.value : '';
    const visit = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'image') {
        // Read metadata while the original Markdown destination is still intact.
        // remark-rehype/rehype-raw may normalize the URL fragment, so relying only
        // on the later HAST src can silently lose the leading-& metadata form.
        if (typeof node.url === 'string') {
          const metadata = parseRinImageUrlMetadata(node.url);
          node.url = metadata.src;
          node.data = node.data ?? {};
          const properties = { ...(node.data.hProperties ?? {}) } as Record<string, any>;
          if (metadata.blurhash) properties.dataRinBlurhash = metadata.blurhash;
          if (metadata.width) applyImageDimension(properties, 'width', String(metadata.width));
          if (metadata.height) applyImageDimension(properties, 'height', String(metadata.height));
          node.data.hProperties = properties;
        }
        const layout = getRinImageLayout(source, node);
        if (layout) {
          node.data = node.data ?? {};
          node.data.hProperties = {
            ...(node.data.hProperties ?? {}),
            dataRinImageLayout: layout,
          };
        }
      }
      if (Array.isArray(node.children)) node.children.forEach(visit);
    };
    visit(tree);
  };
}

/** Extract image display metadata before rendering and keep resource URLs clean. */
function rehypeImageDimensions() {
  return (tree: any, file: any): void => {
    const source = typeof file?.value === 'string' ? file.value : '';
    const visit = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'element' && node.tagName === 'img' && node.properties) {
        const properties = node.properties as Record<string, any>;
        if (properties.dataRinImageLayout == null) {
          const layout = getRinImageLayout(source, node);
          if (layout) properties.dataRinImageLayout = layout;
        }
        const src = properties.src;
        if (typeof src === 'string') {
          const metadata = parseRinImageUrlMetadata(src);
          if (metadata.src !== src) properties.src = metadata.src;
          if (metadata.blurhash) properties.dataRinBlurhash = metadata.blurhash;
          for (const name of ['width', 'height'] as const) {
            const value = metadata[name];
            if (value && properties[name] == null) applyImageDimension(properties, name, String(value));
          }
        }
      }
      if (Array.isArray(node.children)) node.children.forEach(visit);
    };
    visit(tree);
  };
}

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
      .use(remarkRinImageMetadata)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeKatex)
      .use(rehypeRaw)
      .use(rehypeImageDimensions)
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

export function transformMermaidBlocks(root: HTMLElement): void {
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
  return String(file);
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
