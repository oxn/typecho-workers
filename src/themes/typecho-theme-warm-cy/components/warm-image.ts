import {
  normalizeOptimizeParams,
  optimizeContentImages as optimizeSharedContentImages,
  optimizeImageUrl as optimizeSharedImageUrl,
} from '@/lib/image-transform';

export { normalizeOptimizeParams };

/** BlurHash is the only theme-specific image fragment metadata retained here. */
export function parseImageFragment(raw: string): { blurhash: string } {
  const hashIndex = raw.indexOf('#');
  const fragment = (hashIndex >= 0 ? raw.slice(hashIndex + 1) : '').replace(/&amp;/gi, '&');
  const values = new Map<string, string>();
  for (const part of fragment.split(/[&;]/)) {
    if (!part) continue;
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).toLowerCase();
    const encoded = part.slice(separator + 1).replace(/\+/g, '%2B');
    try { values.set(key, decodeURIComponent(encoded)); }
    catch { values.set(key, encoded); }
  }
  const candidate = values.get('blurhash') || '';
  const blurhash = /^[0-9A-Za-z#$%*+,-.:;=?@\[\]^_{|}~]+$/.test(candidate)
    && candidate.length >= 6 && candidate.length <= 200 ? candidate : '';
  return { blurhash };
}

/** Use the shared image URL implementation; only strip display-only fragments. */
export function optimizeImageUrl(url: string, params: string, siteUrl: string): string {
  const hashIndex = url.indexOf('#');
  const resourceUrl = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  return optimizeSharedImageUrl(resourceUrl, params, siteUrl);
}

/**
 * The shared library owns URL optimization. This wrapper only extracts the
 * independent BlurHash placeholder metadata before handing HTML to it.
 */
export function optimizeContentImages(html: string, params: string, siteUrl: string): string {
  if (!html) return html;
  const withoutFragments = html.replace(/<img\b[^>]*>/gi, (tag: string) => {
    const srcMatch = tag.match(/(\ssrc\s*=\s*)(["'])(.*?)\2/i);
    if (!srcMatch) return tag;
    const src = srcMatch[3];
    const hashIndex = src.indexOf('#');
    if (hashIndex < 0) return tag;

    const metadata = parseImageFragment(src);
    const resourceUrl = src.slice(0, hashIndex);
    let updated = tag.replace(srcMatch[0], srcMatch[1] + srcMatch[2] + resourceUrl + srcMatch[2]);
    if (metadata.blurhash && !/\sdata-blurhash\s*=/i.test(updated)) {
      updated = updated.replace(/\/?>$/, (ending: string) => ' data-blurhash="' + metadata.blurhash + '"' + ending);
    }
    return updated;
  });
  return optimizeSharedContentImages(withoutFragments, params, siteUrl);
}
