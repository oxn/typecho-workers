import { eq } from 'drizzle-orm';
import { schema } from 'typecho/db';
import { registerPluginAdminPath, setOption } from 'typecho/plugin-sdk';
import type { PluginInitContext, PluginRouteResult } from 'typecho/plugin-sdk';
import { generateSecurityToken } from '@/lib/auth';
import { isAdminActionResponse, requireAdminAction } from '@/lib/admin-auth';
import { computeUrls } from '@/lib/options';
import adminCss from './admin.css?raw';

const THEME_ID = 'typecho-theme-warm-cy';
const OPTION_KEY = `theme:${THEME_ID}`;
const ADMIN_PATH = '/api/admin/theme-pin';
const ADMIN_SETTINGS_API_PATH = '/api/admin/cy-companion-settings';
const ADMIN_PAGE_SLUG = 'cy-companion';
const PLUGIN_OPTION_KEY = 'plugin:typecho-plugin-warm-cy';

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

function isEnabled(value: unknown, fallback = true): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  return !(value === false || value === 0 || value === '0');
}


function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] || character);
}

function featureSettingsPageHtml(csrfToken: string, rawSettings: unknown): string {
  const settings = parsePluginSettings(rawSettings);
  const commentsEnabled = isEnabled(settings.showCommentManagementButtons);
  const searchEnabled = isEnabled(settings.showHomeSearchButton);
  return `
    <div class="col-mb-12 col-tb-8 col-tb-offset-2 cy-feature-settings"
      data-cy-feature-settings data-csrf-token="${escapeHtml(csrfToken)}">
      <section class="cy-feature-card">
        <h2>评论区管理按键</h2>
        <p>控制文章和独立页面评论区是否显示管理员操作按键。关闭后只隐藏前台按键，不影响后台管理权限及管理接口。</p>
        <label class="cy-feature-toggle">
          <input type="checkbox" data-cy-setting="showCommentManagementButtons" ${commentsEnabled ? 'checked' : ''}>
          <span>显示评论区管理按键</span>
        </label>
      </section>
      <section class="cy-feature-card">
        <h2>首页搜索按键</h2>
        <p>控制 Warm CY 首页导航区域是否显示搜索图标。关闭后不显示图标，也不保留空白位置。</p>
        <label class="cy-feature-toggle">
          <input type="checkbox" data-cy-setting="showHomeSearchButton" ${searchEnabled ? 'checked' : ''}>
          <span>显示首页搜索按键</span>
        </label>
      </section>
      <div class="cy-feature-actions">
        <button type="button" class="btn" data-cy-save>保存设置</button>
        <span data-cy-save-status role="status" aria-live="polite"></span>
      </div>
    </div>
    <script>
      (function () {
        var root = document.querySelector('[data-cy-feature-settings]');
        if (!root || root.dataset.initialized === '1') return;
        root.dataset.initialized = '1';
        var save = root.querySelector('[data-cy-save]');
        var status = root.querySelector('[data-cy-save-status]');
        save.addEventListener('click', async function () {
          var comments = root.querySelector('[data-cy-setting="showCommentManagementButtons"]');
          var search = root.querySelector('[data-cy-setting="showHomeSearchButton"]');
          save.disabled = true;
          status.textContent = '正在保存…';
          try {
            var response = await fetch('/api/admin/cy-companion-settings', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': root.dataset.csrfToken || ''
              },
              body: JSON.stringify({
                showCommentManagementButtons: !!comments.checked,
                showHomeSearchButton: !!search.checked
              })
            });
            var result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || '保存失败');
            status.textContent = '保存成功';
          } catch (error) {
            status.textContent = error instanceof Error ? error.message : '保存失败，请稍后重试';
          } finally {
            save.disabled = false;
          }
        });
      })();
    </script>
  `;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
}

function parseSettings(value: unknown): Record<string, unknown> {
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
    if (!/^\d+$/.test(part.trim())) continue;
    const cid = Number(part.trim());
    if (!Number.isSafeInteger(cid) || cid <= 0 || seen.has(cid)) continue;
    seen.add(cid);
    result.push(cid);
  }
  return result;
}

export default function init({ addHook, pluginId }: PluginInitContext): void {
  registerPluginAdminPath(ADMIN_PATH);
  registerPluginAdminPath(ADMIN_SETTINGS_API_PATH);

  addHook('admin:header', pluginId, (html: string, extra?: { title?: string }) => {
    if (extra?.title !== 'CY 功能显示') return html;
    return `${html}<style data-warm-cy-admin>${adminCss}</style>`;
  }, 20);


  addHook('admin:page', pluginId, (html: string, extra?: {
    slug?: string;
    csrfToken?: string;
    options?: Record<string, unknown>;
  }) => {
    if (extra?.slug !== ADMIN_PAGE_SLUG) return html;
    return featureSettingsPageHtml(
      extra.csrfToken || '',
      extra.options?.[PLUGIN_OPTION_KEY],
    );
  }, 20);

  addHook('route:request', pluginId, async (
    result: PluginRouteResult,
    extra?: { request?: Request; path?: string },
  ) => {
    if (result?.handled || !extra?.request) return result;
    const path = extra.path;
    if (path !== ADMIN_PATH && path !== ADMIN_SETTINGS_API_PATH) return result;
    const request = extra.request;
    if (request.method !== 'POST') {
      return { handled: true, response: json({ error: 'Method not allowed' }, 405) };
    }

    const auth = await requireAdminAction(request, 'administrator');
    if (isAdminActionResponse(auth)) {
      return {
        handled: true,
        response: json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status),
      };
    }
    if (auth.options.theme !== THEME_ID) {
      return { handled: true, response: json({ error: 'Theme is not active' }, 404) };
    }

    let body: unknown;
    try { body = await request.json(); } catch {
      return { handled: true, response: json({ error: 'Invalid JSON' }, 400) };
    }
    if (!body || typeof body !== 'object') {
      return { handled: true, response: json({ error: 'Invalid request' }, 400) };
    }

    if (path === ADMIN_SETTINGS_API_PATH) {
      const values = body as {
        showCommentManagementButtons?: unknown;
        showHomeSearchButton?: unknown;
      };
      if (typeof values.showCommentManagementButtons !== 'boolean'
        || typeof values.showHomeSearchButton !== 'boolean') {
        return { handled: true, response: json({ error: 'Invalid settings' }, 400) };
      }
      const current = parsePluginSettings(auth.options[PLUGIN_OPTION_KEY]);
      const next = {
        ...current,
        showCommentManagementButtons: values.showCommentManagementButtons ? '1' : '0',
        showHomeSearchButton: values.showHomeSearchButton ? '1' : '0',
      };
      await setOption(auth.db, PLUGIN_OPTION_KEY, JSON.stringify(next));
      return { handled: true, response: json({ success: true }) };
    }

    const { cid, pinned } = body as { cid?: unknown; pinned?: unknown };
    const contentId = Number(cid);
    if (!Number.isSafeInteger(contentId) || contentId <= 0 || typeof pinned !== 'boolean') {
      return { handled: true, response: json({ error: 'Invalid parameters' }, 400) };
    }

    const content = await auth.db.query.contents.findFirst({
      columns: { cid: true, type: true, status: true },
      where: eq(schema.contents.cid, contentId),
    });
    if (!content || content.type !== 'post' || content.status !== 'publish') {
      return { handled: true, response: json({ error: 'Published post not found' }, 404) };
    }

    const settings = parseSettings(auth.options[OPTION_KEY]);
    const ids = parsePinnedIds(settings.pinnedIds).filter(id => id !== contentId);
    if (pinned) ids.unshift(contentId);
    settings.pinnedIds = ids.join(',');
    await setOption(auth.db, OPTION_KEY, JSON.stringify(settings));
    return { handled: true, response: json({ success: true, pinned, pinnedIds: ids }) };
  }, 20);

  addHook('comment:list', pluginId, async (
    payload: Record<string, unknown>,
    extra?: { request?: Request; options?: Record<string, unknown>; cid?: number },
  ) => {
    const request = extra?.request;
    const options = extra?.options;
    const cid = Number(extra?.cid);
    if (!request || !options || options.theme !== THEME_ID || !Number.isSafeInteger(cid) || cid <= 0) return payload;

    const auth = await requireAdminAction(request, 'administrator', { csrf: false });
    if (isAdminActionResponse(auth) || !auth.user.authCode) return payload;

    const content = await auth.db.query.contents.findFirst({
      columns: { type: true },
      where: eq(schema.contents.cid, cid),
    });
    if (!content || (content.type !== 'post' && content.type !== 'page')) return payload;

    const settings = parseSettings(auth.options[OPTION_KEY]);
    const featureSettings = parsePluginSettings(auth.options[PLUGIN_OPTION_KEY]);
    const csrfToken = await generateSecurityToken(auth.options.secret, auth.user.authCode, auth.uid);
    return {
      ...payload,
      management: {
        canManage: true,
        showManagementButtons: isEnabled(featureSettings.showCommentManagementButtons),
        adminUrl: computeUrls(auth.options).adminUrl,
        contentType: content.type,
        isPinned: content.type === 'post' && parsePinnedIds(settings.pinnedIds).includes(cid),
        csrfToken,
      },
    };
  }, 20);
}
