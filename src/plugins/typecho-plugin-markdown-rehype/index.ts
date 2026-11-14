import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { remarkAlert } from 'remark-github-blockquote-alert';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough';
import remarkMath from 'remark-math';
import remarkEmoji from 'remark-emoji';
import remarkIns from 'remark-ins';
import remarkToc from 'remark-toc';
import remarkFlexibleCodeTitles from 'remark-flexible-code-titles';
import remarkFlexibleContainers from 'remark-flexible-containers';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeExternalLinks from 'rehype-external-links';
import rehypeStringify from 'rehype-stringify';
import type { PluginInitContext, PluginRouteResult } from 'typecho/plugin-sdk';
import { isAdminActionResponse, requireAdminAction } from '@/lib/admin-auth';
import { registerPluginAdminPath } from '@/lib/plugin';
import { env } from 'cloudflare:workers';
import { getDb } from 'typecho/db';
import { getOption } from 'typecho/plugin-sdk';
import { transformGithubAlerts } from '../../lib/markdown-alerts';
import mathJaxModuleUrl from 'mathjax-full/es5/tex-svg.js?url';
import katexCss from 'katex/dist/katex.min.css?inline';

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

/** Support ![alt](url){width=48 height=48} without interpreting arbitrary attributes. */
function remarkImageSizeAttributes() {
  return (tree: any): void => {
    const visit = (node: any): void => {
      if (!node || !Array.isArray(node.children)) return;
      const children = node.children;
      for (let index = 0; index < children.length; index++) {
        const image = children[index];
        const following = children[index + 1];
        if (image?.type === 'image' && following?.type === 'text' && typeof following.value === 'string') {
          const match = following.value.match(/^\s*\{([^{}]+)\}/);
          if (match) {
            const tokens = match[1].trim().split(/\s+/);
            const dimensions: Record<string, string> = {};
            let valid = tokens.length > 0;
            for (const token of tokens) {
              const attribute = token.match(/^(width|height)=(?:"([^"]*)"|'([^']*)'|([^\s]+))$/i);
              if (!attribute) { valid = false; break; }
              const name = attribute[1].toLowerCase();
              const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
              if (!parseImageDimension(value)) { valid = false; break; }
              dimensions[name] = value;
            }
            if (valid && Object.keys(dimensions).length > 0) {
              image.data = image.data ?? {};
              const imageProperties = { ...(image.data.hProperties ?? {}) } as Record<string, any>;
              for (const [name, value] of Object.entries(dimensions)) {
                applyImageDimension(imageProperties, name as 'width' | 'height', value);
              }
              image.data.hProperties = imageProperties;
              following.value = following.value.slice(match[0].length);
              if (!following.value.trim()) children.splice(index + 1, 1);
            }
          }
        }
      }
      children.forEach(visit);
    };
    visit(tree);
  };
}

/** Interpret legacy image URL-fragment dimensions and preserve unrelated fragments. */
function rehypeImageDimensions() {
  return (tree: any): void => {
    const visit = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'element' && node.tagName === 'img' && node.properties) {
        const properties = node.properties as Record<string, any>;
        const src = properties.src;
        if (typeof src === 'string') {
          const hash = src.indexOf('#');
          if (hash >= 0) {
            const parts = src.slice(hash + 1).split('&');
            const remaining: string[] = [];
            let found = false;
            for (const part of parts) {
              const parameter = part.match(/^(width|height)=(.*)$/i);
              if (!parameter) {
                if (part) remaining.push(part);
                continue;
              }
              const name = parameter[1].toLowerCase() as 'width' | 'height';
              const value = parameter[2];
              if (!parseImageDimension(value)) {
                remaining.push(part);
                continue;
              }
              if (properties[name] == null) applyImageDimension(properties, name, value);
              found = true;
            }
            if (found) properties.src = src.slice(0, hash) + (remaining.length ? `#${remaining.join('&')}` : '');
          }
        }
      }
      if (Array.isArray(node.children)) node.children.forEach(visit);
    };
    visit(tree);
  };
}



// Extend the maintained GitHub-style sanitizer schema rather than implementing
// a second HTML parser or sanitizer. Preserve author-supplied article CSS and
// SVG presentation directly; executable scripts and event-handler attributes
// remain outside the allowlist.
const safeSvgId = /^[\p{L}\p{N}\p{M}_:.-]+$/u;
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

const FORBIDDEN_CUSTOM_HTML_TAGS = new Set([
  'script', 'object', 'embed', 'applet', 'frame', 'frameset',
  'base', 'meta', 'link', 'form', 'template', 'portal',
]);

const PLUGIN_OPTION_KEY = 'plugin:typecho-plugin-markdown-rehype';

const ADMIN_PREVIEW_PATH = '/api/admin/markdown-rehype-preview';

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

export function createArticleSanitizeSchema(
  iframeAttributes: string[] = [...DEFAULT_IFRAME_ATTRIBUTES],
  customHtmlTags: string[] = [],
) {
  return {
    ...articleSanitizeSchema,
    tagNames: [...articleSanitizeSchema.tagNames, ...customHtmlTags],
    attributes: {
      ...articleSanitizeSchema.attributes,
      iframe: [
        ...(articleSanitizeSchema.attributes.iframe ?? []).filter((attribute: any) => Array.isArray(attribute) && attribute[0] === 'src'),
        ...iframeAttributes,
      ],
    },
  };
}

let cachedCustomIframeAttributes: string[] = [];
let customIframeAttributesExpiresAt = 0;
let customIframeAttributesLoad: Promise<string[]> | null = null;
let cachedCustomHtmlTags: string[] = [...DEFAULT_CUSTOM_HTML_TAGS];
let customHtmlTagsExpiresAt = 0;
let customHtmlTagsLoad: Promise<string[]> | null = null;

async function loadCustomIframeAttributes(): Promise<string[]> {
  if (Date.now() < customIframeAttributesExpiresAt) return cachedCustomIframeAttributes;
  if (customIframeAttributesLoad) return customIframeAttributesLoad;
  customIframeAttributesLoad = (async () => {
    try {
      const db = getDb(env.DB);
      const raw = await getOption(db, 'plugin:typecho-plugin-markdown-rehype');
      const config = raw ? JSON.parse(raw) as Record<string, unknown> : {};
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

/** Normalize explicit standard HTML tag names while rejecting executable or document-level tags. */
export function normalizeCustomHtmlTags(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const result = new Set<string>();
  for (const raw of value.replace(/\\[nr]/gi, ' ').split(/[\s,，;；]+/)) {
    const name = raw.trim().toLowerCase();
    if (/^[a-z][a-z0-9]*$/.test(name) && !FORBIDDEN_CUSTOM_HTML_TAGS.has(name)) result.add(name);
  }
  return [...result];
}

async function loadCustomHtmlTags(): Promise<string[]> {
  if (Date.now() < customHtmlTagsExpiresAt) return cachedCustomHtmlTags;
  if (customHtmlTagsLoad) return customHtmlTagsLoad;
  customHtmlTagsLoad = (async () => {
    try {
      const db = getDb(env.DB);
      const raw = await getOption(db, 'plugin:typecho-plugin-markdown-rehype');
      const config = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      // Existing installations without this setting receive the curated defaults.
      // An explicitly saved empty field disables all optional custom tags.
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

const articleSanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...defaultSchema.tagNames,
    'button', 'figure', 'figcaption', 'style', 'mark', 'sup', 'sub',
    'details', 'summary', 'video', 'audio', 'source', 'iframe',
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
    th: [...(defaultSchema.attributes.th ?? []), 'className', ['align', 'left', 'center', 'right'], ['valign', 'top', 'middle', 'bottom']],
    td: [...(defaultSchema.attributes.td ?? []), 'className', ['align', 'left', 'center', 'right'], ['valign', 'top', 'middle', 'bottom']],
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
      ['src', /^(?:https?:)?\/\/(?:www\.youtube\.com|www\.youtube-nocookie\.com|player\.bilibili\.com|player\.vimeo\.com)(?:\/|$)/i],
      ...DEFAULT_IFRAME_ATTRIBUTES,
    ],
    button: [
      ['type', 'button'],
      ['disabled', true],
      'className', 'title', 'ariaLabel', 'dataDisclaimerToggle', 'ariaExpanded', 'style',
    ],
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
    section: [...(defaultSchema.attributes.section ?? []), 'className', 'style'],
    article: [...(defaultSchema.attributes.article ?? []), 'className', 'style'],
    aside: [...(defaultSchema.attributes.aside ?? []), 'className', 'style'],
    header: [...(defaultSchema.attributes.header ?? []), 'className', 'style'],
    footer: [...(defaultSchema.attributes.footer ?? []), 'className', 'style'],
    nav: [...(defaultSchema.attributes.nav ?? []), 'className', 'style'],
    figure: ['className', 'style', 'ariaHidden'],
    figcaption: ['className', 'style'],
    // WordPress/Gutenberg commonly stores presentation classes on semantic blocks.
    h1: [...(defaultSchema.attributes.h1 ?? []), 'className'],
    h2: [...(defaultSchema.attributes.h2 ?? []), 'className'],
    h3: [...(defaultSchema.attributes.h3 ?? []), 'className'],
    h4: [...(defaultSchema.attributes.h4 ?? []), 'className'],
    h5: [...(defaultSchema.attributes.h5 ?? []), 'className'],
    h6: [...(defaultSchema.attributes.h6 ?? []), 'className'],
    ul: [...(defaultSchema.attributes.ul ?? []), 'className'],
    ol: [...(defaultSchema.attributes.ol ?? []), 'className'],
    hr: [...(defaultSchema.attributes.hr ?? []), 'className'],
    table: [...(defaultSchema.attributes.table ?? []), 'className'],
    thead: [...(defaultSchema.attributes.thead ?? []), 'className'],
    tbody: [...(defaultSchema.attributes.tbody ?? []), 'className'],
    tfoot: [...(defaultSchema.attributes.tfoot ?? []), 'className'],
    tr: [...(defaultSchema.attributes.tr ?? []), 'className'],
    dl: [...(defaultSchema.attributes.dl ?? []), 'className'],
    dt: [...(defaultSchema.attributes.dt ?? []), 'className'],
    dd: [...(defaultSchema.attributes.dd ?? []), 'className'],
    i: [...(defaultSchema.attributes.i ?? []), 'className'],
    b: [...(defaultSchema.attributes.b ?? []), 'className'],
    em: [...(defaultSchema.attributes.em ?? []), 'className'],
    strong: [...(defaultSchema.attributes.strong ?? []), 'className'],
    mark: ['className', 'style'],
    sup: ['id', 'title', 'ariaLabel', 'ariaDescribedBy', 'dataFootnoteRef', 'dataFootnoteBackref', 'className', 'style'],
    // GFM footnote links target the generated <li id="fn-N"> element.
    // Preserve that target ID or the visible superscript link has nowhere to jump.
    li: [...(defaultSchema.attributes.li ?? []), 'id', 'className'],
    sub: ['id', 'title', 'ariaLabel', 'ariaDescribedBy', 'className', 'style'],

    img: [
      ...(defaultSchema.attributes.img ?? []),
      'alt', 'title', 'width', 'height', 'loading', 'className', 'style',
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

export type MarkdownMathEngine = 'katex' | 'mathjax';
export interface MarkdownRenderOptions {
  mathEngine?: MarkdownMathEngine;
  /** Generate a TOC only at an explicit "目录" heading in the Markdown source. */
  tocEnabled?: boolean;
}

/**
 * Recognize TeX delimiters inside text nodes created from raw HTML.
 *
 * remark-math handles ordinary Markdown text before raw HTML is parsed. Text
 * inside an HTML block is opaque to remark-math, however, so the same TeX
 * delimiters can otherwise survive as literal text in a styled article.
 * Convert only text nodes (never code, SVG, scripts, or styles) into the same
 * language-math nodes used by remark-math. The normal sanitizer and the
 * selected KaTeX/MathJax renderer then handle them through the existing path.
 */
const protectedMathDelimiters = [
  ['\\(', '\uE000WARM_MATH_INLINE_OPEN\uE001'],
  ['\\)', '\uE000WARM_MATH_INLINE_CLOSE\uE001'],
  ['\\[', '\uE000WARM_MATH_DISPLAY_OPEN\uE001'],
  ['\\]', '\uE000WARM_MATH_DISPLAY_CLOSE\uE001'],
] as const;

/**
 * Normalize indentation on HTML tag lines inside an already-started HTML
 * fragment. CommonMark ends a raw HTML block at a blank line; a later tag
 * indented by four spaces is then parsed as an indented code block. WordPress
 * exports often retain that indentation inside a still-open wrapper element.
 *
 * Only tag lines inside a fragment that began as an ordinary (0-3 space)
 * HTML block are touched. Fenced code blocks are always left byte-for-byte
 * unchanged, and an indented code block cannot start an HTML fragment.
 */
function normalizeIndentedHtmlBlocks(source: string): string {
  const voidElements = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
    'meta', 'param', 'source', 'track', 'wbr',
  ]);
  const lines = source.split('\n');
  const elementStack: string[] = [];
  let fenceCharacter = '';
  let fenceLength = 0;

  const updateHtmlStack = (line: string): void => {
    const tags = line.matchAll(/<\/?([A-Za-z][A-Za-z0-9:-]*)\b[^>]*>/g);
    for (const match of tags) {
      const token = match[0];
      const name = match[1].toLowerCase();
      if (token.startsWith('</')) {
        const index = elementStack.lastIndexOf(name);
        if (index >= 0) elementStack.length = index;
      } else if (!voidElements.has(name) && !/\/\s*>$/.test(token)) {
        elementStack.push(name);
      }
    }
  };

  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    const fence = line.match(/^ {0,3}([\x60~]{3,})/);
    if (fenceCharacter) {
      const marker = fenceCharacter === String.fromCharCode(96) ? '\\x60' : '~';
      const closing = new RegExp('^ {0,3}' + marker + '{' + fenceLength + ',}\\s*$');
      if (closing.test(line)) {
        fenceCharacter = '';
        fenceLength = 0;
      }
      continue;
    }
    if (fence) {
      fenceCharacter = fence[1][0];
      fenceLength = fence[1].length;
      continue;
    }

    const trimmed = line.trimStart();
    const startsWithTag = /^<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s|\/?>)/.test(trimmed);
    const indentation = line.length - trimmed.length;

    if (elementStack.length > 0 && startsWithTag && indentation > 0) {
      line = trimmed;
      lines[index] = line;
    } else if (elementStack.length === 0 && indentation > 3) {
      continue;
    }

    if (startsWithTag && (elementStack.length > 0 || indentation <= 3)) {
      updateHtmlStack(line);
    }
  }

  return lines.join('\n');
}

/**
 * Markdown treats backslash-parenthesis/bracket sequences as escapes before
 * remark-math can see them. Shield those delimiters before parsing, then
 * restore them in HAST text nodes so the shared math-text pass can recognize
 * them in ordinary Markdown and raw HTML alike. Code nodes are restored too,
 * but remain excluded by rehypeMathText.
 */
function protectMathDelimiters(source: string): string {
  return protectedMathDelimiters.reduce((value, [delimiter, placeholder]) => {
    let result = '';
    let cursor = 0;
    while (cursor < value.length) {
      const index = value.indexOf(delimiter, cursor);
      if (index < 0) break;

      // A doubled backslash is a Markdown-escaped literal backslash. Leave
      // that pair for remark-parse to collapse; shielding the second slash
      // would preserve two slashes and prevent the later TeX pass matching it.
      let precedingSlashes = 0;
      for (let offset = index - 1; offset >= 0 && value[offset] === '\\'; offset--) {
        precedingSlashes++;
      }
      if (precedingSlashes % 2 === 0) {
        result += value.slice(cursor, index) + placeholder;
        cursor = index + delimiter.length;
      } else {
        result += value.slice(cursor, index + 1);
        cursor = index + 1;
      }
    }
    return result + value.slice(cursor);
  }, source);
}

function rehypeRestoreMathDelimiters() {
  const replacements = new Map(protectedMathDelimiters.map(([delimiter, placeholder]) => [placeholder, delimiter]));
  return (tree: any): void => {
    const visit = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'text' && typeof node.value === 'string') {
        for (const [placeholder, delimiter] of replacements) {
          node.value = node.value.replaceAll(placeholder, delimiter);
        }
      }
      if (Array.isArray(node.children)) node.children.forEach(visit);
    };
    visit(tree);
  };
}

function rehypeMathText() {
  const ignoredParents = new Set(['pre', 'code', 'script', 'style', 'textarea', 'svg', 'math', 'kbd', 'samp']);
  const isEscaped = (value: string, index: number): boolean => {
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor--) slashes++;
    return slashes % 2 === 1;
  };

  return (tree: any): void => {
    const visit = (node: any, ancestors: string[] = []): void => {
      if (!node || typeof node !== 'object' || !Array.isArray(node.children)) return;
      const tagName = node.type === 'element' ? node.tagName : '';
      const nextAncestors = tagName ? [...ancestors, tagName] : ancestors;
      if (nextAncestors.some((name) => ignoredParents.has(name))) return;
      const children: any[] = [];
      for (const child of node.children) {
        if (child?.type !== 'text' || typeof child.value !== 'string'
          || (!child.value.includes('$') && !child.value.includes('\\(') && !child.value.includes('\\['))) {
          children.push(child);
          if (child?.type === 'element') visit(child, nextAncestors);
          continue;
        }

        const value = child.value;
        let cursor = 0;
        let textStart = 0;
        let matched = false;
        while (cursor < value.length) {
          if (isEscaped(value, cursor)) { cursor++; continue; }

          let open = '';
          let close = '';
          let display = false;
          if (value[cursor] === '$') {
            display = value[cursor + 1] === '$';
            open = display ? '$$' : '$';
            close = open;
          } else if (value[cursor] === '\\' && (value[cursor + 1] === '(' || value[cursor + 1] === '[')) {
            display = value[cursor + 1] === '[';
            open = display ? '\\[' : '\\(';
            close = display ? '\\]' : '\\)';
          } else {
            cursor++;
            continue;
          }

          let closing = -1;
          for (let probe = cursor + open.length; probe < value.length; probe++) {
            if (close === '$$') {
              if (value[probe] === '$' && value[probe + 1] === '$' && !isEscaped(value, probe)) {
                closing = probe;
                break;
              }
            } else if (close === '$') {
              if (value[probe] === '$' && value[probe - 1] !== '$' && value[probe + 1] !== '$'
                && !isEscaped(value, probe) && !value.slice(cursor + open.length, probe).includes('\n')) {
                closing = probe;
                break;
              }
            } else if (value.startsWith(close, probe) && !isEscaped(value, probe)
              && (display || !value.slice(cursor + open.length, probe).includes('\n'))) {
              closing = probe;
              break;
            }
          }

          if (closing < 0) { cursor += open.length; continue; }
          const formula = value.slice(cursor + open.length, closing);
          if (!formula.trim() || (open.startsWith('$') && /^\s|\s$/.test(formula))) {
            cursor += open.length;
            continue;
          }

          if (cursor > textStart) children.push({ type: 'text', value: value.slice(textStart, cursor) });
          const code = {
            type: 'element',
            tagName: 'code',
            properties: { className: ['language-math', display ? 'math-display' : 'math-inline'] },
            children: [{ type: 'text', value: formula }],
          };
          if (display) children.push({ type: 'element', tagName: 'pre', properties: { className: ['math'] }, children: [code] });
          else children.push(code);
          matched = true;
          cursor = closing + close.length;
          textStart = cursor;
        }

        if (!matched) children.push(child);
        else if (textStart < value.length) children.push({ type: 'text', value: value.slice(textStart) });
      }
      node.children = children;
    };
    visit(tree);
  };
}
/**
 * Mirror Rin's remark transform: each Mermaid fence becomes two independent
 * source <pre> nodes, one for the light theme and one for the dark theme.
 */
function remarkMermaidVariants() {
  return (tree: any): void => {
    const visit = (node: any): void => {
      if (!node || !Array.isArray(node.children)) return;
      const children = node.children as any[];
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        if (child?.type === 'code' && child.lang === 'mermaid') {
          const value = typeof child.value === 'string' ? child.value : '';
          children[index] = {
            type: 'html',
            value: `
            <pre class="mermaid_default dark:hidden">${value}</pre>
            <pre class="mermaid_dark dark:block hidden">${value}</pre>
            `,
          };
          continue;
        }
        visit(child);
      }
    };
    visit(tree);
  };
}

/**
 * Keep sanitizer-generated ID prefixes and local references synchronized.
 * rehype-sanitize intentionally prefixes clobberable IDs; SVG paint servers,
 * SVG use references and article fragment links must point at those final IDs.
 */
function rehypeRestoreLocalReferences() {
  return (tree: any): void => {
    const ids = new Set<string>();
    const visit = (node: any, callback: (element: any) => void): void => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'element') callback(node);
      if (Array.isArray(node.children)) node.children.forEach((child: any) => visit(child, callback));
    };

    visit(tree, (node) => {
      const id = node.properties?.id;
      if (typeof id === 'string' && id) ids.add(id);
    });

    const rewriteUrlReferences = (value: string): string => value.replace(
      /url\(\s*(["']?)#([\p{L}\p{N}\p{M}_:.-]+)\1\s*\)/giu,
      (match, quote: string, id: string) => {
        if (ids.has(id)) return match;
        const prefixedId = `user-content-${id}`;
        return ids.has(prefixedId) ? `url(${quote}#${prefixedId}${quote})` : match;
      },
    );

    visit(tree, (node) => {
      const properties = node.properties;
      if (!properties || typeof properties !== 'object') return;
      for (const [name, value] of Object.entries(properties)) {
        if (typeof value === 'string' && (name === 'style'
          || ['fill', 'stroke', 'clipPath', 'mask', 'filter', 'marker', 'markerStart', 'markerMid', 'markerEnd',
            'cursor', 'color', 'floodColor', 'lightingColor'].includes(name))) {
          properties[name] = rewriteUrlReferences(value);
        }
      }

      for (const name of ['href', 'xLinkHref', 'xlinkHref']) {
        const value = properties[name];
        if (typeof value !== 'string' || !value.startsWith('#')) continue;
        const id = value.slice(1);
        if (!safeSvgId.test(id)) continue;
        if (!ids.has(id) && ids.has(`user-content-${id}`)) {
          properties[name] = `#user-content-${id}`;
        }
      }

      for (const name of ['ariaLabelledBy', 'ariaDescribedBy']) {
        const value = properties[name];
        if (typeof value !== 'string') continue;
        properties[name] = value.split(/\s+/).map((id) =>
          !ids.has(id) && ids.has(`user-content-${id}`) ? `user-content-${id}` : id,
        ).join(' ');
      }
    });
  };
}

/**
 * Build one immutable processor for each supported render configuration.
 * Unified freezes a processor on first process() and documents that frozen
 * processors can process files repeatedly. Reuse avoids rebuilding the plugin
 * chain on every article request while keeping math/TOC options isolated.
 */
function createMarkdownProcessor(
  mathEngine: MarkdownMathEngine,
  tocEnabled: boolean,
  customIframeAttributes: string[] = [],
  customHtmlTags: string[] = [],
) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkAlert)
    .use(remarkCjkFriendly)
    .use(remarkCjkFriendlyGfmStrikethrough)
    .use(remarkMath)
    .use(remarkEmoji)
    .use(remarkIns)
    .use(remarkFlexibleCodeTitles, { titleTagName: 'strong', container: false })
    .use(remarkFlexibleContainers, {
      containerTagName: 'blockquote',
      titleTagName: 'strong',
      title: (type, title) => title ?? type?.toUpperCase(),
    })
    .use(remarkImageSizeAttributes)
    .use(remarkMermaidVariants);
  if (tocEnabled) processor.use(remarkToc, { heading: '目录', prefix: 'user-content-' });
  processor
    .use(remarkRehype, {
      allowDangerousHtml: true,
      footnoteLabel: '脚注',
      footnoteBackLabel: '返回正文',
    })
    .use(rehypeRaw)
    .use(rehypeImageDimensions)
    .use(rehypeRestoreMathDelimiters)
    .use(rehypeMathText)
    .use(rehypeSanitize, createArticleSanitizeSchema(customIframeAttributes, customHtmlTags))
    .use(rehypeRestoreLocalReferences);
  if (mathEngine === 'katex') processor.use(rehypeKatex);
  return processor
    .use(rehypeExternalLinks, { rel: ['nofollow'] })
    .use(rehypeHighlight)
    .use(rehypeSlug, { prefix: 'user-content-' })
    .use(rehypeAutolinkHeadings, {
      behavior: 'append',
      content: { type: 'text', value: '¶' },
      properties: { className: ['warm-heading-anchor'], ariaHidden: true, tabIndex: -1 },
    })
    .use(rehypeStringify);
}

const processorCache = new Map<string, ReturnType<typeof createMarkdownProcessor>>();

function getMarkdownProcessor(
  mathEngine: MarkdownMathEngine,
  tocEnabled: boolean,
  customIframeAttributes: string[] = [],
  customHtmlTags: string[] = [],
) {
  const key = [mathEngine, tocEnabled ? 'toc' : 'no-toc', customIframeAttributes.join(','), customHtmlTags.join(',')].join(':');
  let processor = processorCache.get(key);
  if (!processor) {
    processor = createMarkdownProcessor(mathEngine, tocEnabled, customIframeAttributes, customHtmlTags);
    processorCache.set(key, processor);
  }
  return processor;
}

/**
 * Reuse completed renders across requests in the same Worker isolate.
 * Keys contain the exact normalized source and every setting that affects
 * output; no probabilistic hash is used, so a collision cannot return another
 * article's HTML. Both entry count and retained string size are bounded.
 */
/**
 * A bounded, isolate-local gate for expensive Markdown processor runs.
 * This protects one Worker isolate; it is not a global limit across Cloudflare isolates.
 */
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

const MARKDOWN_ALERT_SVGS: Record<string, string> = {
  NOTE: '<svg class="markdown-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
  TIP: '<svg class="markdown-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z"/></svg>',
  IMPORTANT: '<svg class="markdown-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
  WARNING: '<svg class="markdown-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
  CAUTION: '<svg class="markdown-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
};

function addMarkdownAlertIcons(html: string): string {
  // Replace the renderer's text fallback with the matching inline SVG.
  // This runs after rehype-sanitize, so only the fixed, source-owned SVG strings are inserted.
  return html.replace(
    /(<p\b(?=[^>]*\bclass=(["'])[^"']*\bmarkdown-alert-title\b[^"']*\2)[^>]*>)([\s\S]*?)(<\/p>)/gi,
    (_full, opening: string, _quote: string, originalInner: string, closing: string) => {
      const withoutPreviousIcon = originalInner
        .replace(/<svg\b(?=[^>]*\bclass=(['"])[^'"]*\bocticon\b[^'"]*\1)[^>]*>[\s\S]*?<\/svg>/gi, '')
        .replace(/<span\b(?=[^>]*\bclass=(["'])[^"']*\bocticon\b[^"']*\1)[^>]*>[\s\S]*?<\/span>/gi, '')
        .replace(/<span\b(?=[^>]*\bclass=(["'])[^"']*\bmarkdown-alert-icon\b[^"']*\1)[^>]*>[\s\S]*?<\/span>/gi, '')
        .replace(/<svg\b(?=[^>]*\bclass=(["'])[^"']*\bmarkdown-alert-icon\b[^"']*\1)[^>]*>[\s\S]*?<\/svg>/gi, '')
        .replace(/^\s*(?:ⓘ|✦|❗|⚠|⛔)\s*/u, '');
      const label = withoutPreviousIcon.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/gi, ' ').trim().toUpperCase();
      const icon = MARKDOWN_ALERT_SVGS[label] ?? MARKDOWN_ALERT_SVGS.NOTE;
      return opening + icon + withoutPreviousIcon + closing;
    },
  );
}

/** Warm CY article-only Markdown pipeline; raw HTML uses the official sanitizer with a narrow article schema extension. */
export async function renderMarkdown(source: string, options: MarkdownRenderOptions = {}): Promise<string> {
  if (!source) return '';
  const mathEngine = options.mathEngine === 'mathjax' ? 'mathjax' : 'katex';
  const tocEnabled = options.tocEnabled === true;
  const [customIframeAttributes, customHtmlTags] = await Promise.all([
    loadCustomIframeAttributes(),
    loadCustomHtmlTags(),
  ]);
  const normalizedSource = normalizeIndentedHtmlBlocks(source);
  // Avoid allocating a second large copy of exceptionally long articles just
  // to form a cache key. The preview endpoint's existing 100k limit fits here.
  const cacheKey = normalizedSource.length <= RENDERED_MARKDOWN_CACHE_MAX_SOURCE_LENGTH
    ? JSON.stringify([
      mathEngine,
      tocEnabled,
      customIframeAttributes,
      customHtmlTags,
      normalizedSource,
    ])
    : null;

  if (cacheKey) {
    const cached = getCachedMarkdownRender(cacheKey);
    if (cached !== undefined) return cached;

    // Separate tabs or users can submit the same article at nearly the same
    // time. Share that exact render instead of running KaTeX/highlight twice.
    const inFlight = inFlightMarkdownRenders.get(cacheKey);
    if (inFlight) return inFlight;
  }

  const processor = getMarkdownProcessor(
    mathEngine,
    tocEnabled,
    customIframeAttributes,
    customHtmlTags,
  );
  // The cache and in-flight lookup happen before the gate, so cache hits never
  // wait for a render slot and identical concurrent requests still share work.
  const render = runMarkdownRender(async () => {
    const file = await processor.process(protectMathDelimiters(normalizedSource));
    const html = addMarkdownAlertIcons(transformGithubAlerts(String(file)));
    if (cacheKey) cacheMarkdownRender(cacheKey, html);
    return html;
  });

  if (!cacheKey) return render;

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
  const mermaidConfigObject = {
    light: { startOnLoad: false, theme: 'default' },
    dark: { startOnLoad: false, theme: 'dark' },
  };
  const mermaidConfigs = JSON.stringify(mermaidConfigObject).replace(/</g, '\\u003c');
  const katexCssValue = JSON.stringify(katexCss).replace(/</g, '\\u003c');
  const mathJaxUrlValue = JSON.stringify(mathJaxModuleUrl).replace(/</g, '\\u003c');

  return `<script type="module" data-markdown-rehype-live-preview>
(() => {
  const mermaidConfigs = ${mermaidConfigs};
  const katexCss = ${katexCssValue};
  const mathJaxUrl = ${mathJaxUrlValue};
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

  function isPreviewVisible() {
    return !preview.classList.contains('wmd-hidetab');
  }
  frame.srcdoc = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body style="box-sizing:border-box;margin:0;padding:0 15px;font:14px/1.7 system-ui,sans-serif;color:#77817b;background:#fff">正在加载 Markdown 预览…</body></html>';
  const isDarkMode = () =>
    document.documentElement.classList.contains('dark') ||
    document.body.classList.contains('dark');

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

  async function createPreviewDocument(payload) {
    const dark = isDarkMode();
    const mathEngine = payload.mathEngine === 'mathjax' ? 'mathjax' : 'katex';
    const previewKatexCss = await inlineKatexFontAssets(katexCss);
    const bodyClass = 'warm-theme' + (dark ? ' dark' : '');
    const htmlClass = dark ? 'dark' : '';
    const source = typeof payload.html === 'string' ? payload.html : '';
    return '<!doctype html><html lang="zh-CN" class="' + htmlClass + '"><head>' +
      '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<link rel="stylesheet" href="/themes/typecho-theme-warm-cy/style.css">' +
      '<style>' + previewKatexCss + '</style>' +
      '<style>html,body{margin:0!important;padding:0!important;min-height:0!important;}html,body,*{scrollbar-width:auto!important;scrollbar-color:auto!important;}body.warm-theme{min-width:0!important;min-height:0!important;overflow-x:hidden!important;} .warm-main{box-sizing:border-box!important;width:100%!important;max-width:none!important;margin:0!important;padding:0 15px!important;} .warm-article{width:100%!important;margin:0!important;} .warm-article__body{min-width:0!important;width:100%!important;} .warm-prose{width:100%;max-width:none!important;} .warm-prose .mathjax-display{box-sizing:border-box;max-width:100%;overflow:visible;padding:0;line-height:normal;} .warm-prose .mathjax-display__scroll{box-sizing:border-box;max-width:100%;overflow-x:auto;overflow-y:hidden;padding-block:1.5em;} .warm-prose .mathjax-display__scroll mjx-container[display="true"]{margin:0!important;}</style>' +
      '<script>(function(){try{window.localStorage;}catch(e){var values=Object.create(null);var storage={get length(){return Object.keys(values).length;},clear:function(){values=Object.create(null);},getItem:function(key){key=String(key);return Object.prototype.hasOwnProperty.call(values,key)?values[key]:null;},key:function(index){return Object.keys(values)[index]||null;},removeItem:function(key){delete values[String(key)];},setItem:function(key,value){values[String(key)]=String(value);}};try{Object.defineProperty(window,"localStorage",{configurable:true,value:storage});}catch(ignore){}}})();window.MathJax={startup:{typeset:false},options:{enableMenu:false,renderActions:{addMenu:[],checkLoading:[]}},tex:{inlineMath:[["\\\\(","\\\\)"]],displayMath:[["\\\\[","\\\\]"]]}};' + '</scr' + 'ipt>' +
      '</head><body class="' + bodyClass + '">' +
      '<main class="warm-main"><article class="warm-article"><div class="warm-article__body" data-math-engine="' + mathEngine + '"><div class="warm-prose">' + source + '</div></div></article></main>' +
      '<script>(function(){var mermaidConfigs=' + JSON.stringify(mermaidConfigs) + ';var mathEngine=' + JSON.stringify(mathEngine) + ';var mathJaxUrl=' + JSON.stringify(mathJaxUrl) + ';' +
        'function notify(){var root=document.documentElement,body=document.body,rect=body.getBoundingClientRect();var h=Math.ceil(Math.max(root.scrollHeight,body.scrollHeight,root.offsetHeight,body.offsetHeight,rect.bottom+window.scrollY));window.parent.postMessage({type:"markdown-rehype-preview-height",height:h},"*");}' +
        'if(window.ResizeObserver){var ro=new ResizeObserver(notify);ro.observe(document.documentElement);ro.observe(document.body);}' +
        'window.addEventListener("load",notify);window.addEventListener("resize",notify);setTimeout(notify,80);setTimeout(notify,350);' +
        'var ms=document.createElement("script");ms.src="/plugin-assets/typecho-plugin-markdown-rehype/mermaid-runtime.js";ms.onload=function(){var m=window.__warmCyMermaid;if(!m)return;var darkMode=document.documentElement.classList.contains("dark");var nodes=Array.from(document.querySelectorAll(darkMode?"pre.mermaid_dark:not([data-processed])":"pre.mermaid_default:not([data-processed])"));if(!nodes.length){notify();return;}var started=false,mermaidObserver=null;function renderWhenMeasurable(){if(started)return;var measurable=nodes.every(function(node){return node.isConnected&&node.parentElement&&node.parentElement.getBoundingClientRect().width>0;});if(!measurable)return;started=true;if(mermaidObserver)mermaidObserver.disconnect();window.removeEventListener("resize",renderWhenMeasurable);try{m.initialize(darkMode?mermaidConfigs.dark:mermaidConfigs.light);Promise.resolve(m.run({nodes:nodes})).then(function(){requestAnimationFrame(function(){notify();requestAnimationFrame(notify);});}).catch(function(e){console.error("Mermaid rendering failed:",e);notify();});}catch(e){console.error("Mermaid initialization failed:",e);notify();}}if(window.ResizeObserver){mermaidObserver=new ResizeObserver(renderWhenMeasurable);mermaidObserver.observe(document.documentElement);mermaidObserver.observe(document.body);nodes.forEach(function(node){if(node.parentElement)mermaidObserver.observe(node.parentElement);});}window.addEventListener("resize",renderWhenMeasurable);renderWhenMeasurable();};ms.onerror=function(){console.error("Mermaid runtime failed to load");notify();};document.head.append(ms);' +

        'if(mathEngine==="mathjax"&&document.querySelector("code.language-math")){var mathScript=document.createElement("script");mathScript.src=mathJaxUrl;mathScript.onload=function(){var blocks=Array.from(document.querySelectorAll("code.language-math:not([data-mathjax-processed])"));var mathItems=[];blocks.forEach(function(code){var pre=code.closest("pre");var replacement=document.createElement(pre?"div":"span");replacement.className=pre?"mathjax-display":"mathjax-inline";var target=replacement;var tex=code.textContent||"";if(pre){var scroll=document.createElement("div");scroll.className="mathjax-display__scroll";target=scroll;replacement.append(scroll);}mathItems.push({target:target,tex:tex,display:!!pre});(pre||code).replaceWith(replacement);});var mathJax=window.MathJax;if(!mathJax||!mathJax.startup||!mathJax.startup.promise||typeof mathJax.tex2svgPromise!=="function"){console.error("MathJax tex2svg runtime did not initialize in the preview");notify();return;}mathJax.startup.promise.then(function(){return mathItems.reduce(function(chain,item){return chain.then(function(){return mathJax.tex2svgPromise(item.tex,{display:item.display}).then(function(output){item.target.replaceChildren(output);}).catch(function(e){console.error("MathJax formula rendering failed:",e);});});},Promise.resolve());}).then(notify).catch(function(e){console.error("MathJax rendering failed:",e);notify();});};mathScript.onerror=function(){console.error("MathJax script failed to load in the preview:",mathJaxUrl);notify();};document.head.append(mathScript);}' +
'})();' + '</scr' + 'ipt>' +
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
  window.__warmCyMarkdownRehypePreviewRefresh = schedule;

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
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
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
  '.markdown-rehype-settings-page .markdown-rehype-conflict-warning { margin: 0 0 14px; color: #c62828; font-weight: 700; line-height: 1.7; }',
  '@media (max-width: 767px) { .markdown-rehype-settings-page .typecho-option { padding: 16px !important; } }',
].join('\n');

export default function init({ addHook, pluginId }: PluginInitContext): void {
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
    if (auth.options.theme !== 'typecho-theme-warm-cy') {
      return { handled: true, response: new Response('Not found', { status: 404 }) };
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
      const config = parsePluginConfig(auth.options[PLUGIN_OPTION_KEY]);
      const mathEngine = config.mathEngine === 'mathjax' ? 'mathjax' : 'katex';
      const html = await renderMarkdown(source, {
        mathEngine,
        tocEnabled: config.tocEnabled === true || config.tocEnabled === '1',
      });
      return {
        handled: true,
        response: new Response(JSON.stringify({ html, mathEngine }), {
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
      customIframeAttributesExpiresAt = 0;
      customHtmlTagsExpiresAt = 0;
      clearMarkdownRenderCache();
    }
    return result;
  }, 20);

  addHook('admin:header', pluginId, (html: string, extra?: {
    title?: string;
    options?: Record<string, unknown>;
  }) => {
    if (extra?.options?.theme !== 'typecho-theme-warm-cy'
      || extra?.title !== '设置插件 Markdown Rehype') return html;
    return html + '<style data-markdown-rehype-admin>' + markdownRehypeAdminCss + '</style>';
  }, 20);

  addHook('admin:footer', pluginId, (html: string, extra?: {
    options?: Record<string, unknown>;
  }) => {
    if (extra?.options?.theme !== 'typecho-theme-warm-cy') return html;
    const pluginConfig = parsePluginConfig(extra.options?.[PLUGIN_OPTION_KEY]);
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
      '    link.href = \'/admin/options-theme\';',
      '    link.textContent = \'返回主题设置\';',
      '    toolbar.append(link);',
      '    form.before(toolbar);',
      '  }',
      '  if (!form.previousElementSibling || !form.previousElementSibling.classList.contains(\'markdown-rehype-conflict-warning\')) {',
      '    var warning = document.createElement(\'p\');',
      '    warning.className = \'markdown-rehype-conflict-warning\';',
      '    warning.textContent = \'注：运行此插件不要打开CY服务插件中的【正文 HTML / CSS / JavaScript 增强】选项，与之冲突。\';',
      '    form.before(warning);',
      '  }',
      '  var htmlTags = form.querySelector(\'textarea[name="htmlTags"]\');',
      '  var htmlTagsCard = htmlTags && htmlTags.closest(\'.typecho-option\');',
      '  var iframeAttributesCard = form.querySelector(\'textarea[name="iframeAttributes"]\')?.closest(\'.typecho-option\');',
      '  if (htmlTagsCard) htmlTagsCard.classList.add(\'markdown-rehype-allowlist-card\');',
      '  if (htmlTags) {',
      '    var normalizeHtmlTags = function () {',
      '      var tags = Array.from(new Set(htmlTags.value.replace(/\\\\[nr]/gi, \' \').split(/[\\s,，;；]+/).map(function (tag) { return tag.trim().toLowerCase(); }).filter(Boolean)));',
      '      htmlTags.value = tags.join(\', \');',
      '    };',
      '    htmlTags.addEventListener(\'blur\', normalizeHtmlTags);',
      '    form.addEventListener(\'submit\', normalizeHtmlTags);',
      '    normalizeHtmlTags();',
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
