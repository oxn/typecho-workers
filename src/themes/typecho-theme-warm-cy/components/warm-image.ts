/**
 * Warm CY theme-local image URL helpers.
 * Theme-specific EdgeOne URL rewriting stays inside the theme package.
 */
export const OPTIMIZE_PARAMS_MAX_LENGTH = 100;
const OPTIMIZE_PARAMS_UNSAFE = /[^a-zA-Z0-9=&%?._~-]/g;
const UPLOAD_URL_BASE = 'http://typecho.invalid';

export function normalizeOptimizeParams(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/^[?&]+/, '');
  if (!trimmed) return '';
  const safe = trimmed.replace(OPTIMIZE_PARAMS_UNSAFE, '').slice(0, OPTIMIZE_PARAMS_MAX_LENGTH);
  return safe.replace(/^[?&]+/, '');
}

function parseOwnUpload(raw: string, siteUrl: string): URL | null {
  if (!raw) return null;
  let parsed: URL;
  try { parsed = new URL(raw, UPLOAD_URL_BASE); } catch { return null; }
  if (!parsed.pathname.startsWith('/usr/uploads/')) return null;
  if (/\.(gif|svg)$/i.test(parsed.pathname)) return null;
  if (raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    if (!siteUrl) return null;
    try { if (parsed.origin !== new URL(siteUrl).origin) return null; } catch { return null; }
  }
  return parsed;
}

export function optimizeImageUrl(url: string, params: string, siteUrl: string): string {
  const clean = normalizeOptimizeParams(params);
  if (!clean || !url) return url;
  const parsed = parseOwnUpload(url, siteUrl);
  if (!parsed) return url;
  const separator = parsed.search ? '&' : '?';
  if (url.startsWith('/')) return `${parsed.pathname}${parsed.search}${separator}${clean}`;
  return `${parsed.href}${separator}${clean}`;
}

export function optimizeContentImages(html: string, params: string, siteUrl: string): string {
  if (!html) return html;
  const clean = normalizeOptimizeParams(params);
  return html.replace(/<img\b[^>]*>/gi, (tag: string) => {
    const srcMatch = tag.match(/(\ssrc\s*=\s*)(["'])(.*?)\2/i);
    if (!srcMatch) return tag;
    const src = srcMatch[3];
    const fragment = (src.split('#', 2)[1] || '').replace(/&amp;/gi, '&');

    const getDimension = (name: 'width' | 'height'): string | null => {
      const result = fragment.match(new RegExp(`(?:^|[&;])${name}=(\\d+)(?=[&;]|$)`, 'i'));
      if (!result) return null;
      const value = Number(result[1]);
      return Number.isInteger(value) && value > 0 && value <= 10000 ? String(value) : null;
    };

    let updated = tag;
    let attributes = '';
    for (const name of ['width', 'height'] as const) {
      const dimension = getDimension(name);
      const hasAttribute = new RegExp(`\\s${name}\\s*=`, 'i').test(updated);
      if (dimension && !hasAttribute) attributes += ` ${name}="${dimension}"`;
    }
    if (attributes) updated = updated.replace(/\/?>$/, (ending: string) => `${attributes}${ending}`);

    if (clean) {
      const optimized = optimizeImageUrl(src, clean, siteUrl);
      if (optimized !== src) {
        updated = updated.replace(/(\ssrc\s*=\s*)(["'])(.*?)\2/i,
          (_match: string, prefix: string, quote: string) => `${prefix}${quote}${optimized}${quote}`);
      }
    }
    return updated;
  });
}
