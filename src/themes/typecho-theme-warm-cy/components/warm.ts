
import type { ThemeBaseProps, ThemePostProps } from '@/lib/theme-props';
import { normalizeOptimizeParams } from './warm-image';
import { escapeHtml, formatDate } from 'typecho/plugin-sdk';
import sanitizeHtml from 'sanitize-html';
import postcss from 'postcss';

export const WARM_THEME_ID = 'typecho-theme-warm-cy';

const DEFAULT_WARM_SETTINGS: Record<string, unknown> = {
  pinnedIds: '',
  footerCustomHtml: '',
  articleDeclarationHtml: '',
  continuousLoadMode: 'manual',
  commentComponentLoadMode: 'manual',
  commentInitialLoadMode: 'manual',
  imageOptimizeParams: '',
  thumbOptimizeParams: '',
  ...Object.fromEntries(
    Array.from({ length: 10 }, (_, index) => {
      const suffix = String(index + 1).padStart(2, '0');
      return [
        [`linktxt${suffix}`, ''],
        [`links${suffix}`, ''],
        [`linkblank${suffix}`, false],
      ];
    }).flat(),
  ),
};

export type WarmSection = 'home' | 'articles' | 'notes' | 'about' | 'none';
export type WarmContinuousLoadMode = 'manual' | 'auto-2' | 'infinite';
export type WarmCommentComponentLoadMode = 'auto' | 'dwell' | 'manual';
export type WarmCommentInitialLoadMode = 'manual' | 'auto-first' | 'auto-2' | 'infinite';

export interface WarmSettings {
  pinnedIds: number[];
  footerLinks: Array<{ text: string; url: string; newWindow: boolean }>;
  footerCustomHtml: string;
  articleDeclarationHtml: string;
  continuousLoadMode: WarmContinuousLoadMode;
  commentComponentLoadMode: WarmCommentComponentLoadMode;
  commentInitialLoadMode: WarmCommentInitialLoadMode;
  /** Query params appended to same-origin upload URLs in content bodies (EdgeOne). */
  imageOptimizeParams: string;
  /** Query params appended to thumbnail URLs; falls back to imageOptimizeParams when empty. */
  thumbOptimizeParams: string;
}

export interface WarmCyFeatureSettings {
  showCommentManagementButtons: boolean;
  showHomeSearchButton: boolean;
}

export function warmCyFeatureSettings(options: ThemeBaseProps['options']): WarmCyFeatureSettings {
  let saved: Record<string, unknown> = {};
  const raw = options?.['plugin:typecho-plugin-warm-cy'];
  if (typeof raw === 'string' && raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        saved = parsed as Record<string, unknown>;
      }
    } catch {
      saved = {};
    }
  }
  const enabled = (value: unknown) => value === undefined || value === null || value === ''
    ? true
    : !(value === false || value === 0 || value === '0');
  return {
    showCommentManagementButtons: enabled(saved.showCommentManagementButtons),
    showHomeSearchButton: enabled(saved.showHomeSearchButton),
  };
}

export function warmSettings(options: ThemeBaseProps['options']): WarmSettings {
  const savedSettings = readSavedWarmSettings(options);
  const settings = { ...DEFAULT_WARM_SETTINGS, ...(savedSettings || {}) };
  const legacyCommentMode = savedSettings?.commentInitialLoadMode;
  const componentLoadMode = Object.prototype.hasOwnProperty.call(savedSettings || {}, 'commentComponentLoadMode')
    ? settings.commentComponentLoadMode
    : legacyCommentMode === 'dwell' || legacyCommentMode === 'dwell-auto-2'
      ? 'dwell'
      : settings.commentComponentLoadMode;
  const imageOptimizeParams = normalizeOptimizeParams(settings.imageOptimizeParams);
  const pinnedIds = parsePinnedIds(settings.pinnedIds);
  const footerCustomHtml = typeof settings.footerCustomHtml === 'string'
    ? settings.footerCustomHtml
    : '';
  const articleDeclarationHtml = typeof settings.articleDeclarationHtml === 'string'
    ? settings.articleDeclarationHtml
    : '';
  const footerLinks = Array.from({ length: 10 }, (_, index) => {
    const suffix = String(index + 1).padStart(2, '0');
    const text = typeof settings[`linktxt${suffix}`] === 'string' ? String(settings[`linktxt${suffix}`]).trim() : '';
    const url = safeExternalUrl(settings[`links${suffix}`]);
    const newWindowValue = settings[`linkblank${suffix}`];
    return { text, url, newWindow: newWindowValue === true || newWindowValue === '1' || newWindowValue === 1 };
  }).filter(link => link.text && link.url);
  return {
    pinnedIds,
    footerLinks,
    footerCustomHtml,
    articleDeclarationHtml,
    continuousLoadMode: normalizeContinuousLoadMode(settings.continuousLoadMode),
    commentComponentLoadMode: normalizeCommentComponentLoadMode(componentLoadMode),
    commentInitialLoadMode: normalizeCommentInitialLoadMode(settings.commentInitialLoadMode),
    imageOptimizeParams,
    thumbOptimizeParams: normalizeOptimizeParams(settings.thumbOptimizeParams) || imageOptimizeParams,
  };
}

/**
 * Scope administrator CSS to the declaration block and put it in a low-priority
 * cascade layer. Unlayered Warm CY rules therefore win conflicts, while custom
 * rules still fill properties the theme does not define.
 */
function scopeArticleDeclarationCss(css: string): string {
  try {
    const root = postcss.parse(css);
    const keyframes = new Map<string, string>();

    root.walkAtRules(/^(?:-webkit-)?keyframes$/i, atRule => {
      const original = atRule.params.trim();
      if (!original || !/^[\\w-]+$/.test(original)) {
        atRule.remove();
        return;
      }
      const scoped = `warm-declaration-${original}`;
      keyframes.set(original, scoped);
      atRule.params = scoped;
    });

    const scopeRules = (container: postcss.Container) => {
      for (const node of [...container.nodes || []]) {
        if (node.type === 'atrule') {
          const name = node.name.toLowerCase();
          if (name === 'media' || name === 'supports' || name === 'container') {
            scopeRules(node);
          } else if (name !== 'keyframes' && name !== '-webkit-keyframes') {
            // Global CSS constructs (imports, font-face, property, page, etc.)
            // must not escape the declaration's visual boundary.
            node.remove();
          }
          continue;
        }
        if (node.type !== 'rule') continue;

        // Nested CSS rules are not part of the supported authoring format.
        if (node.parent?.type === 'rule') {
          node.remove();
          continue;
        }

        const selectors = splitCssSelectorList(node.selector);
        if (!selectors.length) {
          node.remove();
          continue;
        }
        node.selector = selectors.map(selector =>
          `.warm-article__declaration ${selector}`,
        ).join(', ');
      }
    };

    scopeRules(root);

    root.walkDecls(decl => {
      // Custom CSS remains below unlayered Warm CY declarations, including former inline styles.
      decl.important = false;
      if (/^(?:animation|animation-name|-webkit-animation|-webkit-animation-name)$/i.test(decl.prop)) {
        for (const [original, scoped] of keyframes) {
          decl.value = decl.value.replace(
            new RegExp(`(^|[^\\w-])${escapeRegExp(original)}(?=$|[^\\w-])`, 'g'),
            (_match, before: string) => `${before}${scoped}`,
          );
        }
      }
      if (/expression\\s*\\(|javascript\\s*:|vbscript\\s*:|behavior\\s*:|-moz-binding/i.test(decl.value)) {
        decl.remove();
      }
    });

    return root.nodes?.length
      ? `@layer warm-article-declaration-custom { ${root.toString()} }`
      : '';
  } catch {
    // Invalid CSS is discarded as a whole rather than emitted unscoped.
    return '';
  }
}

function splitCssSelectorList(selector: string): string[] {
  const result: string[] = [];
  let start = 0;
  let quote = '';
  let round = 0;
  let square = 0;
  let escaped = false;

  for (let index = 0; index < selector.length; index++) {
    const char = selector[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') round++;
    else if (char === ')') round = Math.max(0, round - 1);
    else if (char === '[') square++;
    else if (char === ']') square = Math.max(0, square - 1);
    else if (char === ',' && round === 0 && square === 0) {
      const item = selector.slice(start, index).trim();
      if (item) result.push(item);
      start = index + 1;
    }
  }

  const last = selector.slice(start).trim();
  if (last) result.push(last);
  return result;
}

function escapeRegExp(value: string): string {
  const special = '.^$*+?()[]{}|\\';
  return [...value].map(char => special.includes(char) ? '\\' + char : char).join('');

/**
 * Normalize and constrain an administrator-authored HTML fragment.
 *
 * HTML is parsed and repaired by sanitize-html. Style blocks are parsed as CSS,
 * scoped to this declaration, and placed in a lower-priority cascade layer so
 * unlayered Warm CY theme rules take precedence when both define a property.
 */
export function sanitizeArticleDeclarationHtml(html: string): string {
  const sanitized = sanitizeHtml(html, {
    allowedTags: [
      'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'dd', 'del',
      'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4',
      'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p',
      'pre', 'q', 's', 'samp', 'small', 'span', 'style', 'sub', 'summary',
      'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
    ],
    allowedAttributes: {
      '*': ['class', 'id', 'title', 'role', 'style'],
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height', 'loading'],
      td: ['colspan', 'rowspan', 'headers'],
      th: ['colspan', 'rowspan', 'scope', 'headers'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: {
      img: ['http', 'https', 'data'],
    },
    allowProtocolRelative: false,
  });

  const cssBlocks: string[] = [];
  let htmlWithPlaceholders = sanitized.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_match, css: string) => {
    const token = 'WARM_DECLARATION_STYLE_BLOCK_' + cssBlocks.length + '_TOKEN';
    cssBlocks.push(css);
    return token;
  });

  let inlineIndex = 0;
  htmlWithPlaceholders = htmlWithPlaceholders.replace(/<([a-z][\w:-]*)([^>]*)>/gi, (tag, name: string, rawAttributes: string) => {
    const styleMatch = /\sstyle="([^"]*)"/i.exec(rawAttributes);
    if (!styleMatch) return tag;

    const styleValue = styleMatch[1];
    const className = 'warm-declaration-inline-' + (++inlineIndex);
    try {
      const parsed = postcss.parse('.inline { ' + styleValue + ' }');
      const declarations: string[] = [];
      parsed.walkDecls(decl => {
        decl.important = false;
        if (!/expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:|-moz-binding/i.test(decl.value)) {
          declarations.push(decl.toString());
        }
      });
      if (declarations.length) cssBlocks.push('.' + className + ' { ' + declarations.join('; ') + ' }');
    } catch {
      // Malformed inline CSS is discarded rather than emitted unprocessed.
    }

    let attributes = rawAttributes.replace(styleMatch[0], '');
    const classMatch = /\sclass="([^"]*)"/i.exec(attributes);
    if (classMatch) {
      attributes = attributes.replace(classMatch[0], ' class="' + classMatch[1] + ' ' + className + '"');
    } else {
      attributes += ' class="' + className + '"';
    }
    return '<' + name + attributes + '>';
  });

  const scopedCss = cssBlocks
    .map(css => scopeArticleDeclarationCss(css))
    .filter(Boolean)
    .join('\n');
  const restoredHtml = htmlWithPlaceholders.replace(/WARM_DECLARATION_STYLE_BLOCK_(\d+)_TOKEN/g, '');

  return scopedCss
    ? '<style>' + scopedCss + '</style>' + restoredHtml
    : restoredHtml;
}

/**
 * Expand placeholders safely, then normalize the resulting HTML fragment.
 * The fragment is kept separate from article/comment markup by its caller.
 */
export function renderArticleDeclaration(
  template: string,
  values: {
    siteName: string;
    siteUrl: string;
    siteDescription: string;
    postTitle: string;
    postUrl: string;
  },
): string {
  const replacements: Record<string, string> = {
    'site.name': values.siteName,
    'site.url': values.siteUrl,
    'site.description': values.siteDescription,
    'post.title': values.postTitle,
    'post.url': values.postUrl,
  };
  const expanded = template.replace(/\{(site\.name|site\.url|site\.description|post\.title|post\.url)\}/g, (_match, key: string) =>
    escapeHtml(replacements[key] ?? ''),
  );
  return sanitizeArticleDeclarationHtml(expanded);
}

export function parsePinnedIds(value: unknown): number[] {
  if (typeof value !== 'string' && typeof value !== 'number') return [];
  const parts = String(value).split(/[，,\s]+/);
  const result: number[] = [];
  const seen = new Set<number>();
  for (const part of parts) {
    if (!/^\d+$/.test(part.trim())) continue;
    const cid = Number(part.trim());
    if (!Number.isSafeInteger(cid) || cid <= 0 || seen.has(cid)) continue;
    seen.add(cid);
    result.push(cid);
  }
  return result;
}

function readSavedWarmSettings(options: ThemeBaseProps['options']): Record<string, unknown> | null {
  const raw = options?.[`theme:${WARM_THEME_ID}`];
  if (!raw) return null;
  try {
    const saved = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function normalizeContinuousLoadMode(value: unknown): WarmContinuousLoadMode {
  if (value === 'auto-2') return 'auto-2';
  return value === 'infinite' ? value : 'manual';
}

export function normalizeCommentComponentLoadMode(value: unknown): WarmCommentComponentLoadMode {
  return value === 'dwell' || value === 'auto' ? value : 'manual';
}

export function normalizeCommentInitialLoadMode(value: unknown): WarmCommentInitialLoadMode {
  if (value === 'auto-2' || value === 'dwell-auto-2') return 'auto-2';
  if (value === 'infinite') return 'infinite';
  if (value === 'manual') return 'manual';
  if (value === 'auto-first' || value === 'dwell' || value === 'auto') return 'auto-first';
  return 'manual';
}

export function safeExternalUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';

  const input = value.trim();

  // 邮件地址
  if (/^mailto:/i.test(input)) {
    const address = input.slice(input.indexOf(':') + 1).trim();
    if (!address || /[\s<>]/.test(address) || !address.includes('@')) return '';

    try {
      const url = new URL(`mailto:${address}`);
      return url.protocol === 'mailto:' && url.pathname.includes('@')
        ? url.toString()
        : '';
    } catch {
      return '';
    }
  }

  // 完整 HTTP / HTTPS 地址
  if (/^https?:\/\//i.test(input)) {
    try {
      const url = new URL(input);
      return url.protocol === 'https:' || url.protocol === 'http:'
        ? url.toString()
        : '';
    } catch {
      return '';
    }
  }

  // //example.com 形式的协议相对外部地址
  if (input.startsWith('//')) {
    try {
      const url = new URL(`https:${input}`);
      return url.protocol === 'https:' ? url.toString() : '';
    } catch {
      return '';
    }
  }

  // 判断是否为未填写协议的外部域名
  const isDomain = /^(?:localhost|(?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?(?:[/?#].*)?$/i.test(input);

  if (isDomain) {
    try {
      const url = new URL(`https://${input}`);
      return url.protocol === 'https:' ? url.toString() : '';
    } catch {
      return '';
    }
  }

  // 拒绝其他协议，例如 javascript:、ftp:
  if (/^[a-z][a-z\d+.-]*:/i.test(input)) return '';

  // 普通路径按当前网站根目录解析
  try {
    const path = input.startsWith('/')
      ? input
      : `/${input.replace(/^\.\/+/, '')}`;

    const url = new URL(path, 'https://relative.invalid');

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '';
  }
}


/** Match a navigation page by normalized pathname, never by substring. */
export function isCurrentPageLink(permalink: string, currentPath: string, siteUrl: string): boolean {
  try {
    const site = new URL(siteUrl);
    const target = new URL(permalink, site);
    const current = new URL(currentPath, site);
    if (target.origin !== site.origin || current.origin !== site.origin) return false;
    const normalizePath = (pathname: string) => pathname.length > 1
      ? pathname.replace(/\/+$/, '')
      : pathname;
    return normalizePath(target.pathname) === normalizePath(current.pathname);
  } catch {
    return false;
  }
}

export function safeEmail(value: unknown): string {
  if (typeof value !== 'string') return '';
  const email = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

export function formatWarmDate(
  timestamp: number,
  format: string | boolean = 'Y-m-d',
  timezoneOffset = 28800,
  includeTime = false,
): string {
  let dateFormat = typeof format === 'boolean'
    ? format ? 'Y-m-d H:i' : 'Y-m-d'
    : format || 'Y-m-d';
  if (includeTime && !hasTimeFormat(dateFormat)) dateFormat += ' H:i';
  return formatDate(timestamp, dateFormat, timezoneOffset);
}

function hasTimeFormat(format: string): boolean {
  return /[HhGgisaA]/.test(format.replace(/\\./g, ''));
}

export function plainExcerpt(value: string, length = 150): string {
  const plain = value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > length ? `${plain.slice(0, length).trim()}...` : plain;
}

export function readingMinutes(html: string): number {
  const characters = html.replace(/<[^>]*>/g, '').replace(/\s+/g, '').length;
  return Math.max(1, Math.ceil(characters / 420));
}

/** Hero summary: only Intelligence 智能摘要; empty when missing or password-locked. */
export function warmArticleSummary(
  post: Pick<ThemePostProps['post'], 'hasPassword' | 'passwordVerified'>,
  intelligenceSummary: string | null | undefined,
): string {
  if (post.hasPassword && !post.passwordVerified) return '';
  return (intelligenceSummary || '').trim();
}

export interface WarmTocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

const TOC_HEADING_RE = /<(h[23])(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
const TOC_EXISTING_ID_RE = /\sid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const TOC_MIN_ITEMS = 2;

/**
 * Collect h2/h3 headings for the article TOC and ensure each has a unique id.
 * Returns an empty items list when there are fewer than two headings.
 */
export function prepareArticleToc(html: string): { html: string; items: WarmTocItem[] } {
  if (!html) return { html: '', items: [] };

  const used = new Set<string>();
  const items: WarmTocItem[] = [];

  const nextHtml = html.replace(TOC_HEADING_RE, (match, tag: string, attrs = '', inner: string) => {
    const text = plainHeadingText(inner);
    if (!text) return match;

    const level = Number(tag.slice(1)) as 2 | 3;
    const existing = TOC_EXISTING_ID_RE.exec(attrs)?.slice(1).find(Boolean)?.trim();
    let id = existing || generateWarmSlug(text) || `section-${items.length + 1}`;
    const base = id;
    let suffix = 2;
    while (used.has(id)) id = `${base}-${suffix++}`;
    used.add(id);
    items.push({ id, text, level });

    if (existing) {
      if (existing === id) return match;
      const rewrittenAttrs = attrs.replace(TOC_EXISTING_ID_RE, ` id="${escapeHtml(id)}"`);
      return `<${tag}${rewrittenAttrs}>${inner}</${tag}>`;
    }

    const suffixAttrs = attrs ? `${attrs} id="${escapeHtml(id)}"` : ` id="${escapeHtml(id)}"`;
    return `<${tag}${suffixAttrs}>${inner}</${tag}>`;
  });

  if (items.length < TOC_MIN_ITEMS) return { html: nextHtml, items: [] };
  return { html: nextHtml, items };
}

function generateWarmSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 150);
}

function plainHeadingText(inner: string): string {
  return inner
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize iframe attributes in article content.
 *
 * Only applies to iframe elements that have already passed
 * the application's HTML sanitizer.
 */
export function renderWarmIframes(html: string): string {
  return html.replace(/<iframe\b([^>]*)>/gi, (match, rawAttributes: string) => {
    const attributes = rawAttributes;

    // Extract the original iframe source.
    const srcMatch = attributes.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const src = srcMatch?.[1] ?? srcMatch?.[2] ?? srcMatch?.[3] ?? '';

    if (!src) return match;

    // Restrict processing to the supported video providers.
    let hostname = '';

    try {
      hostname = new URL(src, 'https://localhost').hostname.toLowerCase();
    } catch {
      return match;
    }

    const allowedHosts = [
      'www.youtube.com',
      'player.bilibili.com',
      'player.vimeo.com',
    ];

    if (!allowedHosts.includes(hostname)) return match;

    // Add or replace an iframe attribute without duplicating it.
    const setAttribute = (source: string, name: string, value: string) => {
      const pattern = new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'i');

      if (pattern.test(source)) {
        return source.replace(pattern, ` ${name}="${value}"`);
      }

      return `${source} ${name}="${value}"`;
    };

    let result = attributes;

    result = setAttribute(result, 'loading', 'lazy');
    result = setAttribute(result, 'allowfullscreen', '');
    result = setAttribute(
      result,
      'allow',
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
    );
    result = setAttribute(result, 'title', '视频播放器');

    return `<iframe${result}>`;
  });
}
