/**
 * Theme-side image optimization via query-parameter rewriting.
 *
 * The hosting edge (EdgeOne) applies image processing based on query
 * parameters such as `quality=80&format=auto`. The theme exposes those
 * parameters as site settings; this module rewrites same-origin
 * `/usr/uploads/` URLs at render time so every image picks them up.
 * Stored content is never touched — the settings are trivially reversible.
 */

/** Max length of an accepted optimization parameter string. */
export const OPTIMIZE_PARAMS_MAX_LENGTH = 100;

/**
 * Characters allowed in an optimization parameter string; everything else
 * is stripped. The value eventually lands inside a `src` attribute of HTML
 * injected via `set:html`, so it must not be able to smuggle markup,
 * attributes, or quotes.
 */
const OPTIMIZE_PARAMS_UNSAFE = /[^a-zA-Z0-9=&%?._~-]/g;

export function normalizeOptimizeParams(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/^[?&]+/, '');
  if (!trimmed) return '';
  const safe = trimmed.replace(OPTIMIZE_PARAMS_UNSAFE, '').slice(0, OPTIMIZE_PARAMS_MAX_LENGTH);
  return safe.replace(/^[?&]+/, '');
}

const UPLOAD_URL_BASE = 'http://typecho.invalid';

/**
 * Parses a raw image URL and returns it as a URL object only when it is
 * one of ours: a relative `/usr/uploads/` path, or an absolute URL that
 * matches the configured site origin (protocol-relative URLs never match,
 * since they resolve to the placeholder scheme). `.gif`/`.svg` are exempt —
 * animation and vector images must not be re-encoded.
 */
function parseOwnUpload(raw: string, siteUrl: string): URL | null {
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw, UPLOAD_URL_BASE);
  } catch {
    return null;
  }
  if (!parsed.pathname.startsWith('/usr/uploads/')) return null;
  if (/\.(gif|svg)$/i.test(parsed.pathname)) return null;
  if (raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    if (!siteUrl) return null;
    try {
      if (parsed.origin !== new URL(siteUrl).origin) return null;
    } catch {
      return null;
    }
  }
  return parsed;
}

/**
 * Returns `url` with the optimization params appended (via `&` when the
 * URL already carries a query). Relative inputs stay relative; absolute
 * same-origin inputs keep their absolute form. Anything that is not a
 * same-origin upload — or an empty params string — is returned unchanged.
 */
export function optimizeImageUrl(url: string, params: string, siteUrl: string): string {
  const clean = normalizeOptimizeParams(params);
  if (!clean || !url) return url;
  const parsed = parseOwnUpload(url, siteUrl);
  if (!parsed) return url;
  const sep = parsed.search ? '&' : '?';
  if (url.startsWith('/')) {
    return `${parsed.pathname}${parsed.search}${sep}${clean}`;
  }
  return `${parsed.href}${sep}${clean}`;
}

/**
 * Rewrites every `<img>` `src` inside rendered HTML (content bodies) with
 * the optimization params. Only `src` attributes of `img` elements are
 * touched; other elements keep their URLs.
 */

export function optimizeContentImages(html: string, params: string, siteUrl: string): string {
  if (!html) return html;

  const clean = normalizeOptimizeParams(params);

  return html.replace(/<img\b[^>]*>/gi, (tag: string) => {
    const srcMatch = tag.match(/(\ssrc\s*=\s*)(["'])(.*?)\2/i);
    if (!srcMatch) return tag;

    const src = srcMatch[3];

    // 读取 URL # 后面的参数，兼容 HTML 转义的 &amp;
    const fragment = (src.split('#', 2)[1] || '').replace(/&amp;/gi, '&');

    const getDimension = (name: 'width' | 'height'): string | null => {
      const result = fragment.match(
        new RegExp(`(?:^|[&;])${name}=(\\d+)(?=[&;]|$)`, 'i'),
      );

      if (!result) return null;

      const value = Number(result[1]);

      return Number.isInteger(value) && value > 0 && value <= 10000
        ? String(value)
        : null;
    };

    let updated = tag;
    let attributes = '';

    // 只补充缺失的尺寸，不覆盖文章原有的 width/height
    for (const name of ['width', 'height'] as const) {
      const dimension = getDimension(name);
      const hasAttribute = new RegExp(`\\s${name}\\s*=`, 'i').test(updated);

      if (dimension && !hasAttribute) {
        attributes += ` ${name}="${dimension}"`;
      }
    }

    // 将尺寸属性加在 img 标签结束符之前
    if (attributes) {
      updated = updated.replace(/\/?>$/, (ending: string) => {
        return `${attributes}${ending}`;
      });
    }

    // 保留原来的图片优化逻辑
    if (clean) {
      const optimized = optimizeImageUrl(src, clean, siteUrl);

      if (optimized !== src) {
        updated = updated.replace(
          /(\ssrc\s*=\s*)(["'])(.*?)\2/i,
          (_match: string, prefix: string, quote: string) =>
            `${prefix}${quote}${optimized}${quote}`,
        );
      }
    }

    return updated;
  });
}
