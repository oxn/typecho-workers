import { eq } from 'drizzle-orm';
import { schema } from 'typecho/db';
import { registerPluginAdminPath, setOption } from 'typecho/plugin-sdk';
import type { PluginInitContext, PluginRouteResult } from 'typecho/plugin-sdk';
import { generateSecurityToken } from '@/lib/auth';
import { isAdminActionResponse, requireAdminAction } from '@/lib/admin-auth';
import { computeUrls } from '@/lib/options';
import adminCss from './admin.css?raw';
import { inlineHtmlRuntimeLight, protectInlineHtmlLight, restoreInlineHtmlFragmentsLight } from './html-light';
import { inlineHtmlRuntime, protectInlineHtml, restoreInlineHtmlFragments } from './html-full';
import { protectVideoIframesForMarkdown, restoreVideoIframesAfterMarkdown, replaceVideoIframesWithPlaceholders, videoPlayerRuntime } from './video-player';
import { markdownAlertIconStyles, normalizeMarkdownAlertStyleSettings, restoreMarkdownAlertIcons } from './markdown-alerts';
import { featureSettingsPageHtml } from './admin-settings';
import { adminNavigationRuntime, globalSearchRuntime } from './frontend-runtimes';

const THEME_ID = 'typecho-theme-warm-cy';
const OPTION_KEY = `theme:${THEME_ID}`;
const ADMIN_PATH = '/api/admin/theme-pin';
const ADMIN_SETTINGS_API_PATH = '/api/admin/cy-companion-settings';
const ADMIN_PAGE_SLUG = 'cy-companion';
const PLUGIN_OPTION_KEY = 'plugin:typecho-plugin-warm-cy';
const PLUGIN_VERSION = '2026.11.05.10.20';

let activeCyPluginSettings: { theme: unknown; pluginSettings: unknown } | null = null;

function resolveCyPluginSettings(requestContext?: {
  options?: Record<string, unknown>;
}): { theme: unknown; pluginSettings: unknown } | null {
  const options = requestContext?.options;
  if (options) {
    return { theme: options.theme, pluginSettings: options[PLUGIN_OPTION_KEY] };
  }
  return activeCyPluginSettings;
}

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

function getHtmlEnhancementMode(settings: Record<string, unknown>): 'off' | 'light' | 'full' {
  const mode = settings.htmlEnhancementMode;
  if (mode === 'off' || mode === 'light' || mode === 'full') return mode;
  // Backward compatibility: the former enabled checkbox maps to the legacy light mode.
  return isEnabled(settings.htmlEnhancementEnabled, false) ? 'light' : 'off';
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

  // The upstream content filters intentionally receive only their value.
  // Capture site-wide options through the normal request lifecycle hook instead
  // of extending or modifying the core filter signature.
  addHook('system:begin', pluginId, (context?: {
    options?: Record<string, unknown>;
  }) => {
    const options = context?.options;
    activeCyPluginSettings = options
      ? { theme: options.theme, pluginSettings: options[PLUGIN_OPTION_KEY] }
      : null;
  });

  // Optional second arguments keep these handlers easy to unit-test and
  // compatible with third-party callers; upstream core uses the captured
  // system:begin snapshot because it passes only the content value.
  addHook('content:markdown', pluginId, (content: string, requestContext?: {
    options?: Record<string, unknown>;
  }) => {
    const requestOptions = resolveCyPluginSettings(requestContext);
    if (requestOptions?.theme !== THEME_ID) return content;
    const settings = parsePluginSettings(requestOptions.pluginSettings);
    const videoEnabled = isEnabled(settings.videoPlayerEnabled ?? settings.mobileNativePlayerEnhancementEnabled, false);
    const withVideo = videoEnabled ? protectVideoIframesForMarkdown(content) : content;
    const htmlMode = getHtmlEnhancementMode(settings);
    if (htmlMode === 'light') return protectInlineHtmlLight(withVideo);
    if (htmlMode === 'full') return protectInlineHtml(withVideo);
    return withVideo;
  }, 1);

  // Markdown Alert icons remain a separate legacy CY-theme behavior.
  // HTML fragment restoration runs only when its own enhancement is enabled.
  addHook('content:content', pluginId, (content: string, requestContext?: {
    options?: Record<string, unknown>;
  }) => {
    const requestOptions = resolveCyPluginSettings(requestContext);
    if (requestOptions?.theme !== THEME_ID) return content;
    const settings = parsePluginSettings(requestOptions.pluginSettings);
    const withAlertIcons = restoreMarkdownAlertIcons(content, settings.markdownAlertStyleSettings);
    const htmlMode = getHtmlEnhancementMode(settings);
    const withHtml = htmlMode === 'light'
      ? restoreInlineHtmlFragmentsLight(withAlertIcons)
      : htmlMode === 'full'
        ? restoreInlineHtmlFragments(withAlertIcons)
        : withAlertIcons;
    const videoEnabled = isEnabled(settings.videoPlayerEnabled ?? settings.mobileNativePlayerEnhancementEnabled, false);
    if (!videoEnabled) return withHtml;
    return replaceVideoIframesWithPlaceholders(restoreVideoIframesAfterMarkdown(withHtml));
  }, 1);

  // Frontend output is scoped to Warm CY and each feature's own toggle.
  addHook('archive:footer', pluginId, (html: string, extra?: {
    options?: Record<string, unknown>;
  }) => {
    const options = extra?.options;
    if (!options || options.theme !== THEME_ID) return html;
    const settings = parsePluginSettings(options[PLUGIN_OPTION_KEY]);
    const htmlMode = getHtmlEnhancementMode(settings);
    const htmlRuntime = htmlMode === 'light'
      ? inlineHtmlRuntimeLight(true, isEnabled(settings.htmlScriptExecutionEnabled, false))
      : htmlMode === 'full'
        ? inlineHtmlRuntime(isEnabled(settings.htmlScriptExecutionEnabled, false))
        : '';
    const alertIconStyle = markdownAlertIconStyles(settings.markdownAlertStyleSettings);
    const videoPlayer = videoPlayerRuntime(
      isEnabled(settings.videoPlayerEnabled ?? settings.mobileNativePlayerEnhancementEnabled, false),
    );
    if (!isEnabled(settings.showHomeSearchButton)) {
      return html + alertIconStyle + htmlRuntime + videoPlayer;
    }
    const searchBase = JSON.stringify(
      String(computeUrls(options as any).siteUrl || '/').replace(/\/?$/, '/'),
    ).replace(/</g, '\\u003c');
    return `${html}${alertIconStyle}${htmlRuntime}${videoPlayer}${globalSearchRuntime(searchBase)}`;
  }, 20);

  addHook('admin:header', pluginId, (html: string, extra?: {
    title?: string;
    options?: Record<string, unknown>;
  }) => {
    if (extra?.options?.theme !== THEME_ID
      || (extra?.title !== '设置外观' && extra?.title !== 'CY 功能显示')) return html;
    return `${html}<style data-warm-cy-admin>${adminCss}</style>`;
  }, 20);

  // Add the companion settings entry to the existing Settings menu without
  // changing the core Admin layout. Also decorate the theme settings form.
  addHook('admin:footer', pluginId, (html: string, extra?: {
    options?: Record<string, unknown>;
  }) => {
    if (extra?.options?.theme !== THEME_ID) return html;
    const pluginPath = `/admin/plugin/${ADMIN_PAGE_SLUG}`;
    return `${html}${adminNavigationRuntime(pluginPath)}`;
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
      PLUGIN_VERSION,
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
        htmlEnhancementEnabled?: unknown;
        htmlEnhancementMode?: unknown;
        htmlScriptExecutionEnabled?: unknown;
        markdownAlertStyleSettings?: unknown;
        videoPlayerEnabled?: unknown;
        mobileNativePlayerEnhancementEnabled?: unknown;
      };
      const videoPlayerValue = typeof values.videoPlayerEnabled === 'boolean'
        ? values.videoPlayerEnabled
        : values.mobileNativePlayerEnhancementEnabled;
      const htmlMode = typeof values.htmlEnhancementMode === 'string'
        ? values.htmlEnhancementMode
        : typeof values.htmlEnhancementEnabled === 'boolean'
          ? (values.htmlEnhancementEnabled ? 'light' : 'off')
          : null;
      if (typeof values.showCommentManagementButtons !== 'boolean'
        || typeof values.showHomeSearchButton !== 'boolean'
        || (htmlMode !== 'off' && htmlMode !== 'light' && htmlMode !== 'full')
        || (values.htmlScriptExecutionEnabled !== undefined && typeof values.htmlScriptExecutionEnabled !== 'boolean')
        || typeof videoPlayerValue !== 'boolean') {
        return { handled: true, response: json({ error: 'Invalid settings' }, 400) };
      }
      const current = parsePluginSettings(auth.options[PLUGIN_OPTION_KEY]);
      const next = {
        ...current,
        showCommentManagementButtons: values.showCommentManagementButtons ? '1' : '0',
        showHomeSearchButton: values.showHomeSearchButton ? '1' : '0',
        htmlEnhancementMode: htmlMode,
        htmlScriptExecutionEnabled: values.htmlScriptExecutionEnabled === true ? '1' : '0',
        videoPlayerEnabled: videoPlayerValue ? '1' : '0',
      };
      if (values.markdownAlertStyleSettings !== undefined) {
        next.markdownAlertStyleSettings = normalizeMarkdownAlertStyleSettings(values.markdownAlertStyleSettings);
      }
      delete next.htmlEnhancementEnabled;
      delete next.mobileNativePlayerEnhancementEnabled;
      await setOption(auth.db, PLUGIN_OPTION_KEY, JSON.stringify(next));
      return { handled: true, response: json({ success: true }) };
    }

    const { cid, pinned, confirmation } = body as { cid?: unknown; pinned?: unknown; confirmation?: unknown };
    const contentId = Number(cid);
    if (!Number.isSafeInteger(contentId) || contentId <= 0 || typeof pinned !== 'boolean' || confirmation !== '确认') {
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

    // Skip all comment-management work when this feature is switched off.
    const requestSettings = parsePluginSettings(options[PLUGIN_OPTION_KEY]);
    if (!isEnabled(requestSettings.showCommentManagementButtons)) return payload;

    const auth = await requireAdminAction(request, 'administrator', { csrf: false });
    if (isAdminActionResponse(auth) || !auth.user.authCode) return payload;
    const featureSettings = parsePluginSettings(auth.options[PLUGIN_OPTION_KEY]);
    if (!isEnabled(featureSettings.showCommentManagementButtons)) return payload;

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
        showManagementButtons: true,
        adminUrl: computeUrls(auth.options).adminUrl,
        contentType: content.type,
        isPinned: content.type === 'post' && parsePinnedIds(settings.pinnedIds).includes(cid),
        csrfToken,
      },
    };
  }, 20);
}
