import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdminAction: vi.fn(),
  setOption: vi.fn(),
  generateSecurityToken: vi.fn(),
  registerPluginAdminPath: vi.fn(),
  computeUrls: vi.fn(() => ({ adminUrl: '/admin/' })),
}));

vi.mock('@/lib/admin-auth', () => ({
  requireAdminAction: mocks.requireAdminAction,
  isAdminActionResponse: (value: unknown) => value instanceof Response,
}));
vi.mock('@/lib/auth', () => ({
  generateSecurityToken: mocks.generateSecurityToken,
}));
vi.mock('@/lib/options', () => ({
  computeUrls: mocks.computeUrls,
}));
vi.mock('typecho/plugin-sdk', () => ({
  registerPluginAdminPath: mocks.registerPluginAdminPath,
  setOption: mocks.setOption,
}));

import init from './index';

const PLUGIN_ID = 'typecho-plugin-warm-cy';
const ADMIN_PATH = '/api/admin/theme-pin';
const OPTION_KEY = 'theme:typecho-theme-warm-cy';

function collectHooks() {
  const hooks = new Map<string, Function>();
  init({
    pluginId: PLUGIN_ID,
    HookPoints: {} as any,
    addHook: (point: string, _pluginId: string, handler: Function) => {
      hooks.set(point, handler);
    },
  });
  return hooks;
}

function adminContext(overrides: Record<string, unknown> = {}) {
  return {
    db: {
      query: {
        contents: {
          findFirst: vi.fn(async () => ({ cid: 12, type: 'post', status: 'publish' })),
        },
      },
    },
    options: {
      theme: 'typecho-theme-warm-cy',
      secret: 'test-secret',
      siteUrl: 'https://example.com',
      [OPTION_KEY]: JSON.stringify({ pinnedIds: '8,12,20', footerCustomHtml: '<strong>keep</strong>' }),
    },
    uid: 1,
    user: { uid: 1, authCode: 'auth-code', group: 'administrator' },
    pluginCtx: { activatedPlugins: new Set([PLUGIN_ID]) },
    ...overrides,
  };
}

function routeRequest(path = ADMIN_PATH, method = 'POST', body: unknown = { cid: 12, pinned: true }) {
  return new Request(`https://example.com${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
}

describe('typecho-plugin-warm-cy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminAction.mockResolvedValue(adminContext());
    mocks.generateSecurityToken.mockResolvedValue('fresh-csrf-token');
  });

  it('registers only the companion admin route and the comment metadata filter', () => {
    const hooks = collectHooks();
    expect(mocks.registerPluginAdminPath).toHaveBeenCalledWith(ADMIN_PATH);
    expect([...hooks.keys()].sort()).toEqual(['comment:list', 'route:request']);
  });

  it('rejects non-POST requests to the pin endpoint', async () => {
    const handler = collectHooks().get('route:request')!;
    const result = await handler({}, { request: routeRequest(ADMIN_PATH, 'GET'), path: ADMIN_PATH });
    expect(result.handled).toBe(true);
    expect(result.response.status).toBe(405);
    expect(mocks.requireAdminAction).not.toHaveBeenCalled();
  });

  it('does not handle unrelated or already handled routes', async () => {
    const handler = collectHooks().get('route:request')!;
    const original = { handled: false };
    expect(await handler(original, { request: routeRequest('/api/other'), path: '/api/other' })).toBe(original);
    expect(await handler({ handled: true }, { request: routeRequest(), path: ADMIN_PATH })).toEqual({ handled: true });
  });

  it('rejects unauthenticated requests without changing theme settings', async () => {
    mocks.requireAdminAction.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
    const handler = collectHooks().get('route:request')!;
    const result = await handler({}, { request: routeRequest(), path: ADMIN_PATH });
    expect(result.response.status).toBe(401);
    expect(mocks.setOption).not.toHaveBeenCalled();
  });

  it('rejects requests when Warm CY is not the active theme', async () => {
    mocks.requireAdminAction.mockResolvedValueOnce(adminContext({
      options: { theme: 'typecho-theme-warm', [OPTION_KEY]: '{}' },
    }));
    const handler = collectHooks().get('route:request')!;
    const result = await handler({}, { request: routeRequest(), path: ADMIN_PATH });
    expect(result.response.status).toBe(404);
    expect(mocks.setOption).not.toHaveBeenCalled();
  });

  it('validates published posts and preserves unrelated theme settings when pinning', async () => {
    const context = adminContext();
    mocks.requireAdminAction.mockResolvedValueOnce(context);
    const handler = collectHooks().get('route:request')!;
    const result = await handler({}, {
      request: routeRequest(ADMIN_PATH, 'POST', { cid: 12, pinned: true }),
      path: ADMIN_PATH,
    });

    expect(result.response.status).toBe(200);
    expect(await result.response.json()).toEqual({ success: true, pinned: true, pinnedIds: [12, 8, 20] });
    expect(mocks.setOption).toHaveBeenCalledWith(
      context.db,
      OPTION_KEY,
      JSON.stringify({ pinnedIds: '12,8,20', footerCustomHtml: '<strong>keep</strong>' }),
    );
  });

  it('does not expose comment management metadata to anonymous visitors', async () => {
    mocks.requireAdminAction.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
    const handler = collectHooks().get('comment:list')!;
    const payload = { comments: [], options: {} };
    const result = await handler(payload, {
      request: new Request('https://example.com/api/comments?cid=12'),
      options: { theme: 'typecho-theme-warm-cy' },
      cid: 12,
    });
    expect(result).toBe(payload);
    expect(mocks.generateSecurityToken).not.toHaveBeenCalled();
  });

  it('adds management metadata only for an authenticated administrator', async () => {
    const context = adminContext();
    mocks.requireAdminAction.mockResolvedValueOnce(context);
    const handler = collectHooks().get('comment:list')!;
    const payload = { comments: [], options: {} };
    const result = await handler(payload, {
      request: new Request('https://example.com/api/comments?cid=12'),
      options: context.options,
      cid: 12,
    });

    expect(mocks.requireAdminAction).toHaveBeenCalledWith(
      expect.any(Request),
      'administrator',
      { csrf: false },
    );
    expect(mocks.generateSecurityToken).toHaveBeenCalledWith('test-secret', 'auth-code', 1);
    expect(result.management).toEqual({
      canManage: true,
      adminUrl: '/admin/',
      contentType: 'post',
      isPinned: true,
      csrfToken: 'fresh-csrf-token',
    });
  });

  it('does not attach management metadata for another theme or an invalid content ID', async () => {
    const handler = collectHooks().get('comment:list')!;
    const payload = { comments: [] };
    expect(await handler(payload, {
      request: new Request('https://example.com/api/comments?cid=12'),
      options: { theme: 'typecho-theme-warm' },
      cid: 12,
    })).toBe(payload);
    expect(await handler(payload, {
      request: new Request('https://example.com/api/comments?cid=0'),
      options: { theme: 'typecho-theme-warm-cy' },
      cid: 0,
    })).toBe(payload);
    expect(mocks.requireAdminAction).not.toHaveBeenCalled();
  });

  it('does not attach management metadata without a valid auth code or content row', async () => {
    const handler = collectHooks().get('comment:list')!;
    const context = adminContext({ user: { uid: 1, authCode: null, group: 'administrator' } });
    mocks.requireAdminAction.mockResolvedValueOnce(context);
    const payload = { comments: [] };
    expect(await handler(payload, {
      request: new Request('https://example.com/api/comments?cid=12'),
      options: context.options,
      cid: 12,
    })).toBe(payload);
    expect(mocks.generateSecurityToken).not.toHaveBeenCalled();

    const noContent = adminContext();
    noContent.db.query.contents.findFirst = vi.fn(async () => null);
    mocks.requireAdminAction.mockResolvedValueOnce(noContent);
    expect(await handler(payload, {
      request: new Request('https://example.com/api/comments?cid=12'),
      options: noContent.options,
      cid: 12,
    })).toBe(payload);
  });
});
