import type { ThemeBaseProps, ThemePostProps } from '@/lib/theme-props';
import { loadThemeConfig } from '@/lib/theme';
import { normalizeOptimizeParams } from '@/lib/image-transform';
import { formatDate, generateSlug } from '@/lib/content';
import { escapeHtml } from '@/lib/escape';

export const WARM_THEME_ID = 'typecho-theme-warm-cy';

export type WarmSection = 'home' | 'articles' | 'notes' | 'about' | 'none';
export type WarmContinuousLoadMode = 'manual' | 'auto-2' | 'infinite';
export type WarmCommentComponentLoadMode = 'auto' | 'dwell' | 'manual';
export type WarmCommentInitialLoadMode = 'manual' | 'auto-first' | 'auto-2' | 'infinite';

export interface WarmSettings {
  pinnedIds: number[];
  footerLinks: Array<{ text: string; url: string; newWindow: boolean }>;
  continuousLoadMode: WarmContinuousLoadMode;
  commentComponentLoadMode: WarmCommentComponentLoadMode;
  commentInitialLoadMode: WarmCommentInitialLoadMode;
  /** Query params appended to same-origin upload URLs in content bodies (EdgeOne). */
  imageOptimizeParams: string;
  /** Query params appended to thumbnail URLs; falls back to imageOptimizeParams when empty. */
  thumbOptimizeParams: string;
}

export function warmSettings(options: ThemeBaseProps['options']): WarmSettings {
  const settings = loadThemeConfig(options, WARM_THEME_ID);
  const savedSettings = readSavedWarmSettings(options);
  const legacyCommentMode = savedSettings?.commentInitialLoadMode;
  const componentLoadMode = Object.prototype.hasOwnProperty.call(savedSettings || {}, 'commentComponentLoadMode')
    ? settings.commentComponentLoadMode
    : legacyCommentMode === 'dwell' || legacyCommentMode === 'dwell-auto-2'
      ? 'dwell'
      : settings.commentComponentLoadMode;
  const imageOptimizeParams = normalizeOptimizeParams(settings.imageOptimizeParams);
  const pinnedIds = parsePinnedIds(settings.pinnedIds);
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
    continuousLoadMode: normalizeContinuousLoadMode(settings.continuousLoadMode),
    commentComponentLoadMode: normalizeCommentComponentLoadMode(componentLoadMode),
    commentInitialLoadMode: normalizeCommentInitialLoadMode(settings.commentInitialLoadMode),
    imageOptimizeParams,
    thumbOptimizeParams: normalizeOptimizeParams(settings.thumbOptimizeParams) || imageOptimizeParams,
  };
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
    let id = existing || generateSlug(text) || `section-${items.length + 1}`;
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

function plainHeadingText(inner: string): string {
  return inner
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
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
    const setAttribute = (name: string, value: string) => {
      const pattern = new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'i');

      if (pattern.test(attributes)) {
        return attributes.replace(pattern, ` ${name}="${value}"`);
      }

      return `${attributes} ${name}="${value}"`;
    };

    let result = attributes;

    result = setAttribute('loading', 'lazy');
    result = setAttribute('allowfullscreen', '');
    result = setAttribute(
      'allow',
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
    );
    result = setAttribute('title', '视频播放器');

    return `<iframe${result}>`;
  });
}