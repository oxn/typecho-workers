import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginInitContext } from 'typecho/plugin-sdk';

const mocks = vi.hoisted(() => ({
  registerPluginAdminPath: vi.fn(),
  requireAdminAction: vi.fn(),
  isAdminActionResponse: vi.fn(),
}));

vi.mock('typecho/plugin-sdk', () => ({
  registerPluginAdminPath: mocks.registerPluginAdminPath,
}));

vi.mock('@/lib/admin-auth', () => ({
  requireAdminAction: mocks.requireAdminAction,
  isAdminActionResponse: mocks.isAdminActionResponse,
}));

import init, { titleToPinyinSlug } from './index';

function setup() {
  const hooks = new Map<string, (...args: any[]) => any>();
  init({
    pluginId: 'typecho-plugin-pinyin',
    addHook: ((name: string, _pluginId: string, handler: (...args: any[]) => any) => {
      hooks.set(name, handler);
    }) as PluginInitContext['addHook'],
  } as PluginInitContext);
  return hooks;
}

describe('typecho-plugin-pinyin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('converts Chinese titles into URL-safe pinyin slugs', () => {
    expect(titleToPinyinSlug('你好 Typecho')).toBe('ni-hao-typecho');
    expect(titleToPinyinSlug('  ')).toBe('');
    expect(titleToPinyinSlug('Hello, World!')).toBe('hello-world');
  });

  it('registers a dedicated admin route', () => {
    setup();
    expect(mocks.registerPluginAdminPath).toHaveBeenCalledWith('/api/admin/pinyin-slug');
  });

  it('only injects editor helpers when the permalink pattern contains {slug}', () => {
    const hooks = setup();
    const post = hooks.get('admin:writePost:bottom')!;
    const page = hooks.get('admin:writePage:bottom')!;

    expect(post('', { options: { permalinkPattern: '/archives/{cid}/' } })).toBe('');
    expect(page('', { options: { pagePattern: '/archives/{cid}/' } })).toBe('');
    expect(page('', { options: { pagePattern: '/{slug}.html' } })).toContain('重新生成拼音');
    expect(post('', { options: { permalinkPattern: '/{slug}/' }, isEdit: true })).toContain('var manual = true');
    expect(post('', { options: { permalinkPattern: '/{slug}/' }, isEdit: false })).toContain('var manual = String(slug.value || "").trim() !== ""');
    expect(post('', { options: { permalinkPattern: '/{slug}/' } })).toContain("X-CSRF-Token");
  });

  it('rejects non-POST requests without invoking the auth handler', async () => {
    const hooks = setup();
    const route = hooks.get('route:request')!;
    const result = await route(
      { handled: false },
      { path: '/api/admin/pinyin-slug', request: new Request('https://example.com/api/admin/pinyin-slug') },
    );

    expect(result.handled).toBe(true);
    expect(result.response.status).toBe(405);
    expect(mocks.requireAdminAction).not.toHaveBeenCalled();
  });

  it('uses the existing editor permission and admin-action security gate', async () => {
    const hooks = setup();
    const route = hooks.get('route:request')!;
    const request = new Request('https://example.com/api/admin/pinyin-slug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '你好' }),
    });
    const forbidden = new Response('Forbidden', { status: 403 });
    mocks.requireAdminAction.mockResolvedValue(forbidden);
    mocks.isAdminActionResponse.mockReturnValue(true);

    const result = await route({ handled: false }, { path: '/api/admin/pinyin-slug', request });

    expect(mocks.requireAdminAction).toHaveBeenCalledWith(request, 'editor');
    expect(result.handled).toBe(true);
    expect(result.response.status).toBe(403);
  });

  it('rejects malformed JSON and oversized titles after authentication', async () => {
    const hooks = setup();
    const route = hooks.get('route:request')!;
    mocks.requireAdminAction.mockResolvedValue({ user: { group: 'editor' } });
    mocks.isAdminActionResponse.mockReturnValue(false);

    const malformed = await route(
      { handled: false },
      {
        path: '/api/admin/pinyin-slug',
        request: new Request('https://example.com/api/admin/pinyin-slug', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-token' },
          body: '{',
        }),
      },
    );
    expect(malformed.response.status).toBe(400);

    const blank = await route(
      { handled: false },
      {
        path: '/api/admin/pinyin-slug',
        request: new Request('https://example.com/api/admin/pinyin-slug', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-token' },
          body: JSON.stringify({ title: '   ' }),
        }),
      },
    );
    expect(blank.response.status).toBe(400);

    const oversized = await route(
      { handled: false },
      {
        path: '/api/admin/pinyin-slug',
        request: new Request('https://example.com/api/admin/pinyin-slug', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-token' },
          body: JSON.stringify({ title: 'a'.repeat(501) }),
        }),
      },
    );
    expect(oversized.response.status).toBe(400);
  });

  it('returns a slug after the existing editor security gate succeeds', async () => {
    const hooks = setup();
    const route = hooks.get('route:request')!;
    const request = new Request('https://example.com/api/admin/pinyin-slug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-token' },
      body: JSON.stringify({ title: '你好 Typecho' }),
    });
    mocks.requireAdminAction.mockResolvedValue({ user: { group: 'editor' } });
    mocks.isAdminActionResponse.mockReturnValue(false);

    const result = await route({ handled: false }, { path: '/api/admin/pinyin-slug', request });
    const payload = await result.response.json();

    expect(mocks.requireAdminAction).toHaveBeenCalledWith(request, 'editor');
    expect(result.handled).toBe(true);
    expect(result.response.status).toBe(200);
    expect(payload).toEqual({ success: true, slug: 'ni-hao-typecho' });
  });
});
