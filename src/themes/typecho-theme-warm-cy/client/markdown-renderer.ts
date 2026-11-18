import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';

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
  root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6').forEach((heading) => {
    if (heading.id) return;
    const text = heading.textContent?.trim() || '';
    if (text) heading.id = text;
  });
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

export async function renderInto(root: HTMLElement, source: string): Promise<void> {
  root.setAttribute('aria-busy', 'true');
  try {
    root.innerHTML = await renderMarkdown(source);
    addHeadingIds(root);
    normalizeImages(root);
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
