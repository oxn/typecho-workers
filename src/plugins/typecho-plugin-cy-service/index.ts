import { registerPluginAdminPath, setOption } from 'typecho/plugin-sdk';
import type { PluginInitContext, PluginRouteResult } from 'typecho/plugin-sdk';
import { isAdminActionResponse, requireAdminAction } from '@/lib/admin-auth';
import adminCss from './cy-service-settings.css?raw';

const ADMIN_PAGE_SLUG = 'cy-service';
const ADMIN_SETTINGS_API_PATH = '/api/admin/cy-service-settings';
const LEGACY_OPTION_KEY = 'plugin:typecho-plugin-warm-cy';
const THEME_OPTION_KEY = 'theme:typecho-theme-warm-cy';
const THEME_ID = 'typecho-theme-warm-cy';
const PLUGIN_VERSION = '0.1.0';

function parsePluginSettings(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parsePinnedIds(value: unknown): number[] {
  if (typeof value !== 'string' && typeof value !== 'number') return [];
  const result: number[] = [];
  const seen = new Set<number>();
  for (const part of String(value).split(/[，,\s]+/)) {
    const trimmed = part.trim();
    if (!/^\d+$/.test(trimmed)) continue;
    const cid = Number(trimmed);
    if (!Number.isSafeInteger(cid) || cid <= 0 || seen.has(cid)) continue;
    seen.add(cid);
    result.push(cid);
  }
  return result;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] || character);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
}

function pageHtml(csrfToken: string, rawSettings: unknown, rawThemeSettings: unknown): string {
  const settings = parsePluginSettings(rawSettings);
  const themeSettings = parsePluginSettings(rawThemeSettings);
  const pinnedValue = settings.pinnedIds !== undefined ? settings.pinnedIds : themeSettings.pinnedIds;
  const pinnedIds = parsePinnedIds(pinnedValue).join(',');
  const linkRows = Array.from({ length: 10 }, (_, index) => {
    const number = index + 1;
    const suffix = String(number).padStart(2, '0');
    return `
      <div class="cy-service-link-row">
        <div class="cy-service-link-text-line">
          <label for="cy-link-text-${suffix}">文字${number}：</label>
          <input id="cy-link-text-${suffix}" name="linktxt${suffix}" type="text">
          <label class="cy-service-new-window" for="cy-link-blank-${suffix}">
            <input id="cy-link-blank-${suffix}" name="linkblank${suffix}" type="checkbox">
            <span>新窗口打开</span>
          </label>
        </div>
        <div class="cy-service-link-url-line">
          <label for="cy-link-url-${suffix}">网址${number}：</label>
          <input id="cy-link-url-${suffix}" name="links${suffix}" type="text">
        </div>
      </div>`;
  }).join('');

  return `
    <div class="cy-service-settings" data-cy-service-settings data-csrf-token="${escapeHtml(csrfToken)}">
      <header class="cy-service-header">
        <strong>CY服务插件</strong>
        <span class="cy-service-version">版本：${PLUGIN_VERSION}</span>
        <a href="/admin/options-theme">返回主题设置</a>
      </header>

      <main class="cy-service-form">
        <section class="cy-service-card cy-service-home-card">
          <div class="cy-service-field-head">
            <label for="cy-pinned-ids">首页置顶文章 ID</label>
            <p class="cy-service-description">只控制首页置顶。填写文章 ID，多个 ID 用英文逗号分隔；其他页面不受影响。</p>
          </div>
          <input id="cy-pinned-ids" name="pinnedIds" type="text" value="${escapeHtml(pinnedIds)}">
        </section>

        <section class="cy-service-links-group">
          <div class="cy-service-links-heading">
            <strong>页面连接</strong>
            <span>支持 https://、http://、mailto:、站内链接；普通域名可直接填写。</span>
          </div>
          ${linkRows}
        </section>

        <section class="cy-service-card cy-service-article-card">
          <div class="cy-service-field-head">
            <label for="cy-article-declaration">文章内容声明</label>
            <p class="cy-service-description">
              仅在文章详情页显示，位于正文末尾、评论区之前；笔记页不显示。留空则不显示。支持 HTML。<br>
              <strong>变量说明：</strong><code>{site.name}</code>：网站名称；<code>{site.url}</code>：网站首页地址；<code>{site.description}</code>：网站简介。<br>
              <code>{post.title}</code>：当前文章标题；<code>{post.url}</code>：当前文章完整访问地址。<br>
              <strong>样式说明：</strong>声明内 CSS 仅作用于声明区块。需要边框、背景、圆角或内边距时，可自行在 HTML/CSS 中定义。变量替换值会进行 HTML 转义。
            </p>
          </div>
          <textarea id="cy-article-declaration" name="articleDeclarationHtml"></textarea>
        </section>

        <section class="cy-service-card cy-service-footer-card">
          <div class="cy-service-field-head">
            <label for="cy-footer-content">站点底部内容</label>
            <p class="cy-service-description">设置显示于站点底部的内容（HTML）</p>
          </div>
          <textarea id="cy-footer-content" name="footerCustomHtml"></textarea>
        </section>
      </main>

      <div class="cy-service-actions">
        <button type="button" data-cy-service-save>保存置顶设置</button>
        <span data-cy-service-save-status role="status" aria-live="polite"></span>
      </div>
    </div>
    <script>
      (function () {
        var root = document.querySelector('[data-cy-service-settings]');
        if (!root || root.dataset.initialized === '1') return;
        root.dataset.initialized = '1';
        var button = root.querySelector('[data-cy-service-save]');
        var input = root.querySelector('[name="pinnedIds"]');
        var status = root.querySelector('[data-cy-service-save-status]');
        button?.addEventListener('click', async function () {
          if (!button || !input || !status) return;
          button.disabled = true;
          status.textContent = '正在保存…';
          try {
            var response = await fetch('/api/admin/cy-service-settings', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': root.dataset.csrfToken || ''
              },
              body: JSON.stringify({ pinnedIds: input.value })
            });
            var result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || '保存失败');
            input.value = result.pinnedIds || '';
            status.textContent = '保存成功';
          } catch (error) {
            status.textContent = error instanceof Error ? error.message : '保存失败';
          } finally {
            button.disabled = false;
          }
        });
      })();
    </script>
  `;
}

export default function init({ addHook, pluginId }: PluginInitContext): void {
  addHook('admin:header', pluginId, (html: string, extra?: { title?: string }) => {
    if (extra?.title !== 'CY服务插件') return html;
    return `${html}<style data-cy-service-admin>${adminCss}</style>`;
  }, 20);

  registerPluginAdminPath(ADMIN_SETTINGS_API_PATH);

  addHook('admin:page', pluginId, (html: string, extra?: {
    slug?: string;
    csrfToken?: string;
    options?: Record<string, unknown>;
  }) => {
    if (extra?.slug !== ADMIN_PAGE_SLUG) return html;
    return pageHtml(extra.csrfToken || '', extra.options?.[LEGACY_OPTION_KEY], extra.options?.[THEME_OPTION_KEY]);
  }, 20);

  addHook('route:request', pluginId, async (
    result: PluginRouteResult,
    extra?: { request?: Request; path?: string },
  ) => {
    if (result?.handled || !extra?.request) return result;
    const request = extra.request;
    const path = extra.path || new URL(request.url).pathname;
    if (path !== ADMIN_SETTINGS_API_PATH) return result;
    if (request.method !== 'POST') {
      return { handled: true, response: json({ error: 'Method not allowed' }, 405) };
    }

    const auth = await requireAdminAction(request, 'administrator');
    if (isAdminActionResponse(auth)) {
      return { handled: true, response: json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status) };
    }
    if (auth.options.theme !== THEME_ID) {
      return { handled: true, response: json({ error: 'Theme is not active' }, 404) };
    }

    let body: unknown;
    try { body = await request.json(); } catch {
      return { handled: true, response: json({ error: 'Invalid JSON' }, 400) };
    }
    if (!body || typeof body !== 'object' || typeof (body as { pinnedIds?: unknown }).pinnedIds !== 'string') {
      return { handled: true, response: json({ error: 'Invalid pinned IDs' }, 400) };
    }

    const ids = parsePinnedIds((body as { pinnedIds: string }).pinnedIds);
    const normalized = ids.join(',');
    const current = parsePluginSettings(auth.options[LEGACY_OPTION_KEY]);
    if (current.pinnedIds === normalized) {
      return { handled: true, response: json({ success: true, unchanged: true, pinnedIds: normalized }) };
    }
    await setOption(auth.db, LEGACY_OPTION_KEY, JSON.stringify({ ...current, pinnedIds: normalized }));
    return { handled: true, response: json({ success: true, unchanged: false, pinnedIds: normalized }) };
  }, 20);
}
