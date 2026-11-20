import { registerPluginAdminPath } from 'typecho/plugin-sdk';
import type { PluginInitContext, PluginRouteResult } from 'typecho/plugin-sdk';
import { isAdminActionResponse, requireAdminAction } from '@/lib/admin-auth';
import { invalidatePublicCache } from '@/lib/cache';
import { jsonError, jsonOk } from '@/lib/http';
import { escapeAttr } from 'typecho/plugin-sdk';
import { importWordPressExport, previewWordPressImport } from './service';
import { wordpressImportAdminPageHtml } from './admin';

const API_PATH = '/api/admin/wordpress-import';
const MAX_WXR_BYTES = 25 * 1024 * 1024;

export default function init({ addHook, pluginId }: PluginInitContext): void {
  registerPluginAdminPath(API_PATH);

  addHook('route:request', pluginId, async (
    result: PluginRouteResult,
    extra?: { request?: Request; path?: string },
  ) => {
    if (result?.handled || !extra?.request || extra.path !== API_PATH) return result;

    const request = extra.request;
    if (request.method !== 'POST') {
      return { handled: true, response: jsonError(405, 'Method not allowed') };
    }

    const auth = await requireAdminAction(request, 'administrator');
    if (isAdminActionResponse(auth)) {
      return {
        handled: true,
        response: jsonError(auth.status, auth.status === 401 ? 'Unauthorized' : 'Forbidden'),
      };
    }

    try {
      const form = await request.formData();
      const file = form.get('file');
      const action = String(form.get('action') || 'preview');
      if (!(file instanceof File)) {
        return { handled: true, response: jsonError(400, '请选择 WordPress WXR XML 文件') };
      }
      if (file.size === 0) {
        return { handled: true, response: jsonError(400, '导入文件为空') };
      }
      if (file.size > MAX_WXR_BYTES) {
        return { handled: true, response: jsonError(413, '文件超过 25 MB，请拆分 WordPress 导出文件后再导入') };
      }
      if (!file.name.toLowerCase().endsWith('.xml') && file.type !== 'text/xml' && file.type !== 'application/xml') {
        return { handled: true, response: jsonError(400, '文件格式不正确，请选择 WordPress 导出的 XML 文件') };
      }

      const xml = await file.text();
      const report = action === 'import'
        ? await importWordPressExport(auth.db, xml, auth.uid)
        : await previewWordPressImport(auth.db, xml, auth.uid);

      if (action === 'import') {
        await invalidatePublicCache(auth.db, {
          reason: 'wordpress-import',
          domains: ['home', 'post', 'page', 'archive'],
          sharedDomains: ['admin-content'],
        });
      }

      return { handled: true, response: jsonOk(report) };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'WordPress 导入失败';
      console.error('[wordpress-import] request failed:', error);
      return { handled: true, response: jsonError(400, message) };
    }
  }, 20);

  addHook('admin:page', pluginId, (
    html: string,
    extra?: { slug?: string; csrfToken?: string },
  ) => {
    if (extra?.slug !== 'wordpress-import') return html;
    return wordpressImportAdminPageHtml(escapeAttr(extra.csrfToken || ''));
  });

  addHook('admin:footer', pluginId, (
    html: string,
    extra?: { activeMenu?: string; user?: { group?: string } },
  ) => {
    if (extra?.user?.group !== 'administrator') return html;
    const active = extra?.activeMenu === 'wordpress-import';
    return html + `<script>
(function(){
  var link=document.querySelector('.typecho-head-nav nav > menu > li > menu a[href="/admin/manage-posts"]');
  if(!link)return;
  var item=document.createElement('li');
  item.className=${active ? "'focus'" : "''"};
  var anchor=document.createElement('a');
  anchor.href='/admin/plugin/wordpress-import';
  anchor.textContent='WordPress 导入';
  item.appendChild(anchor);
  link.parentElement.insertAdjacentElement('afterend',item);
  if(${active ? 'true' : 'false'})link.closest('li').parentElement.parentElement.classList.add('focus');
})();
</script>`;
  });
}
