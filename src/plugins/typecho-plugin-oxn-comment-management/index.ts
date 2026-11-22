import { eq } from 'drizzle-orm';
import { schema } from 'typecho/db';
import type { PluginInitContext } from 'typecho/plugin-sdk';
import { generateSecurityToken } from '@/lib/auth';
import { isAdminActionResponse, requireAdminAction } from '@/lib/admin-auth';
import { computeUrls } from '@/lib/options';

const THEME_ID = 'typecho-theme-oxn';
const THEME_OPTION_KEY = `theme:${THEME_ID}`;

function parseThemeSettings(value: unknown): Record<string, unknown> {
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

function parsePinnedIds(value: unknown): number[] {
  if (typeof value !== 'string' && typeof value !== 'number') return [];
  const result: number[] = [];
  const seen = new Set<number>();
  for (const part of String(value).split(/[，,\\s]+/)) {
    if (!/^\\d+$/.test(part.trim())) continue;
    const cid = Number(part.trim());
    if (!Number.isSafeInteger(cid) || cid <= 0 || seen.has(cid)) continue;
    seen.add(cid);
    result.push(cid);
  }
  return result;
}

export default function init({ addHook, pluginId }: PluginInitContext): void {
  addHook('comment:list', pluginId, async (
    payload: Record<string, unknown>,
    extra?: { request?: Request; options?: Record<string, unknown>; cid?: number },
  ) => {
    const request = extra?.request;
    const options = extra?.options;
    const cid = Number(extra?.cid);

    // 只在 OXN 主题的文章和独立页面评论请求中提供管理信息。
    if (
      !request ||
      !options ||
      options.theme !== THEME_ID ||
      !Number.isSafeInteger(cid) ||
      cid <= 0
    ) {
      return payload;
    }

    // 每次评论 API 请求都根据本次 Cookie 重新验证，不读取页面预先写入的登录状态。
    const auth = await requireAdminAction(request, 'administrator', { csrf: false });
    if (isAdminActionResponse(auth) || !auth.user.authCode) return payload;

    const content = await auth.db.query.contents.findFirst({
      columns: { type: true },
      where: eq(schema.contents.cid, cid),
    });
    if (!content || (content.type !== 'post' && content.type !== 'page')) return payload;

    const themeSettings = parseThemeSettings(auth.options[THEME_OPTION_KEY]);
    const csrfToken = await generateSecurityToken(
      auth.options.secret,
      auth.user.authCode,
      auth.uid,
    );

    return {
      ...payload,
      management: {
        canManage: true,
        showManagementButtons: isEnabled(themeSettings.showCommentManagementButtons),
        adminUrl: computeUrls(auth.options).adminUrl,
        contentType: content.type,
        isPinned: content.type === 'post' && parsePinnedIds(themeSettings.pinnedIds).includes(cid),
        csrfToken,
      },
    };
  }, 20);
}
