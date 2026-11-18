import { describe, expect, it } from 'vitest';
import { normalizeOptimizeParams, optimizeContentImages, optimizeImageUrl, parseImageFragment } from './warm-image';

describe('Warm CY image helpers', () => {
  it('uses the shared optimization parameter normalizer', () => {
    expect(normalizeOptimizeParams(' ?quality=80&format=auto ')).toBe('quality=80&format=auto');
    expect(normalizeOptimizeParams('quality=80" onerror="alert(1)')).toBe('quality=80onerror=alert1');
    expect(normalizeOptimizeParams('')).toBe('');
    expect(normalizeOptimizeParams(null)).toBe('');
  });

  it('parses BlurHash metadata without interpreting dimensions', () => {
    expect(parseImageFragment(
      'https://cdn.example/image.webp#blurhash=LfLp%7Bl%2509GXo.T-S%251tSIWj%3Dt7f9&width=1536&height=1024',
    )).toEqual({ blurhash: 'LfLp{l%09GXo.T-S%1tSIWj=t7f9' });
  });

  it('preserves literal plus characters in BlurHash values', () => {
    const hash = '1234+5678901234567890123456';
    expect(parseImageFragment('image.webp#blurhash=' + hash).blurhash).toBe(hash);
  });

  it('rejects malformed BlurHash values', () => {
    expect(parseImageFragment('image.webp#blurhash=bad%20hash&width=640')).toEqual({ blurhash: '' });
  });

  it('delegates same-origin upload URL optimization to the shared implementation', () => {
    expect(optimizeImageUrl('/usr/uploads/photo.jpg?width=800#display', 'quality=80', 'https://oook.top'))
      .toBe('/usr/uploads/photo.jpg?width=800&quality=80');
  });

  it('keeps non-upload, GIF, and SVG URLs unchanged', () => {
    expect(optimizeImageUrl('/assets/a.jpg', 'quality=80', 'https://oook.top')).toBe('/assets/a.jpg');
    expect(optimizeImageUrl('/usr/uploads/a.gif', 'quality=80', 'https://oook.top')).toBe('/usr/uploads/a.gif');
    expect(optimizeImageUrl('/usr/uploads/a.svg', 'quality=80', 'https://oook.top')).toBe('/usr/uploads/a.svg');
  });

  it('retains BlurHash while removing fragments before shared URL rewriting', () => {
    const html = '<img src="/usr/uploads/photo.jpg#blurhash=LfLp%7Bl%2509GXo.T-S%251tSIWj%3Dt7f9&amp;width=1536&amp;height=1024" alt="image">';
    const result = optimizeContentImages(html, 'quality=80', 'https://site.example');
    expect(result).toContain('src="/usr/uploads/photo.jpg?quality=80"');
    expect(result).toContain('data-blurhash="LfLp{l%09GXo.T-S%1tSIWj=t7f9"');
    expect(result).not.toContain('width="1536"');
    expect(result).not.toContain('height="1024"');
    expect(result).not.toContain('width:1536px');
    expect(result).not.toContain('height:1024px');
  });

  it('removes display fragments but does not add dimensions when no BlurHash exists', () => {
    const html = '<img src="/usr/uploads/photo.jpg#width=640&height=360" alt="image">';
    expect(optimizeContentImages(html, '', 'https://site.example'))
      .toBe('<img src="/usr/uploads/photo.jpg" alt="image">');
  });

  it('leaves non-image markup unchanged', () => {
    const html = '<a href="/usr/uploads/photo.jpg">photo</a>';
    expect(optimizeContentImages(html, 'quality=80', 'https://oook.top')).toBe(html);
  });
});
