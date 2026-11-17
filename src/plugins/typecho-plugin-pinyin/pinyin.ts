import { pinyin } from 'pinyin-pro';

const DEFAULT_SLUG_LENGTH = 300;

/**
 * Convert a title to the original plugin's URL-safe ASCII pinyin slug.
 * The conversion runs in the browser; no pinyin-generation request is sent.
 */
export function titleToPinyinSlug(title: string, maxLength = DEFAULT_SLUG_LENGTH): string {
  const source = title.trim();
  if (!source) return '';

  const slug = source
    .split(/([\\s\\p{P}\\p{S}]+)/u)
    .map((part) => {
      if (!part) return '';
      if (/^[\\s\\p{P}\\p{S}]+$/u.test(part)) return '-';

      return pinyin(part, { toneType: 'none', nonZh: 'consecutive' })
        .replace(/\\s+/g, '')
        .normalize('NFKD')
        .replace(/[\\u0300-\\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-');
    })
    .join('')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug.slice(0, maxLength).replace(/-+$/g, '');
}
