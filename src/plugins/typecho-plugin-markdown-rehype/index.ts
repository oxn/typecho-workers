import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { remarkAlert } from 'remark-github-blockquote-alert';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';
import type { PluginInitContext, PluginRouteResult } from 'typecho/plugin-sdk';
import { isAdminActionResponse, requireAdminAction } from '@/lib/admin-auth';
import { registerPluginAdminPath } from '@/lib/plugin';
import katexCss from 'katex/dist/katex.min.css?inline';
import { getRinMermaidConfig } from './mermaid-config';

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



const ADMIN_PREVIEW_PATH = '/api/admin/markdown-rehype-preview';

const MARKDOWN_BRIDGE_MAX_ENTRIES = 32;
const MARKDOWN_BRIDGE_TTL_MS = 60_000;
const markdownBridge = new Map<string, { html: string; createdAt: number }>();

function pruneMarkdownBridge(now = Date.now()): void {
  for (const [token, entry] of markdownBridge) {
    if (now - entry.createdAt > MARKDOWN_BRIDGE_TTL_MS) markdownBridge.delete(token);
  }
  while (markdownBridge.size >= MARKDOWN_BRIDGE_MAX_ENTRIES) {
    const oldest = markdownBridge.keys().next().value;
    if (!oldest) break;
    markdownBridge.delete(oldest);
  }
}

async function renderMarkdownBridgeSource(source: string): Promise<string> {
  const token = 'TYPECHOMARKDOWNREHYPE' + crypto.randomUUID().replace(/-/g, '');
  const html = await renderMarkdown(source);
  pruneMarkdownBridge();
  markdownBridge.set(token, { html, createdAt: Date.now() });
  return token;
}

function restoreMarkdownBridgeHtml(processed: string): string {
  const match = processed.match(/<p>\s*(TYPECHOMARKDOWNREHYPE[a-f0-9]{32})\s*<\/p>/i);
  if (!match) return processed;
  const entry = markdownBridge.get(match[1]);
  markdownBridge.delete(match[1]);
  if (!entry || Date.now() - entry.createdAt > MARKDOWN_BRIDGE_TTL_MS) return processed;
  // renderMarkdown already returns Rin's single .toc-content root.
  // Restore it unchanged so public articles/pages and the admin preview share
  // the same DOM structure and runtime scope.
  return processed.replace(match[0], entry.html);
}


function remarkMermaidVariants() {
  return (tree: any): void => {
    const visit = (node: any): void => {
      if (!node || !Array.isArray(node.children)) return;
      const children = node.children as any[];
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        if (child?.type === 'code' && child.lang === 'mermaid') {
          const source = typeof child.value === 'string' ? child.value : '';
          children.splice(index, 1, {
            type: 'html',
            value: `\n<pre class="rin-mermaid_default dark:hidden">${source}</pre>\n<pre class="rin-mermaid_dark dark:block hidden">${source}</pre>\n`,
          });
          continue;
        }
        visit(child);
      }
    };
    visit(tree);
  };
}

/** Wrap iframes for the existing responsive layout without filtering or rewriting their authored attributes. */
function rehypeRinIframeWrapper() {
  return (tree: any): void => {
    const visit = (parent: any): void => {
      if (!parent || !Array.isArray(parent.children)) return;
      const next: any[] = [];
      for (const child of parent.children) {
        if (child?.type === 'element' && child.tagName === 'iframe') {
          next.push({
            type: 'element',
            tagName: 'div',
            properties: { className: ['rin-iframe-wrapper'] },
            children: [child],
          });
        } else {
          visit(child);
          next.push(child);
        }
      }
      parent.children = next;
    };
    visit(tree);
  };
}

function rehypeRinCodeBlocks() {
  return (tree: any, file: any): void => {
    const source = typeof file?.value === 'string' ? file.value : '';
    const visit = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'element' && node.tagName === 'pre' && Array.isArray(node.children)) {
        const offset = Number(node.position?.start?.offset ?? -1);
        const startsWithFence = offset >= 0 && /^ {0,3}(?:`{3,}|~{3,})/.test(source.slice(offset));
        const code = node.children.find((child: any) => child?.type === 'element' && child.tagName === 'code');
        if (startsWithFence && code) {
          node.tagName = 'div';
          node.properties = { className: ['rin-code-pre', 'rounded'] };
        }
      }
      if (Array.isArray(node.children)) node.children.forEach(visit);
    };
    visit(tree);
  };
}

function rehypeRinSemanticComponents() {
  return (tree: any): void => {
    const addClasses = (node: any, classes: string[]): void => {
      node.properties = node.properties || {};
      const current = Array.isArray(node.properties.className)
        ? node.properties.className
        : typeof node.properties.className === 'string'
          ? node.properties.className.split(/\s+/).filter(Boolean)
          : [];
      node.properties.className = [...new Set([...current, ...classes])];
    };
    const visit = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'element') {
        if (node.tagName === 'table') addClasses(node, ['table', 'block', 'max-w-full', 'overflow-x-auto']);
        if (node.tagName === 'th') addClasses(node, ['px-4', 'py-2', 'border', 'bg-gray-600']);
        if (node.tagName === 'td') addClasses(node, ['px-4', 'py-2', 'border']);
        if (node.tagName === 'sup' || node.tagName === 'sub') addClasses(node, ['text-xs', 'mr-[4px]']);
        if (node.tagName === 'section' && Object.prototype.hasOwnProperty.call(node.properties || {}, 'dataFootnotes')) {
          addClasses(node, ['mt-8']);
          for (const child of node.children || []) {
            if (child?.type === 'element' && child.tagName === 'ol') {
              child.properties = child.properties || {};
              child.properties.className = ['list-decimal', 'px-10', 'text-sm', 'text-[#6B7280]'];
            }
          }
        }
      }
      if (Array.isArray(node.children)) node.children.forEach(visit);
    };
    visit(tree);
  };
}

function rehypeRinHeadingIds() {
  const childToString = (child: any): string => child?.type === 'text' && typeof child.value === 'string'
    ? child.value
    : '[object Object]';
  return (tree: any): void => {
    const visit = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'element' && /^h[1-6]$/.test(node.tagName || '')) {
        node.properties = node.properties || {};
        // Rin sets the derived id before spreading incoming heading props;
        // an explicit id from raw HTML therefore takes precedence.
        if (node.properties.id == null) {
          const children = Array.isArray(node.children) ? node.children : [];
          node.properties.id = children.length === 1
            ? childToString(children[0])
            : children.map(childToString).join(',');
        }
        const existingStyle = typeof node.properties.style === 'string' ? node.properties.style : '';
        const withoutScrollMargin = existingStyle.replace(/(?:^|;)\s*scroll-margin-top\s*:[^;]*/gi, '');
        node.properties.style = (withoutScrollMargin ? withoutScrollMargin.replace(/;?\s*$/, ';') : '') +
          'scroll-margin-top:var(--header-scroll-offset, 7rem)';
      }
      if (Array.isArray(node.children)) node.children.forEach(visit);
    };
    visit(tree);
  };
}

/**
 * Build one immutable processor shared by article rendering and editor preview.
 * Unified freezes a processor on first process() and supports repeated processing.
 * Reuse avoids rebuilding the plugin chain for every article request.
 */
function createMarkdownProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMermaidVariants)
    .use(remarkMath)
    .use(remarkAlert)
    .use(remarkBreaks)
    .use(remarkRinImageMetadata)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeKatex)
    .use(rehypeRaw)
    .use(rehypeImageDimensions)
    .use(rehypeRinCodeBlocks)
    .use(rehypeRinIframeWrapper)
    .use(rehypeRinSemanticComponents)
    .use(rehypeRinHeadingIds)
    .use(rehypeStringify);
}

const markdownProcessor = createMarkdownProcessor();

export class MarkdownRenderCapacityError extends Error {
  constructor(message = 'Markdown preview capacity is temporarily full') {
    super(message);
    this.name = 'MarkdownRenderCapacityError';
  }
}

type MarkdownRenderQueueWaiter = {
  resolve: () => void;
  timer: ReturnType<typeof setTimeout>;
};

export function createBoundedConcurrencyGate(maxConcurrent: number, maxPending: number, waitTimeoutMs: number) {
  const concurrencyLimit = Math.max(1, Math.floor(maxConcurrent));
  const pendingLimit = Math.max(0, Math.floor(maxPending));
  const waiting: MarkdownRenderQueueWaiter[] = [];
  let active = 0;

  const releaseSlot = (): void => {
    const next = waiting.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve();
      return;
    }
    active = Math.max(0, active - 1);
  };

  const acquireSlot = (): Promise<() => void> => {
    if (active < concurrencyLimit) {
      active += 1;
      return Promise.resolve(releaseSlot);
    }
    if (waiting.length >= pendingLimit) {
      return Promise.reject(new MarkdownRenderCapacityError());
    }

    return new Promise((resolve, reject) => {
      const waiter = {} as MarkdownRenderQueueWaiter;
      waiter.resolve = () => {
        clearTimeout(waiter.timer);
        resolve(releaseSlot);
      };
      waiter.timer = setTimeout(() => {
        const index = waiting.indexOf(waiter);
        if (index < 0) return;
        waiting.splice(index, 1);
        reject(new MarkdownRenderCapacityError('Markdown preview queue wait timed out'));
      }, Math.max(1, waitTimeoutMs));
      waiting.push(waiter);
    });
  };

  return async function run<T>(task: () => Promise<T> | T): Promise<T> {
    const release = await acquireSlot();
    try {
      return await task();
    } finally {
      release();
    }
  };
}

const MARKDOWN_RENDER_MAX_CONCURRENT = 1;
const MARKDOWN_RENDER_MAX_PENDING = 4;
const MARKDOWN_RENDER_QUEUE_WAIT_TIMEOUT_MS = 5_000;
const MARKDOWN_RENDER_MAX_TRACKED_IN_FLIGHT =
  MARKDOWN_RENDER_MAX_CONCURRENT + MARKDOWN_RENDER_MAX_PENDING;
const runMarkdownRender = createBoundedConcurrencyGate(
  MARKDOWN_RENDER_MAX_CONCURRENT,
  MARKDOWN_RENDER_MAX_PENDING,
  MARKDOWN_RENDER_QUEUE_WAIT_TIMEOUT_MS,
);

export class PreviewRequestBodyTooLargeError extends Error {
  constructor() {
    super('Preview request body is too large');
    this.name = 'PreviewRequestBodyTooLargeError';
  }
}

export const MARKDOWN_PREVIEW_MAX_BODY_BYTES = 1_000_000;
export const MARKDOWN_PREVIEW_MAX_SOURCE_LENGTH = 100_000;

/** Read a request stream with a byte ceiling before JSON.parse allocates the full payload. */
export async function readPreviewRequestBodyText(
  request: Request,
  maxBytes = MARKDOWN_PREVIEW_MAX_BODY_BYTES,
): Promise<string> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
    throw new PreviewRequestBodyTooLargeError();
  }

  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try { await reader.cancel(); } catch { /* The size limit still takes precedence. */ }
        throw new PreviewRequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(body);
}

/**
 * Reuse completed renders across requests in the same Worker isolate.
 * The exact source is the cache key; no probabilistic hash is used, so a
 * collision cannot return another article's HTML. Entry count and retained
 * string size are bounded.
 */
const RENDERED_MARKDOWN_CACHE_MAX_ENTRIES = 12;
const RENDERED_MARKDOWN_CACHE_MAX_WEIGHT = 1_500_000;
const RENDERED_MARKDOWN_CACHE_MAX_ENTRY_WEIGHT = 750_000;
const RENDERED_MARKDOWN_CACHE_MAX_SOURCE_LENGTH = 100_000;

type RenderedMarkdownCacheEntry = { html: string; weight: number };
const renderedMarkdownCache = new Map<string, RenderedMarkdownCacheEntry>();
const inFlightMarkdownRenders = new Map<string, Promise<string>>();
let renderedMarkdownCacheWeight = 0;

function getCachedMarkdownRender(key: string): string | undefined {
  const entry = renderedMarkdownCache.get(key);
  if (!entry) return undefined;
  renderedMarkdownCache.delete(key);
  renderedMarkdownCache.set(key, entry);
  return entry.html;
}

function cacheMarkdownRender(key: string, html: string): void {
  const weight = key.length + html.length;
  if (weight > RENDERED_MARKDOWN_CACHE_MAX_ENTRY_WEIGHT) return;

  const previous = renderedMarkdownCache.get(key);
  if (previous) {
    renderedMarkdownCacheWeight -= previous.weight;
    renderedMarkdownCache.delete(key);
  }

  while (
    renderedMarkdownCache.size >= RENDERED_MARKDOWN_CACHE_MAX_ENTRIES ||
    renderedMarkdownCacheWeight + weight > RENDERED_MARKDOWN_CACHE_MAX_WEIGHT
  ) {
    const oldest = renderedMarkdownCache.entries().next().value as
      [string, RenderedMarkdownCacheEntry] | undefined;
    if (!oldest) break;
    renderedMarkdownCache.delete(oldest[0]);
    renderedMarkdownCacheWeight -= oldest[1].weight;
  }

  renderedMarkdownCache.set(key, { html, weight });
  renderedMarkdownCacheWeight += weight;
}

function clearMarkdownRenderCache(): void {
  renderedMarkdownCache.clear();
  renderedMarkdownCacheWeight = 0;
}

/** Typecho-compatible Markdown pipeline: raw HTML is passed through without plugin-side filtering. */
export async function renderMarkdown(source: string): Promise<string> {
  if (!source) return '';
  // Keep the public renderer and the editor preview on the same Typecho input
  // contract. The shared frontend hook strips these markers before invoking
  // this renderer; preview requests call it directly, so normalize here too.
  const normalizedSource = source
    .replace(/^<!--markdown-->/, '')
    .replace(/<!--more-->/g, '');
  const cacheKey = normalizedSource.length <= RENDERED_MARKDOWN_CACHE_MAX_SOURCE_LENGTH
    ? normalizedSource
    : null;

  if (cacheKey) {
    const cached = getCachedMarkdownRender(cacheKey);
    if (cached !== undefined) return cached;

    // Separate tabs or users can submit the same article at nearly the same
    // time. Share that exact render instead of running KaTeX/highlight twice.
    const inFlight = inFlightMarkdownRenders.get(cacheKey);
    if (inFlight) return inFlight;
  }

  const processor = markdownProcessor;
  // The cache and in-flight lookup happen before the gate, so cache hits never
  // wait for a render slot and identical concurrent requests still share work.
  const render = runMarkdownRender(async () => {
    const file = await processor.process(normalizedSource);
    const html = '<div class="toc-content min-w-0">' + String(file) + '</div>';
    if (cacheKey) cacheMarkdownRender(cacheKey, html);
    return html;
  });

  if (!cacheKey || inFlightMarkdownRenders.size >= MARKDOWN_RENDER_MAX_TRACKED_IN_FLIGHT) {
    return render;
  }

  inFlightMarkdownRenders.set(cacheKey, render);
  try {
    return await render;
  } finally {
    if (inFlightMarkdownRenders.get(cacheKey) === render) {
      inFlightMarkdownRenders.delete(cacheKey);
    }
  }
}


function createAdminPreviewScript(): string {
  const katexCssValue = JSON.stringify(katexCss).replace(/</g, '\\u003c');
  // Embed the shared public-content initializer into the iframe document.
  // The editor script runs in the admin page, so its server-side helper is
  // not available as a browser global inside the generated preview document.
  const contentRuntimeScriptValue = JSON.stringify(createPublicContentRuntimeScript()).replace(/</g, '\\u003c');
  // The editor preview uses the same browser runtime as public content.

  return `<script type="module" data-markdown-rehype-live-preview>
(() => {
  const katexCss = ${katexCssValue};
  const contentRuntimeScript = ${contentRuntimeScriptValue};
  // The editor creates #wmd-preview inside its jQuery ready callback.
  // A module script can run before that callback, so wait for the complete
  // editor DOM instead of permanently abandoning preview initialization.
  if (!/\\/admin\\/write-(?:post|page)\\/?$/.test(window.location.pathname)) return;
  let initialized = false;
  function initialize() {
    if (initialized) return true;
    const preview = document.getElementById('wmd-preview');
    const form = document.querySelector('form[name="write_post"], form[name="write_page"]');
    const textarea = form && form.querySelector('#text[name="text"]');
    const token = form && form.querySelector('input[name="_"]');
    // The markdown marker is conditional (it is absent for non-Markdown
    // editor modes) and is not needed by the preview API. Do not let it block
    // initialization of the live preview.
    if (!preview || !form || !textarea || !token) return false;
    initialized = true;

  const frame = document.createElement('iframe');
  frame.className = 'markdown-rehype-preview-frame';
  frame.title = 'Markdown Rehype 同步预览';
  frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-presentation');
  frame.setAttribute('referrerpolicy', 'same-origin');
  frame.style.cssText = 'display:block;width:100%;height:100%;min-height:0;box-sizing:border-box;border:1px solid #D9D9D6;border-radius:2px;background:#fff;';
  preview.replaceChildren(frame);

  // Reuse the very same native resize element in both tabs. Moving this
  // original node preserves its exact CSS selector matching, DOM, and the
  // Typecho resize event handlers already attached by the editor page.
  const nativeResizeHandle = textarea.nextElementSibling;
  function syncNativeResizeHandleLocation() {
    if (!nativeResizeHandle || !nativeResizeHandle.classList.contains('resize')) return;
    if (preview.classList.contains('wmd-hidetab')) {
      if (nativeResizeHandle.parentElement !== textarea.parentElement ||
          nativeResizeHandle.previousElementSibling !== textarea) {
        textarea.insertAdjacentElement('afterend', nativeResizeHandle);
      }
    } else if (nativeResizeHandle.parentElement !== preview.parentElement ||
               nativeResizeHandle.previousElementSibling !== preview) {
      preview.insertAdjacentElement('afterend', nativeResizeHandle);
    }
  }
  syncNativeResizeHandleLocation();
  if (window.MutationObserver) {
    const previewTabObserver = new MutationObserver(syncNativeResizeHandleLocation);
    previewTabObserver.observe(preview, { attributes: true, attributeFilter: ['class'] });
  }
  // Keep the preview width fluid so it follows its shared editor column even
  // while the native textarea is hidden by the preview tab.
  // Cache the editor height while it is measurable; the preview tab hides it.
  let editorHeight = 0;
  function enforcePreviewLayout() {
    const editorRect = textarea.getBoundingClientRect();
    const measuredHeight = Math.round(editorRect.height);
    if (measuredHeight > 0) editorHeight = measuredHeight;
    if (preview.style.getPropertyValue('width') !== '100%' ||
        preview.style.getPropertyPriority('width') !== 'important') {
      preview.style.setProperty('width', '100%', 'important');
    }
    if (preview.style.getPropertyValue('box-sizing') !== 'border-box' ||
        preview.style.getPropertyPriority('box-sizing') !== 'important') {
      preview.style.setProperty('box-sizing', 'border-box', 'important');
    }
    if (editorHeight > 0) {
      const height = editorHeight + 'px';
      if (preview.style.getPropertyValue('height') !== height ||
          preview.style.getPropertyPriority('height') !== 'important') {
        preview.style.setProperty('height', height, 'important');
      }
    }
    if (preview.style.getPropertyValue('min-height') !== '0px' ||
        preview.style.getPropertyPriority('min-height') !== 'important') {
      preview.style.setProperty('min-height', '0', 'important');
    }
    // Match the native editor area's vertical spacing so switching tabs
    // does not move the surrounding page up or down.
    const editorArea = textarea.parentElement;
    const editorMargin = editorArea ? getComputedStyle(editorArea).margin : '0px';
    if (preview.style.getPropertyValue('margin') !== editorMargin ||
        preview.style.getPropertyPriority('margin') !== 'important') {
      preview.style.setProperty('margin', editorMargin, 'important');
    }
    if (preview.style.getPropertyValue('padding') !== '0px' ||
        preview.style.getPropertyPriority('padding') !== 'important') {
      preview.style.setProperty('padding', '0', 'important');
    }
    if (preview.style.getPropertyValue('max-height') !== 'none' ||
        preview.style.getPropertyPriority('max-height') !== 'important') {
      preview.style.setProperty('max-height', 'none', 'important');
    }
    if (preview.style.getPropertyValue('overflow') !== 'hidden' ||
        preview.style.getPropertyPriority('overflow') !== 'important') {
      preview.style.setProperty('overflow', 'hidden', 'important');
    }
    frame.style.height = '100%';
    frame.style.minHeight = '0';
  }
  enforcePreviewLayout();
  window.addEventListener('resize', enforcePreviewLayout);
  if (window.ResizeObserver) {
    const editorSizeObserver = new ResizeObserver(enforcePreviewLayout);
    editorSizeObserver.observe(textarea);
  }

  let sequence = 0;
  let timer = null;
  let hasRenderedPreview = false;
  // Keep expensive server-side rendering out of the hidden editor tab and
  // coalesce changes while a previous render is still running.
  let renderInFlight = false;
  let renderPending = false;
  let lastRenderedSource = null;
  let requestedVersion = 0;
  let previewKatexCssPromise = null;

  function isPreviewVisible() {
    return !preview.classList.contains('wmd-hidetab');
  }
  frame.srcdoc = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body style="box-sizing:border-box;margin:0;padding:0 15px;font:14px/1.7 system-ui,sans-serif;color:#77817b;background:#fff">正在加载 Markdown 预览…</body></html>';
  const isDarkMode = () =>
    document.documentElement.classList.contains('dark') ||
    document.body.classList.contains('dark') ||
    document.documentElement.getAttribute('data-color-mode') === 'dark' ||
    document.body.getAttribute('data-color-mode') === 'dark';

  async function inlineKatexFontAssets(css) {
    // Vite's inline CSS can contain an extra pair of parentheses around
    // emitted root-relative asset URLs. Parse the url() token, normalize that
    // wrapper, and resolve site assets from the origin root (not /admin/).
    const urlPattern = /url\\(\\s*((?:[^()]|\\([^)]*\\))*)\\s*\\)/gi;
    const normalizeUrl = (value) => value.trim()
      .replace(/^(['"])([\\s\\S]*)\\1$/, '$2')
      .trim()
      .replace(/^\\(+/, '')
      .replace(/\\)+$/, '');
    const assetPromises = new Map();

    for (const match of css.matchAll(urlPattern)) {
      const rawUrl = normalizeUrl(match[1]);
      if (!/\\.(?:woff2?|ttf|otf)(?:[?#].*)?$/i.test(rawUrl)) continue;

      let assetUrl;
      try {
        assetUrl = new URL(rawUrl, window.location.origin + '/');
      } catch {
        continue;
      }
      if (assetUrl.origin !== window.location.origin) continue;

      if (!assetPromises.has(assetUrl.href)) {
        assetPromises.set(assetUrl.href, (async () => {
          const response = await fetch(assetUrl.href, { credentials: 'same-origin' });
          if (!response.ok) {
            throw new Error('KaTeX font request failed: ' + response.status + ' ' + assetUrl.pathname);
          }
          const buffer = await response.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let offset = 0; offset < bytes.length; offset += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
          }
          const extension = assetUrl.pathname.split('.').pop().toLowerCase();
          const mime = response.headers.get('content-type') ||
            (extension === 'woff2' ? 'font/woff2' : extension === 'woff' ? 'font/woff' : extension === 'otf' ? 'font/otf' : 'font/ttf');
          return 'data:' + mime.split(';')[0] + ';base64,' + btoa(binary);
        })().catch(error => {
          console.error('KaTeX preview font could not be embedded:', error);
          return null;
        }));
      }
    }

    const embeddedAssets = new Map(await Promise.all(
      Array.from(assetPromises, async ([url, promise]) => [url, await promise])
    ));

    return css.replace(urlPattern, (original, token) => {
      const rawUrl = normalizeUrl(token);
      if (!/\\.(?:woff2?|ttf|otf)(?:[?#].*)?$/i.test(rawUrl)) return original;

      let assetUrl;
      try {
        assetUrl = new URL(rawUrl, window.location.origin + '/');
      } catch {
        return original;
      }
      if (assetUrl.origin !== window.location.origin) return original;
      const dataUrl = embeddedAssets.get(assetUrl.href);
      return dataUrl ? 'url("' + dataUrl + '")' : original;
    });
  }

  function getPreviewKatexCss() {
    if (!previewKatexCssPromise) {
      // KaTeX font assets are immutable for this page lifetime. Share the
      // first embedding pass across preview updates instead of refetching and
      // base64-encoding the same fonts after every edit.
      previewKatexCssPromise = inlineKatexFontAssets(katexCss);
    }
    return previewKatexCssPromise;
  }

  async function createPreviewDocument(payload) {
    const dark = isDarkMode();
    const previewKatexCss = await getPreviewKatexCss();
    const bodyClass = 'markdown-rehype-preview' + (dark ? ' is-dark' : '');
    const htmlClass = dark ? 'dark' : '';
    const source = typeof payload.html === 'string' ? payload.html : '';
    const previewCss = 'html,body{margin:0!important;padding:0!important;min-height:0!important;}body.markdown-rehype-preview{box-sizing:border-box;min-width:0;overflow-x:hidden;padding:14px 16px;color:#24292f;background:#fff;font:15px/1.75 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}body.markdown-rehype-preview.is-dark{color:#e6edf3;background:#0d1117;color-scheme:dark;}.markdown-rehype-content{min-width:0;overflow-wrap:anywhere;}';
    return '<!doctype html><html lang="zh-CN" class="' + htmlClass + '"><head>' +
      '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style data-markdown-rehype-katex>' + previewCss + previewKatexCss + '</style>' +
      '</head><body class="' + bodyClass + '">' +
      '<main class="markdown-rehype-content">' + source + '</main>' +
      '<script>(function(){' +
        'function notify(){var root=document.documentElement,body=document.body,rect=body.getBoundingClientRect();var h=Math.ceil(Math.max(root.scrollHeight,body.scrollHeight,root.offsetHeight,body.offsetHeight,rect.bottom+window.scrollY));window.parent.postMessage({type:"markdown-rehype-preview-height",height:h},"*");}' +
        'if(window.ResizeObserver){var ro=new ResizeObserver(notify);ro.observe(document.documentElement);ro.observe(document.body);}' +
        'window.addEventListener("load",notify);window.addEventListener("resize",notify);setTimeout(notify,80);setTimeout(notify,350);window.__rinMarkdownContentRendered=notify;' +

      '})();' + '</scr' + 'ipt>' +
      contentRuntimeScript +
      '</body></html>';
  }

  function render() {
    timer = null;
    if (!isPreviewVisible()) {
      renderPending = true;
      return;
    }
    if (renderInFlight) {
      renderPending = true;
      return;
    }

    const source = textarea.value;
    if (hasRenderedPreview && source === lastRenderedSource) {
      renderPending = false;
      return;
    }

    const current = ++sequence;
    const version = requestedVersion;
    renderPending = false;
    renderInFlight = true;

    fetch('/api/admin/markdown-rehype-preview', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token.value },
      body: JSON.stringify({ text: source })
    }).then(response => {
      if (!response.ok) throw new Error('Markdown preview request failed');
      return response.json();
    }).then(payload => {
      if (current !== sequence || version !== requestedVersion ||
          source !== textarea.value || !isPreviewVisible() ||
          !payload || typeof payload.html !== 'string') return;
      return createPreviewDocument(payload).then(previewDocument => {
        if (current !== sequence || version !== requestedVersion ||
            source !== textarea.value || !isPreviewVisible()) return;
        frame.srcdoc = previewDocument;
        hasRenderedPreview = true;
        lastRenderedSource = source;
      });
    }).catch(error => {
      // Preserve the last good document, but never leave the initial preview
      // as an unexplained white iframe when the first request fails.
      if (!hasRenderedPreview && current === sequence && version === requestedVersion) {
        const message = error instanceof Error ? error.message : '未知错误';
        frame.srcdoc = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body style="margin:0;padding:0 15px;font:14px/1.7 system-ui,sans-serif;color:#a33;background:#fff"><strong>Markdown 预览暂时无法加载</strong><p style="white-space:pre-wrap"></p></body><script>document.querySelector("p").textContent=' + JSON.stringify(message) + ';' + '</scr' + 'ipt></html>';
      }
    }).finally(() => {
      renderInFlight = false;
      // At most one server render runs at a time. If the source changed while
      // it was running, render only the latest source after the debounce.
      if (renderPending && isPreviewVisible()) schedule();
    });
  }

  function schedule() {
    requestedVersion += 1;
    renderPending = true;
    if (timer) clearTimeout(timer);
    timer = null;
    if (!isPreviewVisible() || renderInFlight) return;
    timer = setTimeout(render, 700);
  }

  textarea.addEventListener('input', schedule);
  textarea.addEventListener('change', schedule);
  window.__rinMarkdownRehypePreviewRefresh = schedule;

  const previewObserver = new MutationObserver(() => {
    enforcePreviewLayout();
    if (!isPreviewVisible()) {
      if (timer) clearTimeout(timer);
      timer = null;
      renderPending = true;
      return;
    }
    if (!preview.contains(frame)) {
      preview.replaceChildren(frame);
      renderPending = true;
    }
    // Typecho toggles this class when the editor switches between source and
    // preview tabs. Defer remote rendering until the preview is actually shown.
    if (renderPending) schedule();
  });
  previewObserver.observe(preview, {
    childList: true,
    attributes: true,
    attributeFilter: ['style', 'class']
  });

  const themeObserver = new MutationObserver(schedule);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-color-mode'] });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-color-mode'] });
  schedule();
    return true;
  }

  if (!initialize()) {
    const editorDomObserver = new MutationObserver(() => {
      if (initialize()) editorDomObserver.disconnect();
    });
    editorDomObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
</script>`;
}


/** Inject admin presentation for the declarative plugin settings form. */
const markdownRehypeAdminCss = [
  '.markdown-rehype-settings-page .typecho-option { margin: 0 0 16px !important; padding: 20px 22px !important; border: 1px solid #e5e9e7 !important; border-radius: 10px !important; background: #fff !important; box-shadow: 0 2px 9px rgba(20, 40, 30, .035) !important; }',
  '.markdown-rehype-settings-page .typecho-option > li { padding: 0 !important; }',
  '.markdown-rehype-settings-page .typecho-option input[type="checkbox"] { accent-color: #269b63; }',
  '.markdown-rehype-settings-page .typecho-option p.description, .markdown-rehype-settings-page .typecho-option .description { margin: 8px 0 0 !important; color: #77817b; font-size: 13px; line-height: 1.7; }',
  '.markdown-rehype-settings-page .typecho-option-submit { padding: 0 !important; border: 0 !important; background: transparent !important; box-shadow: none !important; }',
  '.markdown-rehype-settings-page .typecho-option-submit > li { padding: 0 !important; }',
  '.markdown-rehype-settings-page .typecho-option-submit .btn { border-color: #269b63; border-radius: 6px; background: #269b63; color: #fff; }',
  '.markdown-rehype-settings-page .markdown-rehype-toolbar { display: flex; justify-content: flex-end; margin: 0 0 14px; }',
  '.markdown-rehype-settings-page .markdown-rehype-toolbar a { display: inline-flex; align-items: center; padding: 7px 12px; border: 1px solid #dce4df; border-radius: 7px; background: #fff; color: #269b63 !important; text-decoration: none; font-size: 13px; }',
  '.markdown-rehype-settings-page .markdown-rehype-toolbar a:hover { border-color: #269b63; background: #f5fbf7; }',
  '@media (max-width: 767px) { .markdown-rehype-settings-page .typecho-option { padding: 16px !important; } }',
].join('\n');


function createPublicContentRuntimeScript(): string {
  const mermaidConfigs = JSON.stringify({
    light: getRinMermaidConfig(false),
    dark: getRinMermaidConfig(true),
  }).replace(/</g, '\\u003c');
  const katexCssValue = JSON.stringify(katexCss).replace(/</g, '\\u003c');

  return `<script data-markdown-rehype-content-runtime>
(() => {
  if (window.__rinMarkdownContentRuntime) return;
  window.__rinMarkdownContentRuntime = true;
  const mermaidConfigs = ${mermaidConfigs};
  const katexCss = ${katexCssValue};
  let mermaidLoad = null;

  const ensureKatexCss = () => {
    if (!document.querySelector('.katex') || document.querySelector('[data-markdown-rehype-katex]')) return;
    const style = document.createElement('style');
    style.dataset.markdownRehypeKatex = '1';
    style.textContent = katexCss;
    document.head.append(style);
  };

  let rinRuntimeLoad = null;
  const loadRinRuntime = () => {
    if (!document.querySelector('.toc-content')) return Promise.resolve();
    if (window.__rinMarkdownRuntime) {
      window.__rinMarkdownRuntime.initialize();
      return Promise.resolve();
    }
    if (rinRuntimeLoad) return rinRuntimeLoad;
    rinRuntimeLoad = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/plugin-assets/typecho-plugin-markdown-rehype/markdown-runtime.js';
      script.async = true;
      script.onload = () => {
        if (window.__rinMarkdownRuntime) {
          window.__rinMarkdownRuntime.initialize();
          resolve();
        } else reject(new Error('Rin Markdown runtime did not initialize'));
      };
      script.onerror = () => reject(new Error('Rin Markdown runtime failed to load'));
      document.head.append(script);
    }).catch(error => {
      rinRuntimeLoad = null;
      console.error('Rin Markdown runtime failed:', error);
    });
    return rinRuntimeLoad;
  };

  const loadMermaid = () => {
    if (window.__rinMermaidRuntime) return Promise.resolve(window.__rinMermaidRuntime);
    if (mermaidLoad) return mermaidLoad;
    mermaidLoad = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/plugin-assets/typecho-plugin-markdown-rehype/mermaid-runtime.js';
      script.async = true;
      script.onload = () => window.__rinMermaidRuntime
        ? resolve(window.__rinMermaidRuntime)
        : reject(new Error('Mermaid runtime did not expose its renderer'));
      script.onerror = () => reject(new Error('Mermaid runtime failed to load'));
      document.head.append(script);
    }).catch(error => {
      // A transient asset/network failure must not poison every later render
      // attempt with the same permanently rejected promise.
      mermaidLoad = null;
      console.error('Rin Mermaid runtime failed to load:', error);
      throw error;
    });
    return mermaidLoad;
  };

  const renderMermaidVariant = async (mermaid, nodes, config) => {
    if (!nodes.length) return;
    const restore = [];
    nodes.forEach(node => {
      if (getComputedStyle(node).display !== 'none') return;
      restore.push({
        node,
        display: node.style.getPropertyValue('display'),
        displayPriority: node.style.getPropertyPriority('display'),
        visibility: node.style.getPropertyValue('visibility'),
        visibilityPriority: node.style.getPropertyPriority('visibility'),
      });
      node.style.setProperty('display', 'block', 'important');
      node.style.setProperty('visibility', 'hidden', 'important');
    });
    try {
      mermaid.initialize(config);
      await mermaid.run({ nodes });
    } finally {
      restore.forEach(item => {
        if (item.display) item.node.style.setProperty('display', item.display, item.displayPriority);
        else item.node.style.removeProperty('display');
        if (item.visibility) item.node.style.setProperty('visibility', item.visibility, item.visibilityPriority);
        else item.node.style.removeProperty('visibility');
      });
    }
  };

  const renderMermaid = async () => {
    const light = [...document.querySelectorAll('pre.rin-mermaid_default:not([data-processed])')];
    const dark = [...document.querySelectorAll('pre.rin-mermaid_dark:not([data-processed])')];
    if (!light.length && !dark.length) return;
    const mermaid = await loadMermaid();
    await renderMermaidVariant(mermaid, light, mermaidConfigs.light);
    await renderMermaidVariant(mermaid, dark, mermaidConfigs.dark);
  };

  // Mermaid has global configuration and shared runtime state. Serialize every
  // batch so a navigation cannot interleave light/dark rendering from two pages.
  let mermaidRenderQueue = Promise.resolve();
  const queueMermaidRender = () => {
    mermaidRenderQueue = mermaidRenderQueue
      .then(renderMermaid)
      .catch(error => {
        console.error('Markdown Mermaid rendering failed:', error);
      });
    return mermaidRenderQueue;
  };

  const hasUnprocessedMermaid = node => {
    if (!node || node.nodeType !== 1) return false;
    const selector = 'pre.rin-mermaid_default:not([data-processed]), pre.rin-mermaid_dark:not([data-processed])';
    return node.matches(selector) || Boolean(node.querySelector(selector));
  };

  // InstantClick replaces the body and re-executes its scripts before emitting
  // newpage. Observe actual DOM insertion as a second, lifecycle-independent
  // signal; this also covers content roots populated after the event.
  const mermaidObserver = new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes].some(hasUnprocessedMermaid))) {
      void queueMermaidRender();
    }
  });
  mermaidObserver.observe(document.documentElement, { childList: true, subtree: true });

  const renderContent = () => {
    ensureKatexCss();
    loadRinRuntime();
    void queueMermaidRender().then(() => {
      if (typeof window.__rinMarkdownContentRendered === 'function') {
        window.__rinMarkdownContentRendered();
      }
    });
  };

  renderContent();
  window.addEventListener('instantclick:newpage', renderContent);
})();
</script>`;
}

export default function init({ addHook, pluginId }: PluginInitContext): void {

  // Let the plugin own Markdown rendering for every theme that uses the shared
  // content renderer. The final replacement restores the plugin's rendered HTML;
  // the plugin does not add another HTML filtering layer.
  addHook('content:markdown', pluginId, async (source: string) => {
    if (typeof source !== 'string' || !source) return source;
    return renderMarkdownBridgeSource(source);
  }, 1000);

  addHook('content:content', pluginId, (html: string) => {
    return typeof html === 'string' ? restoreMarkdownBridgeHtml(html) : html;
  }, 1000);

  // Public content enhancements belong to the renderer plugin, not a theme.
  // Mermaid is loaded only when matching content exists.
  addHook('archive:footer', pluginId, (html: string) => {
    return html + createPublicContentRuntimeScript();
  }, 1000);

  // This preview endpoint is plugin-owned; explicitly allow it through the admin route guard.
  registerPluginAdminPath(ADMIN_PREVIEW_PATH);

  addHook('route:request', pluginId, async (
    result: PluginRouteResult,
    extra?: { request?: Request; path?: string },
  ) => {
    if (result?.handled || !extra?.request) return result;
    const request = extra.request;
    const path = extra.path || new URL(request.url).pathname;
    if (path !== ADMIN_PREVIEW_PATH) return result;
    if (request.method !== 'POST') {
      return { handled: true, response: new Response('Method not allowed', { status: 405 }) };
    }

    const auth = await requireAdminAction(request, 'contributor');
    if (isAdminActionResponse(auth)) {
      return { handled: true, response: new Response(auth.status === 401 ? 'Unauthorized' : 'Forbidden', { status: auth.status }) };
    }
    let body: unknown;
    try {
      const bodyText = await readPreviewRequestBodyText(request);
      body = JSON.parse(bodyText);
    } catch (error) {
      if (error instanceof PreviewRequestBodyTooLargeError) {
        return { handled: true, response: new Response('Preview request body is too large', { status: 413 }) };
      }
      return { handled: true, response: new Response('Invalid JSON', { status: 400 }) };
    }
    if (!body || typeof body !== 'object' || typeof (body as { text?: unknown }).text !== 'string') {
      return { handled: true, response: new Response('Invalid preview content', { status: 400 }) };
    }
    const source = (body as { text: string }).text;
    if (source.length > MARKDOWN_PREVIEW_MAX_SOURCE_LENGTH) {
      return { handled: true, response: new Response('Preview content is too large', { status: 413 }) };
    }

    try {
      const html = await renderMarkdown(source);
      return {
        handled: true,
        response: new Response(JSON.stringify({ html }), {
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        }),
      };
    } catch (error) {
      if (error instanceof MarkdownRenderCapacityError) {
        return {
          handled: true,
          response: new Response('Markdown preview is busy; please retry shortly', {
            status: 503,
            headers: { 'Retry-After': '2' },
          }),
        };
      }
      return { handled: true, response: new Response('Markdown preview failed', { status: 500 }) };
    }
  }, 20);

  addHook('plugin:config:beforeSave', pluginId, (result: any, extra?: { pluginId?: string }) => {
    if (extra?.pluginId === pluginId) {
      clearMarkdownRenderCache();
    }
    return result;
  }, 20);

  addHook('admin:header', pluginId, (html: string, extra?: {
    title?: string;
    options?: Record<string, unknown>;
  }) => {
    if (extra?.title !== '设置插件 Markdown Rehype') return html;
    return html + '<style data-markdown-rehype-admin>' + markdownRehypeAdminCss + '</style>';
  }, 20);

  addHook('admin:footer', pluginId, (html: string, extra?: {
    options?: Record<string, unknown>;
  }) => {
    const script = [
      '<script data-markdown-rehype-admin-navigation>',
      '(function () {',
      '  if (window.location.pathname !== \'/admin/plugin-config\'',
      '    || new URLSearchParams(window.location.search).get(\'id\') !== \'typecho-plugin-markdown-rehype\') return;',
      '  document.body.classList.add(\'markdown-rehype-settings-page\');',
      '  var form = document.querySelector(\'form[action^="/admin/plugin-config"]\');',
      '  if (!form) return;',
      '  if (!form.previousElementSibling || !form.previousElementSibling.classList.contains(\'markdown-rehype-toolbar\')) {',
      '    var toolbar = document.createElement(\'div\');',
      '    toolbar.className = \'markdown-rehype-toolbar\';',
      '    var link = document.createElement(\'a\');',
      '    link.href = \'/admin/plugins\';',
      '    link.textContent = \'返回插件列表\';',
      '    toolbar.append(link);',
      '    form.before(toolbar);',
      '  }',
      "  var initialConfigValues = Array.prototype.map.call(form.querySelectorAll('input[name], textarea[name], select[name]'), function (field) {",
      "    return [field.name, field.type === 'checkbox' || field.type === 'radio' ? field.checked : field.value];",
      "  });",
      "  var unchangedNotice = document.createElement('p');",
      "  unchangedNotice.className = 'description';",
      "  unchangedNotice.setAttribute('role', 'status');",
      "  unchangedNotice.setAttribute('aria-live', 'polite');",
      "  unchangedNotice.style.marginTop = '8px';",
      "  unchangedNotice.textContent = '';",
      "  form.appendChild(unchangedNotice);",
      "  var hasConfigChanges = function () {",
      "    var currentValues = Array.prototype.map.call(form.querySelectorAll('input[name], textarea[name], select[name]'), function (field) {",
      "      return [field.name, field.type === 'checkbox' || field.type === 'radio' ? field.checked : field.value];",
      "    });",
      "    if (currentValues.length !== initialConfigValues.length) return true;",
      "    return currentValues.some(function (value, index) {",
      "      return value[0] !== initialConfigValues[index][0] || value[1] !== initialConfigValues[index][1];",
      "    });",
      "  };",
      "  form.addEventListener('input', function () { unchangedNotice.textContent = ''; });",
      "  form.addEventListener('change', function () { unchangedNotice.textContent = ''; });",
      "  form.addEventListener('submit', function (event) {",
      "    if (hasConfigChanges()) return;",
      "    event.preventDefault();",
      "    unchangedNotice.textContent = '配置没有变化，无需保存。';",
      "  });",
      '})();',
      '</script>',
    ].join('\n');
    const livePreview = createAdminPreviewScript();
    return html + script + livePreview;
  }, 20);
}
