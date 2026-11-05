import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
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
const cyContentContext = {
  options: {
    theme: 'typecho-theme-warm-cy',
    [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementEnabled: '1' }),
  },
};

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
      'archive:footer', 'comment:list', 'content:content', 'content:markdown', 'route:request',
    ]);
  });

  it('shows the timestamped CY plugin version and defaults mobile player enhancement to off', () => {
    const handler = collectHooks().get('admin:page')!;
    const html = handler('', {
      slug: 'cy-companion',
      csrfToken: 'test-token',
      options: { [PLUGIN_OPTION_KEY]: '{}' },
    });
    expect(html).toContain(`CY 插件版本：2026.11.05.10.01`);
    expect(html).toMatch(/data-cy-setting="videoPlayerEnabled"[^>]*>/);
    expect(html).not.toMatch(/data-cy-setting="videoPlayerEnabled" checked/);
    const enabled = handler('', {
      slug: 'cy-companion',
      csrfToken: 'test-token',
      options: { [PLUGIN_OPTION_KEY]: JSON.stringify({ videoPlayerEnabled: '1' }) },
    });
    expect(enabled).toMatch(/data-cy-setting="videoPlayerEnabled" checked/);
    const legacyEnabled = handler('', {
      slug: 'cy-companion',
      csrfToken: 'test-token',
      options: { [PLUGIN_OPTION_KEY]: JSON.stringify({ mobileNativePlayerEnhancementEnabled: '1' }) },
    });
    expect(legacyEnabled).toMatch(/data-cy-setting="videoPlayerEnabled" checked/);
  });

  it('leaves standard consecutive blockquote lines unchanged', () => {
    const handler = collectHooks().get('content:markdown')!;
    const source = '> 第一行\n> 第二行\n> 第三行';
    expect(handler(source, cyContentContext)).toBe(source);
  });

  it('restores all five Markdown Alert SVG icons after the core sanitizer', () => {
    const restore = collectHooks().get('content:content')!;
    const labels = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'];
    const html = labels.map(label =>
      '<blockquote class="markdown-alert" data-alert="' + label + '">'
      + '<p class="markdown-alert-title">' + label + '</p><p>正文</p></blockquote>',
    ).join('');
    const restored = restore(html, cyContentContext);
    expect((restored.match(/class="markdown-alert-icon"/g) || []).length).toBe(5);
    expect((restored.match(/cy-markdown-alert-has-icon/g) || []).length).toBe(5);
    expect(restored).toContain('viewBox="0 0 16 16"');
    expect(restored).toContain('fill="currentColor"');
    expect(restored).toContain('M0 8a8 8 0 1 1 16 0');
    expect(restored).toContain('M8 1.5c-2.363');
    expect(restored).toContain('M0 1.75C0 .784');
    expect(restored).toContain('M6.457 1.047');
    expect(restored).toContain('M4.47.22');
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
    const output = handler(input, cyContentContext);
    expect(output).toContain('CYCYINLINEBLOCKX');
    expect(output).toContain('CYCYINLINECONTAINERX');
    expect(output).not.toMatch(/CYCYINLINE(?:BLOCK|ATTR)_/);
    expect(output.match(/CYCYINLINEBLOCKX/g)?.length).toBe(3);
    expect(output).toContain('```html\n<script>this is only an example</script>\n```');
    expect(output).not.toContain('<style>.download');
    expect(output).not.toContain('<script>window.cyInlineTest');
  });

  it('preserves a complete nested div footer across Markdown blank lines', () => {
    const hooks = collectHooks();
    const protect = hooks.get('content:markdown')!;
    const restore = hooks.get('content:content')!;
    const source = [
      '<div class="custom-footer">',
      '<style>',
      '.custom-footer { display: flex; }',
      '</style>',
      '',
      '<div class="footer-links"><p>服务商</p></div>',
      '',
      '<script>window.cyFooterTest = true;</script>',
      '<svg viewBox="0 0 16 16"><path d="M1 1h14v14H1z"></path></svg>',
      '</div>',
    ].join('\n');

    const protectedSource = protect(source, cyContentContext);
    expect(protectedSource).toContain('CYCYINLINECONTAINERX');
    expect(protectedSource).not.toContain('<div class="custom-footer">');
    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const coreSanitized = sanitizeHtml(parsed, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat([
        'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code',
        'table', 'thead', 'tbody', 'tr', 'th', 'td', 'del', 'ins',
        'details', 'summary', 'figure', 'figcaption', 'video', 'audio',
        'source', 'iframe',
      ]),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        a: ['href', 'title', 'target', 'rel'],
        blockquote: ['class', 'data-alert'],
        p: ['class'],
      },
    });
    const restored = restore(coreSanitized, cyContentContext);

    expect(restored).toContain('<div class="cy-inline-html-pending">');
    expect(restored).toContain('class="custom-footer"');
    expect(restored).toContain('class="footer-links"');
    expect(restored).toContain('CYCYINLINEBLOCKX');
    expect(restored).toContain('CYCYINLINEBLOCKX3c7374796c653e0a2e637573746f6d2d666f6f746572207b20646973706c61793a20666c65783b207d0a3c2f7374796c653eXEND');
    expect(restored).toContain('CYCYINLINEBLOCKX3c7363726970743e77696e646f772e6379466f6f74657254657374203d20747275653b3c2f7363726970743eXEND');
    expect(restored).toContain('CYCYINLINEBLOCKX3c7376672076696577426f783d22302030203136203136223e3c7061746820643d224d31203168313476313448317a223e3c2f706174683e3c2f7376673eXEND');
    expect(restored).toContain('<p>服务商</p>');
    expect(restored).not.toContain('CYCYINLINECONTAINERX');
    expect(restored).not.toContain('<p><div');
  });

  it('restores a single-line styled div after the core sanitizer strips div tags', () => {
    const hooks = collectHooks();
    const protect = hooks.get('content:markdown')!;
    const restore = hooks.get('content:content')!;
    const source = '<div class="ai-card" style="display:flex;gap:12px;padding:16px;background:#f5f5f5;border-radius:12px"><span style="color:#079C48;font-weight:bold">标题</span><a href="https://example.com" style="display:inline-flex;align-items:center">查看</a></div>';
    const protectedSource = protect(source, cyContentContext);
    expect(protectedSource).toContain('CYCYINLINECONTAINERX');
    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const coreSanitized = sanitizeHtml(parsed, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code']),
      allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, a: ['href', 'title', 'target', 'rel'] },
    });
    const restored = restore(coreSanitized, cyContentContext);
    expect(restored).toContain('class="ai-card"');
    expect(restored).toContain('display:flex');
    expect(restored).toContain('gap:12px');
    expect(restored).toContain('background:#f5f5f5');
    expect(restored).toContain('border-radius:12px');
    expect(restored).toContain('color:#079C48');
    expect(restored).toContain('href="https://example.com"');
    expect(restored).toContain('查看');
    expect(restored).not.toContain('CYCYINLINECONTAINERX');
  });

  it('preserves both download-card SVG icons as inert markers for browser hydration', () => {
    const hooks = collectHooks();
    const protect = hooks.get('content:markdown')!;
    const restore = hooks.get('content:content')!;
    const source = [
      '<!-- # 绿色提示框 -->',
      '> [!tip] **⬇️💚 资源下载**',
      '> Adobe Illustrator 2025 v29.2.1.116 x64 Multilingual 多国语言特别版 (2025/01/17)',
      '> <a href="https://pan.baidu.com/s/1otJbDx4U2bg4yL9VYw3MoA?pwd=cycy" target="_blank" rel="noopener noreferrer" style="font-weight:bold;color:var(--accent);word-break:break-all;"><span style="display:inline-flex;align-items:center;gap:4px;background:#079C48;color:#fff;border-radius:4px;padding:4px 10px;white-space:nowrap;"><svg width="18" height="18" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;"><path d="M46 580h20v200h700" fill="#fff"/><path d="M481 734L157 449" fill="#fff"/></svg><span>下载地址</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7"></path><polyline points="7 7 17 7 17 17"></polyline></svg></span></a> | 密码：cycy',
    ].join('\n');

    const protectedSource = protect(source, cyContentContext);
    expect(protectedSource).toContain('CYCYINLINEHTMLX');
    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const coreSanitized = sanitizeHtml(parsed, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat([
        'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code',
        'table', 'thead', 'tbody', 'tr', 'th', 'td', 'del', 'ins',
        'details', 'summary', 'figure', 'figcaption', 'video', 'audio',
        'source', 'iframe',
      ]),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        a: ['href', 'title', 'target', 'rel'],
        blockquote: ['class', 'data-alert'],
        p: ['class'],
      },
    });
    const restored = restore(coreSanitized, cyContentContext);

    expect(restored).toContain('cy-inline-html-pending');
    expect(restored).toContain('href="https://pan.baidu.com/s/1otJbDx4U2bg4yL9VYw3MoA?pwd=cycy"');
    expect(restored).toContain('target="_blank"');
    expect(restored).toContain('rel="noopener noreferrer"');
    expect(restored).toContain('background:#079C48');
    expect(restored).toContain('display:inline-flex');
    const svgPayloads = [...restored.matchAll(/CYCYINLINEBLOCKX([0-9a-f]+)XEND/g)]
      .map(([, payload]) => Buffer.from(payload, 'hex').toString('utf8'));
    expect(svgPayloads).toHaveLength(2);
    expect(svgPayloads[0]).toContain('viewBox="0 0 1024 1024"');
    expect(svgPayloads[0]).toContain('<path');
    expect(svgPayloads[1]).toContain('<polyline');
    expect(restored).toContain('下载地址');
    expect(restored).toContain('密码：cycy');
    expect(restored).not.toContain('CYCYINLINEHTMLX');
  });

  it('adds the inline HTML runtime with the saved opt-in state', () => {
    const handler = collectHooks().get('archive:footer')!;
    const enabled = handler('', { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementEnabled: '1', showHomeSearchButton: '0' }),
    } });
    expect(enabled).toContain('data-cy-inline-html-enhancement');
    expect(enabled).toContain('data-cy-markdown-alert-icons');
    expect(enabled).toContain('cy-markdown-alert-has-icon::before');
    expect(enabled).toContain('const enabled = true');
    expect(enabled).toContain("allowedStyle.has(property)");
    expect(enabled).toContain("key !== 'style'");

    const disabled = handler('', { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementEnabled: '0', showHomeSearchButton: '0' }),
    } });
    expect(disabled).not.toContain('data-cy-inline-html-enhancement');
  });

  it('leaves provider iframe markup untouched when the independent player is disabled', () => {
    const handler = collectHooks().get('content:content')!;
    const iframe = '<iframe src="https://www.youtube.com/embed/demo" width="560" height="315"></iframe>';
    const output = handler(iframe, { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ videoPlayerEnabled: '0' }),
    } });
    expect(output).toBe(iframe);
    expect(output).not.toContain('data-cy-video-player');
  });

  it('takes over supported provider iframes only when the independent player is enabled', () => {
    const handler = collectHooks().get('content:content')!;
    const iframe = '<iframe src="https://www.youtube.com/embed/demo" width="560" height="315"></iframe>';
    const enabled = handler(iframe, { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ videoPlayerEnabled: '1' }),
    } });
    expect(enabled).toContain('data-cy-video-player');
    expect(enabled).toContain('data-cy-video-provider="youtube"');
    expect(enabled).toContain('data-cy-video-height="315"');
    expect(enabled).toContain('data-cy-video-src="https://www.youtube.com/embed/demo"');
    expect(enabled).not.toContain('<iframe');

    const unsupported = '<iframe src="https://video.example/embed/demo"></iframe>';
    expect(handler(unsupported, { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ videoPlayerEnabled: '1' }),
    } })).toBe(unsupported);
  });

  it('injects the independent player runtime only when its own switch is enabled', () => {
    const handler = collectHooks().get('archive:footer')!;
    const enabled = handler('', { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ videoPlayerEnabled: '1', showHomeSearchButton: '0' }),
    } });
    expect(enabled).toContain('data-cy-video-player-runtime');
    expect(enabled).toContain('data-cy-video-player-styles');
    expect(enabled).toContain("document.createElement('iframe')");
    expect(enabled).not.toContain('data-cy-video-border-debug');
    expect(enabled).not.toContain('enablejsapi=1');
    expect(enabled).not.toContain('cloneNode(false)');
    expect(enabled).toContain("frame.setAttribute('referrerpolicy', 'no-referrer')");
    expect(enabled).toContain("frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-forms')");

    const disabled = handler('', { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ videoPlayerEnabled: '0', showHomeSearchButton: '0' }),
    } });
    expect(disabled).not.toContain('data-cy-video-player-runtime');
    expect(disabled).not.toContain('data-cy-video-player-styles');
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
        videoPlayerEnabled: true,
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
        videoPlayerEnabled: '1',
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

  it('hydrates preserved style blocks into the document head after the full Markdown pipeline', () => {
    const hooks = collectHooks();
    const protect = hooks.get('content:markdown')!;
    const restore = hooks.get('content:content')!;
    const source = [
      '<div class="custom-footer">',
      '<style>',
      '.custom-footer { display: flex; color: #123456; }',
      '.badge-row { gap: 12px; }',
      '.badge-dual { font-size: 11px; border-radius: 6px; background: #079C48; /* adjust `font-size` here */ }',
      '</style>',
      '<div class="badge-row"><a class="badge-dual" href="https://example.com">YouTube</a></div>',
      '</div>',
    ].join('\\n');

    const protectedSource = protect(source, cyContentContext);
    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const coreSanitized = sanitizeHtml(parsed, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat([
        'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code',
        'table', 'thead', 'tbody', 'tr', 'th', 'td', 'del', 'ins',
        'details', 'summary', 'figure', 'figcaption', 'video', 'audio',
        'source', 'iframe',
      ]),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        a: ['href', 'title', 'target', 'rel'],
        blockquote: ['class', 'data-alert'],
        p: ['class'],
      },
    });
    const restored = restore(coreSanitized, cyContentContext);
    const marker = restored.match(/CYCYINLINEBLOCKX([0-9a-f]+)XEND/)?.[0];
    expect(marker).toBeTruthy();

    const footer = hooks.get('archive:footer')!('', { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementEnabled: '1', showHomeSearchButton: '0' }),
    } });
    const runtimeStartTag = '<script data-cy-inline-html-enhancement>';
    const runtimeStart = footer.indexOf(runtimeStartTag);
    const runtimeEnd = footer.indexOf('</script>', runtimeStart + runtimeStartTag.length);
    const runtime = runtimeStart >= 0 && runtimeEnd >= 0
      ? footer.slice(runtimeStart + runtimeStartTag.length, runtimeEnd)
      : '';
    expect(runtime).toBeTruthy();

    const appendedStyles: Array<{ tagName: string; textContent: string; media?: string }> = [];
    const replacements: unknown[] = [];
    let replaceCalls = 0;
    const textNode: any = {
      nodeType: 3,
      nodeValue: marker,
      parentElement: { closest: () => null },
      parentNode: {
        replaceChild(fragment: { childNodes: unknown[] }) {
          replaceCalls += 1;
          replacements.push(...fragment.childNodes);
        },
      },
      previousElementSibling: null,
    };
    const body = { appendChild() {} };
    const document = {
      body,
      head: {
        appendChild(element: { tagName: string; textContent: string; media?: string }) {
          appendedStyles.push(element);
        },
      },
      createTreeWalker(_root: unknown, _whatToShow: number, filter: { acceptNode(node: unknown): number }) {
        let visited = false;
        return {
          currentNode: textNode,
          nextNode() {
            if (visited || filter.acceptNode(textNode) !== 1) return false;
            visited = true;
            return true;
          },
        };
      },
      createDocumentFragment() {
        const childNodes: unknown[] = [];
        return {
          childNodes,
          appendChild(node: unknown) { childNodes.push(node); return node; },
        };
      },
      createTextNode(nodeValue: string) { return { nodeType: 3, nodeValue }; },
      createElement(tagName: string) { return { tagName: tagName.toUpperCase(), textContent: '', media: '' }; },
    };
    runInNewContext(runtime!, {
      document,
      window: { addEventListener() {} },
      Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
      NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
      TextDecoder,
      Uint8Array,
    });

    expect(appendedStyles).toHaveLength(1);
    expect(appendedStyles[0].tagName).toBe('STYLE');
    expect(appendedStyles[0].textContent).toContain('.custom-footer { display: flex; color: #123456; }');
    expect(appendedStyles[0].textContent).toContain('.badge-row { gap: 12px; }');
    expect(appendedStyles[0].textContent).toContain('.badge-dual { font-size: 11px; border-radius: 6px; background: #079C48; /* adjust `font-size` here */ }');
    expect(appendedStyles[0].textContent).not.toContain('CYCYCODESEGMENT');
    expect(replaceCalls).toBeGreaterThan(0);
  });

});
