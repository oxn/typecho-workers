import { describe, expect, it } from 'vitest';
import init from './index';
import type { PluginInitContext } from 'typecho/plugin-sdk';

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
  });

  it('leaves unrelated plugin requests untouched', async () => {
    const hooks = collectHooks();
    const handler = hooks.get('route:request')!;
    const original = { handled: false };
    await expect(handler(original, { path: '/api/admin/notes' })).resolves.toBe(original);
  });
});
