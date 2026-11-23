import type { APIRoute } from 'astro';
import { and, eq, inArray } from 'drizzle-orm';
import { schema, type Database } from '@/db';
import { isAdminActionResponse, requireAdminAction } from '@/lib/admin-auth';
import { generateSecurityToken } from '@/lib/auth';
import { bumpCacheVersion } from '@/lib/cache';
import { loadThemeConfig } from '@/lib/theme';
import { parsePinnedIds } from '@/themes/typecho-theme-oxn/components/warm';

const THEME_ID = 'typecho-theme-oxn';
const PIN_OPTION_NAME = `theme-pin:${THEME_ID}`;

async function readPinnedIds(db: Database): Promise<number[] | null> {
  const row = await db.query.options.findFirst({
    columns: { value: true },
    where: eq(schema.options.name, PIN_OPTION_NAME),
  });
  return row ? parsePinnedIds(row.value) : null;
}

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

  // 主题设置专用读取：只返回独立数据库中的完整置顶列表。
  if (url.searchParams.get('list') === '1') {
    const pinnedIds = (await readPinnedIds(auth.db))
      ?? parsePinnedIds(loadThemeConfig(auth.options, THEME_ID).pinnedIds);
    return new Response(JSON.stringify({ success: true, pinnedIds }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store',
        'Vary': 'Cookie',
      },
    });
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

  const pinnedIds = (await readPinnedIds(auth.db)) ?? parsePinnedIds(loadThemeConfig(auth.options, THEME_ID).pinnedIds);
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

  let body: {
    cid?: unknown;
    pinned?: unknown;
    action?: unknown;
    pinnedIds?: unknown;
    confirmation?: unknown;
  };

  try {
    body = await request.json() as typeof body;
  } catch {
    return errorResponse('请求格式错误', 400);
  }

  // 后台主题设置独立保存完整置顶列表；不经过主题配置保存接口。
  if (body.action === 'replace') {
    if (body.confirmation !== '确认' || typeof body.pinnedIds !== 'string') {
      return errorResponse('请确认操作并提供置顶 CID', 400);
    }

    const rawIds = body.pinnedIds.trim();
    const parts = rawIds ? rawIds.split(/[，,\\s]+/) : [];
    if (parts.some(value => !/^\\d+$/.test(value))) {
      return errorResponse('置顶 CID 格式无效，请使用英文逗号分隔正整数', 400);
    }

    const nextPinnedIds: number[] = [];
    const seen = new Set<number>();
    for (const part of parts) {
      const cid = Number(part);
      if (!Number.isSafeInteger(cid) || cid <= 0) {
        return errorResponse('置顶 CID 必须为正整数', 400);
      }
      if (!seen.has(cid)) {
        seen.add(cid);
        nextPinnedIds.push(cid);
      }
    }

    // 与前台置顶操作保持一致：列表中的每个 CID 都必须对应已发布文章。
    if (nextPinnedIds.length > 0) {
      const rows = await auth.db.query.contents.findMany({
        columns: { cid: true, type: true, status: true },
        where: inArray(schema.contents.cid, nextPinnedIds),
      });
      const validIds = new Set(rows
        .filter(row => row.type === 'post' && row.status === 'publish')
        .map(row => Number(row.cid)));
      const invalidIds = nextPinnedIds.filter(cid => !validIds.has(cid));
      if (invalidIds.length > 0) {
        return errorResponse(`以下 CID 不存在或不是已发布文章：${invalidIds.join(', ')}`, 400);
      }
    }

    try {
      const optionValue = nextPinnedIds.join(',');
      await auth.db
        .insert(schema.options)
        .values({ name: PIN_OPTION_NAME, user: 0, value: optionValue })
        .onConflictDoUpdate({
          target: [schema.options.name, schema.options.user],
          set: { value: optionValue },
        });

      // 与前台单篇置顶完全相同：只更新首页缓存，不触碰 options 缓存。
      await bumpCacheVersion(auth.db, {
        reason: 'theme-pin',
        domains: ['home'],
      });

      const storedPinnedIds = (await readPinnedIds(auth.db)) ?? [];
      const verified = storedPinnedIds.length === nextPinnedIds.length
        && storedPinnedIds.every((cid, index) => cid === nextPinnedIds[index]);
      if (!verified) {
        return errorResponse('数据库未确认置顶列表，保存失败', 500);
      }

      return new Response(JSON.stringify({
        success: true,
        pinnedIds: storedPinnedIds,
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'private, no-store',
        },
      });
    } catch {
      return errorResponse('置顶列表写入或数据库核验失败', 500);
    }
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

  // 置顶列表独立存储，不再读写主题设置或共享 options 缓存。
  const pinnedIds = (await readPinnedIds(auth.db)) ?? parsePinnedIds(loadThemeConfig(auth.options, THEME_ID).pinnedIds);

  // 保留 OXN 规则：新置顶文章排在最前面
  const nextPinnedIds = body.pinned
    ? [cid, ...pinnedIds.filter(id => id !== cid)]
    : pinnedIds.filter(id => id !== cid);

  try {
    const optionValue = nextPinnedIds.join(',');

    // 独立写入置顶专用 option；首页每次直接从 D1 读取，不经过共享 options 缓存。
    await auth.db
      .insert(schema.options)
      .values({ name: PIN_OPTION_NAME, user: 0, value: optionValue })
      .onConflictDoUpdate({
        target: [schema.options.name, schema.options.user],
        set: { value: optionValue },
      });

    // 只失效首页 HTML，不触碰 options 共享缓存。
    await bumpCacheVersion(auth.db, {
      reason: 'theme-pin',
      domains: ['home'],
    });

    // 从独立记录直接读回，核验数据库最终状态。
    const storedPinnedIds = (await readPinnedIds(auth.db)) ?? [];
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
