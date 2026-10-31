
import type { APIRoute } from 'astro';
import { setOption } from '@/lib/options';
import { isAdminActionResponse, requireAdminAction } from '@/lib/admin-auth';
import { loadThemeConfig } from '@/lib/theme';
import { parsePinnedIds, WARM_THEME_ID } from '@/themes/typecho-theme-warm-cy/components/warm';

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdminAction(request, 'administrator');
  if (isAdminActionResponse(auth)) {
    return errorResponse('权限不足或登录已失效', auth.status === 401 ? 401 : 403);
  }

  // 只允许 CY 主题使用此接口
  if (String(auth.options.theme || '') !== WARM_THEME_ID) {
    return errorResponse('当前主题不是 CY 主题', 409);
  }

  let body: { cid?: unknown; pinned?: unknown };

  try {
    body = await request.json() as { cid?: unknown; pinned?: unknown };
  } catch {
    return errorResponse('请求格式错误', 400);
  }

  const cid = Number(body.cid);

  if (!Number.isSafeInteger(cid) || cid <= 0 || typeof body.pinned !== 'boolean') {
    return errorResponse('文章参数无效', 400);
  }

  // 读取现有配置，保留其他所有主题设置
  const settings = loadThemeConfig(auth.options, WARM_THEME_ID);
  const pinnedIds = parsePinnedIds(settings.pinnedIds);

  // 只调整当前文章 ID，不影响其他置顶文章
  const nextPinnedIds = body.pinned
    ? [...pinnedIds.filter(id => id !== cid), cid]
    : pinnedIds.filter(id => id !== cid);

  await setOption(
    auth.db,
    `theme:${WARM_THEME_ID}`,
    JSON.stringify({
      ...settings,
      pinnedIds: nextPinnedIds.join(','),
    }),
  );

  return new Response(JSON.stringify({
    success: true,
    pinned: body.pinned,
    pinnedIds: nextPinnedIds,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
