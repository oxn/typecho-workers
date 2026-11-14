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
function appendSlugSuffix(base: string, suffix: string): string {
  const tail = `-${suffix}`;
  const head = base.slice(0, Math.max(1, MAX_SLUG_LENGTH - tail.length)).replace(/-+$/g, '');
  return `${head}${tail}`;
}

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
    candidate = appendSlugSuffix(base, suffix === 1 ? String(cid) : `${cid}-${suffix}`);
  }

  // Keep the fallback distinct even in the pathological case of many collisions.
  const fallback = appendSlugSuffix(base, `${cid}-${Date.now().toString(36)}`);
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
  if (String(content.slug || '') === base) return;

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

  title.maxLength = 500;
  var slug = document.getElementById('slug');
  var initialSlug = ${initialSlug};
  var currentCid = ${cidValue};
  var allowsSlugEdit = ${allowsSlugEdit ? 'true' : 'false'};

  // Keep the permalink and its slug controls on one responsive row. For ID
  // permalinks the generated slug follows the complete URL; for slug-based
  // permalinks the native input remains between the prefix and suffix.
  permalinkRow.style.display = 'flex';
  permalinkRow.style.flexWrap = window.matchMedia('(max-width: 767px)').matches ? 'wrap' : 'nowrap';
  permalinkRow.style.alignItems = 'center';
  permalinkRow.style.gap = '8px';
  permalinkRow.style.maxWidth = '100%';
  permalinkRow.style.minWidth = '0';
  permalinkRow.style.overflowX = 'hidden';

  if (!slug) {
    var label = document.createElement('label');
    label.htmlFor = 'slug';
    label.textContent = '缩略名';
    label.style.cssText = 'flex:0 0 auto;margin-left:2px;';

    slug = document.createElement('input');
    slug.type = 'text';
    // Use the native #slug ID so Typecho's original yellow input styling
    // applies unchanged to this plugin-created control.
    slug.id = 'slug';
    slug.autocomplete = 'off';
    slug.className = 'mono';
    slug.value = initialSlug;
    slug.placeholder = '输入缩略名';
    slug.setAttribute('aria-label', '缩略名');
    slug.style.cssText = 'box-sizing:border-box;flex:0 1 auto;width:120px;max-width:min(420px,100%);min-width:48px;white-space:nowrap;overflow:hidden;';
 
    permalinkRow.appendChild(label);
    permalinkRow.appendChild(slug);
  } else {
    slug.style.boxSizing = 'border-box';
    slug.style.flex = '0 1 auto';
    slug.style.width = '120px';
    slug.style.maxWidth = 'min(420px,100%)';
    slug.style.minWidth = '48px';
    slug.style.overflow = 'hidden';
  }
  slug.maxLength = 180;

  function updateSlugInputWidth() {
    var mobile = window.matchMedia('(max-width: 767px)').matches;
    permalinkRow.style.flexWrap = mobile ? 'wrap' : 'nowrap';
    var style = window.getComputedStyle(slug);
    var canvas = updateSlugInputWidth.canvas || (updateSlugInputWidth.canvas = document.createElement('canvas'));
    var context = canvas.getContext && canvas.getContext('2d');
    var text = String(slug.value || slug.placeholder || '');
    var measured = 120;
    if (context) {
      context.font = style.font;
      measured = Math.ceil(context.measureText(text).width) +
        (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0) +
        (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0) + 14;
    }

    var available = Math.max(48, permalinkRow.clientWidth);
    if (!mobile) {
      var siblingsWidth = 0;
      Array.prototype.forEach.call(permalinkRow.children, function (child) {
        if (child !== slug) siblingsWidth += child.getBoundingClientRect().width;
      });
      var gap = parseFloat(window.getComputedStyle(permalinkRow).columnGap) || 0;
      available = Math.max(48, permalinkRow.clientWidth - siblingsWidth -
        gap * Math.max(0, permalinkRow.children.length - 1) - 2);
    }

    var width = Math.max(48, Math.min(measured, available, 420));
    slug.style.width = width + 'px';
    slug.style.maxWidth = mobile ? '100%' : width + 'px';
    slug.style.flex = mobile ? '0 1 auto' : '0 1 auto';
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
      updateSlugInputWidth();
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
    timer = window.setTimeout(function () { generate(false); }, 500);
  });

  slug.addEventListener('input', function () {
    if (String(slug.value || '') !== lastGenerated) manual = true;
    updateSlugInputWidth();
  });

  var regenerate = document.createElement('button');
  regenerate.type = 'button';
  regenerate.className = 'btn btn-xs';
  regenerate.textContent = '重新生成';
  regenerate.addEventListener('click', function () {
    manual = false;
    generate(true);
  });
  regenerate.style.cssText = 'flex:0 0 auto;white-space:nowrap;';
  permalinkRow.appendChild(regenerate);

  // CID is useful only when the permalink already exposes an editable slug.
  // ID-style permalinks show the complete URL first and omit this redundant ID.
  if (allowsSlugEdit) {
    var cid = document.createElement('span');
    cid.textContent = 'CID=' + (currentCid > 0 ? String(currentCid) : '保存后生成');
    cid.style.cssText = 'color:#999;font-size:12px;white-space:nowrap;margin-left:2px;';
    permalinkRow.appendChild(cid);
  }

  updateSlugInputWidth();
  window.addEventListener('resize', updateSlugInputWidth);
  if (window.ResizeObserver) {
    var slugRowObserver = new ResizeObserver(updateSlugInputWidth);
    slugRowObserver.observe(permalinkRow);
  }

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
