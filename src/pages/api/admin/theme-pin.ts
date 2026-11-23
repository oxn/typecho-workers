import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
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
