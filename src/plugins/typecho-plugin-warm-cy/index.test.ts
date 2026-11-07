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
  getDb: vi.fn(() => ({ binding: 'test-db' })),
  getOption: vi.fn(async () => JSON.stringify({ htmlEnhancementEnabled: '1' })),
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
vi.mock('typecho/db', async () => {
  const actual = await vi.importActual<typeof import('typecho/db')>('typecho/db');
  return { ...actual, getDb: mocks.getDb };
});
vi.mock('cloudflare:workers', () => ({ env: { DB: { test: true } } }));
vi.mock('typecho/plugin-sdk', () => ({
  getOption: mocks.getOption,
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
    mocks.getOption.mockResolvedValue(JSON.stringify({ htmlEnhancementEnabled: '1' }));
    mocks.requireAdminAction.mockResolvedValue(adminContext());
    mocks.generateSecurityToken.mockResolvedValue('fresh-csrf-token');
  });

  it('registers companion admin, content and frontend hooks', () => {
    const hooks = collectHooks();
    expect(mocks.registerPluginAdminPath).toHaveBeenCalledWith(ADMIN_PATH);
    expect(mocks.registerPluginAdminPath).toHaveBeenCalledWith(SETTINGS_API_PATH);
    expect([...hooks.keys()].sort()).toEqual([
      'admin:footer', 'admin:header', 'admin:page',
      'archive:footer', 'archive:header', 'comment:list', 'content:content', 'content:markdown', 'route:request',
    ]);
  });

  it('emits five-Note presentation CSS in the document head before the body is painted', () => {
    const hooks = collectHooks();
    const renderHead = hooks.get('archive:header')!;
    const options = {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({
        markdownAlertStyleSettings: {
          enabled: true,
          types: {
            NOTE: { background: '#123456' },
            TIP: { background: '#234567' },
            IMPORTANT: { background: '#345678' },
            WARNING: { background: '#456789' },
            CAUTION: { background: '#56789a' },
          },
          icon: { visible: true, size: 22, gap: 4 },
        },
      }),
    };
    const html = renderHead('<meta charset="utf-8">', { options });
    expect(html).toContain('<style data-cy-markdown-alert-icons>');
    for (const color of ['#123456', '#234567', '#345678', '#456789', '#56789a']) {
      expect(html).toContain('background:' + color + '!important');
    }
    expect(html).toContain('width:22px!important');
    expect(html).toContain('margin-right:4px!important');
    expect(renderHead('<head>', { options: { ...options, theme: 'another-theme' } })).toBe('<head>');
    expect(hooks.get('archive:footer')!('', { options })).not.toContain('data-cy-markdown-alert-icons');
  });

  it('shows the current CY plugin version and the agreed feature switches', () => {
    const handler = collectHooks().get('admin:page')!;
    const html = handler('', {
      slug: 'cy-companion',
      csrfToken: 'test-token',
      options: { [PLUGIN_OPTION_KEY]: '{}' },
    });
    expect(html).toContain('CY 插件版本：2026.11.07.23.01');
    expect(html).toContain('评论区管理按键');
    expect(html).toContain('首页搜索按键');
    expect(html).toContain('正文 HTML / CSS / JavaScript 增强');
    expect(html).toContain('视频 iframe 增强（仅处理视频地址）');
    expect(html).toContain('data-cy-setting="iframeVideoEnhancementEnabled"');
    expect(html).toContain('data-cy-setting="iframeVideoAllowedHostnames"');
    expect(html).toContain('白名单留空表示拒绝所有 iframe 视频域名');
    expect(html).toContain('www.youtube.com');
    expect(html).toContain('www.youtube-nocookie.com');
    expect(html).toContain('player.bilibili.com');
    expect(html).toContain('player.vimeo.com');
    expect(html).toContain('访问备用域名时自动跳转到主域名');
    expect(html).toContain('data-cy-setting="canonicalDomainRedirectEnabled"');
  });


  it('keeps a deliberately empty iframe allowlist empty in the admin UI', () => {
    const handler = collectHooks().get('admin:page')!;
    const html = handler('', {
      slug: 'cy-companion',
      csrfToken: 'test-token',
      options: { [PLUGIN_OPTION_KEY]: JSON.stringify({ iframeVideoAllowedHostnames: '' }) },
    });
    expect(html).toContain('白名单留空表示拒绝所有 iframe 视频域名');
    expect(html).toContain('data-cy-setting="iframeVideoAllowedHostnames" rows="4"></textarea>');
    expect(html).not.toContain('<textarea id="cy-iframe-video-hostnames" data-cy-setting="iframeVideoAllowedHostnames" rows="4">www.youtube.com');
  });

  it('provides a fallback CY feature-settings entry in the admin navigation', () => {
    const handler = collectHooks().get('admin:footer')!;
    const html = handler('', { options: { theme: 'typecho-theme-warm-cy' } });
    expect(html).toContain("const mainMenu = document.querySelector('.typecho-head-nav > nav > menu')");
    expect(html).toContain("link.textContent = 'CY 功能显示'");
    expect(html).toContain("link.href = pluginPath");
  });

  it('reads the saved HTML switch from the host options store', async () => {
    const handler = collectHooks().get('content:markdown')!;
    const source = '<div data-state-for="youtube-dynamic">状态</div>';
    const protectedSource = await handler(source);
    expect(protectedSource).toContain('CYCYINLINECONTAINERX');
    expect(mocks.getDb).toHaveBeenCalled();
    expect(mocks.getOption).toHaveBeenCalledWith(expect.anything(), PLUGIN_OPTION_KEY);
  });

  it('skips the private options read for plain Markdown without HTML tags', async () => {
    const handler = collectHooks().get('content:markdown')!;
    const source = 'Plain Markdown **text** with a [link](https://example.com).';
    expect(await handler(source)).toBe(source);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.getOption).not.toHaveBeenCalled();
  });

  it('escapes marker-shaped plain text before the Markdown fast path can bypass protection', async () => {
    const protect = collectHooks().get('content:markdown')!;
    const forgedMarker = 'CYCYINLINEBLOCKX' + Buffer.from('<script>window.compromised = true;</script>').toString('hex') + 'XEND';
    const protectedContent = await protect(forgedMarker);
    expect(protectedContent).toContain('CYCY\u200bINLINEBLOCKX');
    expect(protectedContent).not.toBe(forgedMarker);
    expect(mocks.getOption).toHaveBeenCalledWith(expect.anything(), PLUGIN_OPTION_KEY);
  });

  it('leaves standard consecutive blockquote lines unchanged', async () => {
    const handler = collectHooks().get('content:markdown')!;
    const source = '> 第一行\n> 第二行\n> 第三行';
    expect(await handler(source)).toBe(source);
  });

  it('restores all five Markdown Alert SVG icons after the core sanitizer', async () => {
    const restore = collectHooks().get('content:content')!;
    const labels = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'];
    const html = labels.map(label =>
      '<blockquote class="markdown-alert" data-alert="' + label + '">'
      + '<p class="markdown-alert-title">' + label + '</p><p>正文</p></blockquote>',
    ).join('');
    const restored = await restore(html);
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

  it('protects inline style/script/SVG and style attributes while leaving code examples intact', async () => {
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
    const output = await handler(input);
    expect(output).toContain('CYCYINLINEBLOCKX');
    expect(output).toContain('CYCYINLINECONTAINERX');
    expect(output).not.toMatch(/CYCYINLINE(?:BLOCK|ATTR)_/);
    expect(output.match(/CYCYINLINEBLOCKX/g)?.length).toBe(3);
    expect(output).toContain('```html\n<script>this is only an example</script>\n```');
    expect(output).not.toContain('<style>.download');
    expect(output).not.toContain('<script>window.cyInlineTest');
  });

  it('preserves a complete nested div footer across Markdown blank lines', async () => {
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

    const protectedSource = await protect(source);
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
    const restored = await restore(coreSanitized);

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

  it('preserves semantic HTML and form attributes through the full sanitizer pipeline', async () => {
    const hooks = collectHooks();
    const protect = hooks.get('content:markdown')!;
    const restore = hooks.get('content:content')!;
    const source = [
      '<div class="semantic-fixture">',
      '<time datetime="2026-11-07">日期</time>',
      '<details open><summary>展开内容</summary><mark>重点</mark><abbr title="说明">缩写</abbr><u>下划线</u><sub>下标</sub><sup>上标</sup></details>',
      '<form action="/submit" method="post"><fieldset><legend>选项</legend>',
      '<label for="choice">同意</label><input id="choice" name="choice" type="checkbox" checked required>',
      '<select name="format"><option value="a" selected>A</option><option value="b">B</option></select>',
      '<textarea name="message" rows="4" cols="20" placeholder="输入"></textarea>',
      '<output name="result">完成</output><progress value="3" max="10"></progress><meter min="0" max="10" value="7"></meter>',
      '<form action="javascript:alert(1)"><button type="submit">危险表单</button></form>',
      '</fieldset></form>',
      '</div>',
    ].join('');
    const protectedSource = await protect(source);
    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const coreSanitized = sanitizeHtml(parsed);
    const restored = await restore(coreSanitized);

    for (const tag of ['time', 'details', 'summary', 'mark', 'abbr', 'u', 'sub', 'sup', 'form', 'fieldset', 'legend', 'input', 'select', 'option', 'textarea', 'output', 'progress', 'meter']) {
      expect(restored).toContain('<' + tag);
    }
    expect(restored).not.toContain('javascript:alert(1)');
    for (const attribute of ['datetime="2026-11-07"', 'title="说明"', 'action="/submit"', 'method="post"', 'for="choice"', 'rows="4"', 'cols="20"', 'max="10"', 'min="0"']) {
      expect(restored).toContain(attribute);
    }
    expect(restored).toContain('<details open>');
    expect(restored).toContain('checked');
    expect(restored).toContain('required');
    expect(restored).toContain('selected');
  });

  it('restores a single-line styled div after the core sanitizer strips div tags', async () => {
    const hooks = collectHooks();
    const protect = hooks.get('content:markdown')!;
    const restore = hooks.get('content:content')!;
    const source = '<div class="ai-card" style="display:flex;gap:12px;padding:16px;background:#f5f5f5;border-radius:12px"><span style="color:#079C48;font-weight:bold">标题</span><a href="https://example.com" style="display:inline-flex;align-items:center">查看</a></div>';
    const protectedSource = await protect(source);
    expect(protectedSource).toContain('CYCYINLINECONTAINERX');
    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const coreSanitized = sanitizeHtml(parsed, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code']),
      allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, a: ['href', 'title', 'target', 'rel'] },
    });
    const restored = await restore(coreSanitized);
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

  it('preserves data-state-for attributes through the complete enhanced HTML fragment pipeline', async () => {
    const hooks = collectHooks();
    const protect = hooks.get('content:markdown')!;
    const restore = hooks.get('content:content')!;
    const source = [
      '<div class="diagnostic">',
      '<div data-state-for="bili-dynamic-rin">等待诊断脚本创建 iframe…</div>',
      '<div data-state-for="bili-dynamic-plugin">等待诊断脚本创建 iframe…</div>',
      '<div data-state-for="youtube-dynamic">等待诊断脚本创建 iframe…</div>',
      '</div>',
    ].join('');
    const protectedSource = await protect(source);
    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const coreSanitized = sanitizeHtml(parsed, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code']),
      allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes },
    });
    const restored = await restore(coreSanitized);

    expect(restored).toContain('data-state-for="bili-dynamic-rin"');
    expect(restored).toContain('data-state-for="bili-dynamic-plugin"');
    expect(restored).toContain('data-state-for="youtube-dynamic"');
  });

  it('preserves both download-card SVG icons as inert markers for browser hydration', async () => {
    const hooks = collectHooks();
    const protect = hooks.get('content:markdown')!;
    const restore = hooks.get('content:content')!;
    const source = [
      '<!-- # 绿色提示框 -->',
      '> [!tip] **⬇️💚 资源下载**',
      '> Adobe Illustrator 2025 v29.2.1.116 x64 Multilingual 多国语言特别版 (2025/01/17)',
      '> <a href="https://pan.baidu.com/s/1otJbDx4U2bg4yL9VYw3MoA?pwd=cycy" target="_blank" rel="noopener noreferrer" style="font-weight:bold;color:var(--accent);word-break:break-all;"><span style="display:inline-flex;align-items:center;gap:4px;background:#079C48;color:#fff;border-radius:4px;padding:4px 10px;white-space:nowrap;"><svg width="18" height="18" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;"><path d="M46 580h20v200h700" fill="#fff"/><path d="M481 734L157 449" fill="#fff"/></svg><span>下载地址</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7"></path><polyline points="7 7 17 7 17 17"></polyline></svg></span></a> | 密码：cycy',
    ].join('\n');

    const protectedSource = await protect(source);
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
    const restored = await restore(coreSanitized);

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

  it('bypasses HTML protection and restoration completely when the feature is OFF', async () => {
    const hooks = collectHooks();
    const protect = hooks.get('content:markdown')!;
    const restore = hooks.get('content:content')!;
    const source = '<div class="native-content"><iframe src="https://www.youtube.com/embed/example"></iframe></div>';
    const disabledSettings = JSON.stringify({ htmlEnhancementEnabled: '0' });
    mocks.getOption.mockResolvedValue(disabledSettings);
    expect(await protect(source)).toBe(source);
    expect(await restore('<p>ordinary sanitized content</p>'))
      .toBe('<p>ordinary sanitized content</p>');
    const forgedMarker = 'CYCYINLINEHTMLX3c64697620636c6173733d22666f72676564223e68696464656e3c2f6469763eXEND';
    expect(await restore(forgedMarker)).toBe(forgedMarker);
  });

  it('retains iframe elements and safe playback attributes in enhanced HTML fragments', async () => {
    const restore = collectHooks().get('content:content')!;
    const source = '<div class="video-wrap"><iframe class="article-player" id="article-video" style="border-radius:14px;max-width:100%" src="https://www.youtube.com/embed/example" width="560" height="315" title="YouTube" allow="autoplay; encrypted-media" allowfullscreen loading="eager" referrerpolicy="strict-origin-when-cross-origin" data-player="article"></iframe></div>';
    const protectedSource = await collectHooks().get('content:markdown')!(source);
    const parsed = marked.parse(protectedSource, { async: false }) as string;
    const coreSanitized = sanitizeHtml(parsed, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'del', 'ins', 'details', 'summary', 'figure', 'figcaption', 'video', 'audio', 'source', 'iframe']),
      allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, iframe: ['src', 'width', 'height', 'frameborder', 'allowfullscreen'] },
      allowedIframeHostnames: ['www.youtube.com'],
    });
    const restored = await restore(coreSanitized);
    expect(restored).toContain('<iframe');
    expect(restored).toContain('src="https://www.youtube.com/embed/example"');
    expect(restored).toContain('allow="autoplay; encrypted-media"');
    expect(restored).toContain('allowfullscreen');
    expect(restored).toContain('referrerpolicy="strict-origin-when-cross-origin"');
    expect(restored).toContain('class="article-player"');
    expect(restored).toContain('id="article-video"');
    expect(restored).toContain('style="border-radius:14px;max-width:100%"');
    expect(restored).toContain('data-player="article"');
  });


  it('does not intercept iframe content when the iframe enhancement switch is OFF', async () => {
    const hooks = collectHooks();
    const source = '<div class="native-content"><iframe src="https://www.youtube.com/embed/example?a=1&b=2"></iframe></div>';
    mocks.getOption.mockResolvedValue(JSON.stringify({ htmlEnhancementEnabled: '0', iframeVideoEnhancementEnabled: '0', iframeVideoAllowedHostnames: 'www.youtube.com' }));
    const protectedContent = await hooks.get('content:markdown')!(source);
    expect(protectedContent).toBe(source);
    expect(await hooks.get('content:content')!(source)).toBe(source);
  });

  it('does not intercept iframe-looking examples inside code blocks or inline code', async () => {
    const hooks = collectHooks();
    mocks.getOption.mockResolvedValue(JSON.stringify({ htmlEnhancementEnabled: '0', iframeVideoEnhancementEnabled: '1', iframeVideoAllowedHostnames: '' }));
    const source = [
      "```html",
      '<iframe src="https://video.example.org/embed/code"></iframe>',
      "```",
      '',
      '`<iframe src="https://video.example.org/embed/inline"></iframe>`',
      '<script>const sample = "<iframe src=\\"https://video.example.org/embed/script\\"></iframe>";</script>',
      '<!-- <iframe src="https://video.example.org/embed/comment"></iframe> -->',
    ].join('\n');
    const protectedContent = await hooks.get('content:markdown')!(source);
    expect(protectedContent).toBe(source);
    expect(protectedContent).not.toContain('CYIFRAMEVIDEOX');
  });
  it('restores only an explicitly allowed iframe and keeps query separators literal', async () => {
    const hooks = collectHooks();
    mocks.getOption.mockResolvedValue(JSON.stringify({ htmlEnhancementEnabled: '0', iframeVideoEnhancementEnabled: '1', iframeVideoAllowedHostnames: 'video.example.org' }));
    const source = '<iframe src="https://video.example.org/embed/123?a=1&b=2" width="640" height="360" title="Video"></iframe>';
    const protectedContent = await hooks.get('content:markdown')!(source);
    expect(protectedContent).toContain('CYIFRAMEVIDEOX');
    const parsed = marked.parse(protectedContent, { async: false }) as string;
    const restored = await hooks.get('content:content')!(sanitizeHtml(parsed));
    expect(restored).toContain('<iframe');
    expect(restored).toContain('src="https://video.example.org/embed/123?a=1&b=2"');
    expect(restored).toContain('width="640"');
    expect(restored).not.toContain('CYIFRAMEVIDEOX');
  });

  it('uses the four default hosts for legacy settings without an allowlist field', async () => {
    const hooks = collectHooks();
    mocks.getOption.mockResolvedValue(JSON.stringify({ htmlEnhancementEnabled: '0', iframeVideoEnhancementEnabled: '1' }));
    const source = '<iframe src="https://www.youtube.com/embed/legacy"></iframe>';
    const protectedContent = await hooks.get('content:markdown')!(source);
    const parsed = marked.parse(protectedContent, { async: false }) as string;
    const restored = await hooks.get('content:content')!(sanitizeHtml(parsed));
    expect(restored).toContain('src="https://www.youtube.com/embed/legacy"');
  });

  it('decodes query separators only in an allowed iframe src and leaves ordinary links escaped', async () => {
    const hooks = collectHooks();
    mocks.getOption.mockResolvedValue(JSON.stringify({ htmlEnhancementEnabled: '0', iframeVideoEnhancementEnabled: '1', iframeVideoAllowedHostnames: 'video.example.org' }));
    const source = '<a href="https://example.org/watch?a=1&b=2">ordinary link</a>\n\n<iframe src="https://video.example.org/embed/1?a=1&b=2"></iframe>';
    const protectedContent = await hooks.get('content:markdown')!(source);
    const parsed = marked.parse(protectedContent, { async: false }) as string;
    const restored = await hooks.get('content:content')!(sanitizeHtml(parsed));
    expect(restored).toContain('href="https://example.org/watch?a=1&amp;b=2"');
    expect(restored).toContain('src="https://video.example.org/embed/1?a=1&b=2"');
  });
  it('rejects every iframe hostname when the iframe allowlist is empty', async () => {
    const hooks = collectHooks();
    mocks.getOption.mockResolvedValue(JSON.stringify({ htmlEnhancementEnabled: '0', iframeVideoEnhancementEnabled: '1', iframeVideoAllowedHostnames: '' }));
    const source = '<iframe src="https://video.example.org/embed/example?a=1&b=2"></iframe>';
    const protectedContent = await hooks.get('content:markdown')!(source);
    const parsed = marked.parse(protectedContent, { async: false }) as string;
    const restored = await hooks.get('content:content')!(sanitizeHtml(parsed));
    expect(restored).not.toContain('<iframe');
    expect(restored).not.toContain('src="https://video.example.org/embed/example?a=1&b=2"');
    expect(restored).not.toContain('CYIFRAMEVIDEOX');
  });
  it('uses the configured iframe allowlist when an iframe sits inside an enhanced HTML container', async () => {
    const hooks = collectHooks();
    mocks.getOption.mockResolvedValue(JSON.stringify({ htmlEnhancementEnabled: '1', iframeVideoEnhancementEnabled: '1', iframeVideoAllowedHostnames: 'video.example.org' }));
    const source = '<div class="video-wrap"><iframe src="https://video.example.org/embed/1?a=1&b=2"></iframe></div>';
    const protectedContent = await hooks.get('content:markdown')!(source);
    const parsed = marked.parse(protectedContent, { async: false }) as string;
    const restored = await hooks.get('content:content')!(sanitizeHtml(parsed));
    expect(restored).toContain('<iframe');
    expect(restored).toContain('src="https://video.example.org/embed/1?a=1&b=2"');
  });

  it('rejects iframe embeds inside enhanced containers when the allowlist is empty', async () => {
    const hooks = collectHooks();
    mocks.getOption.mockResolvedValue(JSON.stringify({ htmlEnhancementEnabled: '1', iframeVideoEnhancementEnabled: '1', iframeVideoAllowedHostnames: '' }));
    const source = '<div class="video-wrap"><iframe src="https://video.example.org/embed/1?a=1&b=2"></iframe></div>';
    const protectedContent = await hooks.get('content:markdown')!(source);
    const parsed = marked.parse(protectedContent, { async: false }) as string;
    const restored = await hooks.get('content:content')!(sanitizeHtml(parsed));
    expect(restored).not.toContain('<iframe');
    expect(restored).not.toContain('src="https://video.example.org/embed/1?a=1&b=2"');
  });
  it('rejects an iframe hostname that is not in a non-empty configured allowlist', async () => {
    const hooks = collectHooks();
    mocks.getOption.mockResolvedValue(JSON.stringify({ htmlEnhancementEnabled: '0', iframeVideoEnhancementEnabled: '1', iframeVideoAllowedHostnames: 'video.example.org' }));
    const source = '<iframe src="https://www.youtube.com/embed/1"></iframe>';
    const protectedContent = await hooks.get('content:markdown')!(source);
    const parsed = marked.parse(protectedContent, { async: false }) as string;
    const restored = await hooks.get('content:content')!(sanitizeHtml(parsed));
    expect(restored).not.toContain('src="https://www.youtube.com/embed/1"');
  });
  it('adds the inline HTML runtime with the saved opt-in state', () => {
    const handler = collectHooks().get('archive:footer')!;
    const enabled = handler('', { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementEnabled: '1', showHomeSearchButton: '0' }),
    } });
    expect(enabled).toContain('data-cy-inline-html-enhancement');
    // Note presentation CSS is emitted by archive:header, not duplicated in the footer.
    expect(enabled).not.toContain('data-cy-markdown-alert-icons');
    expect(enabled).not.toContain('cy-markdown-alert-has-icon::before');
    expect(enabled).toContain('const enabled = true');
    expect(enabled).toContain('.warm-prose:not(.warm-note-prose) :where(.cy-inline-html-pending) iframe{border-radius:0;margin:0}');
    expect(enabled).not.toContain('iframe{border-radius:0!important}');
    expect(enabled).toContain("allowedStyle.has(property)");
    expect(enabled).toContain("key !== 'style'");
    expect(enabled).toContain("script.src = url.href");
    expect(enabled).toContain("script.integrity");
    expect(enabled).toContain('scriptExecutionQueue = scriptExecutionQueue.then(appendScript, appendScript)');
    expect(enabled).toContain("script.addEventListener('load', finish");
    expect(enabled).toContain("script.addEventListener('error', finish");
    expect(enabled).toContain("@import\\b");
    expect(enabled).toContain("url\\(");

    const disabled = handler('', { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementEnabled: '0', showHomeSearchButton: '0' }),
    } });
    expect(disabled).not.toContain('data-cy-inline-html-enhancement');
    expect(disabled).not.toContain('data-cy-markdown-alert-icons');

    const otherTheme = handler('', { options: {
      theme: 'another-theme',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementEnabled: '1', showHomeSearchButton: '1' }),
    } });
    expect(otherTheme).not.toContain('data-cy-inline-html-enhancement');
    expect(otherTheme).not.toContain('data-cy-inline-html-enhancement-style');
    expect(otherTheme).not.toContain('data-cy-markdown-alert-icons');
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
        iframeVideoEnhancementEnabled: true,
        iframeVideoAllowedHostnames: '',
        canonicalDomainRedirectEnabled: true,
      }),
      path: SETTINGS_API_PATH,
    });
    expect(result.response.status).toBe(200);
    expect(await result.response.json()).toEqual({ success: true });
    expect(mocks.setOption).toHaveBeenCalledTimes(1);
    const savedSettings = JSON.parse(mocks.setOption.mock.calls[0][2] as string);
    expect(savedSettings).toMatchObject({
      existingPluginSetting: 'keep',
      showCommentManagementButtons: '1',
      showHomeSearchButton: '0',
      htmlEnhancementEnabled: '1',
      iframeVideoEnhancementEnabled: '1',
      iframeVideoAllowedHostnames: '',
      canonicalDomainRedirectEnabled: '1',
      markdownAlertStyleSettings: {
        enabled: true,
        types: expect.objectContaining({
          NOTE: expect.objectContaining({ background: expect.any(String) }),
          TIP: expect.objectContaining({ background: expect.any(String) }),
          IMPORTANT: expect.objectContaining({ background: expect.any(String) }),
          WARNING: expect.objectContaining({ background: expect.any(String) }),
          CAUTION: expect.objectContaining({ background: expect.any(String) }),
        }),
        icon: expect.objectContaining({ visible: true }),
      },
    });
  });

  it('keeps the four default iframe hosts when a legacy settings client omits the allowlist field', async () => {
    const context = adminContext();
    mocks.requireAdminAction.mockResolvedValueOnce(context);
    const handler = collectHooks().get('route:request')!;
    const result = await handler({}, {
      request: routeRequest(SETTINGS_API_PATH, 'POST', {
        showCommentManagementButtons: true,
        showHomeSearchButton: true,
        htmlEnhancementEnabled: false,
      }),
      path: SETTINGS_API_PATH,
    });
    expect(result.response.status).toBe(200);
    const savedSettings = JSON.parse(mocks.setOption.mock.calls[0][2] as string);
    expect(savedSettings.iframeVideoAllowedHostnames).toBe(
      'www.youtube.com\\nwww.youtube-nocookie.com\\nplayer.bilibili.com\\nplayer.vimeo.com',
    );
  });

  it('rejects a non-empty invalid iframe hostname list but accepts an empty list', async () => {
    const context = adminContext();
    mocks.requireAdminAction.mockResolvedValueOnce(context);
    const handler = collectHooks().get('route:request')!;
    const invalid = await handler({}, {
      request: routeRequest(SETTINGS_API_PATH, 'POST', { showCommentManagementButtons: true, showHomeSearchButton: true, htmlEnhancementEnabled: false, iframeVideoAllowedHostnames: 'https://video.example.org/embed' }),
      path: SETTINGS_API_PATH,
    });
    expect(invalid.response.status).toBe(400);
    expect(mocks.setOption).not.toHaveBeenCalled();
  });
  it('temporarily redirects an enabled alternate host to the current siteUrl and preserves path/query', async () => {
    const handler = collectHooks().get('route:request')!;
    const request = new Request('https://blog.oook.top/2026/10/30/shengming7.html?from=share&x=1');
    const result = await handler({}, {
      request,
      path: '/2026/10/30/shengming7.html',
      options: {
        siteUrl: 'https://oook.top',
        [PLUGIN_OPTION_KEY]: JSON.stringify({ canonicalDomainRedirectEnabled: '1' }),
      },
    });
    expect(result.handled).toBe(true);
    expect(result.response.status).toBe(302);
    expect(result.response.headers.get('cache-control')).toBe('no-store');
    expect(result.response.headers.get('location')).toBe(
      'https://oook.top/2026/10/30/shengming7.html?from=share&x=1',
    );
  });

  it('does not redirect when disabled, already canonical, or siteUrl is invalid', async () => {
    const handler = collectHooks().get('route:request')!;
    const request = new Request('https://oook.top/article.html');
    const disabled = await handler({}, {
      request,
      path: '/article.html',
      options: {
        siteUrl: 'https://oook.top',
        [PLUGIN_OPTION_KEY]: JSON.stringify({ canonicalDomainRedirectEnabled: '0' }),
      },
    });
    expect(disabled).toEqual({});

    const canonical = await handler({}, {
      request,
      path: '/article.html',
      options: {
        siteUrl: 'https://oook.top',
        [PLUGIN_OPTION_KEY]: JSON.stringify({ canonicalDomainRedirectEnabled: '1' }),
      },
    });
    expect(canonical).toEqual({});

    const invalid = await handler({}, {
      request: new Request('https://blog.oook.top/article.html'),
      path: '/article.html',
      options: {
        siteUrl: 'not a valid URL',
        [PLUGIN_OPTION_KEY]: JSON.stringify({ canonicalDomainRedirectEnabled: '1' }),
      },
    });
    expect(invalid).toEqual({});
  });

  it('does not redirect admin, API, static assets, or non-GET/HEAD requests', async () => {
    const handler = collectHooks().get('route:request')!;
    const options = {
      siteUrl: 'https://oook.top',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ canonicalDomainRedirectEnabled: '1' }),
    };
    for (const path of ['/admin/login', '/api/users/login', '/themes/theme/style.css', '/usr/uploads/a.png', '/assets/app.js']) {
      const result = await handler({}, {
        request: new Request('https://blog.oook.top' + path),
        path,
        options,
      });
      expect(result).toEqual({});
    }
    const post = await handler({}, {
      request: new Request('https://blog.oook.top/article.html', { method: 'POST' }),
      path: '/article.html',
      options,
    });
    expect(post).toEqual({});
  });

  it('keeps protocol-relative request paths on the configured canonical host', async () => {
    const handler = collectHooks().get('route:request')!;
    const result = await handler({}, {
      request: new Request('https://blog.oook.top//attacker.example/path?x=1'),
      path: '//attacker.example/path',
      options: {
        siteUrl: 'https://oook.top',
        [PLUGIN_OPTION_KEY]: JSON.stringify({ canonicalDomainRedirectEnabled: '1' }),
      },
    });
    expect(result.response.status).toBe(302);
    expect(new URL(result.response.headers.get('location')!).hostname).toBe('oook.top');
    expect(result.response.headers.get('location')).toBe('https://oook.top//attacker.example/path?x=1');
  });

  it('uses the canonical siteUrl scheme when redirecting the same host', async () => {
    const handler = collectHooks().get('route:request')!;
    const result = await handler({}, {
      request: new Request('http://oook.top/article.html'),
      path: '/article.html',
      options: {
        siteUrl: 'https://oook.top',
        [PLUGIN_OPTION_KEY]: JSON.stringify({ canonicalDomainRedirectEnabled: '1' }),
      },
    });
    expect(result.response.status).toBe(302);
    expect(result.response.headers.get('location')).toBe('https://oook.top/article.html');
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

  it('hydrates preserved style blocks into the document head after the full Markdown pipeline', async () => {
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

    const protectedSource = await protect(source);
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
    const restored = await restore(coreSanitized);
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

    const appendedStyles: Array<{ tagName: string; textContent: string; media?: string; sheet?: unknown }> = [];
    const removedStyles: unknown[] = [];
    const scopedRule: any = { type: 1, selectorText: '.custom-footer, .badge-dual:is(.active, [data-kind="a,b"])::before' };
    const rootRule: any = { type: 1, selectorText: ':root' };
    const nestedHoverRule: any = { type: 1, selectorText: '&:hover' };
    const nestedDeclarations: any = { type: 0, style: { color: 'red' } };
    const nestedStyleRules: any = [nestedHoverRule, nestedDeclarations];
    nestedStyleRules.deleteRule = (index: number) => nestedStyleRules.splice(index, 1);
    const nestedParentRule: any = {
      type: 1,
      selectorText: '.card',
      cssRules: nestedStyleRules,
      deleteRule(index: number) { this.cssRules.splice(index, 1); },
    };
    const nestedRule: any = { type: 1, selectorText: '.badge-row::after' };
    const mediaRules: any = [nestedRule];
    mediaRules.deleteRule = (index: number) => mediaRules.splice(index, 1);
    const mediaRule: any = { type: 4, cssRules: mediaRules, deleteRule(index: number) { this.cssRules.splice(index, 1); } };
    const keyframeStep: any = { type: 1, selectorText: 'from' };
    const keyframesRule: any = { type: 7, cssRules: [keyframeStep] };
    const fontFaceRule: any = { type: 5 };
    const layerStatementRule: any = { type: 19, cssText: '@layer reset, theme;' };
    const cssRules: any = [scopedRule, rootRule, nestedParentRule, mediaRule, keyframesRule, fontFaceRule, layerStatementRule];
    cssRules.deleteRule = (index: number) => cssRules.splice(index, 1);
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
      querySelectorAll(selector: string) {
        expect(selector).toBe('.warm-prose:not(.warm-note-prose)');
        return [{ articleBody: true }];
      },
      createTreeWalker(root: unknown, _whatToShow: number, filter: { acceptNode(node: unknown): number }) {
        expect(root).toEqual({ articleBody: true });
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
      createElement(tagName: string) {
        return {
          tagName: tagName.toUpperCase(),
          textContent: '',
          media: '',
          sheet: { cssRules, deleteRule(index: number) { cssRules.splice(index, 1); } },
          remove() { removedStyles.push(this); },
        };
      },
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
    expect(appendedStyles[0].textContent).toContain('.badge-dual { font-size: 11px; border-radius: 6px; background: #079C48;  }');
    expect(appendedStyles[0].textContent).not.toContain('/* adjust `font-size` here */');
    expect(appendedStyles[0].textContent).not.toContain('CYCYCODESEGMENT');
    expect(scopedRule.selectorText).toBe('.warm-prose:not(.warm-note-prose) .custom-footer, .warm-prose:not(.warm-note-prose) .badge-dual:is(.active, [data-kind="a,b"])::before');
    expect(nestedRule.selectorText).toBe('.warm-prose:not(.warm-note-prose) .badge-row::after');
    expect(rootRule.selectorText).toBe('.warm-prose:not(.warm-note-prose)');
    expect(nestedParentRule.selectorText).toBe('.warm-prose:not(.warm-note-prose) .card');
    expect(nestedHoverRule.selectorText).toBe('&:hover');
    expect(nestedStyleRules).toContain(nestedDeclarations);

    expect(keyframeStep.selectorText).toBe('from');
    expect(cssRules).not.toContain(fontFaceRule);
    expect(cssRules).not.toContain(layerStatementRule);
    expect(appendedStyles[0].media).toBe('');
    expect(removedStyles).toHaveLength(0);
    expect(replaceCalls).toBeGreaterThan(0);

    // If the browser cannot expose a mutable CSSOM, the restored style block
    // must be removed instead of becoming an unscoped page-wide stylesheet.
    const unavailableStyles: Array<{ media: string; removed: boolean }> = [];
    const unavailableDocument = {
      ...document,
      head: {
        appendChild(element: { media: string }) {
          unavailableStyles.push({ media: element.media || '', removed: false });
        },
      },
      createElement() {
        const style = {
          tagName: 'STYLE',
          textContent: '',
          media: '',
          sheet: null,
          remove() {
            const record = unavailableStyles[unavailableStyles.length - 1];
            if (record) record.removed = true;
          },
        };
        return style;
      },
    };
    runInNewContext(runtime!, {
      document: unavailableDocument,
      window: { addEventListener() {} },
      Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
      NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
      TextDecoder,
      Uint8Array,
    });
    expect(unavailableStyles).toEqual([{ media: 'not all', removed: true }]);
  });

  it('executes external and inline scripts sequentially in source order', async () => {
    const footer = collectHooks().get('archive:footer')!('', { options: {
      theme: 'typecho-theme-warm-cy',
      [PLUGIN_OPTION_KEY]: JSON.stringify({ htmlEnhancementEnabled: '1', showHomeSearchButton: '0' }),
    } });
    const runtimeStartTag = '<script data-cy-inline-html-enhancement>';
    const runtimeStart = footer.indexOf(runtimeStartTag);
    const runtimeEnd = footer.indexOf('</script>', runtimeStart + runtimeStartTag.length);
    const runtime = footer.slice(runtimeStart + runtimeStartTag.length, runtimeEnd);
    const external = '<script src="https://cdn.example.test/library.js"></script>';
    const failingExternal = '<script src="https://cdn.example.test/optional.js"></script>';
    const inline = '<script>window.libraryReady = true;</script>';
    const forgedMarker = 'CYCY\u200bINLINEBLOCKX' + Buffer.from('<script>window.compromised = true;</script>').toString('hex') + 'XEND';
    const marker = (source: string) => 'CYCYINLINEBLOCKX' + Buffer.from(source).toString('hex') + 'XEND';
    const textNode: any = {
      nodeType: 3,
      nodeValue: marker(external) + marker(failingExternal) + marker(inline) + forgedMarker,
      parentElement: { closest: () => null },
      parentNode: { replaceChild(fragment: { childNodes: any[] }) { replacedNodes.push(...fragment.childNodes); } },
      previousElementSibling: null,
    };
    const appendedScripts: any[] = [];
    const replacedNodes: any[] = [];
    const document = {
      body: { appendChild(script: any) { appendedScripts.push(script); return script; } },
      head: { appendChild() {} },
      querySelectorAll() { return [{}]; },
      createTreeWalker(_root: unknown, _what: number, filter: { acceptNode(node: unknown): number }) {
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
        return { childNodes: [] as unknown[], appendChild(node: unknown) { this.childNodes.push(node); return node; } };
      },
      createTextNode(nodeValue: string) { return { nodeType: 3, nodeValue }; },
      createElement(tagName: string) {
        const listeners: Record<string, Function> = {};
        return {
          tagName: tagName.toUpperCase(), type: '', src: '', async: true, textContent: '',
          addEventListener(name: string, callback: Function) { listeners[name] = callback; },
          dispatch(name: string) { listeners[name]?.(); },
        };
      },
    };
    runInNewContext(runtime, {
      document,
      window: { addEventListener() {} },
      location: { origin: 'https://example.com' },
      URL,
      Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
      NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
      TextDecoder,
      Uint8Array,
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(appendedScripts).toHaveLength(1);
    expect(appendedScripts[0].src).toBe('https://cdn.example.test/library.js');
    expect(appendedScripts[0].async).toBe(false);

    appendedScripts[0].dispatch('load');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(appendedScripts).toHaveLength(2);
    expect(appendedScripts[1].src).toBe('https://cdn.example.test/optional.js');

    appendedScripts[1].dispatch('error');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(appendedScripts).toHaveLength(3);
    expect(appendedScripts[2].textContent).toBe('window.libraryReady = true;');
    expect(appendedScripts).toHaveLength(3);
    expect(replacedNodes.some(node => node.nodeType === 3 && node.nodeValue === forgedMarker.replace('CYCY\u200bINLINE', 'CYCYINLINE'))).toBe(true);
  });

});
