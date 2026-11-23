import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { isAdminActionResponse, requireAdminAction } from '@/lib/admin-auth';
import { generateSecurityToken } from '@/lib/auth';
import { getOption, setOption } from '@/lib/options';
import { loadThemeConfig } from '@/lib/theme';
import { parsePinnedIds } from '@/themes/typecho-theme-oxn/components/warm';

const THEME_ID = 'typecho-theme-oxn';

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  const auth = await requireAdminAction(request, 'administrator', { csrf: false });
  if (isAdminActionResponse(auth)) {
    return errorResponse('权限不足或登录已失效', auth.status === 401 ? 401 : 403);
  }

  // 只允许 OXN 主题使用此接口
  if (String(auth.options.theme || '') !== THEME_ID) {
    return errorResponse('当前主题不是 OXN 主题', 409);
  }

  const cid = Number(url.searchParams.get('cid'));
  if (!Number.isSafeInteger(cid) || cid <= 0) {
    return errorResponse('cid 参数无效', 400);
  }

  const content = await auth.db.query.contents.findFirst({
    columns: { cid: true, type: true },
    where: eq(schema.contents.cid, cid),
  });
  if (!content || (content.type !== 'post' && content.type !== 'page')) {
    return new Response(JSON.stringify({ management: null }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
    });
  }

  const settings = loadThemeConfig(auth.options, THEME_ID);
  const pinnedIds = parsePinnedIds(settings.pinnedIds);
  const csrfToken = await generateSecurityToken(
    auth.options.secret,
    auth.user.authCode!,
    auth.uid,
  );

  return new Response(JSON.stringify({
    management: {
      canManage: true,
      adminUrl: '/admin/',
      contentType: content.type,
      isPinned: content.type === 'post' && pinnedIds.includes(cid),
      csrfToken,
    },
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
      'Vary': 'Cookie',
    },
  });
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdminAction(request, 'administrator');
  if (isAdminActionResponse(auth)) {
    return errorResponse('权限不足或登录已失效', auth.status === 401 ? 401 : 403);
  }

  // 只允许 OXN 主题使用此接口
  if (String(auth.options.theme || '') !== THEME_ID) {
    return errorResponse('当前主题不是 OXN 主题', 409);
  }

  let body: { cid?: unknown; pinned?: unknown; confirmation?: unknown };

  try {
    body = await request.json() as { cid?: unknown; pinned?: unknown; confirmation?: unknown };
  } catch {
    return errorResponse('请求格式错误', 400);
  }

  const cid = Number(body.cid);

  if (!Number.isSafeInteger(cid) || cid <= 0 || typeof body.pinned !== 'boolean' || body.confirmation !== '确认') {
    return errorResponse('文章参数无效或未确认操作', 400);
  }

  // 与 CY 一致：只允许对已发布的文章执行置顶操作
  const content = await auth.db.query.contents.findFirst({
    columns: { cid: true, type: true, status: true },
    where: eq(schema.contents.cid, cid),
  });
  if (!content || content.type !== 'post' || content.status !== 'publish') {
    return errorResponse('文章不存在或不是已发布文章', 404);
  }

  // 读取现有配置，保留其他所有主题设置
  const settings = loadThemeConfig(auth.options, THEME_ID);
  const pinnedIds = parsePinnedIds(settings.pinnedIds);

  // 保留 OXN 规则：新置顶文章排在最前面
  const nextPinnedIds = body.pinned
    ? [cid, ...pinnedIds.filter(id => id !== cid)]
    : pinnedIds.filter(id => id !== cid);

  try {
    await setOption(
      auth.db,
      `theme:${THEME_ID}`,
      JSON.stringify({
        ...settings,
        pinnedIds: nextPinnedIds.join(','),
      }),
    );

    // 直接从数据库读回，不使用主题配置缓存验证写入结果
    const storedValue = await getOption(auth.db, `theme:${THEME_ID}`);
    if (!storedValue) {
      return errorResponse('数据库未读回置顶配置，操作失败', 500);
    }

    let storedSettings: { pinnedIds?: unknown };
    try {
      storedSettings = JSON.parse(storedValue) as { pinnedIds?: unknown };
    } catch {
      return errorResponse('数据库置顶配置格式异常，操作失败', 500);
    }

    const storedPinnedIds = parsePinnedIds(storedSettings.pinnedIds);
    const verified = body.pinned
      ? storedPinnedIds.includes(cid)
      : !storedPinnedIds.includes(cid);

    if (!verified) {
      return errorResponse('数据库未确认置顶状态，操作失败', 500);
    }

    return new Response(JSON.stringify({
      success: true,
      pinned: body.pinned,
      pinnedIds: storedPinnedIds,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return errorResponse('置顶操作写入或数据库核验失败', 500);
  }
};
