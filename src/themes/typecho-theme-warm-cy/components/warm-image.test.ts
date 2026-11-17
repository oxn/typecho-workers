import { describe, expect, it } from 'vitest';
import {
  normalizeOptimizeParams,
  optimizeContentImages,
  optimizeImageUrl,
  parseImageFragment,
} from './warm-image';

describe('Warm CY image helpers', () => {
  it('normalizes only supported optimization parameter characters', () => {
    expect(normalizeOptimizeParams(' ?quality=80&format=auto ')).toBe('quality=80&format=auto');
    expect(normalizeOptimizeParams('quality=80" onerror="alert(1)')).toBe('quality=80onerror=alert1');
    expect(normalizeOptimizeParams('')).toBe('');
    expect(normalizeOptimizeParams(null)).toBe('');
  });

  it('parses encoded BlurHash and dimensions exactly once', () => {
    expect(parseImageFragment(
      'https://cdn.example/image.webp#blurhash=LfLp%7Bl%2509GXo.T-S%251tSIWj%3Dt7f9&width=1536&height=1024',
    )).toEqual({
      blurhash: 'LfLp{l%09GXo.T-S%1tSIWj=t7f9',
      width: '1536',
      height: '1024',
    });
  });

  it('preserves literal plus characters in BlurHash values', () => {
    const hash = '1234+5678901234567890123456';
    expect(parseImageFragment('image.webp#blurhash=' + hash).blurhash).toBe(hash);
  });

  it('rejects malformed BlurHash values and unsafe dimensions', () => {
    expect(parseImageFragment('image.webp#blurhash=bad%20hash&width=0&height=20001')).toEqual({
      blurhash: '',
      width: null,
      height: null,
    });
  });

  it('rewrites relative uploads without losing existing query parameters', () => {
    expect(optimizeImageUrl('/usr/uploads/photo.jpg?width=800', 'quality=80', 'https://oook.top'))
      .toBe('/usr/uploads/photo.jpg?width=800&quality=80');
  });

  it('strips fragments from image URLs while applying eligible optimization', () => {
    expect(optimizeImageUrl(
      'https://oook.top/usr/uploads/photo.jpg#width=640&height=360',
      'quality=80',
      'https://oook.top',
    )).toBe('https://oook.top/usr/uploads/photo.jpg?quality=80');
  });

  it('strips fragments from external and non-optimized image URLs too', () => {
    expect(optimizeImageUrl('https://other.example/image.webp#blurhash=abc123', 'quality=80', 'https://oook.top'))
      .toBe('https://other.example/image.webp');
    expect(optimizeImageUrl('/assets/a.jpg#width=320', 'quality=80', 'https://oook.top'))
      .toBe('/assets/a.jpg');
  });

  it('does not optimize non-upload, GIF, or SVG URLs', () => {
    expect(optimizeImageUrl('/assets/a.jpg', 'quality=80', 'https://oook.top')).toBe('/assets/a.jpg');
    expect(optimizeImageUrl('/usr/uploads/a.gif', 'quality=80', 'https://oook.top')).toBe('/usr/uploads/a.gif');
    expect(optimizeImageUrl('/usr/uploads/a.svg', 'quality=80', 'https://oook.top')).toBe('/usr/uploads/a.svg');
  });

  it('keeps BlurHash metadata and removes the fragment from the actual image request', () => {
    const html = '<img src="https://cdn.example/image.webp#blurhash=LfLp%7Bl%2509GXo.T-S%251tSIWj%3Dt7f9&amp;width=1536&amp;height=1024" alt="image">';
    const result = optimizeContentImages(html, '', 'https://site.example');
    expect(result).toContain('src="https://cdn.example/image.webp"');
    expect(result).toContain('data-blurhash="LfLp{l%09GXo.T-S%1tSIWj=t7f9"');
    expect(result).toContain('width="1536"');
    expect(result).toContain('height="1024"');
    expect(result).toContain('width:1536px');
    expect(result).toContain('height:1024px');
  });

  it('recovers dimensions without overriding explicit attributes', () => {
    const html = '<img src="/usr/uploads/photo.jpg#width=640&height=360" width="320">';
    expect(optimizeContentImages(html, 'quality=80', 'https://oook.top'))
      .toBe('<img src="/usr/uploads/photo.jpg?quality=80" width="320" height="360" style="height:360px">');
  });

  it('applies fragment dimensions as inline display sizes, including an ampersand-prefixed fragment', () => {
    const html = '<img src="https://img.347777.xyz/file/icon.svg#&width=48&height=48" alt="icon">';
    const output = optimizeContentImages(html, '', 'https://oook.top');
    expect(output).toContain('src="https://img.347777.xyz/file/icon.svg"');
    expect(output).toContain('width="48"');
    expect(output).toContain('height="48"');
    expect(output).toContain('style="width:48px;height:48px"');
  });

  it('keeps legacy image URLs and existing dimensions compatible', () => {
    const html = '<img src="/uploads/legacy.webp" alt="legacy" width="320" loading="lazy">';
    expect(optimizeContentImages(html, '', 'https://site.example')).toBe(html);
    const withExistingDimensions = '<img src="https://cdn.example/image.webp#width=640&amp;height=480" width="320" height="240">';
    const result = optimizeContentImages(withExistingDimensions, '', 'https://site.example');
    expect(result).toContain('width="320"');
    expect(result).toContain('height="240"');
    expect(result).not.toContain('data-blurhash');
    expect(result).toContain('src="https://cdn.example/image.webp"');
  });

  it('leaves non-image markup unchanged', () => {
    const html = '<a href="/usr/uploads/photo.jpg">photo</a>';
    expect(optimizeContentImages(html, 'quality=80', 'https://oook.top')).toBe(html);
  });
});
