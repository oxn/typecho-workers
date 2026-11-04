import { beforeEach, describe, expect, it, vi } from 'vitest';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

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

  it('registers companion admin, content and frontend hooks', () => {
    const hooks = collectHooks();
    expect(mocks.registerPluginAdminPath).toHaveBeenCalledWith(ADMIN_PATH);
    expect(mocks.registerPluginAdminPath).toHaveBeenCalledWith(SETTINGS_API_PATH);
    expect([...hooks.keys()].sort()).toEqual([
      'admin:footer', 'admin:header', 'admin:page',
      'archive:footer', 'comment:list', 'content:markdown', 'route:request',
    ]);
  });

  it('shows the timestamped CY plugin version in its settings page', () => {
    const handler = collectHooks().get('admin:page')!;
    const html = handler('', {
      slug: 'cy-companion',
      csrfToken: 'test-token',
      options: { [PLUGIN_OPTION_KEY]: '{}' },
    });
    expect(html).toContain('CY 插件版本：2026.11.04.18.33');
  });

  it('protects inline style/script/SVG and style attributes while leaving code examples intact', () => {
    const handler = collectHooks().get('content:markdown')!;
    const input = [
      '<style>.download { color: green; }</style>',
      '<script>window.cyInlineTest = true;</script>',
      '<div class="download-card" style="color: red">content</div>',
      '<svg viewBox="0 0 24 24"><path d="M2 2h20v20H2z"></path></svg>',
      '```html',
      '<script>this is only an example</script>',
      '```',
    ].join('\n');
    const output = handler(input);
    expect(output).toContain('CYCYINLINEBLOCKX');
    expect(output).toContain('CYCYINLINEATTRXdivX');
    expect(output).not.toMatch(/CYCYINLINE(?:BLOCK|ATTR)_/);
    expect(output.match(/CYCYINLINEBLOCKX/g)?.length).toBe(3);
    expect(output).toContain('```html\n<script>this is only an example</script>\n```');
    expect(output).not.toContain('<style>.download');
    expect(output).not.toContain('<script>window.cyInlineTest');
  });

  it('keeps real download-card HTML markers through Markdown parsing and sanitization', () => {
    const handler = collectHooks().get('content:markdown')!;
    const source = [
      '> <a href="https://example.com/download" target="_blank" rel="noopener noreferrer" style="font-weight:bold;color:var(--accent);word-break:break-all;">',
      '<span style="display:inline-flex;align-items:center;gap:4px;background:#079C48;color:#fff;border-radius:4px;padding:4px 10px;">',
      '<svg width="24" height="24" viewBox="0 0 24 24"><defs><linearGradient id="download-gradient"><stop offset="0" stop-color="#fff"/></linearGradient></defs><g opacity="1" transform="translate(1 1)"><path d="M2 2h20v20H2z" fill="url(#download-gradient)"/></g></svg>',
      '<span>下载</span>',
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="M7 17 17 7"/><polyline points="7 7 17 7 17 17"/></svg>',
      '</span></a> | **密码📋：`cycy`**',
    ].join('');
    const protectedSource = handler(source);
    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const sanitized = sanitizeHtml(parsed, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'del', 'ins', 'details', 'summary', 'figure', 'figcaption', 'video', 'audio', 'source', 'iframe']),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        a: ['href', 'title', 'target', 'rel'],
        span: ['class'],
        blockquote: ['class', 'data-alert'],
      },
    });

    expect(sanitized).toContain('<blockquote>');
    expect(sanitized).toContain('href="https://example.com/download"');
    expect(sanitized).toContain('target="_blank"');
    expect(sanitized).toContain('rel="noopener noreferrer"');
    expect(sanitized).toContain('CYCYINLINEATTRXaX');
    expect(sanitized).toContain('CYCYINLINEATTRXspanX');
    expect(sanitized).toContain('CYCYINLINEBLOCKX');
    expect(sanitized).not.toContain('background:#079C48');

    const block = sanitized.match(/CYCYINLINEBLOCKX([0-9a-f]+)XEND/);
    expect(block).not.toBeNull();
    const svg = new TextDecoder().decode(Uint8Array.from(
      block![1].match(/.{2}/g)!.map(byte => parseInt(byte, 16)),
    ));
    expect(svg).toContain('<linearGradient');
    expect(svg).toContain('<polyline');
    expect(svg).toContain('url(#download-gradient)');
  });

  it('adds the inline HTML runtime with the saved opt-in state', () => {
    const handler = collectHooks().get('archive:footer')!;
    const enabled = handler('', { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementEnabled: '1', showHomeSearchButton: '0' }),
    } });
    expect(enabled).toContain('data-cy-inline-html-enhancement');
    expect(enabled).toContain('const enabled = true');
    expect(enabled).toContain("allowedStyle.has(property)");
    expect(enabled).toContain("key !== 'style'");

    const disabled = handler('', { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementEnabled: '0', showHomeSearchButton: '0' }),
    } });
    expect(disabled).toContain('const enabled = false');
  });

  it('saves the HTML enhancement toggle without dropping existing plugin settings', async () => {
    const context = adminContext();
    mocks.requireAdminAction.mockResolvedValueOnce(context);
    const handler = collectHooks().get('route:request')!;
    const result = await handler({}, {
      request: routeRequest(SETTINGS_API_PATH, 'POST', {
        showCommentManagementButtons: true,
        showHomeSearchButton: false,
        htmlEnhancementEnabled: true,
      }),
      path: SETTINGS_API_PATH,
    });
    expect(result.response.status).toBe(200);
    expect(await result.response.json()).toEqual({ success: true });
    expect(mocks.setOption).toHaveBeenCalledWith(
      context.db,
      PLUGIN_OPTION_KEY,
      JSON.stringify({
        existingPluginSetting: 'keep',
        showCommentManagementButtons: '1',
        showHomeSearchButton: '0',
        htmlEnhancementEnabled: '1',
      }),
    );
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
