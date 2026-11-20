import { describe, expect, it } from 'vitest';
import init from './index';
import type { PluginInitContext } from 'typecho/plugin-sdk';
import { normalizeWordPressSource } from './service';

function collectHooks() {
  const hooks = new Map<string, Function>();
  init({
    pluginId: 'typecho-plugin-wordpress-import',
    HookPoints: {} as any,
    addHook: ((point: string, _pluginId: string, handler: Function) => {
      hooks.set(point, handler);
    }) as any,
  } as PluginInitContext);
  return hooks;
}

describe('WordPress import plugin', () => {
  it('registers the admin API, page renderer, and navigation hook', () => {
    const hooks = collectHooks();
    expect([...hooks.keys()]).toEqual(['route:request', 'admin:page', 'admin:footer']);
  });

  it('renders its admin page only for the matching plugin slug', () => {
    const hooks = collectHooks();
    const render = hooks.get('admin:page')!;
    expect(render('original', { slug: 'other' })).toBe('original');
    const html = render('', { slug: 'wordpress-import', csrfToken: 'csrf-value' });
    expect(html).toContain('wordpress-import-file');
    expect(html).toContain('/api/admin/wordpress-import');
    expect(html).toContain('csrf-value');
    expect(html).toContain('确认导入');
    expect(html).toContain('function splitWxr');
    expect(html).toContain('MAX_PART_BYTES=24*1024*1024');
    expect(html).toContain("childText(item,'post_parent')");
    expect(html).toContain("key!=='_thumbnail_id'");
    expect(html).toContain('crypto.subtle.digest');
    expect(html).toContain('重新选择同一原始文件并重新分析');
  });

  it('leaves unrelated plugin requests untouched', async () => {
    const hooks = collectHooks();
    const handler = hooks.get('route:request')!;
    const original = { handled: false };
    await expect(handler(original, { path: '/api/admin/notes' })).resolves.toBe(original);
  });
});


describe('WordPress source identity', () => {
  it('normalizes host and removes query/hash while preserving subdirectory paths', () => {
    expect(normalizeWordPressSource('HTTPS://Example.COM/blog/?export=1#top'))
      .toBe('https://example.com/blog');
  });

  it('rejects exports without a valid source URL', () => {
    expect(() => normalizeWordPressSource('')).toThrow('缺少 WordPress 站点地址');
    expect(() => normalizeWordPressSource('ftp://example.com')).toThrow('站点地址无效');
  });
});
