import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { remarkAlert } from 'remark-github-blockquote-alert';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';
import type { PluginInitContext, PluginRouteResult } from 'typecho/plugin-sdk';
import { isAdminActionResponse, requireAdminAction } from '@/lib/admin-auth';
import { registerPluginAdminPath } from '@/lib/plugin';
import { env } from 'cloudflare:workers';
import { getDb } from 'typecho/db';
import { getOption } from 'typecho/plugin-sdk';
import katexCss from 'katex/dist/katex.min.css?inline';
import { getRinMermaidConfig } from './mermaid-config';

/** Parse a small, safe image-dimension grammar: numeric pixels, percentages and auto. */
function parseImageDimension(value: string): { attribute?: string; style?: string } | null {
  const normalized = value.trim().toLowerCase();
  if (!/^(?:\d{1,5}(?:\.\d+)?(?:px|%)?|auto)$/.test(normalized)) return null;
  if (normalized.endsWith('%') || normalized === 'auto') return { style: normalized };
  return { attribute: normalized.replace(/px$/, '') };
}

function applyImageDimension(properties: Record<string, any>, name: 'width' | 'height', value: string): void {
  const dimension = parseImageDimension(value);
  if (!dimension) return;
  if (dimension.attribute !== undefined) {
    properties[name] = dimension.attribute;
    return;
  }
  const declaration = `${name}:${dimension.style}`;
  const existing = typeof properties.style === 'string' ? properties.style.trim().replace(/;?$/, ';') : '';
  properties.style = `${existing}${declaration}`;
}

/**
 * Rin-compatible Markdown image metadata handling.
 * Runs on remark image nodes before remark-rehype, so Markdown images receive
 * the same clean src + display metadata contract as Rin's MarkdownImage.
 * Literal '+' is preserved because it is part of the BlurHash alphabet.
 */
function countRinNewlinesBeforeNode(text: string, offset: number): number {
  let count = 0;
  for (let index = offset - 1; index >= 0 && text[index] === '\n'; index--) count++;
  return count;
}
function isRinMarkdownImageLinkAtEnd(text: string): boolean {
  const trimmed = text.trim();
  const match = trimmed.match(/(.*)(!\[.*?\]\(.*?\))$/s);
  if (!match) return false;
  const beforeImage = match[1];
  return beforeImage.trim().length === 0 || beforeImage.endsWith('\n');
}
function remarkRinImageMetadata() {
  return (tree: any, file: any): void => {
    const source = typeof file?.value === 'string' ? file.value : '';
    const visit = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'image' && typeof node.url === 'string') {
        const offset = Number(node.position?.start?.offset ?? 0);
        const previousContent = source.slice(0, offset);
        const block = countRinNewlinesBeforeNode(previousContent, offset) >= 1
          || previousContent.trim().length === 0
          || isRinMarkdownImageLinkAtEnd(previousContent);
        node.data = node.data ?? {};
        const properties = { ...(node.data.hProperties ?? {}) } as Record<string, any>;
        properties.dataRinImageLayout = block ? 'block' : 'inline';
        const hashIndex = node.url.indexOf('#');
        if (hashIndex >= 0) {
          const resourceUrl = node.url.slice(0, hashIndex);
          const fragment = node.url.slice(hashIndex + 1).replace(/&amp;/gi, '&');
          const metadata = new Map<string, string>();
          for (const part of fragment.split(/[&;]/)) {
            if (!part) continue;
            const separator = part.indexOf('=');
            if (separator < 0) continue;
            let key = part.slice(0, separator);
            let value = part.slice(separator + 1);
            try { key = decodeURIComponent(key); } catch {}
            value = value.replace(/\+/g, '%2B');
            try { value = decodeURIComponent(value); } catch {}
            metadata.set(key.toLowerCase(), value);
          }
          const blurhash = metadata.get('blurhash') || '';
          const validBlurhash = /^[0-9A-Za-z#$%*+,-.:;=?@\[\]^_{|}~]{6,200}$/.test(blurhash) ? blurhash : '';
          if (validBlurhash) properties.dataRinBlurhash = validBlurhash;
          for (const name of ['width', 'height'] as const) {
            const raw = metadata.get(name);
            if (!raw) continue;
            const value = Number.parseInt(raw, 10);
            if (Number.isInteger(value) && value > 0 && value <= 10000 && properties[name] == null) {
              applyImageDimension(properties, name, String(value));
            }
          }
          node.url = resourceUrl;
        }
        node.data.hProperties = properties;
      }
      if (Array.isArray(node.children)) node.children.forEach(visit);
    };
    visit(tree);
  };
}

/** Extract image display metadata before sanitization and keep resource URLs clean. */
function rehypeImageDimensions() {
  return (tree: any, file: any): void => {
    const source = typeof file?.value === 'string' ? file.value : '';
    const visit = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'element' && node.tagName === 'img' && node.properties) {
        const properties = node.properties as Record<string, any>;
        const offset = Number(node.position?.start?.offset ?? 0);
        const previousContent = source.slice(0, offset);
        const block = countRinNewlinesBeforeNode(previousContent, offset) >= 1
          || previousContent.trim().length === 0
          || isRinMarkdownImageLinkAtEnd(previousContent);
        if (properties.dataRinImageLayout == null) properties.dataRinImageLayout = block ? 'block' : 'inline';
        const src = properties.src;
        if (typeof src === 'string') {
          const hash = src.indexOf('#');
          if (hash >= 0) {
            const metadata = new Map<string, string>();
            for (const part of src.slice(hash + 1).replace(/&amp;/gi, '&').split(/[&;]/)) {
              if (!part) continue;
              const separator = part.indexOf('=');
              if (separator < 0) continue;
              let key = part.slice(0, separator);
              let value = part.slice(separator + 1);
              try { key = decodeURIComponent(key); } catch {}
              try { value = decodeURIComponent(value.replace(/\+/g, '%2B')); } catch {}
              metadata.set(key.toLowerCase(), value);
            }
            const blurhash = metadata.get('blurhash') || '';
            if (/^[0-9A-Za-z#$%*+,-.:;=?@\[\]^_{|}~]{6,200}$/.test(blurhash)) {
              properties.dataRinBlurhash = blurhash;
            }
            for (const name of ['width', 'height'] as const) {
              const value = metadata.get(name);
              if (value && properties[name] == null) applyImageDimension(properties, name, value);
            }
            properties.src = src.slice(0, hash);
          }
        }
      }
      if (Array.isArray(node.children)) node.children.forEach(visit);
    };
    visit(tree);
  };
}



// Extend the maintained GitHub-style sanitizer schema rather than implementing
// a second HTML parser or sanitizer. Preserve inline style attributes and SVG
// presentation, but do not allow raw <style> elements in article content;
// executable scripts and event-handler attributes remain outside the allowlist.
const safeSvgHref = /^#[\p{L}\p{N}\p{M}_:.-]+$/u;
const safeSvgPaint = /^(?:none|currentColor|context-fill|context-stroke|transparent|#[\da-f]{3,8}|[a-z]+|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^<>]*\)|url\(\s*(["']?)#[\p{L}\p{N}\p{M}_:.-]+\1\s*\)(?:\s+(?:none|currentColor|context-fill|context-stroke|transparent|#[\da-f]{3,8}|[a-z]+|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^<>]*\)))?)$/iu;
const safeSvgOpacity = /^(?:(?:0(?:\.\d+)?|0?\.\d+|1(?:\.0+)?)|(?:(?:100|[1-9]?\d)(?:\.\d+)?)%)$/;
const safeSvgReference = /^url\(\s*(["']?)#[\p{L}\p{N}\p{M}_:.-]+\1\s*\)$/iu;
const commonSvgAttributes = [
  'id', 'className', 'style', 'transform', 'transformOrigin',
  'color', 'colorInterpolation', 'colorInterpolationFilters',
  'fillRule', 'strokeWidth',
  'strokeLineCap', 'strokeLineJoin', 'strokeDashArray', 'strokeDashOffset', 'strokeMiterLimit',
  'clipRule', 'maskType', 'lightingColor',
  ['fill', safeSvgPaint], ['stroke', safeSvgPaint], ['opacity', safeSvgOpacity],
  ['fillOpacity', safeSvgOpacity], ['strokeOpacity', safeSvgOpacity],
  ['clipPath', safeSvgReference], ['mask', safeSvgReference], ['filter', safeSvgReference],
  ['marker', safeSvgReference], ['markerStart', safeSvgReference], ['markerMid', safeSvgReference], ['markerEnd', safeSvgReference],
  'vectorEffect', 'shapeRendering', 'imageRendering', 'textRendering',
  'display', 'visibility', 'overflow', 'paintOrder', 'pointerEvents',
  'dominantBaseline', 'alignmentBaseline', 'textAnchor', 'textDecoration',
  'fontFamily', 'fontSize', 'fontSizeAdjust', 'fontStretch', 'fontStyle', 'fontVariant', 'fontWeight',
  'letterSpacing', 'wordSpacing', 'writingMode', 'direction', 'unicodeBidi',
  'pathLength',
];
export const DEFAULT_IFRAME_ATTRIBUTES = [
  'width', 'height', 'frameBorder', 'frameSpacing', 'framespacing', 'border',
  'allow', 'allowFullScreen', 'allowTransparency', 'allowPaymentRequest',
  'title', 'name', 'id', 'className', 'style', 'referrerPolicy', 'sandbox',
  'scrolling', 'marginWidth', 'marginHeight', 'loading', 'credentialless',
  'fetchPriority', 'align', 'longDesc', 'ariaLabel', 'ariaHidden', 'dataDiagId',
] as const;

/** Safe optional HTML tags that administrators may explicitly allow in article content. */
export const DEFAULT_CUSTOM_HTML_TAGS = [
  'u', 's', 'kbd', 'abbr', 'small', 'cite', 'q', 'time',
  'del', 'ins', 'ruby', 'rt', 'rp', 'wbr', 'bdi', 'bdo',
  'data', 'output', 'progress', 'meter',
] as const;


const PLUGIN_OPTION_KEY = 'plugin:typecho-plugin-markdown-rehype';
const FORBIDDEN_CUSTOM_HTML_TAGS = new Set([
  'script', 'object', 'embed', 'applet', 'frame', 'frameset',
  'base', 'meta', 'link', 'form', 'template', 'portal',
]);
const DEFAULT_CUSTOM_HTML_ATTRIBUTES: Record<string, string[]> = {
  abbr: ['title', 'className'],
  q: ['cite', 'className'],
  time: ['dateTime', 'className'],
  del: ['cite', 'dateTime', 'className'],
  ins: ['cite', 'dateTime', 'className'],
  bdo: ['dir', 'className'],
  data: ['value', 'className'],
  output: ['htmlFor', 'form', 'name', 'className'],
  progress: ['max', 'value', 'className'],
  meter: ['min', 'max', 'low', 'high', 'optimum', 'value', 'className'],
};
const SAFE_CUSTOM_HTML_ATTRIBUTES: Record<string, Record<string, string>> = {
  abbr: { title: 'title', class: 'className' },
  q: { cite: 'cite', class: 'className' },
  time: { datetime: 'dateTime', class: 'className' },
  del: { cite: 'cite', datetime: 'dateTime', class: 'className' },
  ins: { cite: 'cite', datetime: 'dateTime', class: 'className' },
  bdo: { dir: 'dir', class: 'className' },
  data: { value: 'value', class: 'className' },
  output: { for: 'htmlFor', form: 'form', name: 'name', class: 'className' },
  progress: { max: 'max', value: 'value', class: 'className' },
  meter: { min: 'min', max: 'max', low: 'low', high: 'high', optimum: 'optimum', value: 'value', class: 'className' },
};

export function normalizeCustomHtmlAttributes(value: unknown): Record<string, string[]> {
  if (typeof value !== 'string') return {};
  const result: Record<string, Set<string>> = {};
  for (const line of value.replace(/\\[nr]/gi, '\n').split(/[\n;；]+/)) {
    const match = line.trim().match(/^([a-z][a-z0-9]*)\s*:\s*(.+)$/i);
    if (!match) continue;
    const tag = match[1].toLowerCase();
    const allowed = SAFE_CUSTOM_HTML_ATTRIBUTES[tag];
    if (!allowed) continue;
    const attrs = result[tag] ?? new Set<string>();
    for (const raw of match[2].split(/[\s,，]+/)) {
      const name = raw.trim().toLowerCase();
      if (!name || name.startsWith('on') || !allowed[name]) continue;
      attrs.add(allowed[name]);
    }
    result[tag] = attrs;
  }
  return Object.fromEntries(Object.entries(result).map(([tag, attrs]) => [tag, [...attrs]]));
}

const FORBIDDEN_CUSTOM_IFRAME_ATTRIBUTES = new Set([
  'src', 'srcdoc', 'onload', 'onerror', 'nonce', 'integrity',
]);
const HTML_TO_HAST_IFRAME_PROPERTIES: Record<string, string> = {
  class: 'className',
  frameborder: 'frameBorder',
  framespacing: 'frameSpacing',
  allowfullscreen: 'allowFullScreen',
  allowtransparency: 'allowTransparency',
  allowpaymentrequest: 'allowPaymentRequest',
  referrerpolicy: 'referrerPolicy',
  marginwidth: 'marginWidth',
  marginheight: 'marginHeight',
  fetchpriority: 'fetchPriority',
  longdesc: 'longDesc',
};

function parsePluginConfig(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function normalizeCustomIframeAttributes(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const result = new Set<string>();
  for (const raw of value.replace(/\\[nr]/gi, ' ').split(/[\s,，;；]+/)) {
    const name = raw.trim().toLowerCase();
    if (!name || !/^[a-z][a-z0-9:-]*$/.test(name)) continue;
    if (name.startsWith('on') || FORBIDDEN_CUSTOM_IFRAME_ATTRIBUTES.has(name)) continue;
    const property = HTML_TO_HAST_IFRAME_PROPERTIES[name]
      ?? (name.startsWith('data-') || name.startsWith('aria-')
        ? name.replace(/-([a-z0-9])/g, (_match, char: string) => char.toUpperCase())
        : name);
    result.add(property);
  }
  return [...result];
}

export function normalizeCustomHtmlTags(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const result = new Set<string>();
  for (const raw of value.replace(/\\[nr]/gi, ' ').split(/[\s,，;；]+/)) {
    const name = raw.trim().toLowerCase();
    if (/^[a-z][a-z0-9]*$/.test(name) && !FORBIDDEN_CUSTOM_HTML_TAGS.has(name)) result.add(name);
  }
  return [...result];
}

let cachedCustomIframeAttributes: string[] = [...DEFAULT_IFRAME_ATTRIBUTES];
let customIframeAttributesExpiresAt = 0;
let customIframeAttributesLoad: Promise<string[]> | null = null;
let cachedCustomHtmlTags: string[] = [...DEFAULT_CUSTOM_HTML_TAGS];
let customHtmlTagsExpiresAt = 0;
let customHtmlTagsLoad: Promise<string[]> | null = null;
let cachedCustomHtmlAttributes: Record<string, string[]> = DEFAULT_CUSTOM_HTML_ATTRIBUTES;
let customHtmlAttributesExpiresAt = 0;
let customHtmlAttributesLoad: Promise<Record<string, string[]>> | null = null;

async function loadCustomIframeAttributes(): Promise<string[]> {
  if (Date.now() < customIframeAttributesExpiresAt) return cachedCustomIframeAttributes;
  if (customIframeAttributesLoad) return customIframeAttributesLoad;
  customIframeAttributesLoad = (async () => {
    try {
      const db = getDb(env.DB);
      const config = parsePluginConfig(await getOption(db, PLUGIN_OPTION_KEY));
      const configured = normalizeCustomIframeAttributes(config.iframeAttributes);
      cachedCustomIframeAttributes = configured.length ? configured : [...DEFAULT_IFRAME_ATTRIBUTES];
    } catch {
      cachedCustomIframeAttributes = [...DEFAULT_IFRAME_ATTRIBUTES];
    }
    customIframeAttributesExpiresAt = Date.now() + 15_000;
    return cachedCustomIframeAttributes;
  })();
  try {
    return await customIframeAttributesLoad;
  } finally {
    customIframeAttributesLoad = null;
  }
}

async function loadCustomHtmlTags(): Promise<string[]> {
  if (Date.now() < customHtmlTagsExpiresAt) return cachedCustomHtmlTags;
  if (customHtmlTagsLoad) return customHtmlTagsLoad;
  customHtmlTagsLoad = (async () => {
    try {
      const db = getDb(env.DB);
      const config = parsePluginConfig(await getOption(db, PLUGIN_OPTION_KEY));
      cachedCustomHtmlTags = Object.prototype.hasOwnProperty.call(config, 'htmlTags')
        ? normalizeCustomHtmlTags(config.htmlTags)
        : [...DEFAULT_CUSTOM_HTML_TAGS];
    } catch {
      cachedCustomHtmlTags = [...DEFAULT_CUSTOM_HTML_TAGS];
    }
    customHtmlTagsExpiresAt = Date.now() + 15_000;
    return cachedCustomHtmlTags;
  })();
  try {
    return await customHtmlTagsLoad;
  } finally {
    customHtmlTagsLoad = null;
  }
}

async function loadCustomHtmlAttributes(): Promise<Record<string, string[]>> {
  if (Date.now() < customHtmlAttributesExpiresAt) return cachedCustomHtmlAttributes;
  if (customHtmlAttributesLoad) return customHtmlAttributesLoad;
  customHtmlAttributesLoad = (async () => {
    try {
      const db = getDb(env.DB);
      const config = parsePluginConfig(await getOption(db, PLUGIN_OPTION_KEY));
      cachedCustomHtmlAttributes = Object.prototype.hasOwnProperty.call(config, 'htmlAttributes')
        ? normalizeCustomHtmlAttributes(config.htmlAttributes)
        : DEFAULT_CUSTOM_HTML_ATTRIBUTES;
    } catch {
      cachedCustomHtmlAttributes = DEFAULT_CUSTOM_HTML_ATTRIBUTES;
    }
    customHtmlAttributesExpiresAt = Date.now() + 15_000;
    return cachedCustomHtmlAttributes;
  })();
  try {
    return await customHtmlAttributesLoad;
  } finally {
    customHtmlAttributesLoad = null;
  }
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

function restoreMarkdownBridgeHtml(sanitized: string): string {
  const match = sanitized.match(/<p>\s*(TYPECHOMARKDOWNREHYPE[a-f0-9]{32})\s*<\/p>/i);
  if (!match) return sanitized;
  const entry = markdownBridge.get(match[1]);
  markdownBridge.delete(match[1]);
  if (!entry || Date.now() - entry.createdAt > MARKDOWN_BRIDGE_TTL_MS) return sanitized;
  // renderMarkdown already returns Rin's single .toc-content root.
  // Restore it unchanged so public articles/pages and the admin preview share
  // the same DOM structure and runtime scope.
  return sanitized.replace(match[0], entry.html);
}


export function createArticleSanitizeSchema(
  iframeAttributes: string[] = [...DEFAULT_IFRAME_ATTRIBUTES],
  customHtmlTags: string[] = [],
  customHtmlAttributes: Record<string, string[]> = DEFAULT_CUSTOM_HTML_ATTRIBUTES,
) {
  const configuredAttributes: Record<string, any[]> = {};
  for (const [tag, attributes] of Object.entries(customHtmlAttributes)) {
    const base = (defaultSchema.attributes as Record<string, any[]>)[tag] ?? [];
    configuredAttributes[tag] = [...base, ...attributes.map(attribute =>
      tag === 'bdo' && attribute === 'dir' ? ['dir', 'ltr', 'rtl'] : attribute
    )];
  }
  return {
    ...articleSanitizeSchema,
    tagNames: [...articleSanitizeSchema.tagNames, ...customHtmlTags],
    attributes: {
      ...articleSanitizeSchema.attributes,
      ...configuredAttributes,
      iframe: [
        ...(articleSanitizeSchema.attributes.iframe ?? []).filter((attribute: any) => Array.isArray(attribute) && attribute[0] === 'src'),
        ...iframeAttributes,
      ],
    },
  };
}

const articleSanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...defaultSchema.tagNames,
    'button', 'figure', 'figcaption', 'mark', 'sup', 'sub',
    'main', 'label', 'picture', 'details', 'summary', 'video', 'audio', 'source', 'iframe',
    'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'image',
    'line', 'polyline', 'polygon', 'title', 'desc', 'defs', 'use', 'symbol',
    'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'filter', 'marker', 'pattern',
    'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix', 'feDiffuseLighting',
    'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood', 'feFuncR', 'feFuncG', 'feFuncB', 'feFuncA',
    'feGaussianBlur', 'feImage', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight',
    'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence', 'text', 'tspan',
  ],
  attributes: {
    ...defaultSchema.attributes,
    // Rin's rehypeRaw renderer forwards inline styles on arbitrary allowed raw-HTML elements.
    // Keep style globally available while the sanitizer continues to reject event handlers.
    '*': [...((defaultSchema.attributes as Record<string, any[]>)['*'] ?? []), 'style'],
    a: [
      ...(defaultSchema.attributes.a ?? []),
      'id', 'ariaLabel', 'ariaDescribedBy', 'dataFootnoteRef', 'dataFootnoteBackref',
      'className', 'download', 'style',
      ['target', '_blank', '_self'],
      'rel',
    ],
    blockquote: [
      ...(defaultSchema.attributes.blockquote ?? []),
      'className', 'dataAlert', 'style',
    ],
    code: [...(defaultSchema.attributes.code ?? []), 'className', 'style'],
    pre: [...(defaultSchema.attributes.pre ?? []), 'className', 'style'],
    th: [...(defaultSchema.attributes.th ?? []), 'className', 'style', ['align', 'left', 'center', 'right'], ['valign', 'top', 'middle', 'bottom']],
    td: [...(defaultSchema.attributes.td ?? []), 'className', 'style', ['align', 'left', 'center', 'right'], ['valign', 'top', 'middle', 'bottom']],
    video: [
      'src', 'controls', 'width', 'height', 'poster', 'autoplay', 'muted', 'loop',
      ['preload', 'none', 'metadata', 'auto'],
      ['playsInline', true],
      ['disablePictureInPicture', true],
      ['controlsList', /^(?:nodownload|nofullscreen|noremoteplayback)(?:\s+(?:nodownload|nofullscreen|noremoteplayback))*$/i],
    ],
    audio: [
      'src', 'controls', 'autoplay', 'muted', 'loop',
      ['preload', 'none', 'metadata', 'auto'],
    ],
    source: ['src', 'type', 'media'],
    iframe: [
      ['src', /^(?:https?:)?\/\/[^\s]+$/i],
      ...DEFAULT_IFRAME_ATTRIBUTES,
    ],
    button: [
      ['type', 'button'],
      ['disabled', true],
      'className', 'title', 'ariaLabel', 'dataDisclaimerToggle', 'ariaExpanded', 'style',
    ],
    main: ['className', 'style', 'id', 'ariaLabel', 'ariaLabelledBy', 'ariaDescribedBy'],
    label: ['htmlFor', 'className', 'style', 'id', 'title', 'ariaLabel'],
    picture: ['className', 'style', 'id'],
    div: [
      ...(defaultSchema.attributes.div ?? []),
      ['dir', 'ltr', 'rtl', 'auto'],
      'className', 'dataAlign', 'dataType', 'dataId', 'dataUrl', 'dataCaption',
      'dataStartDate', 'dataDisclaimer', 'dataCountdownTarget',
      'dataCountdownDays', 'dataCountdownHours', 'dataCountdownMinutes', 'dataCountdownSeconds',
      'ariaHidden', 'style',
    ],
    span: [
      ...(defaultSchema.attributes.span ?? []),
      'className', 'dataCountdownDays', 'dataCountdownHours', 'style',
      'dataCountdownMinutes', 'dataCountdownSeconds',
    ],
    p: [...(defaultSchema.attributes.p ?? []), 'className', 'style', ['dir', 'ltr', 'rtl', 'auto']],
    section: [...(defaultSchema.attributes.section ?? []), 'className', 'style', 'dataFootnotes'],
    article: [...(defaultSchema.attributes.article ?? []), 'className', 'style'],
    aside: [...(defaultSchema.attributes.aside ?? []), 'className', 'style'],
    header: [...(defaultSchema.attributes.header ?? []), 'className', 'style'],
    footer: [...(defaultSchema.attributes.footer ?? []), 'className', 'style'],
    nav: [...(defaultSchema.attributes.nav ?? []), 'className', 'style'],
    figure: ['className', 'style', 'ariaHidden'],
    figcaption: ['className', 'style'],
    // WordPress/Gutenberg commonly stores presentation classes on semantic blocks.
    h1: [...(defaultSchema.attributes.h1 ?? []), 'className', 'style'],
    h2: [...(defaultSchema.attributes.h2 ?? []), 'className', 'style'],
    h3: [...(defaultSchema.attributes.h3 ?? []), 'className', 'style'],
    h4: [...(defaultSchema.attributes.h4 ?? []), 'className', 'style'],
    h5: [...(defaultSchema.attributes.h5 ?? []), 'className', 'style'],
    h6: [...(defaultSchema.attributes.h6 ?? []), 'className', 'style'],
    ul: [...(defaultSchema.attributes.ul ?? []), 'className', 'style'],
    ol: [...(defaultSchema.attributes.ol ?? []), 'className', 'style'],
    hr: [...(defaultSchema.attributes.hr ?? []), 'className', 'style'],
    table: [...(defaultSchema.attributes.table ?? []), 'className', 'style'],
    thead: [...(defaultSchema.attributes.thead ?? []), 'className', 'style'],
    tbody: [...(defaultSchema.attributes.tbody ?? []), 'className', 'style'],
    tfoot: [...(defaultSchema.attributes.tfoot ?? []), 'className', 'style'],
    tr: [...(defaultSchema.attributes.tr ?? []), 'className', 'style'],
    dl: [...(defaultSchema.attributes.dl ?? []), 'className'],
    dt: [...(defaultSchema.attributes.dt ?? []), 'className'],
    dd: [...(defaultSchema.attributes.dd ?? []), 'className'],
    i: [...(defaultSchema.attributes.i ?? []), 'className'],
    b: [...(defaultSchema.attributes.b ?? []), 'className'],
    em: [...(defaultSchema.attributes.em ?? []), 'className', 'style'],
    strong: [...(defaultSchema.attributes.strong ?? []), 'className', 'style'],
    mark: ['className', 'style'],
    sup: ['id', 'title', 'ariaLabel', 'ariaDescribedBy', 'dataFootnoteRef', 'dataFootnoteBackref', 'className', 'style'],
    // GFM footnote links target the generated <li id="fn-N"> element.
    // Preserve that target ID or the visible superscript link has nowhere to jump.
    li: [...(defaultSchema.attributes.li ?? []), 'id', 'className', 'style'],
    sub: ['id', 'title', 'ariaLabel', 'ariaDescribedBy', 'className', 'style'],


    img: [
      ...(defaultSchema.attributes.img ?? []),
      'alt', 'title', 'width', 'height', 'loading', 'className', 'style', 'dataBlurhash', 'dataRinBlurhash', 'dataRinImageLayout',
    ],
    svg: [
      'id', 'className', 'width', 'height', 'viewBox', 'xmlns', 'xmlnsXLink', 'version', 'preserveAspectRatio', 'style',
      ['fill', safeSvgPaint],
      ['stroke', safeSvgPaint],
      'strokeWidth', 'strokeLineCap', 'strokeLineJoin', 'strokeDashArray', 'strokeDashOffset', 'strokeMiterLimit',
      'fillRule', 'clipRule', ['opacity', safeSvgOpacity], ['fillOpacity', safeSvgOpacity], ['strokeOpacity', safeSvgOpacity],
      ['clipPath', safeSvgReference], ['mask', safeSvgReference], ['filter', safeSvgReference], 'className',
      ['role', 'img'], 'ariaLabel', 'ariaLabelledBy', 'ariaDescribedBy',
      ['ariaHidden', 'true', 'false'],
      ['focusable', 'true', 'false'],
      'className',
    ],
    g: [
      ...commonSvgAttributes,
      ['fill', safeSvgPaint], ['stroke', safeSvgPaint],
      ['opacity', safeSvgOpacity],
      'strokeWidth', 'strokeLineCap', 'strokeLineJoin', 'strokeDashArray', 'strokeDashOffset', 'strokeMiterLimit',
      'fillRule', 'clipRule', ['fillOpacity', safeSvgOpacity], ['strokeOpacity', safeSvgOpacity], ['clipPath', safeSvgReference], ['marker', safeSvgReference],
      ['mask', safeSvgReference], ['filter', safeSvgReference], 'transform', 'vectorEffect', 'shapeRendering', 'className', 'style',
    ],
    path: [
      ...commonSvgAttributes,
      'd',
      ['fill', safeSvgPaint], ['stroke', safeSvgPaint],
      ['opacity', safeSvgOpacity],
      ['fillRule', 'nonzero', 'evenodd'],
      ['clipRule', 'nonzero', 'evenodd'],
      'strokeWidth', 'strokeLineCap', 'strokeLineJoin', 'strokeDashArray', 'strokeDashOffset', 'strokeMiterLimit',
      ['fillOpacity', safeSvgOpacity], ['strokeOpacity', safeSvgOpacity], ['clipPath', safeSvgReference], ['mask', safeSvgReference],
      ['filter', safeSvgReference], ['marker', safeSvgReference], 'transform', 'vectorEffect', 'shapeRendering', 'className', 'style',
    ],
    rect: [
      ...commonSvgAttributes,
      'x', 'y', 'width', 'height', 'rx', 'ry',
      ['fill', safeSvgPaint], ['stroke', safeSvgPaint],
      ['opacity', safeSvgOpacity],
      'strokeWidth', 'strokeDashArray', 'strokeDashOffset', 'strokeMiterLimit', ['fillOpacity', safeSvgOpacity], ['strokeOpacity', safeSvgOpacity],
      ['clipPath', safeSvgReference], ['mask', safeSvgReference], ['filter', safeSvgReference], ['marker', safeSvgReference],
      'transform', 'vectorEffect', 'shapeRendering', 'className', 'style',
    ],
    circle: [
      ...commonSvgAttributes,
      'cx', 'cy', 'r',
      ['fill', safeSvgPaint], ['stroke', safeSvgPaint],
      ['opacity', safeSvgOpacity],
      'strokeWidth', 'strokeDashArray', 'strokeDashOffset', 'strokeMiterLimit', ['fillOpacity', safeSvgOpacity], ['strokeOpacity', safeSvgOpacity],
      ['clipPath', safeSvgReference], ['mask', safeSvgReference], ['filter', safeSvgReference], ['marker', safeSvgReference],
      'transform', 'vectorEffect', 'shapeRendering', 'className', 'style',
    ],
    ellipse: [
      ...commonSvgAttributes,
      'cx', 'cy', 'rx', 'ry',
      ['fill', safeSvgPaint], ['stroke', safeSvgPaint],
      ['opacity', safeSvgOpacity],
      'strokeWidth', 'strokeDashArray', 'strokeDashOffset', 'strokeMiterLimit', ['fillOpacity', safeSvgOpacity], ['strokeOpacity', safeSvgOpacity],
      ['clipPath', safeSvgReference], ['mask', safeSvgReference], ['filter', safeSvgReference], ['marker', safeSvgReference],
      'transform', 'vectorEffect', 'shapeRendering', 'className', 'style',
    ],
    line: [
      ...commonSvgAttributes,
      'x1', 'y1', 'x2', 'y2',
      ['stroke', safeSvgPaint], ['opacity', safeSvgOpacity],
      'strokeWidth', 'strokeLineCap', 'strokeDashArray', 'strokeDashOffset', 'strokeMiterLimit', ['strokeOpacity', safeSvgOpacity],
      ['clipPath', safeSvgReference], ['mask', safeSvgReference], ['filter', safeSvgReference], ['marker', safeSvgReference],
      'transform', 'vectorEffect', 'shapeRendering', 'className', 'style',
    ],
    polyline: [
      ...commonSvgAttributes,
      'points',
      ['fill', safeSvgPaint], ['stroke', safeSvgPaint],
      ['opacity', safeSvgOpacity],
      'strokeWidth', 'strokeLineCap', 'strokeDashArray', 'strokeDashOffset', 'strokeMiterLimit', ['strokeOpacity', safeSvgOpacity],
      ['clipPath', safeSvgReference], ['mask', safeSvgReference], ['filter', safeSvgReference],
      'transform', 'vectorEffect', 'shapeRendering', 'className', 'style',
    ],
    polygon: [
      ...commonSvgAttributes,
      'points',
      ['fill', safeSvgPaint], ['stroke', safeSvgPaint],
      ['opacity', safeSvgOpacity],
      'strokeWidth', 'strokeLineCap', 'strokeDashArray', 'strokeDashOffset', 'strokeMiterLimit', ['strokeOpacity', safeSvgOpacity],
      ['clipPath', safeSvgReference], ['mask', safeSvgReference], ['filter', safeSvgReference],
      'transform', 'vectorEffect', 'shapeRendering', 'className', 'style',
    ],
    title: ['id', 'className'],
    desc: ['id', 'className'],
    defs: ['id', 'className', 'style'],
    symbol: [...commonSvgAttributes, 'viewBox', 'preserveAspectRatio'],
    use: [
      ...commonSvgAttributes,
      ['href', safeSvgHref], ['xLinkHref', safeSvgHref], ['xlinkHref', safeSvgHref],
      'x', 'y', 'width', 'height',
    ],
    linearGradient: [
      ...commonSvgAttributes, 'x1', 'x2', 'y1', 'y2', 'gradientUnits', 'gradientTransform', 'spreadMethod',
      ['href', safeSvgHref], ['xLinkHref', safeSvgHref], ['xlinkHref', safeSvgHref],
    ],
    radialGradient: [
      ...commonSvgAttributes, 'cx', 'cy', 'r', 'fx', 'fy', 'fr', 'gradientUnits', 'gradientTransform', 'spreadMethod',
      ['href', safeSvgHref], ['xLinkHref', safeSvgHref], ['xlinkHref', safeSvgHref],
    ],
    stop: [
      ...commonSvgAttributes, 'offset',
      ['stopColor', safeSvgPaint], ['stopOpacity', safeSvgOpacity],
    ],
    clipPath: [...commonSvgAttributes, 'clipPathUnits'],
    mask: [
      ...commonSvgAttributes, 'maskUnits', 'maskContentUnits', 'x', 'y', 'width', 'height',
      ['fill', safeSvgPaint], ['stroke', safeSvgPaint], ['opacity', safeSvgOpacity],
      'fillRule', 'clipRule', ['fillOpacity', safeSvgOpacity], ['strokeOpacity', safeSvgOpacity], 'strokeWidth',
    ],
    marker: [...commonSvgAttributes, 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'markerUnits', 'viewBox'],
    pattern: [
      ...commonSvgAttributes, 'x', 'y', 'width', 'height', 'patternUnits', 'patternContentUnits', 'patternTransform', 'viewBox',
      ['href', safeSvgHref], ['xLinkHref', safeSvgHref], ['xlinkHref', safeSvgHref],
    ],
    image: [
      ...commonSvgAttributes, 'x', 'y', 'width', 'height', 'preserveAspectRatio',
      ['href', /^https?:\/\//i], ['xLinkHref', /^https?:\/\//i], ['xlinkHref', /^https?:\/\//i],
    ],
    filter: [...commonSvgAttributes, 'x', 'y', 'width', 'height', 'filterUnits', 'primitiveUnits', 'colorInterpolationFilters'],
    feBlend: ['in', 'in2', 'mode', 'result'],
    feColorMatrix: ['in', 'type', 'values', 'result'],
    feComponentTransfer: ['in', 'result'],
    feComposite: ['in', 'in2', 'operator', 'k1', 'k2', 'k3', 'k4', 'result'],
    feConvolveMatrix: ['in', 'order', 'kernelMatrix', 'divisor', 'bias', 'targetX', 'targetY', 'edgeMode', 'kernelUnitLength', 'preserveAlpha', 'result'],
    feDiffuseLighting: ['in', 'surfaceScale', 'diffuseConstant', 'kernelUnitLength', 'result'],
    feDisplacementMap: ['in', 'in2', 'scale', 'xChannelSelector', 'yChannelSelector', 'result'],
    feDistantLight: ['azimuth', 'elevation'],
    feDropShadow: ['in', 'dx', 'dy', 'stdDeviation', ['floodColor', safeSvgPaint], ['floodOpacity', safeSvgOpacity], 'result'],
    feFlood: [['floodColor', safeSvgPaint], ['floodOpacity', safeSvgOpacity], 'result'],
    feFuncR: ['type', 'slope', 'amplitude', 'exponent', 'intercept', 'tableValues'],
    feFuncG: ['type', 'slope', 'amplitude', 'exponent', 'intercept', 'tableValues'],
    feFuncB: ['type', 'slope', 'amplitude', 'exponent', 'intercept', 'tableValues'],
    feFuncA: ['type', 'slope', 'amplitude', 'exponent', 'intercept', 'tableValues'],
    feGaussianBlur: ['in', 'stdDeviation', 'edgeMode', 'result'],
    feImage: [['href', /^https?:\/\//i], ['xLinkHref', /^https?:\/\//i], ['xlinkHref', /^https?:\/\//i], 'preserveAspectRatio', 'result'],
    feMerge: [],
    feMergeNode: ['in'],
    feMorphology: ['in', 'operator', 'radius', 'result'],
    feOffset: ['in', 'dx', 'dy', 'result'],
    fePointLight: ['x', 'y', 'z'],
    feSpecularLighting: ['in', 'surfaceScale', 'specularConstant', 'specularExponent', 'kernelUnitLength', 'result'],
    feSpotLight: ['x', 'y', 'z', 'pointsAtX', 'pointsAtY', 'pointsAtZ', 'specularExponent', 'limitingConeAngle'],
    feTile: ['in', 'result'],
    feTurbulence: ['baseFrequency', 'numOctaves', 'seed', 'stitchTiles', 'type', 'result'],
    text: [
      ...commonSvgAttributes,'x', 'y', 'dx', 'dy', 'textAnchor', 'fontSize', 'fontWeight', 'fill', 'stroke', 'className', 'style'],
    tspan: [
      ...commonSvgAttributes,'x', 'y', 'dx', 'dy', 'textAnchor', 'fontSize', 'fontWeight', 'fill', 'stroke', 'className', 'style'],
  },
  required: {
    ...defaultSchema.required,
    button: { type: 'button' },
  },
};

/**
 * Remove raw style blocks before sanitization. CSS text inside a disallowed
 * style element would otherwise be unwrapped into visible article text.
 * Inline style attributes remain available for existing article formatting.
 */
function rehypeRemoveStyleElements() {
  return (tree: any): void => {
    const visit = (node: any): void => {
      if (!node || !Array.isArray(node.children)) return;
      node.children = node.children.filter((child: any) =>
        !(child?.type === 'element' && String(child.tagName).toLowerCase() === 'style'),
      );
      node.children.forEach(visit);
    };
    visit(tree);
  };
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

function rehypeRinIframes() {
  return (tree: any): void => {
    const visit = (parent: any): void => {
      if (!parent || !Array.isArray(parent.children)) return;
      const next: any[] = [];
      for (const child of parent.children) {
        if (child?.type === 'element' && child.tagName === 'iframe') {
          const properties = child.properties || (child.properties = {});
          properties.title = typeof properties.title === 'string' && properties.title
            ? properties.title
            : 'Embedded content';
          properties.className = ['rin-iframe'];
          properties.style = 'min-height:400px';
          properties.loading = 'lazy';
          properties.referrerPolicy = 'no-referrer';
          properties.sandbox = 'allow-scripts allow-same-origin allow-popups allow-forms';
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
        const startsWithFence = offset >= 0 && source.slice(offset).trimStart().startsWith('```');
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
          ? node.properties.className.split(/\\s+/).filter(Boolean)
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
 * Build one immutable processor for each supported render configuration.
 * Unified freezes a processor on first process() and documents that frozen
 * processors can process files repeatedly. Reuse avoids rebuilding the plugin
 * chain on every article request while keeping math/TOC options isolated.
 */
function createMarkdownProcessor(iframeAttributes: string[], customHtmlTags: string[], customHtmlAttributes: Record<string, string[]>) {
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
    .use(rehypeRemoveStyleElements)
    .use(rehypeImageDimensions)
    .use(rehypeRinCodeBlocks)
    .use(rehypeSanitize, createArticleSanitizeSchema(iframeAttributes, customHtmlTags, customHtmlAttributes))
    .use(rehypeRinIframes)
    .use(rehypeRinSemanticComponents)
    .use(rehypeRinHeadingIds)
    .use(rehypeStringify);
}

const markdownProcessorCache = new Map<string, ReturnType<typeof createMarkdownProcessor>>();
function getMarkdownProcessor(iframeAttributes: string[], customHtmlTags: string[], customHtmlAttributes: Record<string, string[]>) {
  const key = JSON.stringify([iframeAttributes, customHtmlTags, customHtmlAttributes]);
  let processor = markdownProcessorCache.get(key);
  if (!processor) {
    processor = createMarkdownProcessor(iframeAttributes, customHtmlTags, customHtmlAttributes);
    markdownProcessorCache.set(key, processor);
  }
  return processor;
}

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

/** Rin-compatible Markdown article pipeline with a fixed safe HTML schema. */
export async function renderMarkdown(source: string): Promise<string> {
  if (!source) return '';
  // Keep the public renderer and the editor preview on the same Typecho input
  // contract. The shared frontend hook strips these markers before invoking
  // this renderer; preview requests call it directly, so normalize here too.
  const normalizedSource = source
    .replace(/^<!--markdown-->/, '')
    .replace(/<!--more-->/g, '');
  const [iframeAttributes, customHtmlTags, customHtmlAttributes] = await Promise.all([
    loadCustomIframeAttributes(),
    loadCustomHtmlTags(),
    loadCustomHtmlAttributes(),
  ]);
  const cacheKey = normalizedSource.length <= RENDERED_MARKDOWN_CACHE_MAX_SOURCE_LENGTH
    ? JSON.stringify([iframeAttributes, customHtmlTags, customHtmlAttributes, normalizedSource])
    : null;

  if (cacheKey) {
    const cached = getCachedMarkdownRender(cacheKey);
    if (cached !== undefined) return cached;

    // Separate tabs or users can submit the same article at nearly the same
    // time. Share that exact render instead of running KaTeX/highlight twice.
    const inFlight = inFlightMarkdownRenders.get(cacheKey);
    if (inFlight) return inFlight;
  }

  const processor = getMarkdownProcessor(iframeAttributes, customHtmlTags, customHtmlAttributes);
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
  '.markdown-rehype-settings-page .markdown-rehype-allowlist-card { border-color: #dfe8e2 !important; border-radius: 10px !important; background: #fff !important; }',
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
    try {
      const mermaid = await loadMermaid();
      await renderMermaidVariant(mermaid, light, mermaidConfigs.light);
      await renderMermaidVariant(mermaid, dark, mermaidConfigs.dark);
    } catch (error) {
      console.error('Markdown Mermaid rendering failed:', error);
    }
  };

  const renderContent = () => {
    ensureKatexCss();
    loadRinRuntime();
    renderMermaid().then(() => {
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
  // content renderer. The final replacement runs after the core sanitizer;
  // the HTML inserted here has already passed this plugin's rehype sanitizer.
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
      customIframeAttributesExpiresAt = 0;
      customHtmlTagsExpiresAt = 0;
      customHtmlAttributesExpiresAt = 0;
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
      '  var htmlTags = form.querySelector(\'textarea[name="htmlTags"]\');',
      '  var htmlTagsCard = htmlTags && htmlTags.closest(\'.typecho-option\');',
      '  var htmlAttributes = form.querySelector(\'textarea[name="htmlAttributes"]\');',
      '  var htmlAttributesCard = htmlAttributes && htmlAttributes.closest(\'.typecho-option\');',
      '  var iframeAttributesCard = form.querySelector(\'textarea[name="iframeAttributes"]\')?.closest(\'.typecho-option\');',
      '  if (htmlTagsCard) htmlTagsCard.classList.add(\'markdown-rehype-allowlist-card\');',
      '  if (htmlAttributesCard) htmlAttributesCard.classList.add(\'markdown-rehype-allowlist-card\');',
      '  if (htmlTags) {',
      '    var normalizeHtmlTags = function () {',
      '      var tags = Array.from(new Set(htmlTags.value.replace(/\\\\[nr]/gi, \' \').split(/[\\s,，;；]+/).map(function (tag) { return tag.trim().toLowerCase(); }).filter(Boolean)));',
      '      htmlTags.value = tags.join(\', \');',
      '    };',
      '    htmlTags.addEventListener(\'blur\', normalizeHtmlTags);',
      '    form.addEventListener(\'submit\', normalizeHtmlTags);',
      '    normalizeHtmlTags();',
      '  }',
      '  if (htmlAttributes) {',
      '    var normalizeHtmlAttributes = function () {',
      '      var rows = htmlAttributes.value.replace(/\\\\[nr]/gi, \'\\n\').split(/[\\n;；]+/).map(function (line) {',
      '        var match = line.trim().match(/^([a-z][a-z0-9]*)\\s*:\\s*(.+)$/i);',
      '        if (!match) return \'\';',
      '        var attrs = Array.from(new Set(match[2].split(/[\\s,，]+/).map(function (attr) { return attr.trim().toLowerCase(); }).filter(Boolean)));',
      '        return attrs.length ? match[1].toLowerCase() + \': \' + attrs.join(\', \') : \'\';',
      '      }).filter(Boolean);',
      '      htmlAttributes.value = rows.join(\'\\n\');',
      '    };',
      '    htmlAttributes.addEventListener(\'blur\', normalizeHtmlAttributes);',
      '    form.addEventListener(\'submit\', normalizeHtmlAttributes);',
      '    normalizeHtmlAttributes();',
      '  }',
      '  if (iframeAttributesCard) iframeAttributesCard.classList.add(\'markdown-rehype-allowlist-card\');',
      '  if (htmlTags && !form.querySelector(\'[data-html-tags-reset]\')) {',
      '    var htmlTagsReset = document.createElement(\'button\');',
      '    htmlTagsReset.type = \'button\';',
      '    htmlTagsReset.className = \'btn btn-xs\';',
      '    htmlTagsReset.dataset.htmlTagsReset = \'1\';',
      '    htmlTagsReset.textContent = \'恢复常用标签默认值\';',
      '    htmlTagsReset.style.marginTop = \'8px\';',
      '    htmlTagsReset.addEventListener(\'click\', function () { htmlTags.value = \'u, s, kbd, abbr, small, cite, q, time, del, ins, ruby, rt, rp, wbr, bdi, bdo, data, output, progress, meter\'; normalizeHtmlTags(); htmlTags.dispatchEvent(new Event(\'input\', { bubbles: true })); });',
      '    htmlTags.after(htmlTagsReset);',
      '  }',
      '  var iframeAttributes = form.querySelector(\'textarea[name="iframeAttributes"]\');',
      '  if (iframeAttributes) {',
      '    var normalizeIframeAttributes = function () {',
      '      var attributes = Array.from(new Set(iframeAttributes.value.replace(/\\\\[nr]/gi, \' \').split(/[\\s,，;；]+/).map(function (attribute) { return attribute.trim().toLowerCase(); }).filter(Boolean)));',
      '      iframeAttributes.value = attributes.join(\', \');',
      '    };',
      '    iframeAttributes.addEventListener(\'blur\', normalizeIframeAttributes);',
      '    form.addEventListener(\'submit\', normalizeIframeAttributes);',
      '    normalizeIframeAttributes();',
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
      '  document.addEventListener(\'DOMContentLoaded\', function () {',
      '    if (htmlTags) normalizeHtmlTags();',
      '    if (iframeAttributes) normalizeIframeAttributes();',
      '  });',
      '  window.addEventListener(\'pageshow\', function () {',
      '    if (htmlTags) normalizeHtmlTags();',
      '    if (iframeAttributes) normalizeIframeAttributes();',
      '  });',
      '  if (iframeAttributes && !form.querySelector(\'[data-iframe-allowlist-reset]\')) {',
      '    var reset = document.createElement(\'button\');',
      '    reset.type = \'button\';',
      '    reset.className = \'btn btn-xs\';',
      '    reset.dataset.iframeAllowlistReset = \'1\';',
      '    reset.textContent = \'恢复默认白名单\';',
      '    reset.style.marginTop = \'8px\';',
      '    reset.addEventListener(\'click\', function () { iframeAttributes.value = \'width, height, frameborder, framespacing, border, allow, allowfullscreen, allowtransparency, allowpaymentrequest, title, name, id, class, style, referrerpolicy, sandbox, scrolling, marginwidth, marginheight, loading, credentialless, fetchpriority, align, longdesc, aria-label, aria-hidden, data-diag-id\'; normalizeIframeAttributes(); iframeAttributes.dispatchEvent(new Event(\'input\', { bubbles: true })); });',
      '    iframeAttributes.after(reset);',
      '  }',
      '})();',
      '</script>',
    ].join('\n');
    const livePreview = createAdminPreviewScript();
    return html + script + livePreview;
  }, 20);
}
