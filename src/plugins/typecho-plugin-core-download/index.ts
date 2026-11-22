import { registerPluginAdminPath } from 'typecho/plugin-sdk';
import type { PluginInitContext, PluginRouteResult } from 'typecho/plugin-sdk';
import { requireAdminAction, isAdminActionResponse } from '@/lib/admin-auth';
import { jsonError, jsonOk } from '@/lib/http';
import { coreDownloadPostEditorHtml, coreDownloadSettingsPageHtml } from './admin';
import { getCoreDownloadSettings, saveCoreDownloadSettings } from './service';

export {
  CORE_DOWNLOAD_META_FIELD,
  CORE_DOWNLOAD_SETTINGS_OPTION,
  decodeBase64Json,
  decodeBase64Utf8,
  encodeBase64Json,
  encodeBase64Utf8,
  getCoreDownloadForTheme,
  getCoreDownloadSettings,
  normalizeCoreDownloadPostData,
  saveCoreDownloadSettings,
} from './service';
export type {
  CoreDownloadItem,
  CoreDownloadPostData,
  CoreDownloadSettings,
  CoreDownloadThemeData,
} from './service';

export const CORE_DOWNLOAD_ADMIN_API_PATH = '/api/admin/core-download';

export default function init({ addHook, pluginId }: PluginInitContext): void {
  registerPluginAdminPath(CORE_DOWNLOAD_ADMIN_API_PATH);

  addHook(
    'route:request',
    pluginId,
    async (result: PluginRouteResult, extra?: { request?: Request; path?: string }) => {
      if (result?.handled || !extra?.request || extra.path !== CORE_DOWNLOAD_ADMIN_API_PATH) return result;
      const request = extra.request;
      const auth = await requireAdminAction(request, 'administrator', {
        csrf: request.method !== 'GET',
      });
      if (isAdminActionResponse(auth)) {
        return {
          handled: true,
          response: jsonError(auth.status, auth.status === 401 ? 'Unauthorized' : 'Forbidden'),
        };
      }

      if (request.method === 'GET') {
        return {
          handled: true,
          response: jsonOk({ success: true, settings: await getCoreDownloadSettings(auth.db) }),
        };
      }

      if (request.method === 'POST') {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return { handled: true, response: jsonError(400, '请求数据格式错误') };
        }
        const settings = await saveCoreDownloadSettings(auth.db, body);
        return { handled: true, response: jsonOk({ success: true, settings }) };
      }

      return { handled: true, response: jsonError(405, 'Method Not Allowed') };
    },
    20,
  );

  addHook(
    'admin:page',
    pluginId,
    (html: string, extra?: { slug?: string; csrfToken?: string }) => {
      if (extra?.slug !== 'core-download') return html;
      return coreDownloadSettingsPageHtml(extra.csrfToken || '');
    },
  );

  addHook(
    'admin:writePost:bottom',
    pluginId,
    (html: string) => html + coreDownloadPostEditorHtml(),
  );
}
