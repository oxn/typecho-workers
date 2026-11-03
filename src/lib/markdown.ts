import { Marked, marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { applyFilter, type HookContext } from '@/lib/plugin';
import { escapeHtml as escapeHtmlShared } from '@/lib/escape';
import { generateSlug } from '@/lib/content';
import { transformGithubAlerts } from '@/lib/markdown-alerts';
import markedFootnote from 'marked-footnote';

export { transformGithubAlerts } from '@/lib/markdown-alerts';

/**
 * Parse article/page/note Markdown with a fresh footnote extension instance.
 * A new instance per parse keeps reference state isolated between requests.
 * Comment Markdown intentionally continues to use the separate basic parser.
 */
const mathBlockExtension = {
  name: 'markdownMathBlock',
  level: 'block' as const,
  start(source: string): number | undefined {
    const lines = source.split('\n');
    const backtick = String.fromCharCode(96);
    let offset = 0;
    let fenceCharacter = '';
    let fenceLength = 0;

    for (const line of lines) {
      const trimmed = line.trimStart();
      const marker = trimmed.charAt(0);
      let markerLength = 0;
      while (trimmed.charAt(markerLength) === marker && marker) markerLength += 1;

      if (!fenceCharacter && (marker === backtick || marker === '~') && markerLength >= 3) {
        fenceCharacter = marker;
        fenceLength = markerLength;
      } else if (fenceCharacter) {
        if (marker === fenceCharacter && markerLength >= fenceLength && trimmed.slice(markerLength).trim() === '') {
          fenceCharacter = '';
          fenceLength = 0;
        }
      } else if (trimmed === '$$' || trimmed === '\\[') {
        return offset + (line.length - trimmed.length);
      }

      offset += line.length + 1;
    }
    return undefined;
  },
  tokenizer(source: string) {
    const dollar = /^\$\$\s*\n([\s\S]*?)\n\$\$\s*(?:\n|$)/.exec(source);
    const bracket = /^\\\[\s*\n([\s\S]*?)\n\\\]\s*(?:\n|$)/.exec(source);
    const match = dollar ?? bracket;
    if (!match) return undefined;
    return { type: 'markdownMathBlock', raw: match[0], text: match[1] };
  },
  renderer(token: { text: string }): string {
    const tex = token.text.trim();
    const escaped = escapeHtmlShared(tex);
    return '<div class="markdown-math markdown-math--block" data-tex="' + escaped + '">' + escaped + '</div>\n';
  },
};

const mathInlineExtension = {
  name: 'markdownMathInline',
  level: 'inline' as const,
  start(source: string): number | undefined {
    const tick = String.fromCharCode(96);
    let index = 0;
    while (index < source.length) {
      if (source[index] === '\\') {
        if (source[index + 1] === '(') return index;
        if (source[index + 1] === '$') {
          index += 2;
          continue;
        }
        index += 1;
        continue;
      }
      if (source[index] === tick) {
        let end = index + 1;
        while (source[end] === tick) end += 1;
        const marker = tick.repeat(end - index);
        const close = source.indexOf(marker, end);
        if (close === -1) return undefined;
        index = close + marker.length;
        continue;
      }
      if (source[index] === '$' && source[index + 1] !== '$') return index;
      index += 1;
    }
    return undefined;
  },
  tokenizer(source: string) {
    const dollar = /^\$(?!\$)((?:\\.|[^$])+?)(?<!\\)\$(?!\$)/.exec(source);
    if (dollar && dollar[1].trim()) {
      return { type: 'markdownMathInline', raw: dollar[0], text: dollar[1] };
    }
    const bracket = /^\\\((.+?)\\\)/.exec(source);
    if (bracket && bracket[1].trim()) {
      return { type: 'markdownMathInline', raw: bracket[0], text: bracket[1] };
    }
    return undefined;
  },
  renderer(token: { text: string }): string {
    const tex = token.text.trim();
    const escaped = escapeHtmlShared(tex);
    return '<span class="markdown-math" data-tex="' + escaped + '">' + escaped + '</span>';
  },
};

function addMarkdownHeadingAnchors(html: string): string {
  const reserved = new Set<string>();
  html.replace(/<h[1-6]([^>]*)>/gi, (_full, attributes: string) => {
    const existingId = /\bid\s*=\s*(["'])(.*?)\1/i.exec(attributes);
    if (existingId) reserved.add(existingId[2]);
    return _full;
  });

  const used = new Set(reserved);
  return html.replace(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gi, (full, level: string, attributes: string, inner: string) => {
    if (/\bid\s*=\s*(["']).*?\1/i.test(attributes)) return full;

    const headingText = inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const base = generateSlug(headingText) || 'heading-' + level;
    let id = base;
    let suffix = 1;
    while (used.has(id)) {
      id = base + '-' + suffix;
      suffix += 1;
    }
    used.add(id);
    return '<h' + level + attributes + ' id="' + id + '">' + inner + '</h' + level + '>';
  });
}

function parseContentMarkdown(source: string): string {
  const parser = new Marked({ gfm: true, breaks: true });
  parser.use(markedFootnote());
  parser.use({ extensions: [mathBlockExtension, mathInlineExtension] });
  const html = parser.parse(source) as string;
  return addMarkdownHeadingAnchors(html);
}
// ─── HTML escape helper ─────────────────────────────────────────────────────

/** @deprecated Import from '@/lib/escape' directly. */
export function escapeHtml(str: string): string {
  return escapeHtmlShared(str);
}

// ─── Shared sanitize config ──────────────────────────────────────────────────


const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    // Markdown and text
    'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'pre', 'code', 'del', 'ins', 'mark', 'small',
    'sub', 'sup', 'abbr', 'wbr', 'kbd', 'samp',

    // Tables
    'table', 'caption', 'colgroup', 'col',
    'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',

    // Lists
    'dl', 'dt', 'dd',

    // Semantic HTML
    'div', 'span', 'section', 'article', 'aside',
    'header', 'footer', 'nav', 'main', 'address',

    // Interactive presentation
    'button', 'details', 'summary',

    // Media
    'figure', 'figcaption', 'picture',
    'video', 'audio', 'source', 'track',

    // Existing iframe support remains hostname-restricted
    'iframe',

    // SVG
    'svg', 'title', 'desc',
    'path', 'polyline', 'polygon', 'line',
    'circle', 'ellipse', 'rect', 'g',
    'defs', 'clipPath', 'clippath',
    'radialgradient', 'lineargradient',
    'radialGradient', 'linearGradient', 'stop',
  ]),

  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,

    img: [
      'src', 'alt', 'title', 'width', 'height',
      'loading', 'decoding',
    ],

    a: [
      'href', 'title', 'target', 'rel',
      'download', 'class', 'id', 'style',
      'data-footnote-ref', 'data-footnote-backref',
      'aria-label', 'aria-describedby',
    ],

    button: [
      'type', 'disabled', 'class', 'id', 'title', 'style',
    ],

    div: ['class', 'id', 'title', 'style'],
    span: ['class', 'id', 'title', 'style'],
    section: ['class', 'id', 'title', 'style', 'data-footnotes'],
    article: ['class', 'id', 'title', 'style'],
    aside: ['class', 'id', 'title', 'style'],
    header: ['class', 'id', 'title', 'style'],
    footer: ['class', 'id', 'title', 'style'],
    nav: ['class', 'id', 'title', 'style'],
    main: ['class', 'id', 'title', 'style'],
    address: ['class', 'id', 'title', 'style'],
    h1: ['class', 'id'],
    h2: ['class', 'id'],
    h3: ['class', 'id'],
    h4: ['class', 'id'],
    h5: ['class', 'id'],
    h6: ['class', 'id'],
    li: ['id'],

    table: ['class', 'id', 'style'],
    caption: ['class', 'id', 'style'],
    colgroup: ['span'],
    col: ['span', 'width'],

    td: ['align', 'valign', 'colspan', 'rowspan', 'class', 'style'],
    th: ['align', 'valign', 'colspan', 'rowspan', 'scope', 'class', 'style'],

    code: ['class'],
    pre: ['class'],
    p: ['class', 'style'],

    blockquote: ['class', 'data-alert'],

    video: [
      'src', 'controls', 'width', 'height',
      'poster', 'preload', 'muted', 'loop',
      'autoplay', 'playsinline',
    ],

    audio: [
      'src', 'controls', 'preload',
      'muted', 'loop', 'autoplay',
    ],

    source: ['src', 'type', 'media'],
    track: ['kind', 'src', 'srclang', 'label', 'default'],

    iframe: [
      'src', 'width', 'height',
      'frameborder', 'allowfullscreen',
    ],

    svg: [
      'width', 'height', 'viewbox', 'xmlns',
      'fill', 'stroke', 'stroke-width',
      'stroke-linecap', 'stroke-linejoin',
      'style', 'class', 'id', 'role',
      'aria-label',
    ],

    path: [
      'id', 'd', 'fill', 'fill-rule',
      'stroke', 'stroke-width',
      'stroke-linecap', 'stroke-linejoin',
      'opacity', 'style',
    ],

    polyline: [
      'points', 'fill', 'stroke',
      'stroke-width', 'stroke-linecap',
      'stroke-linejoin', 'opacity',
    ],

    polygon: [
      'points', 'fill', 'stroke',
      'stroke-width', 'stroke-linejoin',
      'opacity',
    ],

    line: [
      'x1', 'y1', 'x2', 'y2',
      'fill', 'stroke', 'stroke-width',
      'stroke-linecap', 'stroke-linejoin', 'opacity',
    ],

    circle: [
      'id', 'cx', 'cy', 'r', 'fill',
      'fill-rule', 'stroke', 'stroke-width',
      'opacity', 'style',
    ],

    ellipse: [
      'id', 'cx', 'cy', 'rx', 'ry',
      'fill', 'stroke', 'stroke-width', 'opacity',
    ],

    rect: [
      'id', 'x', 'y', 'width', 'height',
      'rx', 'ry', 'fill', 'fill-rule',
      'stroke', 'stroke-width', 'opacity', 'style',
      'clip-path',
    ],

    g: [
      'id', 'fill', 'stroke', 'stroke-width',
      'stroke-linecap', 'stroke-linejoin',
      'opacity', 'transform',
    ],

    defs: ['id'],
    clipPath: ['id', 'clipPathUnits'],
    title: ['class'],

    radialgradient: [
      'id', 'cx', 'cy', 'fx', 'fy', 'r',
      'gradientunits', 'gradienttransform', 'spreadmethod',
    ],

    lineargradient: [
      'id', 'x1', 'y1', 'x2', 'y2',
      'gradientunits', 'gradienttransform', 'spreadmethod',
    ],

    radialGradient: [
      'id', 'cx', 'cy', 'fx', 'fy', 'r',
      'gradientUnits', 'gradientTransform', 'spreadMethod',
    ],

    linearGradient: [
      'id', 'x1', 'y1', 'x2', 'y2',
      'gradientUnits', 'gradientTransform', 'spreadMethod',
    ],

    stop: ['offset', 'stop-color', 'stop-opacity', 'style'],
  },

  allowedStyles: {
    '*': {
      color: [
        /^(?:#[0-9a-f]{3,8}|rgba?\([0-9.,%\s]+\)|var\(--[a-zA-Z0-9_-]+\)|[a-zA-Z]+)$/i,
      ],

      fill: [
        /^(?:#[0-9a-f]{3,8}|none|currentColor|[a-zA-Z]+)$/i,
      ],

      'fill-rule': [/^(?:nonzero|evenodd)$/i],

      'background-color': [
        /^(?:#[0-9a-f]{3,8}|rgba?\([0-9.,%\s]+\)|var\(--[a-zA-Z0-9_-]+\)|[a-zA-Z]+)$/i,
      ],

      background: [
        /^(?:#[0-9a-f]{3,8}|rgba?\([0-9.,%\s]+\)|var\(--[a-zA-Z0-9_-]+\)|[a-zA-Z]+)$/i,
      ],

      'font-weight': [
        /^(?:normal|bold|bolder|lighter|[1-9]00)$/i,
      ],

      'font-size': [
        /^(?:[0-9.]+(?:px|em|rem|%|pt)|small|medium|large|larger|smaller)$/i,
      ],

      'font-family': [
        /^[a-zA-Z0-9_,\s"'()-]+$/,
      ],

      'text-decoration': [
        /^(?:none|underline|overline|line-through)(?:\s+(?:solid|dotted|dashed|wavy))?$/i,
      ],

      'text-align': [
        /^(?:left|right|center|justify|start|end)$/i,
      ],

      'letter-spacing': [
        /^(?:normal|[0-9.-]+(?:px|em|rem))$/i,
      ],

      'word-break': [
        /^(?:normal|break-all|keep-all|break-word)$/i,
      ],

      'white-space': [
        /^(?:normal|nowrap|pre|pre-wrap|pre-line|break-spaces)$/i,
      ],

      display: [
        /^(?:inline|inline-block|inline-flex|block|flex|grid|none|table|table-cell)$/i,
      ],

      position: [
        /^(?:static|relative|absolute)$/i,
      ],

      top: [/^[0-9.]+(?:px|em|rem|%)?$/i],
      right: [/^[0-9.]+(?:px|em|rem|%)?$/i],
      bottom: [/^[0-9.]+(?:px|em|rem|%)?$/i],
      left: [/^[0-9.]+(?:px|em|rem|%)?$/i],

      width: [/^(?:auto|[0-9.]+(?:px|em|rem|%|vw))$/i],
      height: [/^(?:auto|[0-9.]+(?:px|em|rem|%|vh))$/i],

      'min-width': [/^(?:0|[0-9.]+(?:px|em|rem|%|vw))$/i],
      'max-width': [/^(?:none|100%|[0-9.]+(?:px|em|rem|%|vw))$/i],
      'min-height': [/^(?:0|[0-9.]+(?:px|em|rem|%|vh))$/i],
      'max-height': [/^(?:none|100%|[0-9.]+(?:px|em|rem|%|vh))$/i],

      'flex-direction': [
        /^(?:row|row-reverse|column|column-reverse)$/i,
      ],

      'flex-wrap': [
        /^(?:nowrap|wrap|wrap-reverse)$/i,
      ],

      flex: [
        /^(?:none|auto|initial|[0-9.]+(?:\s+[0-9.]+){0,2})$/i,
      ],

      'justify-content': [
        /^(?:start|end|center|flex-start|flex-end|space-between|space-around|space-evenly)$/i,
      ],

      'align-items': [
        /^(?:center|start|end|flex-start|flex-end|baseline|stretch)$/i,
      ],

      'align-self': [
        /^(?:auto|center|start|end|flex-start|flex-end|baseline|stretch)$/i,
      ],

      'grid-template-columns': [
        /^(?:none|repeat\([0-9]+,\s*(?:[0-9.]+fr|[0-9.]+px|[0-9.]+%|auto)\)|(?:[0-9.]+fr|[0-9.]+px|[0-9.]+%|auto)(?:\s+(?:[0-9.]+fr|[0-9.]+px|[0-9.]+%|auto)){0,5})$/i,
      ],

      gap: [/^[0-9.]+(?:px|em|rem|%)$/i],

      padding: [
        /^[0-9.]+(?:px|em|rem|%)?(?:\s+[0-9.]+(?:px|em|rem|%)?){0,3}$/i,
      ],

      'padding-top': [/^[0-9.]+(?:px|em|rem|%)?$/i],
      'padding-right': [/^[0-9.]+(?:px|em|rem|%)?$/i],
      'padding-bottom': [/^[0-9.]+(?:px|em|rem|%)?$/i],
      'padding-left': [/^[0-9.]+(?:px|em|rem|%)?$/i],

      margin: [
        /^(?:auto|[0-9.]+(?:px|em|rem|%)?)(?:\s+(?:auto|[0-9.]+(?:px|em|rem|%)?)){0,3}$/i,
      ],

      'margin-top': [/^(?:auto|[0-9.]+(?:px|em|rem|%)?)$/i],
      'margin-right': [/^(?:auto|[0-9.]+(?:px|em|rem|%)?)$/i],
      'margin-bottom': [/^(?:auto|[0-9.]+(?:px|em|rem|%)?)$/i],
      'margin-left': [/^(?:auto|[0-9.]+(?:px|em|rem|%)?)$/i],

      'border-radius': [
        /^[0-9.]+(?:px|em|rem|%)?(?:\s+[0-9.]+(?:px|em|rem|%)?){0,3}$/i,
      ],

      border: [
        /^[0-9.]+px\s+(?:solid|dashed|dotted)\s+(?:#[0-9a-f]{3,8}|[a-zA-Z]+)$/i,
      ],

      'border-color': [
        /^(?:#[0-9a-f]{3,8}|[a-zA-Z]+)$/i,
      ],

      'border-width': [
        /^[0-9.]+(?:px|em|rem)$/i,
      ],

      'border-style': [
        /^(?:none|solid|dashed|dotted|double)$/i,
      ],

      'border-bottom-left-radius': [
        /^[0-9.]+(?:px|em|rem|%)?$/i,
      ],

      'line-height': [
        /^(?:[0-9.]+|[0-9.]+(?:px|em|rem|%))$/i,
      ],

      'vertical-align': [
        /^(?:middle|baseline|top|bottom|text-top|text-bottom)$/i,
      ],

      opacity: [
        /^(?:0|1|0?\.[0-9]+)$/i,
      ],

      overflow: [
        /^(?:hidden|auto|visible|scroll)$/i,
      ],

      'overflow-x': [
        /^(?:hidden|auto|visible|scroll)$/i,
      ],

      'overflow-y': [
        /^(?:hidden|auto|visible|scroll)$/i,
      ],

      'object-fit': [
        /^(?:contain|cover|fill|none|scale-down)$/i,
      ],

      'object-position': [
        /^(?:center|top|bottom|left|right)$/i,
      ],
    },
  },

  allowedIframeHostnames: [
    'www.youtube.com',
    'player.bilibili.com',
    'player.vimeo.com',
  ],
};


const COMMENT_MARKDOWN_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'pre', 'code']),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title'],
    code: ['class'],
    pre: ['class'],
    blockquote: ['class', 'data-alert'],
    p: ['class'],
  },
};

export interface CommentRenderOptions {
  markdown?: boolean;
  htmlTagAllowed?: string | null;
}

/**
 * Unique placeholder used to survive markdown rendering + sanitization.
 * Marked wraps a standalone line of plain text in <p>…</p>, so after
 * rendering the placeholder appears as <p>TYPECHO_MORE_0</p> which we
 * can reliably split on.
 */
const MORE_PLACEHOLDER = 'TYPECHO_MORE_0';
const MORE_PLACEHOLDER_RE = /<p>\s*TYPECHO_MORE_0\s*<\/p>/;
const MORE_COMMENT_RE = /<!--more-->/g;
const HTML_TAG_RE = /<[^>]+>/g;
const WHITESPACE_RE = /\s+/g;

// ─── Strip <!--markdown--> prefix ────────────────────────────────────────────

const MARKDOWN_PREFIX = '<!--markdown-->';
const RENDER_CACHE_MAX_ENTRIES = 64;
const RENDER_CACHE_MAX_SOURCE_LENGTH = 100_000;

export interface RenderedContent {
  html: string;
  plainExcerpt: string;
}

const renderedContentCache = new Map<string, RenderedContent>();
const commentSanitizeOptionsCache = new Map<string, sanitizeHtml.IOptions>();
const COMMENT_SANITIZE_CACHE_MAX_ENTRIES = 32;

const FULL_RENDER_CACHE_MAX_ENTRIES = 32;
const renderedFullContentCache = new Map<string, string>();

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function stripMarkdownPrefix(text: string): string {
  return text.startsWith(MARKDOWN_PREFIX) ? text.slice(MARKDOWN_PREFIX.length) : text;
}

/**
 * Remove Typecho-specific markers from content: <!--markdown--> prefix and all <!--more--> tags.
 */
export function stripTypechoMarkers(text: string): string {
  return stripMarkdownPrefix(text).replace(MORE_COMMENT_RE, '');
}

/**
 * Strip all HTML tags and collapse whitespace to single spaces.
 */
export function stripHtmlTags(html: string): string {
  return html.replace(HTML_TAG_RE, ' ').replace(WHITESPACE_RE, ' ').trim();
}

/**
 * Marked emits disabled checkbox inputs for GFM task lists. Keep the visual
 * state while replacing form controls with inert spans before sanitization.
 * This deliberately targets only a checkbox immediately inside a list item.
 */
function normalizeTaskListCheckboxes(html: string): string {
  return html.replace(
    /(<li\b[^>]*>)\s*<input\b(?=[^>]*\btype=["']?checkbox["']?)[^>]*>/gi,
    (match, listItem: string) => {
      const checked = /\bchecked(?:=["'][^"']*["'])?(?=\s|\/?>)/i.test(match);
      return listItem + '<span class="markdown-task-checkbox' + (checked ? ' is-checked' : '') + '"></span>';
    },
  );
}
// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Render markdown to HTML (synchronous, no plugin hooks)
 */
export function renderMarkdown(text: string): string {
  return renderContent(text).html;
}

/**
 * Parse and sanitize content once, deriving both the full HTML and its plain
 * excerpt. A small bounded isolate cache lets archive and feed rendering reuse
 * the same result without retaining arbitrarily large articles.
 */
export function renderContent(text: string, maxExcerptLength = 200): RenderedContent {
  if (!text) return { html: '', plainExcerpt: '' };

  const cacheable = maxExcerptLength === 200 && text.length <= RENDER_CACHE_MAX_SOURCE_LENGTH;
  const cached = cacheable ? renderedContentCache.get(text) : undefined;
  if (cached) {
    // Refresh insertion order for LRU eviction.
    renderedContentCache.delete(text);
    renderedContentCache.set(text, cached);
    return cached;
  }

  const content = stripMarkdownPrefix(text).replace(MORE_COMMENT_RE, '');
  const parsed = normalizeTaskListCheckboxes(transformGithubAlerts(parseContentMarkdown(content)));
  const html = sanitizeHtml(parsed, SANITIZE_OPTIONS);
  const plain = stripHtmlTags(parsed);
  const plainExcerpt = plain.length <= maxExcerptLength
    ? plain
    : `${plain.substring(0, maxExcerptLength)}...`;
  const rendered = { html, plainExcerpt };

  if (cacheable) {
    renderedContentCache.set(text, rendered);
    if (renderedContentCache.size > RENDER_CACHE_MAX_ENTRIES) {
      const oldest = renderedContentCache.keys().next().value;
      if (oldest !== undefined) renderedContentCache.delete(oldest);
    }
  }
  return rendered;
}

export function renderCommentText(text: string, options: CommentRenderOptions = {}): string {
  if (!text) return '';

  const sanitizeOptions = buildCommentSanitizeOptions(options.htmlTagAllowed, !!options.markdown);
  if (options.markdown) {
    const html = transformGithubAlerts(
      marked.parse(stripMarkdownPrefix(text), { async: false, breaks: true }) as string,
    );
    return sanitizeHtml(html, sanitizeOptions);
  }

  const sanitized = sanitizeHtml(text, sanitizeOptions);
  return autop(sanitized);
}

/**
 * Render markdown to HTML with plugin filter hooks (async)
 * Use this for content display where plugins should be able to intercept
 */
export async function renderMarkdownFiltered(ctx: HookContext, text: string): Promise<string> {
  if (!text) return '';

  // Full renders (filters + marked.parse + sanitizeHtml) are the expensive
  // part of a page-cache MISS. Memoize per source text + activated plugin
  // set — the only state the content:markdown / content:content filters can
  // observe. Option or plugin changes clear this through
  // resetMarkdownRenderCache() via the invalidation funnel.
  const cacheKey = text.length <= RENDER_CACHE_MAX_SOURCE_LENGTH
    ? `${await sha256Hex(text)}\0${[...(ctx.activatedPlugins ?? [])].sort().join(',')}`
    : null;
  const cached = cacheKey ? renderedFullContentCache.get(cacheKey) : undefined;
  if (cached !== undefined && cacheKey) {
    // Refresh insertion order for LRU eviction.
    renderedFullContentCache.delete(cacheKey);
    renderedFullContentCache.set(cacheKey, cached);
    return cached;
  }

  let content = stripMarkdownPrefix(text);
  // Remove <!--more--> from full-content renders — it is only meaningful
  // for list/excerpt views where renderContentExcerpt() is used instead.
  content = content.replace(MORE_COMMENT_RE, '');

  // A content transformer is optional application code. If it fails, render
  // the original source through the sanitizer so one plugin cannot take down
  // the article route. Security-critical filters elsewhere remain fail-closed.
  try {
    content = await applyFilter(ctx, 'content:markdown', content);
  } catch (error) {
    console.error('[markdown] content:markdown filter failed:', error);
  }

  const html = normalizeTaskListCheckboxes(transformGithubAlerts(marked.parse(content, { async: false, breaks: true }) as string));
  let sanitized = sanitizeHtml(html, SANITIZE_OPTIONS);

  try {
    sanitized = await applyFilter(ctx, 'content:content', sanitized);
  } catch (error) {
    console.error('[markdown] content:content filter failed:', error);
  }

  if (cacheKey) {
    renderedFullContentCache.set(cacheKey, sanitized);
    if (renderedFullContentCache.size > FULL_RENDER_CACHE_MAX_ENTRIES) {
      const oldest = renderedFullContentCache.keys().next().value;
      if (oldest !== undefined) renderedFullContentCache.delete(oldest);
    }
  }
  return sanitized;
}

/**
 * Drop memoized full-content renders. Filter output depends on plugin
 * configuration, which can change without a deploy — invalidation events
 * carrying the 'all' or 'content' shared domains clear it.
 */
export function resetMarkdownRenderCache(): void {
  renderedFullContentCache.clear();
}

/**
 * Render content with <!--more--> support.
 *
 * The full markdown source is rendered first so that reference-style links,
 * footnotes, and other constructs that span the <!--more--> boundary are
 * resolved correctly.  Only after a complete render is the output split at
 * the <!--more--> marker to produce the excerpt.
 */
export function renderContentExcerpt(
  text: string,
  moreText = '- 阅读剩余部分 -',
  permalink = '#'
): string {
  if (!text) return '';

  const content = stripMarkdownPrefix(text);

  if (!content.includes('<!--more-->')) {
    return renderMarkdown(text);
  }

  // Surround the marker with blank lines before substituting the placeholder.
  // This guarantees that marked wraps the placeholder in its own <p> block
  // regardless of whether the author placed <!--more--> inline or between
  // paragraphs — enabling a clean split on the rendered output.
  const withPlaceholder = content.replace(MORE_COMMENT_RE, '\n\n' + MORE_PLACEHOLDER + '\n\n');
  const html = normalizeTaskListCheckboxes(transformGithubAlerts(parseContentMarkdown(withPlaceholder)));
  const sanitized = sanitizeHtml(html, SANITIZE_OPTIONS);

  // Split on the rendered placeholder and keep only the excerpt (part before it).
  const excerptHtml = sanitized.split(MORE_PLACEHOLDER_RE)[0];
  return `${excerptHtml}<p class="more"><a href="${escapeHtml(permalink)}" title="${escapeHtml(moreText)}">${escapeHtml(moreText)}</a></p>`;
}

/**
 * Generate plain text excerpt from content
 */
export function generateExcerpt(text: string, maxLength = 200): string {
  return renderContent(text, maxLength).plainExcerpt;
}

/**
 * Auto-paragraph helper. Splits on blank lines and wraps each paragraph
 * in `<p>...</p>` unless it already starts with a recognised block-level
 * element. Single newlines inside a paragraph become `<br />`.
 *
 * Wrapping a chunk that already contains `<p>` / `<div>` / `<h1>` etc
 * produces invalid HTML (`<p><div>...</div></p>`); browsers tolerate it
 * but the output then breaks downstream sanitizers and CSS selectors.
 */
const BLOCK_OPEN_RE = /^\s*<(p|div|section|article|aside|header|footer|nav|figure|figcaption|blockquote|pre|ul|ol|li|dl|dt|dd|table|thead|tbody|tfoot|tr|th|td|h[1-6]|hr|details|summary|form|fieldset)\b/i;

export function autop(text: string): string {
  if (!text) return '';
  text = text.replace(/\r\n|\r/g, '\n');
  text = text.replace(/\n\n+/g, '\n\n');
  const paragraphs = text.split('\n\n');
  return paragraphs
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      if (BLOCK_OPEN_RE.test(p)) return p;
      return `<p>${p.replace(/\n/g, '<br />')}</p>`;
    })
    .join('\n');
}

function buildCommentSanitizeOptions(htmlTagAllowed?: string | null, markdown = false): sanitizeHtml.IOptions {
  const cacheKey = `${markdown ? '1' : '0'}\0${htmlTagAllowed || ''}`;
  const cached = commentSanitizeOptionsCache.get(cacheKey);
  if (cached) return cached;

  const parsed = parseAllowedHtmlTags(htmlTagAllowed);
  let result: sanitizeHtml.IOptions;
  if (!parsed) {
    result = markdown ? COMMENT_MARKDOWN_OPTIONS : {
      allowedTags: [],
      allowedAttributes: {},
    };
  } else if (!markdown) {
    result = {
      allowedTags: parsed.allowedTags,
      allowedAttributes: parsed.allowedAttributes,
      // Carry the default schemes through so links survive the sanitizer.
      allowedSchemes: sanitizeHtml.defaults.allowedSchemes,
    };
  } else {
    result = {
      ...COMMENT_MARKDOWN_OPTIONS,
      allowedTags: [...new Set([...COMMENT_MARKDOWN_OPTIONS.allowedTags as string[], ...parsed.allowedTags])],
      allowedAttributes: mergeAllowedAttributes(COMMENT_MARKDOWN_OPTIONS.allowedAttributes || {}, parsed.allowedAttributes),
    };
  }

  commentSanitizeOptionsCache.set(cacheKey, result);
  if (commentSanitizeOptionsCache.size > COMMENT_SANITIZE_CACHE_MAX_ENTRIES) {
    const oldest = commentSanitizeOptionsCache.keys().next().value;
    if (oldest !== undefined) commentSanitizeOptionsCache.delete(oldest);
  }
  return result;
}

function parseAllowedHtmlTags(htmlTagAllowed?: string | null): {
  allowedTags: string[];
  allowedAttributes: Record<string, string[]>;
} | null {
  if (!htmlTagAllowed?.trim()) return null;

  const allowedTags: string[] = [];
  const allowedAttributes: Record<string, string[]> = {};
  const tagRe = /<\s*([a-zA-Z0-9]+)([^>]*)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(htmlTagAllowed)) !== null) {
    const tag = match[1].toLowerCase();
    allowedTags.push(tag);

    // Match either `name=` or a bare attribute name (e.g. `<a href>`).
    const attrs = [...match[2].matchAll(/([a-zA-Z0-9:-]+)(?=\s*=|\s|\/?>|$)/g)]
      .map(attr => attr[1].toLowerCase())
      .filter(attr => isSafeAttributeName(tag, attr));
    if (attrs.length > 0) {
      allowedAttributes[tag] = [...new Set([...(allowedAttributes[tag] || []), ...attrs])];
    }
  }

  return {
    allowedTags: [...new Set(allowedTags)],
    allowedAttributes,
  };
}

/**
 * Reject attribute names that are unsafe regardless of the tag they
 * appear on. Even though sanitize-html itself would normally filter
 * inline event handlers, the comment-form path lets administrators
 * declare a custom HTML allowlist via options.commentsHTMLTagAllowed —
 * a single typo there could otherwise re-enable XSS surface.
 *
 * The set deliberately leans towards over-rejection. Callers can
 * restore broader sets through plugin filters if needed.
 */
const ATTRIBUTE_GLOBAL_DENYLIST = new Set([
  'style', 'srcset', 'sandbox', 'allow', 'allowfullscreen',
  'formaction', 'action', 'background', 'dynsrc', 'lowsrc', 'ping',
  'poster', 'data',
]);

function isSafeAttributeName(tag: string, attr: string): boolean {
  if (attr.startsWith('on')) return false;
  if (attr.startsWith('xlink:') || attr.startsWith('xmlns')) return false;
  if (ATTRIBUTE_GLOBAL_DENYLIST.has(attr)) return false;
  // src is only meaningful on a small set of tags; reject elsewhere.
  if (attr === 'src' && !['img', 'audio', 'video', 'source', 'iframe'].includes(tag)) return false;
  // href is similarly restricted to anchors and (legacy) link tags.
  if (attr === 'href' && !['a', 'link', 'area'].includes(tag)) return false;
  return true;
}

function mergeAllowedAttributes(
  base: sanitizeHtml.IOptions['allowedAttributes'],
  extra: Record<string, string[]>,
): sanitizeHtml.IOptions['allowedAttributes'] {
  const merged: Record<string, string[]> = {};
  for (const [tag, attrs] of Object.entries(base || {})) {
    merged[tag] = Array.isArray(attrs) ? attrs.map(String) : [];
  }
  for (const [tag, attrs] of Object.entries(extra)) {
    merged[tag] = [...new Set([...(merged[tag] || []), ...attrs])];
  }
  return merged;
}
);
        if (closingFence.test(line)) {
          fenceCharacter = '';
          fenceLength = 0;
        }
      } else {
        const delimiter = /^ {0,3}(?:\$\$|\\\[)\s*$/.exec(line);
        if (delimiter) return offset + (line.length - line.trimStart().length);
      }
      offset += line.length + 1;
    }
    return undefined;
  },
  tokenizer(source: string) {
    const dollar = /^\$\$\s*\n([\s\S]*?)\n\$\$\s*(?:\n|$)/.exec(source);
    const bracket = /^\\\[\s*\n([\s\S]*?)\n\\\]\s*(?:\n|$)/.exec(source);
    const match = dollar ?? bracket;
    if (!match) return undefined;
    return { type: 'markdownMathBlock', raw: match[0], text: match[1] };
  },
  renderer(token: { text: string }): string {
    const tex = token.text.trim();
    const escaped = escapeHtmlShared(tex);
    return '<div class="markdown-math markdown-math--block" data-tex="' + escaped + '">' + escaped + '</div>\n';
  },
};

const mathInlineExtension = {
  name: 'markdownMathInline',
  level: 'inline' as const,
  start(source: string): number | undefined {
    const tick = String.fromCharCode(96);
    let index = 0;
    while (index < source.length) {
      if (source[index] === '\\') {
        if (source[index + 1] === '(') return index;
        if (source[index + 1] === '$') {
          index += 2;
          continue;
        }
        index += 1;
        continue;
      }
      if (source[index] === tick) {
        let end = index + 1;
        while (source[end] === tick) end += 1;
        const marker = tick.repeat(end - index);
        const close = source.indexOf(marker, end);
        if (close === -1) return undefined;
        index = close + marker.length;
        continue;
      }
      if (source[index] === '$' && source[index + 1] !== '$') return index;
      index += 1;
    }
    return undefined;
  },
  tokenizer(source: string) {
    const dollar = /^\$(?!\$)((?:\\.|[^$])+?)(?<!\\)\$(?!\$)/.exec(source);
    if (dollar && dollar[1].trim()) {
      return { type: 'markdownMathInline', raw: dollar[0], text: dollar[1] };
    }
    const bracket = /^\\\((.+?)\\\)/.exec(source);
    if (bracket && bracket[1].trim()) {
      return { type: 'markdownMathInline', raw: bracket[0], text: bracket[1] };
    }
    return undefined;
  },
  renderer(token: { text: string }): string {
    const tex = token.text.trim();
    const escaped = escapeHtmlShared(tex);
    return '<span class="markdown-math" data-tex="' + escaped + '">' + escaped + '</span>';
  },
};

function addMarkdownHeadingAnchors(html: string): string {
  const used = new Set<string>();
  return html.replace(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gi, (full, level: string, attributes: string, inner: string) => {
    const existingId = /\bid\s*=\s*(["'])(.*?)\1/i.exec(attributes);
    if (existingId) {
      used.add(existingId[2]);
      return full;
    }

    const headingText = inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const base = generateSlug(headingText) || 'heading-' + level;
    let id = base;
    let suffix = 1;
    while (used.has(id)) {
      id = base + '-' + suffix;
      suffix += 1;
    }
    used.add(id);
    return '<h' + level + attributes + ' id="' + id + '">' + inner + '</h' + level + '>';
  });
}

function parseContentMarkdown(source: string): string {
  const footnoteExtension = markedFootnote();
  const html = marked.parse(source, {
    ...footnoteExtension,
    async: false,
    breaks: true,
    extensions: [
      ...(footnoteExtension.extensions ?? []),
      mathBlockExtension,
      mathInlineExtension,
    ],
  }) as string;
  return addMarkdownHeadingAnchors(html);
}
// ─── HTML escape helper ─────────────────────────────────────────────────────

/** @deprecated Import from '@/lib/escape' directly. */
export function escapeHtml(str: string): string {
  return escapeHtmlShared(str);
}

// ─── Shared sanitize config ──────────────────────────────────────────────────


const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    // Markdown and text
    'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'pre', 'code', 'del', 'ins', 'mark', 'small',
    'sub', 'sup', 'abbr', 'wbr', 'kbd', 'samp',

    // Tables
    'table', 'caption', 'colgroup', 'col',
    'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',

    // Lists
    'dl', 'dt', 'dd',

    // Semantic HTML
    'div', 'span', 'section', 'article', 'aside',
    'header', 'footer', 'nav', 'main', 'address',

    // Interactive presentation
    'button', 'details', 'summary',

    // Media
    'figure', 'figcaption', 'picture',
    'video', 'audio', 'source', 'track',

    // Existing iframe support remains hostname-restricted
    'iframe',

    // SVG
    'svg', 'title', 'desc',
    'path', 'polyline', 'polygon', 'line',
    'circle', 'ellipse', 'rect', 'g',
    'defs', 'clipPath', 'clippath',
    'radialgradient', 'lineargradient',
    'radialGradient', 'linearGradient', 'stop',
  ]),

  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,

    img: [
      'src', 'alt', 'title', 'width', 'height',
      'loading', 'decoding',
    ],

    a: [
      'href', 'title', 'target', 'rel',
      'download', 'class', 'id', 'style',
      'data-footnote-ref', 'data-footnote-backref',
      'aria-label', 'aria-describedby',
    ],

    button: [
      'type', 'disabled', 'class', 'id', 'title', 'style',
    ],

    div: ['class', 'id', 'title', 'style'],
    span: ['class', 'id', 'title', 'style'],
    section: ['class', 'id', 'title', 'style', 'data-footnotes'],
    article: ['class', 'id', 'title', 'style'],
    aside: ['class', 'id', 'title', 'style'],
    header: ['class', 'id', 'title', 'style'],
    footer: ['class', 'id', 'title', 'style'],
    nav: ['class', 'id', 'title', 'style'],
    main: ['class', 'id', 'title', 'style'],
    address: ['class', 'id', 'title', 'style'],
    h1: ['class', 'id'],
    h2: ['class', 'id'],
    h3: ['class', 'id'],
    h4: ['class', 'id'],
    h5: ['class', 'id'],
    h6: ['class', 'id'],
    li: ['id'],

    table: ['class', 'id', 'style'],
    caption: ['class', 'id', 'style'],
    colgroup: ['span'],
    col: ['span', 'width'],

    td: ['align', 'valign', 'colspan', 'rowspan', 'class', 'style'],
    th: ['align', 'valign', 'colspan', 'rowspan', 'scope', 'class', 'style'],

    code: ['class'],
    pre: ['class'],
    p: ['class', 'style'],

    blockquote: ['class', 'data-alert'],

    video: [
      'src', 'controls', 'width', 'height',
      'poster', 'preload', 'muted', 'loop',
      'autoplay', 'playsinline',
    ],

    audio: [
      'src', 'controls', 'preload',
      'muted', 'loop', 'autoplay',
    ],

    source: ['src', 'type', 'media'],
    track: ['kind', 'src', 'srclang', 'label', 'default'],

    iframe: [
      'src', 'width', 'height',
      'frameborder', 'allowfullscreen',
    ],

    svg: [
      'width', 'height', 'viewbox', 'xmlns',
      'fill', 'stroke', 'stroke-width',
      'stroke-linecap', 'stroke-linejoin',
      'style', 'class', 'id', 'role',
      'aria-label',
    ],

    path: [
      'id', 'd', 'fill', 'fill-rule',
      'stroke', 'stroke-width',
      'stroke-linecap', 'stroke-linejoin',
      'opacity', 'style',
    ],

    polyline: [
      'points', 'fill', 'stroke',
      'stroke-width', 'stroke-linecap',
      'stroke-linejoin', 'opacity',
    ],

    polygon: [
      'points', 'fill', 'stroke',
      'stroke-width', 'stroke-linejoin',
      'opacity',
    ],

    line: [
      'x1', 'y1', 'x2', 'y2',
      'fill', 'stroke', 'stroke-width',
      'stroke-linecap', 'stroke-linejoin', 'opacity',
    ],

    circle: [
      'id', 'cx', 'cy', 'r', 'fill',
      'fill-rule', 'stroke', 'stroke-width',
      'opacity', 'style',
    ],

    ellipse: [
      'id', 'cx', 'cy', 'rx', 'ry',
      'fill', 'stroke', 'stroke-width', 'opacity',
    ],

    rect: [
      'id', 'x', 'y', 'width', 'height',
      'rx', 'ry', 'fill', 'fill-rule',
      'stroke', 'stroke-width', 'opacity', 'style',
      'clip-path',
    ],

    g: [
      'id', 'fill', 'stroke', 'stroke-width',
      'stroke-linecap', 'stroke-linejoin',
      'opacity', 'transform',
    ],

    defs: ['id'],
    clipPath: ['id', 'clipPathUnits'],
    title: ['class'],

    radialgradient: [
      'id', 'cx', 'cy', 'fx', 'fy', 'r',
      'gradientunits', 'gradienttransform', 'spreadmethod',
    ],

    lineargradient: [
      'id', 'x1', 'y1', 'x2', 'y2',
      'gradientunits', 'gradienttransform', 'spreadmethod',
    ],

    radialGradient: [
      'id', 'cx', 'cy', 'fx', 'fy', 'r',
      'gradientUnits', 'gradientTransform', 'spreadMethod',
    ],

    linearGradient: [
      'id', 'x1', 'y1', 'x2', 'y2',
      'gradientUnits', 'gradientTransform', 'spreadMethod',
    ],

    stop: ['offset', 'stop-color', 'stop-opacity', 'style'],
  },

  allowedStyles: {
    '*': {
      color: [
        /^(?:#[0-9a-f]{3,8}|rgba?\([0-9.,%\s]+\)|var\(--[a-zA-Z0-9_-]+\)|[a-zA-Z]+)$/i,
      ],

      fill: [
        /^(?:#[0-9a-f]{3,8}|none|currentColor|[a-zA-Z]+)$/i,
      ],

      'fill-rule': [/^(?:nonzero|evenodd)$/i],

      'background-color': [
        /^(?:#[0-9a-f]{3,8}|rgba?\([0-9.,%\s]+\)|var\(--[a-zA-Z0-9_-]+\)|[a-zA-Z]+)$/i,
      ],

      background: [
        /^(?:#[0-9a-f]{3,8}|rgba?\([0-9.,%\s]+\)|var\(--[a-zA-Z0-9_-]+\)|[a-zA-Z]+)$/i,
      ],

      'font-weight': [
        /^(?:normal|bold|bolder|lighter|[1-9]00)$/i,
      ],

      'font-size': [
        /^(?:[0-9.]+(?:px|em|rem|%|pt)|small|medium|large|larger|smaller)$/i,
      ],

      'font-family': [
        /^[a-zA-Z0-9_,\s"'()-]+$/,
      ],

      'text-decoration': [
        /^(?:none|underline|overline|line-through)(?:\s+(?:solid|dotted|dashed|wavy))?$/i,
      ],

      'text-align': [
        /^(?:left|right|center|justify|start|end)$/i,
      ],

      'letter-spacing': [
        /^(?:normal|[0-9.-]+(?:px|em|rem))$/i,
      ],

      'word-break': [
        /^(?:normal|break-all|keep-all|break-word)$/i,
      ],

      'white-space': [
        /^(?:normal|nowrap|pre|pre-wrap|pre-line|break-spaces)$/i,
      ],

      display: [
        /^(?:inline|inline-block|inline-flex|block|flex|grid|none|table|table-cell)$/i,
      ],

      position: [
        /^(?:static|relative|absolute)$/i,
      ],

      top: [/^[0-9.]+(?:px|em|rem|%)?$/i],
      right: [/^[0-9.]+(?:px|em|rem|%)?$/i],
      bottom: [/^[0-9.]+(?:px|em|rem|%)?$/i],
      left: [/^[0-9.]+(?:px|em|rem|%)?$/i],

      width: [/^(?:auto|[0-9.]+(?:px|em|rem|%|vw))$/i],
      height: [/^(?:auto|[0-9.]+(?:px|em|rem|%|vh))$/i],

      'min-width': [/^(?:0|[0-9.]+(?:px|em|rem|%|vw))$/i],
      'max-width': [/^(?:none|100%|[0-9.]+(?:px|em|rem|%|vw))$/i],
      'min-height': [/^(?:0|[0-9.]+(?:px|em|rem|%|vh))$/i],
      'max-height': [/^(?:none|100%|[0-9.]+(?:px|em|rem|%|vh))$/i],

      'flex-direction': [
        /^(?:row|row-reverse|column|column-reverse)$/i,
      ],

      'flex-wrap': [
        /^(?:nowrap|wrap|wrap-reverse)$/i,
      ],

      flex: [
        /^(?:none|auto|initial|[0-9.]+(?:\s+[0-9.]+){0,2})$/i,
      ],

      'justify-content': [
        /^(?:start|end|center|flex-start|flex-end|space-between|space-around|space-evenly)$/i,
      ],

      'align-items': [
        /^(?:center|start|end|flex-start|flex-end|baseline|stretch)$/i,
      ],

      'align-self': [
        /^(?:auto|center|start|end|flex-start|flex-end|baseline|stretch)$/i,
      ],

      'grid-template-columns': [
        /^(?:none|repeat\([0-9]+,\s*(?:[0-9.]+fr|[0-9.]+px|[0-9.]+%|auto)\)|(?:[0-9.]+fr|[0-9.]+px|[0-9.]+%|auto)(?:\s+(?:[0-9.]+fr|[0-9.]+px|[0-9.]+%|auto)){0,5})$/i,
      ],

      gap: [/^[0-9.]+(?:px|em|rem|%)$/i],

      padding: [
        /^[0-9.]+(?:px|em|rem|%)?(?:\s+[0-9.]+(?:px|em|rem|%)?){0,3}$/i,
      ],

      'padding-top': [/^[0-9.]+(?:px|em|rem|%)?$/i],
      'padding-right': [/^[0-9.]+(?:px|em|rem|%)?$/i],
      'padding-bottom': [/^[0-9.]+(?:px|em|rem|%)?$/i],
      'padding-left': [/^[0-9.]+(?:px|em|rem|%)?$/i],

      margin: [
        /^(?:auto|[0-9.]+(?:px|em|rem|%)?)(?:\s+(?:auto|[0-9.]+(?:px|em|rem|%)?)){0,3}$/i,
      ],

      'margin-top': [/^(?:auto|[0-9.]+(?:px|em|rem|%)?)$/i],
      'margin-right': [/^(?:auto|[0-9.]+(?:px|em|rem|%)?)$/i],
      'margin-bottom': [/^(?:auto|[0-9.]+(?:px|em|rem|%)?)$/i],
      'margin-left': [/^(?:auto|[0-9.]+(?:px|em|rem|%)?)$/i],

      'border-radius': [
        /^[0-9.]+(?:px|em|rem|%)?(?:\s+[0-9.]+(?:px|em|rem|%)?){0,3}$/i,
      ],

      border: [
        /^[0-9.]+px\s+(?:solid|dashed|dotted)\s+(?:#[0-9a-f]{3,8}|[a-zA-Z]+)$/i,
      ],

      'border-color': [
        /^(?:#[0-9a-f]{3,8}|[a-zA-Z]+)$/i,
      ],

      'border-width': [
        /^[0-9.]+(?:px|em|rem)$/i,
      ],

      'border-style': [
        /^(?:none|solid|dashed|dotted|double)$/i,
      ],

      'border-bottom-left-radius': [
        /^[0-9.]+(?:px|em|rem|%)?$/i,
      ],

      'line-height': [
        /^(?:[0-9.]+|[0-9.]+(?:px|em|rem|%))$/i,
      ],

      'vertical-align': [
        /^(?:middle|baseline|top|bottom|text-top|text-bottom)$/i,
      ],

      opacity: [
        /^(?:0|1|0?\.[0-9]+)$/i,
      ],

      overflow: [
        /^(?:hidden|auto|visible|scroll)$/i,
      ],

      'overflow-x': [
        /^(?:hidden|auto|visible|scroll)$/i,
      ],

      'overflow-y': [
        /^(?:hidden|auto|visible|scroll)$/i,
      ],

      'object-fit': [
        /^(?:contain|cover|fill|none|scale-down)$/i,
      ],

      'object-position': [
        /^(?:center|top|bottom|left|right)$/i,
      ],
    },
  },

  allowedIframeHostnames: [
    'www.youtube.com',
    'player.bilibili.com',
    'player.vimeo.com',
  ],
};


const COMMENT_MARKDOWN_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'pre', 'code']),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title'],
    code: ['class'],
    pre: ['class'],
    blockquote: ['class', 'data-alert'],
    p: ['class'],
  },
};

export interface CommentRenderOptions {
  markdown?: boolean;
  htmlTagAllowed?: string | null;
}

/**
 * Unique placeholder used to survive markdown rendering + sanitization.
 * Marked wraps a standalone line of plain text in <p>…</p>, so after
 * rendering the placeholder appears as <p>TYPECHO_MORE_0</p> which we
 * can reliably split on.
 */
const MORE_PLACEHOLDER = 'TYPECHO_MORE_0';
const MORE_PLACEHOLDER_RE = /<p>\s*TYPECHO_MORE_0\s*<\/p>/;
const MORE_COMMENT_RE = /<!--more-->/g;
const HTML_TAG_RE = /<[^>]+>/g;
const WHITESPACE_RE = /\s+/g;

// ─── Strip <!--markdown--> prefix ────────────────────────────────────────────

const MARKDOWN_PREFIX = '<!--markdown-->';
const RENDER_CACHE_MAX_ENTRIES = 64;
const RENDER_CACHE_MAX_SOURCE_LENGTH = 100_000;

export interface RenderedContent {
  html: string;
  plainExcerpt: string;
}

const renderedContentCache = new Map<string, RenderedContent>();
const commentSanitizeOptionsCache = new Map<string, sanitizeHtml.IOptions>();
const COMMENT_SANITIZE_CACHE_MAX_ENTRIES = 32;

const FULL_RENDER_CACHE_MAX_ENTRIES = 32;
const renderedFullContentCache = new Map<string, string>();

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function stripMarkdownPrefix(text: string): string {
  return text.startsWith(MARKDOWN_PREFIX) ? text.slice(MARKDOWN_PREFIX.length) : text;
}

/**
 * Remove Typecho-specific markers from content: <!--markdown--> prefix and all <!--more--> tags.
 */
export function stripTypechoMarkers(text: string): string {
  return stripMarkdownPrefix(text).replace(MORE_COMMENT_RE, '');
}

/**
 * Strip all HTML tags and collapse whitespace to single spaces.
 */
export function stripHtmlTags(html: string): string {
  return html.replace(HTML_TAG_RE, ' ').replace(WHITESPACE_RE, ' ').trim();
}

/**
 * Marked emits disabled checkbox inputs for GFM task lists. Keep the visual
 * state while replacing form controls with inert spans before sanitization.
 * This deliberately targets only a checkbox immediately inside a list item.
 */
function normalizeTaskListCheckboxes(html: string): string {
  return html.replace(
    /(<li\b[^>]*>)\s*<input\b(?=[^>]*\btype=["']?checkbox["']?)[^>]*>/gi,
    (match, listItem: string) => {
      const checked = /\bchecked(?:=["'][^"']*["'])?(?=\s|\/?>)/i.test(match);
      return listItem + '<span class="markdown-task-checkbox' + (checked ? ' is-checked' : '') + '"></span>';
    },
  );
}
// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Render markdown to HTML (synchronous, no plugin hooks)
 */
export function renderMarkdown(text: string): string {
  return renderContent(text).html;
}

/**
 * Parse and sanitize content once, deriving both the full HTML and its plain
 * excerpt. A small bounded isolate cache lets archive and feed rendering reuse
 * the same result without retaining arbitrarily large articles.
 */
export function renderContent(text: string, maxExcerptLength = 200): RenderedContent {
  if (!text) return { html: '', plainExcerpt: '' };

  const cacheable = maxExcerptLength === 200 && text.length <= RENDER_CACHE_MAX_SOURCE_LENGTH;
  const cached = cacheable ? renderedContentCache.get(text) : undefined;
  if (cached) {
    // Refresh insertion order for LRU eviction.
    renderedContentCache.delete(text);
    renderedContentCache.set(text, cached);
    return cached;
  }

  const content = stripMarkdownPrefix(text).replace(MORE_COMMENT_RE, '');
  const parsed = normalizeTaskListCheckboxes(transformGithubAlerts(parseContentMarkdown(content)));
  const html = sanitizeHtml(parsed, SANITIZE_OPTIONS);
  const plain = stripHtmlTags(parsed);
  const plainExcerpt = plain.length <= maxExcerptLength
    ? plain
    : `${plain.substring(0, maxExcerptLength)}...`;
  const rendered = { html, plainExcerpt };

  if (cacheable) {
    renderedContentCache.set(text, rendered);
    if (renderedContentCache.size > RENDER_CACHE_MAX_ENTRIES) {
      const oldest = renderedContentCache.keys().next().value;
      if (oldest !== undefined) renderedContentCache.delete(oldest);
    }
  }
  return rendered;
}

export function renderCommentText(text: string, options: CommentRenderOptions = {}): string {
  if (!text) return '';

  const sanitizeOptions = buildCommentSanitizeOptions(options.htmlTagAllowed, !!options.markdown);
  if (options.markdown) {
    const html = transformGithubAlerts(
      marked.parse(stripMarkdownPrefix(text), { async: false, breaks: true }) as string,
    );
    return sanitizeHtml(html, sanitizeOptions);
  }

  const sanitized = sanitizeHtml(text, sanitizeOptions);
  return autop(sanitized);
}

/**
 * Render markdown to HTML with plugin filter hooks (async)
 * Use this for content display where plugins should be able to intercept
 */
export async function renderMarkdownFiltered(ctx: HookContext, text: string): Promise<string> {
  if (!text) return '';

  // Full renders (filters + marked.parse + sanitizeHtml) are the expensive
  // part of a page-cache MISS. Memoize per source text + activated plugin
  // set — the only state the content:markdown / content:content filters can
  // observe. Option or plugin changes clear this through
  // resetMarkdownRenderCache() via the invalidation funnel.
  const cacheKey = text.length <= RENDER_CACHE_MAX_SOURCE_LENGTH
    ? `${await sha256Hex(text)}\0${[...(ctx.activatedPlugins ?? [])].sort().join(',')}`
    : null;
  const cached = cacheKey ? renderedFullContentCache.get(cacheKey) : undefined;
  if (cached !== undefined && cacheKey) {
    // Refresh insertion order for LRU eviction.
    renderedFullContentCache.delete(cacheKey);
    renderedFullContentCache.set(cacheKey, cached);
    return cached;
  }

  let content = stripMarkdownPrefix(text);
  // Remove <!--more--> from full-content renders — it is only meaningful
  // for list/excerpt views where renderContentExcerpt() is used instead.
  content = content.replace(MORE_COMMENT_RE, '');

  // A content transformer is optional application code. If it fails, render
  // the original source through the sanitizer so one plugin cannot take down
  // the article route. Security-critical filters elsewhere remain fail-closed.
  try {
    content = await applyFilter(ctx, 'content:markdown', content);
  } catch (error) {
    console.error('[markdown] content:markdown filter failed:', error);
  }

  const html = normalizeTaskListCheckboxes(transformGithubAlerts(marked.parse(content, { async: false, breaks: true }) as string));
  let sanitized = sanitizeHtml(html, SANITIZE_OPTIONS);

  try {
    sanitized = await applyFilter(ctx, 'content:content', sanitized);
  } catch (error) {
    console.error('[markdown] content:content filter failed:', error);
  }

  if (cacheKey) {
    renderedFullContentCache.set(cacheKey, sanitized);
    if (renderedFullContentCache.size > FULL_RENDER_CACHE_MAX_ENTRIES) {
      const oldest = renderedFullContentCache.keys().next().value;
      if (oldest !== undefined) renderedFullContentCache.delete(oldest);
    }
  }
  return sanitized;
}

/**
 * Drop memoized full-content renders. Filter output depends on plugin
 * configuration, which can change without a deploy — invalidation events
 * carrying the 'all' or 'content' shared domains clear it.
 */
export function resetMarkdownRenderCache(): void {
  renderedFullContentCache.clear();
}

/**
 * Render content with <!--more--> support.
 *
 * The full markdown source is rendered first so that reference-style links,
 * footnotes, and other constructs that span the <!--more--> boundary are
 * resolved correctly.  Only after a complete render is the output split at
 * the <!--more--> marker to produce the excerpt.
 */
export function renderContentExcerpt(
  text: string,
  moreText = '- 阅读剩余部分 -',
  permalink = '#'
): string {
  if (!text) return '';

  const content = stripMarkdownPrefix(text);

  if (!content.includes('<!--more-->')) {
    return renderMarkdown(text);
  }

  // Surround the marker with blank lines before substituting the placeholder.
  // This guarantees that marked wraps the placeholder in its own <p> block
  // regardless of whether the author placed <!--more--> inline or between
  // paragraphs — enabling a clean split on the rendered output.
  const withPlaceholder = content.replace(MORE_COMMENT_RE, '\n\n' + MORE_PLACEHOLDER + '\n\n');
  const html = normalizeTaskListCheckboxes(transformGithubAlerts(parseContentMarkdown(withPlaceholder)));
  const sanitized = sanitizeHtml(html, SANITIZE_OPTIONS);

  // Split on the rendered placeholder and keep only the excerpt (part before it).
  const excerptHtml = sanitized.split(MORE_PLACEHOLDER_RE)[0];
  return `${excerptHtml}<p class="more"><a href="${escapeHtml(permalink)}" title="${escapeHtml(moreText)}">${escapeHtml(moreText)}</a></p>`;
}

/**
 * Generate plain text excerpt from content
 */
export function generateExcerpt(text: string, maxLength = 200): string {
  return renderContent(text, maxLength).plainExcerpt;
}

/**
 * Auto-paragraph helper. Splits on blank lines and wraps each paragraph
 * in `<p>...</p>` unless it already starts with a recognised block-level
 * element. Single newlines inside a paragraph become `<br />`.
 *
 * Wrapping a chunk that already contains `<p>` / `<div>` / `<h1>` etc
 * produces invalid HTML (`<p><div>...</div></p>`); browsers tolerate it
 * but the output then breaks downstream sanitizers and CSS selectors.
 */
const BLOCK_OPEN_RE = /^\s*<(p|div|section|article|aside|header|footer|nav|figure|figcaption|blockquote|pre|ul|ol|li|dl|dt|dd|table|thead|tbody|tfoot|tr|th|td|h[1-6]|hr|details|summary|form|fieldset)\b/i;

export function autop(text: string): string {
  if (!text) return '';
  text = text.replace(/\r\n|\r/g, '\n');
  text = text.replace(/\n\n+/g, '\n\n');
  const paragraphs = text.split('\n\n');
  return paragraphs
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      if (BLOCK_OPEN_RE.test(p)) return p;
      return `<p>${p.replace(/\n/g, '<br />')}</p>`;
    })
    .join('\n');
}

function buildCommentSanitizeOptions(htmlTagAllowed?: string | null, markdown = false): sanitizeHtml.IOptions {
  const cacheKey = `${markdown ? '1' : '0'}\0${htmlTagAllowed || ''}`;
  const cached = commentSanitizeOptionsCache.get(cacheKey);
  if (cached) return cached;

  const parsed = parseAllowedHtmlTags(htmlTagAllowed);
  let result: sanitizeHtml.IOptions;
  if (!parsed) {
    result = markdown ? COMMENT_MARKDOWN_OPTIONS : {
      allowedTags: [],
      allowedAttributes: {},
    };
  } else if (!markdown) {
    result = {
      allowedTags: parsed.allowedTags,
      allowedAttributes: parsed.allowedAttributes,
      // Carry the default schemes through so links survive the sanitizer.
      allowedSchemes: sanitizeHtml.defaults.allowedSchemes,
    };
  } else {
    result = {
      ...COMMENT_MARKDOWN_OPTIONS,
      allowedTags: [...new Set([...COMMENT_MARKDOWN_OPTIONS.allowedTags as string[], ...parsed.allowedTags])],
      allowedAttributes: mergeAllowedAttributes(COMMENT_MARKDOWN_OPTIONS.allowedAttributes || {}, parsed.allowedAttributes),
    };
  }

  commentSanitizeOptionsCache.set(cacheKey, result);
  if (commentSanitizeOptionsCache.size > COMMENT_SANITIZE_CACHE_MAX_ENTRIES) {
    const oldest = commentSanitizeOptionsCache.keys().next().value;
    if (oldest !== undefined) commentSanitizeOptionsCache.delete(oldest);
  }
  return result;
}

function parseAllowedHtmlTags(htmlTagAllowed?: string | null): {
  allowedTags: string[];
  allowedAttributes: Record<string, string[]>;
} | null {
  if (!htmlTagAllowed?.trim()) return null;

  const allowedTags: string[] = [];
  const allowedAttributes: Record<string, string[]> = {};
  const tagRe = /<\s*([a-zA-Z0-9]+)([^>]*)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(htmlTagAllowed)) !== null) {
    const tag = match[1].toLowerCase();
    allowedTags.push(tag);

    // Match either `name=` or a bare attribute name (e.g. `<a href>`).
    const attrs = [...match[2].matchAll(/([a-zA-Z0-9:-]+)(?=\s*=|\s|\/?>|$)/g)]
      .map(attr => attr[1].toLowerCase())
      .filter(attr => isSafeAttributeName(tag, attr));
    if (attrs.length > 0) {
      allowedAttributes[tag] = [...new Set([...(allowedAttributes[tag] || []), ...attrs])];
    }
  }

  return {
    allowedTags: [...new Set(allowedTags)],
    allowedAttributes,
  };
}

/**
 * Reject attribute names that are unsafe regardless of the tag they
 * appear on. Even though sanitize-html itself would normally filter
 * inline event handlers, the comment-form path lets administrators
 * declare a custom HTML allowlist via options.commentsHTMLTagAllowed —
 * a single typo there could otherwise re-enable XSS surface.
 *
 * The set deliberately leans towards over-rejection. Callers can
 * restore broader sets through plugin filters if needed.
 */
const ATTRIBUTE_GLOBAL_DENYLIST = new Set([
  'style', 'srcset', 'sandbox', 'allow', 'allowfullscreen',
  'formaction', 'action', 'background', 'dynsrc', 'lowsrc', 'ping',
  'poster', 'data',
]);

function isSafeAttributeName(tag: string, attr: string): boolean {
  if (attr.startsWith('on')) return false;
  if (attr.startsWith('xlink:') || attr.startsWith('xmlns')) return false;
  if (ATTRIBUTE_GLOBAL_DENYLIST.has(attr)) return false;
  // src is only meaningful on a small set of tags; reject elsewhere.
  if (attr === 'src' && !['img', 'audio', 'video', 'source', 'iframe'].includes(tag)) return false;
  // href is similarly restricted to anchors and (legacy) link tags.
  if (attr === 'href' && !['a', 'link', 'area'].includes(tag)) return false;
  return true;
}

function mergeAllowedAttributes(
  base: sanitizeHtml.IOptions['allowedAttributes'],
  extra: Record<string, string[]>,
): sanitizeHtml.IOptions['allowedAttributes'] {
  const merged: Record<string, string[]> = {};
  for (const [tag, attrs] of Object.entries(base || {})) {
    merged[tag] = Array.isArray(attrs) ? attrs.map(String) : [];
  }
  for (const [tag, attrs] of Object.entries(extra)) {
    merged[tag] = [...new Set([...(merged[tag] || []), ...attrs])];
  }
  return merged;
}
