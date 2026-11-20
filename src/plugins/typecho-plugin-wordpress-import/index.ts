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

function collectErrorMessages(error: unknown): string {
  const messages: string[] = [];
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();

  while (pending.length) {
    const current = pending.pop();
    if (current == null || seen.has(current)) continue;
    if (typeof current === 'string') {
      messages.push(current);
      continue;
    }
    if (typeof current !== 'object' && typeof current !== 'function') {
      messages.push(String(current));
      continue;
    }
    seen.add(current);
    const value = current as { message?: unknown; cause?: unknown };
    if (typeof value.message === 'string') messages.push(value.message);
    if (value.cause !== undefined) pending.push(value.cause);
  }

  return messages.join('\n') || 'WordPress 导入失败';
}

export function classifyWordPressImportError(error: unknown): { status: number; message: string } {
  const detail = collectErrorMessages(error);

  if (/free tier daily row (?:read|write) limit/i.test(detail)) {
    return {
      status: 429,
      message: 'Cloudflare D1 免费计划的每日读写行额度已用尽。请等待 UTC 午夜额度重置，或升级 Workers 计划；之后重新分析同一 XML 即可继续，已成功导入的内容会自动跳过。',
    };
  }
  if (/maximum db size|maximum account storage limit|exceeded maximum db size/i.test(detail)) {
    return {
      status: 507,
      message: 'Cloudflare D1 数据库存储空间已达到上限。本次分片未能确认完成，请先处理数据库容量问题，再重新分析 XML。',
    };
  }
  if (/storage operation exceeded timeout|timed?\s*out|timeout/i.test(detail)) {
    return {
      status: 504,
      message: 'Cloudflare D1 数据库写入超时。本次分片的 batch 事务会整体回滚；请稍后重试，若仍失败，需要减小导入分片。',
    };
  }
  if (/overloaded|too many requests queued|network connection lost|temporarily unavailable|transient issue|object was reset|isolate exceeded its memory|cpu time limit/i.test(detail)) {
    return {
      status: 503,
      message: 'Cloudflare D1 当前繁忙或正在恢复，暂时无法完成本次写入。请稍后重新分析并继续导入，不要同时启动多个导入任务。',
    };
  }
  if (/D1_ERROR|D1_EXEC_ERROR|SQLITE_ERROR|SQLITE_CONSTRAINT|too many SQL variables|database/i.test(detail)) {
    return {
      status: 500,
      message: 'Cloudflare D1 拒绝了本次数据库操作。请查看服务器日志中的 [wordpress-import] 详细错误；本次失败的 batch 事务不会只提交一部分。',
    };
  }

  return { status: 422, message: detail };
}

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
      if (action !== 'preview' && action !== 'import') {
        return { handled: true, response: jsonError(400, '无效的导入操作') };
      }
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
          domains: ['home', 'post', 'page', 'note', 'archive', 'other'],
          sharedDomains: [
            'navigation',
            'sidebar',
            'metas',
            'comments',
            'notes',
            'archive',
            'content',
            'admin-dashboard',
            'admin-content',
            'admin-comments',
            'admin-metas',
            'admin-media',
          ],
        });
      }

      return { handled: true, response: jsonOk(report) };
    } catch (error) {
      const failure = classifyWordPressImportError(error);
      console.error('[wordpress-import] request failed:', error);
      return { handled: true, response: jsonError(failure.status, failure.message) };
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
  var menu=link.parentElement;
  if(!menu)return;
  var item=document.createElement('li');
  item.className=${active ? "'focus'" : "''"};
  var anchor=document.createElement('a');
  anchor.href='/admin/plugin/wordpress-import';
  anchor.textContent='WordPress 导入';
  item.appendChild(anchor);
  menu.appendChild(item);
  if(${active ? 'true' : 'false'})link.closest('li').parentElement.parentElement.classList.add('focus');
})();
</script>`;
  });
}
