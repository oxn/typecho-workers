import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { isAdminActionResponse, requireAdminAction } from '@/lib/admin-auth';
import { setOption } from '@/lib/options';
import { loadThemeConfig } from '@/lib/theme';
import { jsonError, jsonOk } from '@/lib/http';

const THEME_ID = 'typecho-theme-oxn';

function parsePinnedIds(value: unknown): number[] {
  if (typeof value !== 'string') return [];
  return [...new Set(value.split(/[\\s,]+/)
    .map(value => Number(value))
    .filter(id => Number.isSafeInteger(id) && id > 0))];
}

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdminAction(request, 'administrator');
  if (isAdminActionResponse(auth)) {
    return jsonError(auth.status === 401 ? 401 : 403, auth.status === 401 ? 'Unauthorized' : 'Forbidden');
  }
  if (auth.options.theme !== THEME_ID) return jsonError(404, 'Theme is not active');

  let body: { cid?: unknown; pinned?: unknown; confirmation?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return jsonError(400, 'Invalid JSON'); }

  const cid = Number(body.cid);
  if (!Number.isSafeInteger(cid) || cid <= 0 || typeof body.pinned !== 'boolean' || body.confirmation !== '确认') {
    return jsonError(400, 'Invalid parameters');
  }
  const content = await auth.db.query.contents.findFirst({
    columns: { cid: true, type: true, status: true },
    where: eq(schema.contents.cid, cid),
  });
  if (!content || content.type !== 'post' || content.status !== 'publish') {
    return jsonError(404, 'Published post not found');
  }

  const settings = loadThemeConfig(auth.options, THEME_ID);
  const ids = parsePinnedIds(settings.pinnedIds).filter(id => id !== cid);
  if (body.pinned) ids.unshift(cid);
  await setOption(auth.db, `theme:${THEME_ID}`, JSON.stringify({ ...settings, pinnedIds: ids.join(',') }));
  return jsonOk({ success: true, pinned: body.pinned, pinnedIds: ids });
};
