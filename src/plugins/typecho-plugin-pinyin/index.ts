import { and, eq, sql } from 'drizzle-orm';
import { pinyin } from 'pinyin-pro';
import { registerPluginAdminPath } from 'typecho/plugin-sdk';
import type { PluginInitContext, PluginRouteResult } from 'typecho/plugin-sdk';
import { schema } from '@/db';
import { isAdminActionResponse, requireAdminAction } from '@/lib/admin-auth';

const ADMIN_PATH = '/api/admin/pinyin-slug';
const SAVE_SLUG_PARAM = '__pinyinSlug';
const MAX_SLUG_LENGTH = 180;
const MAX_SLUG_ATTEMPTS = 100;

type EditorExtra = {
  options?: Record<string, unknown>;
  post?: { cid?: number; slug?: string | null };
  page?: { cid?: number; slug?: string | null };
};

type SaveExtra = {
  request?: Request;
  db?: any;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  });
}

/**
 * Convert a title to a URL-safe ASCII slug.
 * Pinyin conversion stays in the Worker; the editor only sends the title.
 */
export function titleToPinyinSlug(title: string): string {
  const source = title.trim();
  if (!source) return '';

  // Keep separators only where the original title contains whitespace,
  // punctuation, or symbols. Pinyin syllables inside a continuous Han run
  // are concatenated instead of being separated with hyphens.
  const slug = source
    .split(/([\s\p{P}\p{S}]+)/u)
    .map((part) => {
      if (!part) return '';
      if (/^[\s\p{P}\p{S}]+$/u.test(part)) return '-';

      return pinyin(part, { toneType: 'none', nonZh: 'consecutive' })
        .replace(/\s+/g, '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-');
    })
    .join('')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '');
}

/** Normalize a manually edited slug using the same URL-safe character set. */
function normalizeSlug(value: string): string {
  return value
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
}

/**
 * Claim a unique slug after the core save has created/updated the content row.
 * This mirrors the core compare-and-swap strategy and avoids a SELECT/UPDATE race.
 */
async function claimUniqueSlug(db: any, cid: number, base: string): Promise<string> {
  let candidate = base;
  let suffix = 0;

  while (suffix < MAX_SLUG_ATTEMPTS) {
    const claimed = await db.update(schema.contents)
      .set({ slug: candidate })
      .where(and(
        eq(schema.contents.cid, cid),
        sql`NOT EXISTS (SELECT 1 FROM typecho_contents WHERE slug = ${candidate} AND cid != ${cid})`,
      ))
      .returning({ cid: schema.contents.cid });

    if (claimed.length > 0) return candidate;

    suffix += 1;
    candidate = suffix === 1 ? `${base}-${cid}` : `${base}-${cid}-${suffix}`;
  }

  // Keep the fallback distinct even in the pathological case of many collisions.
  const fallback = `${base}-${cid}-${Date.now().toString(36)}`;
  await db.update(schema.contents)
    .set({ slug: fallback })
    .where(eq(schema.contents.cid, cid));
  return fallback;
}

/**
 * The core content endpoint intentionally ignores slug when the permalink
 * pattern has no {slug}. The editor places the requested value in the POST
 * URL, and the existing finishSave hook persists it after the core has claimed
 * its initial slug but before the core invalidates/warmups content caches.
 */
async function persistSubmittedSlug(content: Record<string, any>, extra?: SaveExtra): Promise<void> {
  const request = extra?.request;
  const db = extra?.db;
  if (!request || !db || request.method !== 'POST') return;

  const url = new URL(request.url);
  if (url.pathname !== '/api/admin/content') return;

  const requestedSlug = url.searchParams.get(SAVE_SLUG_PARAM);
  if (!requestedSlug) return;

  const cid = Number(content.cid);
  const base = normalizeSlug(requestedSlug);
  if (!Number.isSafeInteger(cid) || cid <= 0 || !base) return;

  const finalSlug = await claimUniqueSlug(db, cid, base);
  // finishData is the same object the core uses for its subsequent cache work.
  content.slug = finalSlug;
}

function editorHtml(
  formName: 'write_post' | 'write_page',
  allowsSlugEdit: boolean,
  currentSlug: string,
  currentCid: number,
): string {
  const initialSlug = JSON.stringify(currentSlug).replace(/</g, '\\u003c');
  const cidValue = Number.isSafeInteger(currentCid) && currentCid > 0 ? String(currentCid) : '0';

  return `<script>
(function () {
  var form = document.forms.namedItem('${formName}');
  var title = document.getElementById('title');
  var permalinkRow = document.querySelector('p.url-slug');
  if (!form || !title || !permalinkRow || form.dataset.pinyinSlugReady === '1') return;
  form.dataset.pinyinSlugReady = '1';

  var slug = document.getElementById('slug');
  var initialSlug = ${initialSlug};
  var currentCid = ${cidValue};
  var allowsSlugEdit = ${allowsSlugEdit ? 'true' : 'false'};

  if (!slug) {
    var control = document.createElement('div');
    control.className = 'pinyin-slug-control';
    control.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px;max-width:100%;margin:8px 0;';

    var label = document.createElement('label');
    label.htmlFor = 'pinyin-slug-input';
    label.textContent = '缩略名';
    label.style.cssText = 'flex:0 0 auto;';

    slug = document.createElement('input');
    slug.type = 'text';
    slug.id = 'pinyin-slug-input';
    slug.autocomplete = 'off';
    slug.className = 'mono';
    slug.value = initialSlug;
    slug.placeholder = '输入缩略名';
    slug.setAttribute('aria-label', '缩略名');
    slug.style.cssText = 'box-sizing:border-box;flex:1 1 220px;width:min(100%,420px);max-width:420px;min-width:0;';

    control.appendChild(label);
    control.appendChild(slug);
    permalinkRow.parentNode.insertBefore(control, permalinkRow.nextSibling);
  } else {
    permalinkRow.style.display = 'flex';
    permalinkRow.style.flexWrap = 'wrap';
    permalinkRow.style.alignItems = 'center';
    permalinkRow.style.gap = '8px';
    permalinkRow.style.maxWidth = '100%';
    slug.style.boxSizing = 'border-box';
    slug.style.flex = '1 1 220px';
    slug.style.width = 'min(100%,420px)';
    slug.style.maxWidth = '420px';
    slug.style.minWidth = '0';
  }

  var csrf = form.querySelector('input[name="_"]');
  var lastGenerated = '';
  var manual = String(initialSlug || '').trim() !== '';
  var sequence = 0;
  var timer = 0;
  var generationPromise = Promise.resolve();
  var generationPending = false;
  var lastGeneratedTitle = '';

  function generate(force) {
    var value = String(title.value || '').trim();
    if (!value || (!force && (manual || (slug.value && slug.value !== lastGenerated)))) {
      return Promise.resolve();
    }
    var current = ++sequence;
    generationPending = true;
    generationPromise = fetch('${ADMIN_PATH}', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf ? String(csrf.value || '') : ''
      },
      body: JSON.stringify({ title: value })
    }).then(function (response) {
      if (!response.ok) throw new Error('拼音缩略名生成失败');
      return response.json();
    }).then(function (data) {
      if (current !== sequence || manual || String(title.value || '').trim() !== value) return;
      if (typeof data.slug !== 'string' || !data.slug) return;
      lastGenerated = data.slug;
      lastGeneratedTitle = value;
      slug.value = data.slug;
      slug.dispatchEvent(new Event('change', { bubbles: true }));
    }).catch(function () {
      // Pinyin generation is an optional editor enhancement; never block saving.
      if (current === sequence) lastGeneratedTitle = value;
    }).then(function () {
      if (current === sequence) generationPending = false;
    });
    return generationPromise;
  }

  title.addEventListener('input', function () {
    if (manual) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(function () { generate(false); }, 280);
  });

  slug.addEventListener('input', function () {
    if (String(slug.value || '') !== lastGenerated) manual = true;
  });

  var regenerate = document.createElement('button');
  regenerate.type = 'button';
  regenerate.className = 'btn btn-xs';
  regenerate.textContent = '重新生成拼音';
  regenerate.addEventListener('click', function () {
    manual = false;
    generate(true);
  });
  slug.parentNode.insertBefore(regenerate, slug.nextSibling);

  var cid = document.createElement('span');
  cid.textContent = 'CID=' + (currentCid > 0 ? String(currentCid) : '保存后生成');
  cid.style.cssText = 'color:#999;font-size:12px;white-space:nowrap;';
  regenerate.parentNode.insertBefore(cid, regenerate.nextSibling);

  form.addEventListener('submit', function (event) {
    var currentTitle = String(title.value || '').trim();
    if (!manual && currentTitle && (generationPending || currentTitle !== lastGeneratedTitle)) {
      event.preventDefault();
      window.clearTimeout(timer);
      if (!generationPending) generate(false);
      var submitter = event.submitter;
      generationPromise.then(function () {
        if (typeof form.requestSubmit === 'function') form.requestSubmit(submitter || undefined);
        else form.submit();
      });
      return;
    }

    if (!allowsSlugEdit) {
      var value = String(slug.value || '').trim();
      var target = new URL(form.getAttribute('action') || '/api/admin/content', window.location.href);
      if (value) target.searchParams.set('${SAVE_SLUG_PARAM}', value);
      else target.searchParams.delete('${SAVE_SLUG_PARAM}');
      form.setAttribute('action', target.pathname + target.search + target.hash);
    }
  });

  if (!manual && !String(slug.value || '').trim()) {
    generate(false);
  }
})();
</script>`;
}

export default function init({ addHook, pluginId }: PluginInitContext): void {
  registerPluginAdminPath(ADMIN_PATH);

  addHook('admin:writePost:bottom', pluginId, (html: string, extra?: EditorExtra) => {
    const pattern = String(extra?.options?.permalinkPattern || '/archives/{cid}/');
    const post = extra?.post;
    return html + editorHtml(
      'write_post',
      pattern.includes('{slug}'),
      String(post?.slug || ''),
      Number(post?.cid) || 0,
    );
  });

  addHook('admin:writePage:bottom', pluginId, (html: string, extra?: EditorExtra) => {
    const pattern = String(extra?.options?.pagePattern || '/{slug}.html');
    const page = extra?.page;
    return html + editorHtml(
      'write_page',
      pattern.includes('{slug}'),
      String(page?.slug || ''),
      Number(page?.cid) || 0,
    );
  });

  addHook('post:finishSave', pluginId, async (content: Record<string, any>, extra?: SaveExtra) => {
    await persistSubmittedSlug(content, extra);
  });

  addHook('page:finishSave', pluginId, async (content: Record<string, any>, extra?: SaveExtra) => {
    await persistSubmittedSlug(content, extra);
  });

  addHook('route:request', pluginId, async (
    result: PluginRouteResult,
    extra?: { request?: Request; path?: string },
  ) => {
    if (result?.handled || !extra?.request || extra.path !== ADMIN_PATH) return result;
    const request = extra.request;

    if (request.method !== 'POST') {
      return { handled: true, response: json({ error: 'Method not allowed' }, 405) };
    }

    const auth = await requireAdminAction(request, 'editor');
    if (isAdminActionResponse(auth)) {
      return {
        handled: true,
        response: json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status),
      };
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return { handled: true, response: json({ error: 'Invalid JSON' }, 400) };
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { handled: true, response: json({ error: 'Invalid request' }, 400) };
    }

    const title = (body as { title?: unknown }).title;
    if (typeof title !== 'string' || !title.trim() || title.length > 500) {
      return { handled: true, response: json({ error: 'Invalid title' }, 400) };
    }

    return {
      handled: true,
      response: json({ success: true, slug: titleToPinyinSlug(title) }),
    };
  }, 20);
}
