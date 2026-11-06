import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { transformGithubAlerts } from '@/lib/markdown-alerts';

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
    [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementMode: 'full' }),
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
    expect(html).toContain(`CY 插件版本：2026.11.05.10.20`);
    expect(html).toContain('data-cy-setting="htmlEnhancementMode"');
    expect(html).toContain('value="off" checked');
    expect(html).toContain('data-cy-alert-style-field="NOTE.background"');
    expect(html).toContain('data-cy-alert-style-field="CAUTION.icon"');
    expect(html).toContain('data-cy-alert-icon-visible');
    expect(html).toContain("gap: Number(root.querySelector('[data-cy-alert-icon-gap]')?.value ?? 8)");
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

    const legacyHtmlMode = handler('', {
      slug: 'cy-companion',
      csrfToken: 'test-token',
      options: { [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementEnabled: '1' }) },
    });
    expect(legacyHtmlMode).toContain('value="light" checked');
    const fullHtmlMode = handler('', {
      slug: 'cy-companion',
      csrfToken: 'test-token',
      options: { [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementMode: 'full' }) },
    });
    expect(fullHtmlMode).toContain('value="full" checked');
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

  it('keeps the five Note icons independent from the HTML enhancement mode', () => {
    const restore = collectHooks().get('content:content')!;
    const source = '<blockquote class="markdown-alert" data-alert="NOTE"><p class="markdown-alert-title">NOTE</p><p>正文</p></blockquote>';
    const output = restore(source, { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementMode: 'off' }),
    } });
    expect(output).toContain('class="markdown-alert-icon"');
    expect(output).toContain('cy-markdown-alert-has-icon');
    expect(output).not.toContain('CYCYINLINE');
  });

  it('restores Note icons after the real GitHub-alert transform and core sanitizer in off mode', () => {
    const handler = collectHooks().get('content:content')!;
    const markdown = [
      '> [!NOTE]\n> note body',
      '> [!TIP]\n> tip body',
      '> [!IMPORTANT]\n> important body',
      '> [!WARNING]\n> warning body',
      '> [!CAUTION]\n> caution body',
    ].join('\n\n');
    const parsed = transformGithubAlerts(marked.parse(markdown, { async: false }) as string);
    const sanitized = sanitizeHtml(parsed, {
      allowedTags: sanitizeHtml.defaults.allowedTags,
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        blockquote: ['class', 'data-alert'],
        p: ['class'],
      },
    });
    const restored = handler(sanitized, { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementMode: 'off' }),
    } });
    expect((restored.match(/class="markdown-alert-icon"/g) || []).length).toBe(5);
    expect(restored).toContain('data-alert="NOTE"');
    expect(restored).toContain('data-alert="CAUTION"');
    expect(restored).not.toContain('CYCYINLINE');
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

  it('preserves quoted local SVG fragment references and removes external SVG references', () => {
    const protect = collectHooks().get('content:markdown')!;
    const restore = collectHooks().get('content:content')!;
    const source = [
      '<svg viewBox="0 0 16 16">',
      '<defs><linearGradient id="safe-gradient"><stop offset="0" /></linearGradient>',
      '<clipPath id="safe-clip"><rect width="10" height="10" /></clipPath></defs>',
      "<path fill='url(\"#safe-gradient\")' clip-path=\"url('#safe-clip')\" d=\"M0 0h10v10H0z\" />",
      '<use href="#safe-gradient" />',
      '<use href="https://evil.example/external.svg#icon" />',
      '</svg>',
    ].join('\n');
    const protectedSource = protect(source, cyContentContext);
    const restored = restore(protectedSource, cyContentContext);
    const payload = restored.match(/CYCYINLINEBLOCKX([0-9a-f]+)XEND/)?.[1];
    expect(payload).toBeTruthy();
    const svg = Buffer.from(payload!, 'hex').toString('utf8');
    expect(svg).toContain("fill='url(\"#safe-gradient\")'");
    expect(svg).toContain('clip-path="url(\'#safe-clip\')"');
    expect(svg).toContain('href="#safe-gradient"');
    expect(svg).not.toContain('https://evil.example/external.svg#icon');
  });

  it('preserves a complete nested div footer across Markdown blank lines', () => {
    const hooks = collectHooks();
    const protect = hooks.get('content:markdown')!;
    const restore = hooks.get('content:content')!;
    const source = [
      '<div class="custom-footer">',
      '<style>',
      '.custom-footer { display: flex; border-left: 2px solid #123456; border-collapse: collapse; color-scheme: light; fill: #123456; font: 600 14px/1.5 sans-serif; overflow-x: auto; }',
      '</style>',
      '',
      '<div class="footer-links"><p>服务商</p></div>',
      '<div class="inline-style-test" style="border-left: 2px solid #123456; border-collapse: collapse; color-scheme: light; fill: #123456; font: 600 14px/1.5 sans-serif; overflow-x: auto;">inline</div>',
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
    expect(restored).toMatch(/style="[^"]*border-left:\s*2px solid #123456[^"]*"/);
    expect(restored).toMatch(/style="[^"]*border-collapse:\s*collapse[^"]*"/);
    expect(restored).toMatch(/style="[^"]*color-scheme:\s*light[^"]*"/);
    expect(restored).toMatch(/style="[^"]*fill:\s*#123456[^"]*"/);
    expect(restored).toMatch(/style="[^"]*font:\s*600 14px\/1.5 sans-serif[^"]*"/);
    expect(restored).toMatch(/style="[^"]*overflow-x:\s*auto[^"]*"/);
    expect(restored).toContain('CYCYINLINEBLOCKX');
    expect(restored).toContain('CYCYINLINEBLOCKX3c7374796c653e0a2e637573746f6d2d666f6f746572207b20646973706c61793a20666c65783b207d0a3c2f7374796c653eXEND');
    expect(restored).toContain('CYCYINLINEBLOCKX3c7363726970743e77696e646f772e6379466f6f74657254657374203d20747275653b3c2f7363726970743eXEND');
    expect(restored).toContain('CYCYINLINEBLOCKX3c7376672076696577426f783d22302030203136203136223e3c7061746820643d224d31203168313476313448317a223e3c2f706174683e3c2f7376673eXEND');
    expect(restored).toContain('<p>服务商</p>');
    expect(restored).not.toContain('CYCYINLINECONTAINERX');
    expect(restored).not.toContain('<p><div');
  });

  it('restores inline code nested inside a complete div container', () => {
    const hooks = collectHooks();
    const protect = hooks.get('content:markdown')!;
    const restore = hooks.get('content:content')!;
    const source = '<div class="note"><strong>测试方式：</strong>不要直接双击用 <code>file://</code> 打开。</div>';

    const protectedSource = protect(source, cyContentContext);
    expect(protectedSource).toContain('CYCYINLINECONTAINERX');
    expect(protectedSource).not.toContain('CYCYCODESEGMENT');

    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const coreSanitized = sanitizeHtml(parsed, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']),
      allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes },
    });
    const restored = restore(coreSanitized, cyContentContext);

    expect(restored).toContain('<code>file://</code>');
    expect(restored).not.toContain('CYCYCODESEGMENT');
    expect(restored).not.toContain('CYCYINLINECONTAINERX');
  });

  it('restores a single-line styled div after the core sanitizer strips div tags', () => {
    const hooks = collectHooks();
    const protect = hooks.get('content:markdown')!;
    const restore = hooks.get('content:content')!;
    const source = '<div class="ai-card" style="display:flex;gap:12px;padding:16px;background:#f5f5f5;border-radius:12px;box-sizing:border-box;font-style:italic;text-transform:uppercase;grid-template-columns:1fr 2fr"><span style="color:#079C48;font-weight:bold">标题</span><a href="https://example.com" style="display:inline-flex;align-items:center">查看</a></div>';
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
    expect(restored).toContain('box-sizing:border-box');
    expect(restored).toContain('font-style:italic');
    expect(restored).toContain('text-transform:uppercase');
    expect(restored).toContain('grid-template-columns:1fr 2fr');
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

  it('preserves arbitrary data-* and aria-* attributes inside protected containers', () => {
    const hooks = collectHooks();
    const protect = hooks.get('content:markdown')!;
    const restore = hooks.get('content:content')!;
    const source = '<div class="diag" data-diag-id="bili-static" aria-label="播放器区域"><div class="state" data-state-for="bili-static" data-state="waiting">等待加载</div><button data-action="retry" aria-pressed="false">重试</button></div>';
    const context = { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementMode: 'full' }),
    } };
    const protectedSource = protect(source, context);
    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const sanitized = sanitizeHtml(parsed, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['button']),
      allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, button: ['type'] },
    });
    const output = restore(sanitized, context);

    expect(output).toContain('data-diag-id="bili-static"');
    expect(output).toContain('data-state-for="bili-static"');
    expect(output).toContain('data-state="waiting"');
    expect(output).toContain('data-action="retry"');
    expect(output).toContain('aria-label="播放器区域"');
    expect(output).toContain('aria-pressed="false"');
  });

  it('preserves Bilibili iframe security and playback attributes through HTML restoration', () => {
    const hooks = collectHooks();
    const protect = hooks.get('content:markdown')!;
    const restore = hooks.get('content:content')!;
    const source = '<div class="video-wrap"><iframe src="https://player.bilibili.com/player.html?bvid=BV1TEST" width="100%" height="480" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" referrerpolicy="no-referrer" allow="autoplay; fullscreen; picture-in-picture" loading="lazy"></iframe></div>';
    const context = { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementMode: 'full', videoPlayerEnabled: '0' }),
    } };

    const protectedSource = protect(source, context);
    expect(protectedSource).toContain('CYCYINLINECONTAINERX');
    expect(protectedSource).not.toContain('sandbox=');

    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const sanitized = sanitizeHtml(parsed, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['iframe']),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        iframe: ['src', 'width', 'height', 'frameborder', 'allowfullscreen', 'loading',
          'referrerpolicy', 'sandbox', 'scrolling', 'border', 'framespacing', 'allow'],
      },
      allowedIframeHostnames: ['www.youtube.com', 'player.bilibili.com', 'player.vimeo.com'],
    });
    const output = restore(sanitized, context);

    expect(output).toContain('class="video-wrap"');
    expect(output).toContain('src="https://player.bilibili.com/player.html?bvid=BV1TEST"');
    expect(output).toContain('sandbox="allow-scripts allow-same-origin allow-popups allow-forms"');
    expect(output).toContain('referrerpolicy="no-referrer"');
    expect(output).toContain('allow="autoplay; fullscreen; picture-in-picture"');
    expect(output).toContain('scrolling="no"');
    expect(output).toContain('framespacing="0"');
    expect(output).toContain('loading="lazy"');
  });

  it('leaves HTML untouched by the CY enhancement when the mode is off', () => {
    const markdown = collectHooks().get('content:markdown')!;
    const source = '<div class="raw-card"><style>.raw-card{color:red}</style>原始正文</div>';
    const context = { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementMode: 'off' }),
    } };
    expect(markdown(source, context)).toBe(source);
  });

  it('routes lightweight HTML content through the preserved legacy sanitizer pipeline', () => {
    const hooks = collectHooks();
    const markdown = hooks.get('content:markdown')!;
    const content = hooks.get('content:content')!;
    const context = { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementMode: 'light' }),
    } };
    const source = '<div class="legacy-card" style="display:flex"><strong>轻量模式</strong></div>';
    const protectedSource = markdown(source, context);
    expect(protectedSource).toContain('CYCYINLINECONTAINERX');
    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const sanitized = sanitizeHtml(parsed, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['div']),
      allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, div: ['class'] },
    });
    const restored = content(sanitized, context);
    expect(restored).toContain('cy-inline-html-pending');
    expect(restored).toContain('legacy-card');
    expect(restored).toContain('轻量模式');
  });

  it('keeps legacy light mode separate from the expanded full runtime', () => {
    const handler = collectHooks().get('archive:footer')!;
    const light = handler('', { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementMode: 'light', showHomeSearchButton: '0' }),
    } });
    expect(light).toContain('data-cy-inline-html-enhancement');
    expect(light).toContain('markerPattern');
    expect(light).not.toContain('safeStylesheetText');

    const full = handler('', { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementMode: 'full', showHomeSearchButton: '0' }),
    } });
    expect(full).toContain('data-cy-inline-html-enhancement');
    expect(full).toContain('safeStylesheetText');

    const off = handler('', { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementMode: 'off', showHomeSearchButton: '0' }),
    } });
    expect(off).not.toContain('data-cy-inline-html-enhancement');
  });

  it('adds the inline HTML runtime with the saved opt-in state', () => {
    const handler = collectHooks().get('archive:footer')!;
    const enabled = handler('', { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementMode: 'full', showHomeSearchButton: '0' }),
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
    const hooks = collectHooks();
    const markdown = hooks.get('content:markdown')!;
    const handler = hooks.get('content:content')!;
    const iframe = '<iframe src="https://www.youtube.com/embed/demo" width="560" height="315"></iframe>';
    const context = { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ videoPlayerEnabled: '1' }),
    } };
    const protectedSource = markdown(iframe, context);
    expect(protectedSource).not.toContain('<iframe');
    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const sanitized = sanitizeHtml(parsed, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['iframe']),
      allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, iframe: ['src', 'width', 'height', 'frameborder', 'allowfullscreen'] },
      allowedIframeHostnames: ['www.youtube.com', 'player.bilibili.com', 'player.vimeo.com'],
    });
    const enabled = handler(sanitized, context);
    expect(enabled).toContain('data-cy-video-player');
    expect(enabled).toContain('data-cy-video-provider="youtube"');
    expect(enabled).toContain('data-cy-video-ratio="1.77778"');
    expect(enabled).toContain('data-cy-video-src="https://www.youtube.com/embed/demo"');
    expect(enabled).not.toContain('<iframe');

    const unsupported = '<iframe src="https://video.example/embed/demo"></iframe>';
    const unsupportedProtected = markdown(unsupported, context);
    expect(unsupportedProtected).toBe(unsupported);
  });

  it('only takes over trusted HTTPS provider iframe URLs', () => {
    const markdown = collectHooks().get('content:markdown')!;
    const context = { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ videoPlayerEnabled: '1' }),
    } };
    const trusted = '<iframe src="https://www.youtube.com/embed/demo"></iframe>';
    const protocolRelative = '<iframe src="//player.bilibili.com/player.html?bvid=BV1TEST"></iframe>';
    const insecure = '<iframe src="http://www.youtube.com/embed/demo"></iframe>';
    const credentialed = '<iframe src="https://user@www.youtube.com/embed/demo"></iframe>';
    const customPort = '<iframe src="https://www.youtube.com:8443/embed/demo"></iframe>';

    expect(markdown(trusted, context)).toContain('CYVIDEOIFRAMEX');
    expect(markdown(protocolRelative, context)).toContain('CYVIDEOIFRAMEX');
    expect(markdown(insecure, context)).toBe(insecure);
    expect(markdown(credentialed, context)).toBe(credentialed);
    expect(markdown(customPort, context)).toBe(customPort);
  });

  it('preserves Bilibili iframe markup before Markdown can split provider attributes', () => {
    const hooks = collectHooks();
    const markdown = hooks.get('content:markdown')!;
    const content = hooks.get('content:content')!;
    const source = '<iframe width="100%" height="480" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" referrerpolicy="no-referrer" src="//player.bilibili.com/player.html?isOutside=true&amp;aid=117041382098906&amp;bvid=BV1GGMC6YEMc&amp;cid=40613054036&amp;p=1"></iframe>';
    const context = { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ videoPlayerEnabled: '1', htmlEnhancementEnabled: '0' }),
    } };
    const protectedSource = markdown(source, context);
    expect(protectedSource).not.toContain('scrolling=');
    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const sanitized = sanitizeHtml(parsed, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['iframe']),
      allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, iframe: ['src', 'width', 'height', 'frameborder', 'allowfullscreen'] },
      allowedIframeHostnames: ['www.youtube.com', 'player.bilibili.com', 'player.vimeo.com'],
    });
    const output = content(sanitized, context);
    expect(output).toContain('data-cy-video-provider="bilibili"');
    expect(output).toContain('BV1GGMC6YEMc');
    expect(output).not.toContain('scrolling=&quot;no&quot;');
    expect(output).not.toContain('framespacing=');
    expect(output).not.toContain('sandbox=');
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
    expect(enabled).toContain("frame.loading = 'eager'");
    expect(enabled).not.toContain("frame.setAttribute('referrerpolicy', 'no-referrer')");
    expect(enabled).not.toContain("frame.setAttribute('sandbox'");

    const disabled = handler('', { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ videoPlayerEnabled: '0', showHomeSearchButton: '0' }),
    } });
    expect(disabled).not.toContain('data-cy-video-player-runtime');
    expect(disabled).not.toContain('data-cy-video-player-styles');
  });

  it('migrates the legacy HTML toggle to light mode without dropping existing plugin settings', async () => {
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
        htmlEnhancementMode: 'light',
        videoPlayerEnabled: '1',
      }),
    );
  });

  it('renders independent per-type Note colors and icon controls', () => {
    const handler = collectHooks().get('archive:footer')!;
    const html = handler('', { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({
        showHomeSearchButton: '0',
        markdownAlertStyleSettings: {
          types: { NOTE: { background: '#123456', border: '#234567', title: '#345678', text: '#456789', icon: '#56789a', radius: 14, borderStyle: 'dashed' } },
          icon: { visible: false, size: 24, gap: 5 },
        },
      }),
    } });
    expect(html).toContain('background:#123456!important');
    expect(html).toContain('border-color:#234567!important');
    expect(html).toContain('border-style:dashed!important');
    expect(html).toContain('border-radius:14px!important');
    expect(html).toContain('color:#345678!important');
    expect(html).toContain('> :not(.markdown-alert-title){color:#456789!important}');
    expect(html).toContain('color:#56789a!important');
    expect(html).toContain('width:24px!important');
    expect(html).toContain('margin-right:5px!important');
    expect(html).toContain('display:none!important');
    expect(html).toContain('.warm-prose .markdown-alert[data-alert="NOTE"] .markdown-alert-title');
    expect(html).toContain('.warm-note__content .markdown-alert[data-alert="NOTE"] .markdown-alert-title');
  });

  it('validates and stores Note style settings without dropping other plugin options', async () => {
    const context = adminContext();
    mocks.requireAdminAction.mockResolvedValueOnce(context);
    const handler = collectHooks().get('route:request')!;
    const result = await handler({}, {
      request: routeRequest(SETTINGS_API_PATH, 'POST', {
        showCommentManagementButtons: true,
        showHomeSearchButton: false,
        htmlEnhancementMode: 'full',
        videoPlayerEnabled: false,
        markdownAlertStyleSettings: {
          types: {
            NOTE: { background: 'red', border: '#123456', title: '#234567', text: '#345678', icon: '#456789', radius: 99, borderStyle: 'invalid' },
          },
          icon: { visible: false, size: 99, gap: -2 },
        },
      }),
      path: SETTINGS_API_PATH,
    });
    expect(result.response.status).toBe(200);
    const saved = JSON.parse(mocks.setOption.mock.calls[0][2]);
    expect(saved.existingPluginSetting).toBe('keep');
    expect(saved.htmlEnhancementMode).toBe('full');
    expect(saved.markdownAlertStyleSettings.types.NOTE).toEqual({
      background: '#eef2ff',
      border: '#123456',
      title: '#234567',
      text: '#345678',
      icon: '#456789',
      radius: 32,
      borderStyle: 'solid',
    });
    expect(saved.markdownAlertStyleSettings.icon).toEqual({ visible: false, size: 32, gap: 0 });
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
      '.custom-footer { display: flex; color: #123456; border-left: 2px solid #123456; border-collapse: collapse; color-scheme: light; fill: #123456; font: 600 14px/1.5 sans-serif; overflow-x: auto; }',
      'body { background-color: #ffffff; }',
      'body.cy-test-root { color: #123456; }',
      'body > .cy-test-child { display: block; }',
      'html body .cy-test-nested-root { color: #abcdef; }',
      'html > body > .cy-test-deep-child { display: block; }',
      ':root { --cy-test-color: #123456; }',
      '* { box-sizing: border-box; }',
      '.badge-row { gap: 12px; }',
      '.gradient-fill { background-image: url(\"#safe-gradient\"); }',
      '.badge-dual { font-size: 11px; border-radius: 6px; background: #079C48; /* adjust `font-size` here */ }',
      '.unsafe { color: expression(alert(1)); background-image: url(https://evil.example/pixel); behavior: url(x); }',
      '.escaped-url { background-image: url(\\68 ttps://evil.example/pixel); }',
      '.comment-url { background-image: url(/*comment*/https://evil.example/pixel); }',
      '.image-set-url { background-image: image-set("https://evil.example/pixel.png" 1x); }',
      '.webkit-image-set-url { background-image: -webkit-image-set("https://evil.example/pixel.png" 1x); }',
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
      [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementMode: 'full', showHomeSearchButton: '0' }),
    } });
    const runtimeStartTag = '<script data-cy-inline-html-enhancement>';
    const runtimeStart = footer.indexOf(runtimeStartTag);
    const runtimeEnd = footer.indexOf('</script>', runtimeStart + runtimeStartTag.length);
    const runtime = runtimeStart >= 0 && runtimeEnd >= 0
      ? footer.slice(runtimeStart + runtimeStartTag.length, runtimeEnd)
      : '';
    expect(runtime).toBeTruthy();

    const scopeRoot: any = {
      attributes: {} as Record<string, string>,
      classes: new Set<string>(),
      classList: { add(name: string) { scopeRoot.classes.add(name); } },
      getAttribute(name: string) { return scopeRoot.attributes[name] || null; },
      setAttribute(name: string, value: string) { scopeRoot.attributes[name] = value; },
    };
    const appendedStyles: Array<{ tagName: string; textContent: string; media?: string }> = [];
    const replacements: unknown[] = [];
    const attributeWrites: Array<[string, string]> = [];
    let replaceCalls = 0;
    const attributeMarker = 'CYCYINLINEATTRXmetaX' + Buffer.from(JSON.stringify({ name: 'viewport' }), 'utf8').toString('hex') + 'XEND';
    const textNode: any = {
      nodeType: 3,
      nodeValue: marker + attributeMarker,
      parentElement: { tagName: 'DIV', closest(selector: string) { return selector === 'article' ? scopeRoot : null; }, setAttribute(name: string, value: string) { attributeWrites.push([name, value]); } },
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
      querySelectorAll() { return []; },
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
    class MockCSSStyleSheet {
      cssRules: any[] = [];
      replaceSync(cssText: string) {
        const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
        let match: RegExpExecArray | null;
        while ((match = rulePattern.exec(cssText))) {
          const selectorText = match[1].trim();
          const declarations = match[2].split(';').map(part => part.trim()).filter(Boolean);
          const values = new Map<string, { value: string; priority: string }>();
          for (const declaration of declarations) {
            const split = declaration.indexOf(':');
            if (split < 1) continue;
            const property = declaration.slice(0, split).trim().toLowerCase();
            let value = declaration.slice(split + 1).trim();
            const important = /\s*!important\s*$/i.test(value);
            if (important) value = value.replace(/\s*!important\s*$/i, '');
            values.set(property, { value, priority: important ? 'important' : '' });
          }
          const names = Array.from(values.keys());
          const style: any = {
            length: names.length,
            item(index: number) { return names[index]; },
            getPropertyValue(property: string) { return values.get(property)?.value || ''; },
            getPropertyPriority(property: string) { return values.get(property)?.priority || ''; },
          };
          this.cssRules.push({ type: 1, selectorText, style });
        }
      }
    }
    runInNewContext(runtime!, {
      CSSStyleSheet: MockCSSStyleSheet,
      document,
      window: { addEventListener() {} },
      Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
      NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
      TextDecoder,
      Uint8Array,
    });

    expect(appendedStyles).toHaveLength(1);
    expect(appendedStyles[0].tagName).toBe('STYLE');
    const scopeSelector = appendedStyles[0].textContent.match(/^(\.cy-inline-html-scope-[a-z0-9-]+)/)?.[1];
    expect(scopeSelector).toBeTruthy();
    expect(appendedStyles[0].textContent).toContain(`${scopeSelector} .custom-footer{display:flex;color:#123456;`);
    expect(appendedStyles[0].textContent).toContain(`${scopeSelector} .custom-footer{display:flex;color:#123456;border-left:2px solid #123456;border-collapse:collapse;color-scheme:light;fill:#123456;font:600 14px/1.5 sans-serif;overflow-x:auto}`);
    expect(appendedStyles[0].textContent).toContain(`${scopeSelector}{background-color:#ffffff}`);
    expect(appendedStyles[0].textContent).toContain(`${scopeSelector}.cy-test-root{color:#123456}`);
    expect(appendedStyles[0].textContent).toContain(`${scopeSelector} > .cy-test-child{display:block}`);
    expect(appendedStyles[0].textContent).toContain(`${scopeSelector} .cy-test-nested-root{color:#abcdef}`);
    expect(appendedStyles[0].textContent).toContain(`${scopeSelector} > .cy-test-deep-child{display:block}`);
    expect(appendedStyles[0].textContent).toContain(`${scopeSelector}{--cy-test-color:#123456}`);
    expect(appendedStyles[0].textContent).toContain(`${scopeSelector},${scopeSelector} *{box-sizing:border-box}`);
    expect(scopeRoot.classes.has(scopeSelector.slice(1))).toBe(true);
    expect(appendedStyles[0].textContent).toContain(`${scopeSelector} .badge-row{gap:12px}`);
    expect(appendedStyles[0].textContent).toContain(`${scopeSelector} .gradient-fill{background-image:url(#safe-gradient)`);
    expect(appendedStyles[0].textContent).toContain(`${scopeSelector} .badge-dual{font-size:11px;border-radius:6px;background:#079C48}`);
    expect(appendedStyles[0].textContent).not.toContain('expression');
    expect(appendedStyles[0].textContent).not.toContain('.escaped-url');
    expect(appendedStyles[0].textContent).not.toContain('.comment-url');
    expect(appendedStyles[0].textContent).not.toContain('.image-set-url');
    expect(appendedStyles[0].textContent).not.toContain('.webkit-image-set-url');
    const cssUrls = Array.from(
      appendedStyles[0].textContent.matchAll(/url\(\s*(?:("')(.*?)\1|([^)]*))\s*\)/gi),
      match => (match[2] ?? match[3] ?? '').trim(),
    );
    const normalizedCssUrls = cssUrls.map(value => value.replace(/^["']|["']$/g, ''));
    expect(normalizedCssUrls).toEqual(['#safe-gradient']);
    expect(appendedStyles[0].textContent).not.toContain('CYCYCODESEGMENT');
    expect(replaceCalls).toBeGreaterThan(0);
    expect(attributeWrites).toEqual([]);
    expect(replacements.filter((node: any) => node && typeof node.nodeValue === 'string').map((node: any) => node.nodeValue).join('')).not.toMatch(/CYCYINLINE(?:BLOCK|ATTR)/);
  });


  it('rebuilds SVG nodes from an allowlist and keeps only local fragment references', () => {
    const hooks = collectHooks();
    const footer = hooks.get('archive:footer')!('', { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementMode: 'full', showHomeSearchButton: '0' }),
    } });
    const runtimeStartTag = '<script data-cy-inline-html-enhancement>';
    const runtimeStart = footer.indexOf(runtimeStartTag);
    const runtimeEnd = footer.indexOf('</script>', runtimeStart + runtimeStartTag.length);
    const runtime = runtimeStart >= 0 && runtimeEnd >= 0
      ? footer.slice(runtimeStart + runtimeStartTag.length, runtimeEnd)
      : '';
    expect(runtime).toBeTruthy();

    const svgSource = '<svg viewBox="0 0 16 16" onload="alert(1)">'
      + '<use href="#safe-symbol"></use>'
      + '<use href="https://evil.example/external.svg#icon"></use>'
      + '<path fill=\'url("#safe-gradient")\' d="M0 0h10v10H0z"></path>'
      + '<path fill="url(https://evil.example/paint.svg#gradient)" d="M1 1h8v8H1z"></path>'
      + '<path fill="url(\\23 safe-gradient)" d="M2 2h6v6H2z"></path>'
      + '<path fill="url(/*comment*/#safe-gradient)" d="M3 3h4v4H3z"></path>'
      + '</svg>';
    const marker = 'CYCYINLINEBLOCKX' + Buffer.from(svgSource, 'utf8').toString('hex') + 'XEND';

    const makeNode = (localName: string, attributes: Record<string, string> = {}, childNodes: any[] = []) => ({
      nodeType: 1,
      localName,
      attributes: Object.entries(attributes).map(([name, value]) => ({ name, value })),
      childNodes,
    });
    const parsedRoot = makeNode('svg', { viewBox: '0 0 16 16', onload: 'alert(1)' }, [
      makeNode('use', { href: '#safe-symbol' }),
      makeNode('use', { href: 'https://evil.example/external.svg#icon' }),
      makeNode('path', { fill: 'url("#safe-gradient")', d: 'M0 0h10v10H0z' }),
      makeNode('path', { fill: 'url(https://evil.example/paint.svg#gradient)', d: 'M1 1h8v8H1z' }),
      makeNode('path', { fill: 'url(\\23 safe-gradient)', d: 'M2 2h6v6H2z' }),
      makeNode('path', { fill: 'url(/*comment*/#safe-gradient)', d: 'M3 3h4v4H3z' }),
    ]);
    let parsedSource = '';
    class MockDOMParser {
      parseFromString(source: string) {
        parsedSource = source;
        return { querySelector: () => null, documentElement: parsedRoot };
      }
    }

    const inserted: any[] = [];
    const textNode: any = {
      nodeType: 3,
      nodeValue: marker,
      parentElement: { closest: () => null },
      parentNode: {
        replaceChild(fragment: { childNodes: unknown[] }) {
          inserted.push(...fragment.childNodes);
        },
      },
      previousElementSibling: null,
    };
    const createSvgElement = (localName: string) => ({
      nodeType: 1,
      localName,
      attributes: [] as Array<{ name: string; value: string }>,
      childNodes: [] as any[],
      setAttribute(name: string, value: string) { this.attributes.push({ name, value }); },
      setAttributeNS(_namespace: string, name: string, value: string) { this.attributes.push({ name, value }); },
      appendChild(child: any) { this.childNodes.push(child); return child; },
    });
    const document = {
      body: { appendChild() {} },
      head: { appendChild() {} },
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
        const childNodes: any[] = [];
        return { childNodes, appendChild(node: any) { childNodes.push(node); return node; } };
      },
      createTextNode(nodeValue: string) { return { nodeType: 3, nodeValue }; },
      createElementNS(_namespace: string, localName: string) { return createSvgElement(localName); },
      createElement(tagName: string) { return { tagName: tagName.toUpperCase(), textContent: '', setAttribute() {} }; },
    };

    runInNewContext(runtime, {
      CSSStyleSheet: undefined,
      DOMParser: MockDOMParser,
      document,
      window: { addEventListener() {} },
      Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
      NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
      TextDecoder,
      Uint8Array,
    });

    expect(parsedSource).toBe(svgSource);
    expect(inserted).toHaveLength(1);
    const svg = inserted[0];
    expect(svg.localName).toBe('svg');
    expect(svg.attributes).toContainEqual({ name: 'viewBox', value: '0 0 16 16' });
    expect(svg.attributes.some((attribute: { name: string }) => attribute.name.toLowerCase() === 'onload')).toBe(false);

    const uses = svg.childNodes.filter((node: any) => node.localName === 'use');
    expect(uses.map((node: any) => node.attributes.find((attribute: any) => attribute.name === 'href')?.value))
      .toEqual(['#safe-symbol', undefined]);

    const paths = svg.childNodes.filter((node: any) => node.localName === 'path');
    expect(paths.map((node: any) => node.attributes.find((attribute: any) => attribute.name === 'fill')?.value))
      .toEqual(['url("#safe-gradient")', undefined, undefined, undefined]);
  });
});
