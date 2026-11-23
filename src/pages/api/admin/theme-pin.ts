import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { generateSecurityToken } from '@/lib/auth';
import { isAdminActionResponse, requireAdminAction } from '@/lib/admin-auth';
import { setOption } from '@/lib/options';
import { loadThemeConfig } from '@/lib/theme';

const THEME_ID = 'typecho-theme-oxn';
const RESPONSE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'private, no-store',
};

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: RESPONSE_HEADERS,
  });
}

function readPinnedIds(value: unknown): number[] {
  return String(value || '')
    .split(/[，,\s]+/)
    .map(item => Number(item.trim()))
    .filter(id => Number.isSafeInteger(id) && id > 0);
}

export const GET: APIRoute = async ({ request, url }) => {
  const auth = await requireAdminAction(request, 'administrator', { csrf: false });
  if (isAdminActionResponse(auth)) {
    return jsonResponse({ error: '权限不足' }, auth.status === 401 ? 401 : 403);
  }

  if (String(auth.options.theme || '') !== THEME_ID) {
    return jsonResponse({ error: '当前主题不是 OXN' }, 404);
  }

  const settings = loadThemeConfig(auth.options, THEME_ID);
  if (String(settings.showCommentManagementButtons ?? '1') === '0') {
    return jsonResponse({ error: '评论区管理按钮已关闭' }, 404);
  }

  const cid = Number(url.searchParams.get('cid'));
  const content = await auth.db.query.contents.findFirst({
    where: eq(schema.contents.cid, cid),
  });
  if (!content || (content.type !== 'post' && content.type !== 'page')) {
    return jsonResponse({ error: '内容不存在' }, 404);
  }

  const pinnedIds = readPinnedIds(settings.pinnedIds);
  const csrfToken = await generateSecurityToken(
    auth.options.secret as string,
    auth.user.authCode!,
    auth.uid,
  );

  return jsonResponse({
    canManage: true,
    adminUrl: '/admin/',
    contentType: content.type,
    isPinned: content.type === 'post' && pinnedIds.includes(cid),
    csrfToken,
  });
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdminAction(request, 'administrator');
  if (isAdminActionResponse(auth)) {
    return jsonResponse({ error: '权限不足' }, auth.status === 401 ? 401 : 403);
  }

  if (String(auth.options.theme || '') !== THEME_ID) {
    return jsonResponse({ error: '当前主题不是 OXN' }, 404);
  }

  let body: { cid?: number; pinned?: boolean };
  try {
    body = await request.json() as { cid?: number; pinned?: boolean };
  } catch {
    return jsonResponse({ error: '请求格式错误' }, 400);
  }

  const cid = Number(body.cid);
  if (!Number.isSafeInteger(cid) || cid <= 0 || typeof body.pinned !== 'boolean') {
    return jsonResponse({ error: '文章 ID 或置顶状态无效' }, 400);
  }

  const content = await auth.db.query.contents.findFirst({
    where: eq(schema.contents.cid, cid),
  });
  if (!content || content.type !== 'post') {
    return jsonResponse({ error: '文章不存在' }, 404);
  }

  const settings = loadThemeConfig(auth.options, THEME_ID);
  const pinnedIds = readPinnedIds(settings.pinnedIds).filter(id => id !== cid);
  if (body.pinned) pinnedIds.unshift(cid);

  await setOption(auth.db, `theme:${THEME_ID}`, JSON.stringify({
    ...settings,
    pinnedIds: [...new Set(pinnedIds)].join(','),
  }));

  return jsonResponse({ success: true, cid, pinned: body.pinned });
};
