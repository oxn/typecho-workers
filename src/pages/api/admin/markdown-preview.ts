import type { APIRoute } from 'astro';
import { hasPermission } from '@/lib/auth';
import { isAdminActionResponse, requireAdminAction } from '@/lib/admin-auth';
import { renderMarkdown, renderMarkdownFiltered } from '@/lib/markdown';
import { jsonError, jsonOk } from '@/lib/http';
import { linkifyNoteContent } from '@/plugins/typecho-plugin-notes/service';

const MAX_PREVIEW_BODY_BYTES = 500_000;

function preserveEditorEmbedPreview(html: string): string {
  return html.replace(/<(iframe|embed)\s+([^>]*)>/ig, (_all, tag: string, attributes: string) => {
    const source = attributes.endsWith('/') ? attributes.slice(0, -1) : attributes;
    return '<div class="embed"><strong>' + tag + '</strong> : ' + source.trim() + '</div>';
  });
}

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdminAction(request, 'contributor');
  if (isAdminActionResponse(auth)) return auth;

  const lengthHeader = request.headers.get('content-length');
  const declaredLength = lengthHeader ? Number(lengthHeader) : 0;
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PREVIEW_BODY_BYTES) {
    return jsonError(413, 'Preview content is too large');
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_PREVIEW_BODY_BYTES) {
    return jsonError(413, 'Preview content is too large');
  }

  let payload: { content?: unknown; type?: unknown } | null;
  try {
    payload = JSON.parse(rawBody) as { content?: unknown; type?: unknown };
  } catch {
    return jsonError(400, 'Invalid preview request');
  }

  if (!payload || typeof payload !== 'object') {
    return jsonError(400, 'Invalid preview request');
  }

  if (typeof payload.content !== 'string') {
    return jsonError(400, 'Preview content is required');
  }

  const type = payload.type;
  if (type !== 'post' && type !== 'page' && type !== 'note') {
    return jsonError(400, 'Unsupported preview type');
  }

  if (type === 'page' && !hasPermission(auth.user.group || 'visitor', 'editor')) {
    return jsonError(403, 'Forbidden');
  }

  let html: string;
  if (type === 'note') {
    if (!hasPermission(auth.user.group || 'visitor', 'administrator') ||
        !auth.pluginCtx.activatedPlugins.has('typecho-plugin-notes')) {
      return jsonError(403, 'Forbidden');
    }
    html = linkifyNoteContent(renderMarkdown(payload.content), payload.content, auth.options.siteUrl || '');
  } else {
    html = await renderMarkdownFiltered(auth.pluginCtx, payload.content);
    html = preserveEditorEmbedPreview(html);
  }

  return jsonOk({ html });
};
