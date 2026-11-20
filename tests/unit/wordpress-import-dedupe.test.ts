import { describe, expect, it } from 'vitest';
import {
  buildWordPressImportDedupeKey,
  normalizeImportedPostSlug,
} from '../../src/plugins/typecho-plugin-wordpress-import/service';

describe('WordPress import duplicate matching', () => {
  const item = { title: 'Same title', slug: 'same-alias', oldId: 42 };

  it.each([
    ['title', ['title']],
    ['slug', ['slug']],
    ['id', ['id']],
    ['title + slug', ['title', 'slug']],
    ['title + id', ['title', 'id']],
    ['slug + id', ['slug', 'id']],
    ['title + slug + id', ['title', 'slug', 'id']],
  ] as const)('builds the selected composite identity for %s', (_label, fields) => {
    const original = buildWordPressImportDedupeKey(item, fields, 'https://wp.example');
    expect(buildWordPressImportDedupeKey({ ...item }, fields, 'https://wp.example')).toBe(original);
  });

  it('does not treat a partial field match as the same composite identity', () => {
    const fields = ['title', 'id'] as const;
    const original = buildWordPressImportDedupeKey(item, fields, 'https://wp.example');
    expect(buildWordPressImportDedupeKey({ ...item, oldId: 43 }, fields, 'https://wp.example')).not.toBe(original);
    expect(buildWordPressImportDedupeKey({ ...item, title: 'Different title' }, fields, 'https://wp.example')).not.toBe(original);
  });

  it('normalizes the generated fallback alias for blank post/page aliases', () => {
    expect(normalizeImportedPostSlug('', 42)).toBe('post-42');
    expect(normalizeImportedPostSlug('post-42', 42)).toBe('post-42');
    expect(normalizeImportedPostSlug('post-42-wp-42', 42)).toBe('post-42');
    expect(normalizeImportedPostSlug('post-42-wp-42-2', 42)).toBe('post-42');
  });

  it('preserves an explicitly supplied WordPress alias', () => {
    expect(normalizeImportedPostSlug('my-custom-alias', 42)).toBe('my-custom-alias');
  });
});
