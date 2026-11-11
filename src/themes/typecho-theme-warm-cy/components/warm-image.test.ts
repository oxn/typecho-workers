import { describe, expect, it } from 'vitest';
import {
  normalizeOptimizeParams,
  optimizeContentImages,
  optimizeImageUrl,
} from './warm-image';

describe('Warm CY image helpers', () => {
  it('normalizes only supported optimization parameter characters', () => {
    expect(normalizeOptimizeParams(' ?quality=80&format=auto ')).toBe('quality=80&format=auto');
    expect(normalizeOptimizeParams('quality=80" onerror="alert(1)')).toBe('quality=80onerror=alert1');
    expect(normalizeOptimizeParams('')).toBe('');
    expect(normalizeOptimizeParams(null)).toBe('');
  });

  it('rewrites relative uploads without losing existing query parameters', () => {
    expect(optimizeImageUrl('/usr/uploads/photo.jpg?width=800', 'quality=80', 'https://oook.top'))
      .toBe('/usr/uploads/photo.jpg?width=800&quality=80');
  });

  it('inserts optimization parameters before a URL fragment', () => {
    expect(optimizeImageUrl(
      'https://oook.top/usr/uploads/photo.jpg#width=640&height=360',
      'quality=80',
      'https://oook.top',
    )).toBe('https://oook.top/usr/uploads/photo.jpg?quality=80#width=640&height=360');
  });

  it('does not rewrite external, non-upload, GIF, or SVG URLs', () => {
    expect(optimizeImageUrl('https://other.example/usr/uploads/a.jpg', 'quality=80', 'https://oook.top'))
      .toBe('https://other.example/usr/uploads/a.jpg');
    expect(optimizeImageUrl('/assets/a.jpg', 'quality=80', 'https://oook.top')).toBe('/assets/a.jpg');
    expect(optimizeImageUrl('/usr/uploads/a.gif', 'quality=80', 'https://oook.top')).toBe('/usr/uploads/a.gif');
    expect(optimizeImageUrl('/usr/uploads/a.svg', 'quality=80', 'https://oook.top')).toBe('/usr/uploads/a.svg');
  });

  it('recovers dimensions from the fragment without overriding explicit attributes', () => {
    const html = '<img src="/usr/uploads/photo.jpg#width=640&height=360" width="320">';
    expect(optimizeContentImages(html, 'quality=80', 'https://oook.top'))
      .toBe('<img src="/usr/uploads/photo.jpg?quality=80#width=640&height=360" width="320" height="360" style="height:360px">');
  });

  it('applies fragment dimensions as inline display sizes, including an ampersand-prefixed fragment', () => {
    const html = '<img src="https://img.347777.xyz/file/icon.svg#&width=48&height=48" alt="icon">';
    const output = optimizeContentImages(html, '', 'https://oook.top');
    expect(output).toContain('width="48"');
    expect(output).toContain('height="48"');
    expect(output).toContain('style="width:48px;height:48px"');
  });

  it('can recover dimensions when optimization is disabled', () => {
    expect(optimizeContentImages(
      '<img src="/usr/uploads/photo.jpg#width=640&height=360">',
      '',
      'https://oook.top',
    )).toBe('<img src="/usr/uploads/photo.jpg#width=640&height=360" width="640" height="360" style="width:640px;height:360px">');
  });

  it('leaves non-image markup unchanged', () => {
    const html = '<a href="/usr/uploads/photo.jpg">photo</a>';
    expect(optimizeContentImages(html, 'quality=80', 'https://oook.top')).toBe(html);
  });
});
