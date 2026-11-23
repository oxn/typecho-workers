import type { APIRoute } from 'astro';
import { isAdminActionResponse, requireAdminAction } from '@/lib/admin-auth';
import { setOption } from '@/lib/options';
import { loadThemeConfig } from '@/lib/theme';
import { parsePinnedIds } from '@/themes/typecho-theme-oxn/components/warm';

const THEME_ID = 'typecho-theme-oxn';

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

  // 只允许 OXN 主题使用此接口
  if (String(auth.options.theme || '') !== THEME_ID) {
    return errorResponse('当前主题不是 OXN 主题', 409);
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
  const settings = loadThemeConfig(auth.options, THEME_ID);
  const pinnedIds = parsePinnedIds(settings.pinnedIds);

  // 保留 OXN 规则：新置顶文章排在最前面
  const nextPinnedIds = body.pinned
    ? [cid, ...pinnedIds.filter(id => id !== cid)]
    : pinnedIds.filter(id => id !== cid);

  await setOption(
    auth.db,
    `theme:${THEME_ID}`,
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
