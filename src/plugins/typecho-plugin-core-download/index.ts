import { and, eq, lte, or } from 'drizzle-orm';
import { schema } from 'typecho/db';
import type { Database } from 'typecho/db';
import { registerPluginAdminPath } from 'typecho/plugin-sdk';
import type { PluginInitContext, PluginRouteResult } from 'typecho/plugin-sdk';
import { requireAdminAction, isAdminActionResponse } from '@/lib/admin-auth';
import { jsonError, jsonOk } from '@/lib/http';
import { coreDownloadPostEditorHtml, coreDownloadSettingsPageHtml } from './admin';
import { buildCoreDownloadClientScript } from './client-runtime';
import { CORE_DOWNLOAD_STATIC_ASSETS } from './static-assets';
import { getCoreDownloadForTheme, getCoreDownloadSettings, saveCoreDownloadSettings } from './service';

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
export const CORE_DOWNLOAD_DATA_API_PATH = '/api/core-download/data';
export const CORE_DOWNLOAD_CLIENT_API_PATH = '/api/core-download/client.js';
export const CORE_DOWNLOAD_ASSET_PREFIX = '/__plugin-assets/typecho-plugin-core-download/';

interface PluginRouteExtra {
  request?: Request;
  path?: string;
  db?: Database;
}

async function resolvePost(db: Database, pathname: string): Promise<{ cid: number; password: string | null } | null> {
  const archiveMatch = pathname.match(/(?:^|\/)archives\/(\d+)(?:\.html)?\/?$/i);
  if (archiveMatch) {
    const cid = Number(archiveMatch[1]);
    if (!Number.isSafeInteger(cid) || cid <= 0) return null;
    return await db.query.contents.findFirst({
      where: and(
        eq(schema.contents.cid, cid),
        eq(schema.contents.type, 'post'),
        or(eq(schema.contents.status, 'publish'), eq(schema.contents.status, 'hidden')),
        lte(schema.contents.created, Math.floor(Date.now() / 1000)),
      ),
      columns: { cid: true, password: true },
    }) ?? null;
  }

  const segments = pathname.split('/').filter(Boolean);
  const lastSegment = segments[segments.length - 1];
  if (!lastSegment) return null;
  let slug = lastSegment;
  try { slug = decodeURIComponent(slug); } catch { /* Keep the literal path segment. */ }
  slug = slug.replace(/\.html$/i, '');
  if (!slug) return null;

  return await db.query.contents.findFirst({
    where: and(
      eq(schema.contents.slug, slug),
      eq(schema.contents.type, 'post'),
      or(eq(schema.contents.status, 'publish'), eq(schema.contents.status, 'hidden')),
      lte(schema.contents.created, Math.floor(Date.now() / 1000)),
    ),
    columns: { cid: true, password: true },
  }) ?? null;
}

export default function init({ addHook, pluginId }: PluginInitContext): void {
  registerPluginAdminPath(CORE_DOWNLOAD_ADMIN_API_PATH);

  addHook(
    'route:request',
    pluginId,
    async (result: PluginRouteResult, extra?: PluginRouteExtra) => {
      if (result?.handled || !extra?.request || !extra.path) return result;


      if (extra.path.startsWith(CORE_DOWNLOAD_ASSET_PREFIX)) {
        const assetPath = extra.path.slice(CORE_DOWNLOAD_ASSET_PREFIX.length);
        const asset = CORE_DOWNLOAD_STATIC_ASSETS[assetPath];
        if (!asset) return result;
        if (extra.request.method !== 'GET' && extra.request.method !== 'HEAD') {
          return { handled: true, response: new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } }) };
        }
        let body: BodyInit | null = null;
        if (extra.request.method !== 'HEAD') {
          if (asset.encoding === 'base64') {
            const binary = atob(asset.content);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
            body = bytes;
          } else body = asset.content;
        }
        return { handled: true, response: new Response(body, { headers: {
          'Content-Type': asset.contentType,
          'Cache-Control': 'public, max-age=300',
          'X-Content-Type-Options': 'nosniff',
        } }) };
      }

      if (extra.path === CORE_DOWNLOAD_CLIENT_API_PATH) {
        return {
          handled: true,
          response: new Response(buildCoreDownloadClientScript(), {
            headers: {
              'Content-Type': 'application/javascript; charset=utf-8',
              'Cache-Control': 'public, max-age=300',
            },
          }),
        };
      }

      if (extra.path === CORE_DOWNLOAD_DATA_API_PATH) {
        if (extra.request.method !== 'GET') {
          return { handled: true, response: jsonError(405, 'Method Not Allowed') };
        }
        if (!extra.db) {
          return { handled: true, response: jsonError(503, 'Database unavailable') };
        }
        const url = new URL(extra.request.url);
        const pathname = url.searchParams.get('path') || '/';
        const post = await resolvePost(extra.db, pathname);
        const suppliedPassword = url.searchParams.get('password');
        const passwordAllowed = !post?.password || suppliedPassword === post.password;
        const data = post && passwordAllowed
          ? await getCoreDownloadForTheme(extra.db, post.cid)
          : null;
        return {
          handled: true,
          response: new Response(JSON.stringify(data), {
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          }),
        };
      }

      if (extra.path !== CORE_DOWNLOAD_ADMIN_API_PATH) return result;
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
    'content:content',
    pluginId,
    (html: string) => html + '<div data-core-download></div>',
  );

  addHook(
    'archive:footer',
    pluginId,
    (html: string, extra?: { pageContext?: { pageType?: string } }) => {
      if (extra?.pageContext?.pageType !== 'post' && extra?.pageContext?.pageType !== 'page') return html;
      return html
        + '<script src="/api/core-download/client.js" defer></script>';
    },
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
