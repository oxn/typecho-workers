import { eq } from 'drizzle-orm';
import { schema } from 'typecho/db';
import { registerPluginAdminPath, setOption } from 'typecho/plugin-sdk';
import type { PluginInitContext, PluginRouteResult } from 'typecho/plugin-sdk';
import { generateSecurityToken } from '@/lib/auth';
import { isAdminActionResponse, requireAdminAction } from '@/lib/admin-auth';
import { computeUrls } from '@/lib/options';

const THEME_ID = 'typecho-theme-warm-cy';
const OPTION_KEY = `theme:${THEME_ID}`;
const PLUGIN_OPTION_KEY = 'plugin:typecho-plugin-warm-cy';
const ADMIN_PATH = '/api/admin/theme-pin';
const SETTINGS_PATH = '/api/admin/warm-cy-settings';
const ADMIN_PAGE_SLUG = 'warm-cy';

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

function isEnabled(value: unknown): boolean {
  return value !== false && value !== 0 && value !== '0' && value !== 'false';
}

function renderSettingsPage(csrfToken: string, options?: Record<string, unknown>): string {
  const settings = parseSettings(options?.[PLUGIN_OPTION_KEY]);
  const commentChecked = isEnabled(settings.showCommentManagement) ? ' checked' : '';
  const searchChecked = isEnabled(settings.showHomeSearch) ? ' checked' : '';
  return `<section id="warm-cy-settings" class="col-mb-12">
  <h3 class="warm-cy-module-title">功能显示</h3>
  <div class="warm-cy-module">
    <strong>评论区管理按键</strong>
    <label class="warm-cy-setting"><input type="checkbox" id="warm-cy-comments"${commentChecked}><span>显示评论区管理按键</span></label>
    <p class="warm-cy-hint">关闭后，评论区不再显示管理员的置顶、取消置顶、编辑和删除入口；后台管理功能及权限不受影响。</p>
  </div>
  <div class="warm-cy-module">
    <strong>首页搜索按键</strong>
    <label class="warm-cy-setting"><input type="checkbox" id="warm-cy-search"${searchChecked}><span>显示首页搜索按键</span></label>
    <p class="warm-cy-hint">开启后，在首页导航区域显示搜索图标，点击后可输入关键词并跳转到搜索结果。</p>
  </div>
  <div class="warm-cy-actions">
    <button type="button" class="btn primary" id="warm-cy-save">保存设置</button>
    <span id="warm-cy-result" role="status" aria-live="polite"></span>
  </div>
</section>
<style>
.warm-cy-module-title{font-size:14px;font-weight:600;color:#333;margin:16px 0 8px}
.warm-cy-module{border:1px solid #e5e5e5;border-radius:3px;padding:14px 16px;margin:0 0 8px;background:#fafafa}
.warm-cy-module>strong{display:block;margin-bottom:10px;color:#333;font-size:13px}
.warm-cy-setting{display:inline-flex;align-items:center;gap:7px;color:#333;font-size:13px;cursor:pointer}
.warm-cy-setting input{margin:0;accent-color:#31966b}
.warm-cy-hint{margin:7px 0 0;color:#888;font-size:12px;line-height:1.6}
.warm-cy-actions{display:flex;align-items:center;gap:12px;margin-top:14px}
#warm-cy-result{font-size:12px;color:#666}
@media(max-width:640px){.warm-cy-module{padding:12px}.warm-cy-actions{align-items:flex-start;flex-direction:column}}
</style>
<script>
(function(){
  var save=document.getElementById('warm-cy-save');
  var result=document.getElementById('warm-cy-result');
  if(!save||!result)return;
  save.addEventListener('click',async function(){
    save.disabled=true;result.textContent='正在保存...';
    try{
      var response=await fetch('/api/admin/warm-cy-settings',{
        method:'POST',
        headers:{'Content-Type':'application/json','X-CSRF-Token':${JSON.stringify(csrfToken)}},
        body:JSON.stringify({
          showCommentManagement:document.getElementById('warm-cy-comments').checked,
          showHomeSearch:document.getElementById('warm-cy-search').checked
        })
      });
      var data=await response.json();
      if(!response.ok||data.success!==true)throw new Error(data.error||'保存失败');
      result.textContent='设置已保存';
    }catch(error){result.textContent=error&&error.message?error.message:'保存失败'}
    finally{save.disabled=false}
  });
})();
</script>`;
}

export default function init({ addHook, pluginId }: PluginInitContext): void {
  registerPluginAdminPath(ADMIN_PATH);
  registerPluginAdminPath(SETTINGS_PATH);

  addHook('route:request', pluginId, async (
    result: PluginRouteResult,
    extra?: { request?: Request; path?: string },
  ) => {
    if (result?.handled || !extra?.request || (extra.path !== ADMIN_PATH && extra.path !== SETTINGS_PATH)) return result;
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
    if (extra.path === SETTINGS_PATH) {
      let settingsBody: unknown;
      try { settingsBody = await request.json(); } catch {
        return { handled: true, response: json({ error: 'Invalid JSON' }, 400) };
      }
      if (!settingsBody || typeof settingsBody !== 'object') {
        return { handled: true, response: json({ error: 'Invalid request' }, 400) };
      }
      const input = settingsBody as { showCommentManagement?: unknown; showHomeSearch?: unknown };
      if (typeof input.showCommentManagement !== 'boolean' || typeof input.showHomeSearch !== 'boolean') {
        return { handled: true, response: json({ error: 'Invalid settings' }, 400) };
      }
      const current = parseSettings(auth.options[PLUGIN_OPTION_KEY]);
      const next = {
        ...current,
        showCommentManagement: input.showCommentManagement,
        showHomeSearch: input.showHomeSearch,
      };
      await setOption(auth.db, PLUGIN_OPTION_KEY, JSON.stringify(next));
      return { handled: true, response: json({ success: true, settings: next }) };
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

  addHook('admin:page', pluginId, (html: string, extra?: {
    slug?: string;
    csrfToken?: string;
    options?: Record<string, unknown>;
  }) => {
    if (extra?.slug !== ADMIN_PAGE_SLUG) return html;
    return renderSettingsPage(extra.csrfToken || '', extra.options);
  }, 20);

  addHook('admin:footer', pluginId, (html: string, extra?: {
    user?: { group?: string };
    activeMenu?: string;
  }) => {
    if (extra?.user?.group !== 'administrator') return html;
    const active = extra.activeMenu === ADMIN_PAGE_SLUG;
    return html + `<script>(function(){
      var menu=document.querySelector('.typecho-head-nav nav > menu > li:nth-child(4) > menu');
      if(!menu||menu.querySelector('a[href="/admin/plugin/${ADMIN_PAGE_SLUG}"]'))return;
      var item=document.createElement('li');
      item.className=${JSON.stringify(active ? 'focus' : '')};
      var link=document.createElement('a');
      link.href='/admin/plugin/${ADMIN_PAGE_SLUG}';
      link.textContent='CY 功能显示';
      item.appendChild(link);menu.appendChild(item);
    })()</script>`;
  }, 20);

  addHook('comment:list', pluginId, async (
    payload: Record<string, unknown>,
    extra?: { request?: Request; options?: Record<string, unknown>; cid?: number },
  ) => {
    const request = extra?.request;
    const options = extra?.options;
    const cid = Number(extra?.cid);
    if (!request || !options || options.theme !== THEME_ID || !Number.isSafeInteger(cid) || cid <= 0) return payload;
    const featureSettings = parseSettings(options[PLUGIN_OPTION_KEY]);
    if (!isEnabled(featureSettings.showCommentManagement)) return payload;

    const auth = await requireAdminAction(request, 'administrator', { csrf: false });
    if (isAdminActionResponse(auth) || !auth.user.authCode) return payload;

    const content = await auth.db.query.contents.findFirst({
      columns: { type: true },
      where: eq(schema.contents.cid, cid),
    });
    if (!content || (content.type !== 'post' && content.type !== 'page')) return payload;

    const settings = parseSettings(auth.options[OPTION_KEY]);
    const csrfToken = await generateSecurityToken(auth.options.secret, auth.user.authCode, auth.uid);
    return {
      ...payload,
      management: {
        canManage: true,
        adminUrl: computeUrls(auth.options).adminUrl,
        contentType: content.type,
        isPinned: content.type === 'post' && parsePinnedIds(settings.pinnedIds).includes(cid),
        csrfToken,
      },
    };
  }, 20);
}
