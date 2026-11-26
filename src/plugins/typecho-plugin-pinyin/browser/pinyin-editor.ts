import { pinyin } from 'pinyin-pro';

type PinyinBrowserWindow = Window & {
  TypechoPinyinSlug?: (title: string, maxLength?: number) => string;
};

export function titleToPinyinSlug(title: string, maxLength = 300): string {
  const source = String(title || '').trim();
  if (!source) return '';

  const slug = source
    .split(/([\s\p{P}\p{S}]+)/u)
    .map((part) => {
      if (!part) return '';
      if (/^[\s\p{P}\p{S}]+$/u.test(part)) return '-';

      return pinyin(part, { toneType: 'none', nonZh: 'consecutive' })
        .replace(/\s+/g, '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-');
    })
    .join('')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug.slice(0, maxLength).replace(/-+$/g, '');
}

if (typeof window !== 'undefined') {
  (window as PinyinBrowserWindow).TypechoPinyinSlug = titleToPinyinSlug;
}
