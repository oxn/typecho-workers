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
const SETTINGS_API_PATH = '/api/admin/cy-companion-settings';
const PLUGIN_OPTION_KEY = 'plugin:typecho-plugin-warm-cy';
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
      [PLUGIN_OPTION_KEY]: JSON.stringify({ existingPluginSetting: 'keep' }),
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

  it('registers companion admin and frontend management hooks', () => {
    const hooks = collectHooks();
    expect(mocks.registerPluginAdminPath).toHaveBeenCalledWith(ADMIN_PATH);
    expect(mocks.registerPluginAdminPath).toHaveBeenCalledWith(SETTINGS_API_PATH);
    expect([...hooks.keys()].sort()).toEqual([
      'admin:footer', 'admin:header', 'admin:page',
      'archive:footer', 'comment:list', 'route:request',
    ]);
  });

  it('shows the current CY plugin version and the agreed feature switches', () => {
    const handler = collectHooks().get('admin:page')!;
    const html = handler('', {
      slug: 'cy-companion',
      csrfToken: 'test-token',
      options: { [PLUGIN_OPTION_KEY]: '{}' },
    });
    expect(html).toContain('<strong>CY服务插件</strong>');
    expect(html).toContain('版本：2026.11.10.21.03');
    expect(html).toContain('返回主题设置');
    expect(html).toContain('评论区管理按键');
    expect(html).toContain('首页搜索按键');
    expect(html).not.toContain('五种 Note 与图标样式');
  });

  it('renders the four migrated settings as native Typecho option rows and reads legacy values', () => {
    const handler = collectHooks().get('admin:page')!;
    const legacy = {
      pinnedIds: '8,12',
      linktxt01: '关于本站',
      links01: 'https://example.com/about',
      linkblank01: true,
      articleDeclarationHtml: '<strong>声明</strong>',
      footerCustomHtml: '<span>页脚</span>',
    };
    const html = handler('', {
      slug: 'cy-companion',
      csrfToken: 'test-token',
      options: { [PLUGIN_OPTION_KEY]: '{}', [OPTION_KEY]: JSON.stringify(legacy) },
    });
    expect(html.match(/class="typecho-option"/g)?.length).toBe(33);
    expect(html).toContain('id="pinnedIds-0-1" name="pinnedIds" type="text" class="text"');
    expect(html).toContain('id="typecho-option-item-pinnedIds-0"');
    expect(html).toContain('id="articleDeclarationHtml-0-34"');
    expect(html).toContain('id="typecho-option-item-articleDeclarationHtml-33"');
    expect(html).toContain('id="footerCustomHtml-0-35"');
    expect(html).toContain('id="typecho-option-item-footerCustomHtml-34"');
    expect(html).toContain('value="8,12"');
    expect(html).toContain('id="linktxt01-0-2"');
    expect(html).toContain('value="https://example.com/about"');
    expect(html).toContain('id="linkblank01-0-4" name="linkblank01" data-cy-setting="linkblank01" value="1" checked');
    expect(html).toContain('&lt;strong&gt;声明&lt;/strong&gt;');
    expect(html).toContain('&lt;span&gt;页脚&lt;/span&gt;');
    expect(html).toContain('ul.typecho-option:has(textarea[name="articleDeclarationHtml"])');
    expect(html).not.toContain('cy-feature-card"><h2>首页置顶文章 ID');
    expect(html).not.toContain('cy-feature-link-row');
  });

  it('provides a fallback CY feature-settings entry in the admin navigation', () => {
    const handler = collectHooks().get('admin:footer')!;
    const html = handler('', { options: { theme: 'typecho-theme-warm-cy' } });
    expect(html).toContain("const mainMenu = document.querySelector('.typecho-head-nav > nav > menu')");
    expect(html).toContain("link.textContent = 'CY服务插件'");
    expect(html).toContain("rehypeLink.textContent = 'Markdown Rehype'");
    expect(html).toContain("version.textContent = '主题版本：' + THEME_VERSION");
    expect(html).toContain("link.href = pluginPath");
  });

  it('keeps the search UI but never injects content-rendering code', () => {
    const hooks = collectHooks();
    expect(hooks.has('content:markdown')).toBe(false);
    expect(hooks.has('content:content')).toBe(false);
    const handler = hooks.get('archive:footer')!;
    const html = handler('', { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ showHomeSearchButton: '1' }),
    } });
    expect(html).toContain('data-warm-cy-global-search');
    expect(html).toContain('data-warm-search-dialog');
    expect(html).not.toMatch(/cy-inline-html-enhancement|CYCYINLINE|markdown-alert-icon|<style data-cy-inline/);
  });

  it('saves only retained interface settings and clears legacy processing switches', async () => {
    const defaults = adminContext();
    const context = adminContext({
      options: {
        ...defaults.options,
        [PLUGIN_OPTION_KEY]: JSON.stringify({
          existingPluginSetting: 'keep',
          htmlEnhancementEnabled: '1',
          canonicalDomainRedirectEnabled: '1',
        }),
      },
    });
    mocks.requireAdminAction.mockResolvedValueOnce(context);
    const handler = collectHooks().get('route:request')!;
    const result = await handler({}, {
      request: routeRequest(SETTINGS_API_PATH, 'POST', {
        showCommentManagementButtons: true,
        showHomeSearchButton: false,
      }),
      path: SETTINGS_API_PATH,
    });
    expect(result.response.status).toBe(200);
    const saved = JSON.parse(mocks.setOption.mock.calls[0][2] as string);
    expect(saved).toMatchObject({
      existingPluginSetting: 'keep',
      showCommentManagementButtons: '1',
      showHomeSearchButton: '0',
    });
    expect(saved).not.toHaveProperty('htmlEnhancementEnabled');
    expect(saved).not.toHaveProperty('canonicalDomainRedirectEnabled');
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
      request: routeRequest(ADMIN_PATH, 'POST', { cid: 12, pinned: true, confirmation: '确认' }),
      path: ADMIN_PATH,
    });

    expect(result.response.status).toBe(200);
    expect(await result.response.json()).toEqual({ success: true, pinned: true, pinnedIds: [12, 8, 20] });
    const savedPluginOptions = JSON.parse(mocks.setOption.mock.calls[0][2] as string);
    expect(mocks.setOption).toHaveBeenCalledWith(context.db, PLUGIN_OPTION_KEY, expect.any(String));
    expect(savedPluginOptions).toEqual({
      existingPluginSetting: 'keep',
      pinnedIds: '12,8,20',
      footerCustomHtml: '<strong>keep</strong>',
    });
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
      showManagementButtons: true,
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
    noContent.db.query.contents.findFirst = vi.fn(async () => null) as any;
    mocks.requireAdminAction.mockResolvedValueOnce(noContent);
    expect(await handler(payload, {
      request: new Request('https://example.com/api/comments?cid=12'),
      options: noContent.options,
      cid: 12,
    })).toBe(payload);
  });


});
