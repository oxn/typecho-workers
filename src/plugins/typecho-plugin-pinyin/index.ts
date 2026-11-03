import { pinyin } from 'pinyin-pro';
import { registerPluginAdminPath } from 'typecho/plugin-sdk';
import type { PluginInitContext, PluginRouteResult } from 'typecho/plugin-sdk';
import { isAdminActionResponse, requireAdminAction } from '@/lib/admin-auth';

const ADMIN_PATH = '/api/admin/pinyin-slug';

type EditorExtra = {
  options?: Record<string, unknown>;
  isEdit?: boolean;
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

  return pinyin(source, { toneType: 'none', nonZh: 'consecutive' })
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180)
    .replace(/-+$/g, '');
}

function editorHtml(formName: 'write_post' | 'write_page', isEdit: boolean): string {
  return `<script>
(function () {
  var form = document.forms.namedItem('${formName}');
  var title = document.getElementById('title');
  var slug = document.getElementById('slug');
  if (!form || !title || !slug || form.dataset.pinyinSlugReady === '1') return;
  form.dataset.pinyinSlugReady = '1';

  var csrf = form.querySelector('input[name="_"]');
  var lastGenerated = '';
  var manual = ${isEdit ? 'true' : 'String(slug.value || "").trim() !== ""'};
  var sequence = 0;
  var timer = 0;

  function generate(force) {
    var value = String(title.value || '').trim();
    if (!value || (!force && (manual || (slug.value && slug.value !== lastGenerated)))) return Promise.resolve();
    var current = ++sequence;
    return fetch('${ADMIN_PATH}', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf ? String(csrf.value || '') : ''
      },
      body: JSON.stringify({ title: value })
    }).then(function (response) {
      if (!response.ok) throw new Error('拼音别名生成失败');
      return response.json();
    }).then(function (data) {
      if (current !== sequence || manual || String(title.value || '').trim() !== value) return;
      if (typeof data.slug !== 'string' || !data.slug) return;
      lastGenerated = data.slug;
      slug.value = data.slug;
      slug.setAttribute('size', String(Math.max(5, data.slug.length)));
      slug.dispatchEvent(new Event('change', { bubbles: true }));
    }).catch(function () {
      // Slug generation is an optional editor enhancement; never block saving.
    });
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
  regenerate.className = 'btn';
  regenerate.textContent = '重新生成拼音';
  regenerate.style.marginLeft = '8px';
  regenerate.addEventListener('click', function () {
    manual = false;
    generate(true);
  });
  slug.parentElement.appendChild(regenerate);

  if (!${isEdit ? 'true' : 'false'} && !String(slug.value || '').trim()) {
    generate(false);
  }
})();
</script>`;
}

export default function init({ addHook, pluginId }: PluginInitContext): void {
  registerPluginAdminPath(ADMIN_PATH);

  addHook('admin:writePost:bottom', pluginId, (html: string, extra?: EditorExtra) => {
    const pattern = String(extra?.options?.permalinkPattern || '/archives/{cid}/');
    if (!pattern.includes('{slug}')) return html;
    return html + editorHtml('write_post', Boolean(extra?.isEdit));
  });

  addHook('admin:writePage:bottom', pluginId, (html: string, extra?: EditorExtra) => {
    const pattern = String(extra?.options?.pagePattern || '/{slug}.html');
    if (!pattern.includes('{slug}')) return html;
    return html + editorHtml('write_page', Boolean(extra?.isEdit));
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
