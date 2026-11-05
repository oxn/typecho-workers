import { eq } from 'drizzle-orm';
import sanitizeHtml from 'sanitize-html';
import { getDb, schema } from 'typecho/db';
import { env } from 'cloudflare:workers';
import { getOption, registerPluginAdminPath, setOption } from 'typecho/plugin-sdk';
import type { PluginInitContext, PluginRouteResult } from 'typecho/plugin-sdk';
import { generateSecurityToken } from '@/lib/auth';
import { isAdminActionResponse, requireAdminAction } from '@/lib/admin-auth';
import { computeUrls } from '@/lib/options';
import adminCss from './admin.css?raw';

const THEME_ID = 'typecho-theme-warm-cy';
const OPTION_KEY = `theme:${THEME_ID}`;
const ADMIN_PATH = '/api/admin/theme-pin';
const ADMIN_SETTINGS_API_PATH = '/api/admin/cy-companion-settings';
const ADMIN_PAGE_SLUG = 'cy-companion';
const PLUGIN_OPTION_KEY = 'plugin:typecho-plugin-warm-cy';
const PLUGIN_VERSION = '2026.11.05.06.22';

function parsePluginSettings(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function isEnabled(value: unknown, fallback = true): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  return !(value === false || value === 0 || value === '0');
}


async function isHtmlEnhancementEnabled(): Promise<boolean> {
  // Content filters receive only the content string, not RequestContext.options.
  // Read this plugin's private option through the public plugin SDK so the
  // feature switch works without changing the core filter-hook contract.
  const rawSettings = await getOption(getDb(env.DB), PLUGIN_OPTION_KEY);
  const settings = parsePluginSettings(rawSettings);
  return isEnabled(settings.htmlEnhancementEnabled, false);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] || character);
}

function featureSettingsPageHtml(csrfToken: string, rawSettings: unknown): string {
  const settings = parsePluginSettings(rawSettings);
  const commentsEnabled = isEnabled(settings.showCommentManagementButtons);
  const searchEnabled = isEnabled(settings.showHomeSearchButton);
  const htmlEnhancementEnabled = isEnabled(settings.htmlEnhancementEnabled, false);
  return `
    <div class="col-mb-12 col-tb-8 col-tb-offset-2 cy-feature-settings"
      data-cy-feature-settings data-csrf-token="${escapeHtml(csrfToken)}">
      <div class="cy-feature-links">
        <a href="/admin/options-theme">返回主题设置</a>
      </div>
      <p class="cy-feature-version">CY 插件版本：${PLUGIN_VERSION}</p>
      <section class="cy-feature-card">
        <label class="cy-feature-toggle">
          <input type="checkbox" data-cy-setting="showCommentManagementButtons" ${commentsEnabled ? 'checked' : ''}>
          <span>评论区管理按键</span>
        </label>
        <p>控制文章和独立页面评论区是否显示管理员操作按键。关闭后只隐藏前台按键，不影响后台管理权限及管理接口。</p>
      </section>
      <section class="cy-feature-card">
        <label class="cy-feature-toggle">
          <input type="checkbox" data-cy-setting="showHomeSearchButton" ${searchEnabled ? 'checked' : ''}>
          <span>全局搜索按键</span>
        </label>
        <p>控制 Warm CY 所有页面的主导航是否显示搜索图标。关闭后全站不显示搜索入口。</p>
      </section>
      <section class="cy-feature-card">
        <label class="cy-feature-toggle">
          <input type="checkbox" data-cy-setting="htmlEnhancementEnabled" ${htmlEnhancementEnabled ? 'checked' : ''}>
          <span>正文 HTML / CSS / JavaScript 增强</span>
        </label>
        <p>允许文章、笔记和独立页面正文使用内嵌 &lt;style&gt;、&lt;script&gt;、SVG，以及 HTML 的 class、id、data、aria 和 style 属性。开启后正文脚本会在访客浏览器中执行，请确保只有可信人员能够发布文章；评论区不受影响。</p>
      </section>
      <div class="cy-feature-actions">
        <button type="button" class="btn" data-cy-save>保存设置</button>
        <span data-cy-save-status role="status" aria-live="polite"></span>
      </div>
    </div>
    <script>
      (function () {
        var root = document.querySelector('[data-cy-feature-settings]');
        if (!root || root.dataset.initialized === '1') return;
        root.dataset.initialized = '1';
        var save = root.querySelector('[data-cy-save]');
        var status = root.querySelector('[data-cy-save-status]');
        save.addEventListener('click', async function () {
          var comments = root.querySelector('[data-cy-setting="showCommentManagementButtons"]');
          var search = root.querySelector('[data-cy-setting="showHomeSearchButton"]');
          var htmlEnhancement = root.querySelector('[data-cy-setting="htmlEnhancementEnabled"]');
          save.disabled = true;
          status.textContent = '正在保存…';
          try {
            var response = await fetch('/api/admin/cy-companion-settings', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': root.dataset.csrfToken || ''
              },
              body: JSON.stringify({
                showCommentManagementButtons: !!comments.checked,
                showHomeSearchButton: !!search.checked,
                htmlEnhancementEnabled: !!htmlEnhancement.checked
              })
            });
            var result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || '保存失败');
            status.textContent = '保存成功';
          } catch (error) {
            status.textContent = error instanceof Error ? error.message : '保存失败，请稍后重试';
          } finally {
            save.disabled = false;
          }
        });
      })();
    </script>
  `;
}

function encodeInlinePayload(value: string): string {
  return Array.from(new TextEncoder().encode(value), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function protectCompleteDivContainers(content: string, protectedSegments: string[]): string {
  const tagPattern = /<\/?div\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  let output = '';
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(content))) {
    if (/^<\//.test(match[0]) || /\/\s*>$/.test(match[0])) continue;

    let depth = 1;
    let closeEnd = -1;
    let nested: RegExpExecArray | null;
    while ((nested = tagPattern.exec(content))) {
      if (/^<\//.test(nested[0])) depth -= 1;
      else if (!/\/\s*>$/.test(nested[0])) depth += 1;
      if (depth === 0) {
        closeEnd = tagPattern.lastIndex;
        break;
      }
    }
    if (closeEnd < 0) break;

    const block = content.slice(match.index, closeEnd).replace(
      /CYCYCODESEGMENT(\d+)TOKEN/g,
      (_token, index: string) => protectedSegments[Number(index)] ?? _token,
    );

    // Protect every complete div container, not only multiline footers.
    // Even a single-line div is stripped by the core sanitizer, which breaks
    // its class/style attributes and makes the remaining content look plain.

    output += content.slice(cursor, match.index)
      + 'CYCYINLINECONTAINERX' + encodeInlinePayload(block) + 'XEND';
    cursor = closeEnd;
    tagPattern.lastIndex = closeEnd;
  }

  return output + content.slice(cursor);
}
function protectInlineHtml(source: string): string {
  const protectedSegments: string[] = [];
  const protect = (value: string): string => {
    const marker = 'CYCYCODESEGMENT' + protectedSegments.length + 'TOKEN';
    protectedSegments.push(value);
    return marker;
  };
  const restoreProtectedSegments = (value: string): string => value.replace(
    /CYCYCODESEGMENT(\d+)TOKEN/g,
    (_token, index: string) => protectedSegments[Number(index)] ?? _token,
  );

  let content = source.replace(/<(pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, protect);
  let fenceChar = '';
  let fenceLength = 0;
  const lines = content.split('\n');
  content = lines.map(line => {
    const fence = line.match(/^ {0,3}(\x60{3,}|~{3,})/);
    if (fenceChar) {
      const marker = protect(line);
      if (fence && fence[1][0] === fenceChar && fence[1].length >= fenceLength) {
        fenceChar = '';
        fenceLength = 0;
      }
      return marker;
    }
    if (fence) {
      fenceChar = fence[1][0];
      fenceLength = fence[1].length;
      return protect(line);
    }
    if (/^(?: {4}|\t)/.test(line)) return protect(line);

    return line.replace(/(\x60+)([\s\S]*?)\1/g, protect);
  }).join('\n');

  // Preserve styled download-card anchors as a single fragment so nested SVG markup
  // is not fragmented by Markdown tokenization or the core HTML sanitizer.
  content = content.replace(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi, block => {
    if (!/\bstyle\s*=|<svg\b/i.test(block)) return block;
    return 'CYCYINLINEHTMLX' + encodeInlinePayload(restoreProtectedSegments(block)) + 'XEND';
  });

  content = content.replace(
    /<(style|script|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    block => 'CYCYINLINEBLOCKX' + encodeInlinePayload(restoreProtectedSegments(block)) + 'XEND',
  );

  // Preserve each complete iframe as a block fragment before Markdown and the
  // core sanitizer can discard it for lacking a temporary src attribute. The
  // playback attributes are restored and validated by the fragment sanitizer
  // in the content:content hook, then the theme's native iframe normalizer runs.
  // This also covers standalone iframes that are not inside a protected div.
  content = content.replace(
    /<iframe\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?<\/iframe\s*>/gi,
    block => 'CYCYINLINECONTAINERX' + encodeInlinePayload(restoreProtectedSegments(block)) + 'XEND',
  );

  // Preserve complete div containers as one HTML fragment. CommonMark ends a
  // raw <div> block at blank lines, which otherwise breaks long embedded footers.

  content = protectCompleteDivContainers(content, protectedSegments);
  content = content.replace(/<([a-z][\w:-]*)(\s[^<>]*?)>/gi, (full, tag: string, attrs: string) => {
    const preserved: Record<string, string> = {};
    const attributePattern = /([^\s=\/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let match: RegExpExecArray | null;
    while ((match = attributePattern.exec(attrs))) {
      const name = match[1].toLowerCase();
      if (name === 'style' || name === 'class' || name === 'id' || name === 'title'
        || name === 'role' || name === 'width' || name === 'height' || name === 'alt'
        || name === 'loading' || name === 'type' || name === 'name' || name === 'value'
        || name === 'placeholder'
        || (tag.toLowerCase() === 'iframe'
          && ['src', 'frameborder', 'allow', 'allowfullscreen', 'referrerpolicy', 'sandbox', 'scrolling', 'border', 'framespacing'].includes(name))
        || name.startsWith('data-') || name.startsWith('aria-')) {
        preserved[name] = match[2] ?? match[3] ?? match[4] ?? '';
      }
    }
    if (!Object.keys(preserved).length) return full;
    const cleanAttrs = attrs.replace(attributePattern, (attribute, name: string) =>
      Object.prototype.hasOwnProperty.call(preserved, name.toLowerCase()) ? '' : attribute,
    );
    return '<' + tag + cleanAttrs + '>CYCYINLINEATTRX' + tag.toLowerCase()
      + 'X' + encodeInlinePayload(JSON.stringify(preserved)) + 'XEND';
  });

  for (let index = protectedSegments.length - 1; index >= 0; index--) {
    content = content.replace('CYCYCODESEGMENT' + index + 'TOKEN', protectedSegments[index]);
  }
  return content;
}


const INLINE_FRAGMENT_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'a', 'div', 'p', 'span', 'strong', 'b', 'em', 'i', 'small', 'br', 'hr',
    'ul', 'ol', 'li', 'section', 'article', 'header', 'footer', 'nav', 'main',
    'figure', 'figcaption', 'time', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'img', 'button', 'label', 'blockquote', 'pre', 'code',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'details', 'summary', 'dl', 'dt', 'dd', 'picture', 'source',
    'video', 'audio', 'iframe',
    'svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon',
    'ellipse', 'defs', 'lineargradient', 'linearGradient',
    'radialgradient', 'radialGradient', 'stop', 'clippath', 'clipPath',
    'mask', 'title', 'desc', 'use', 'symbol',
  ],
  allowedAttributes: {
    '*': ['class', 'id', 'style', 'title', 'role', 'aria-label', 'aria-hidden', 'data-*', 'aria-*'],
    a: ['href', 'target', 'rel', 'title', 'style', 'class', 'id', 'download', 'data-*', 'aria-*'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'class', 'style', 'data-*', 'aria-*'],
    div: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden', 'data-*', 'aria-*'],
    p: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden', 'data-*', 'aria-*'],
    span: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden', 'data-*', 'aria-*'],
    section: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden', 'data-*', 'aria-*'],
    article: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden', 'data-*', 'aria-*'],
    header: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden', 'data-*', 'aria-*'],
    footer: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden', 'data-*', 'aria-*'],
    nav: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden', 'data-*', 'aria-*'],
    main: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden', 'data-*', 'aria-*'],
    figure: ['style', 'class', 'id', 'title', 'data-*', 'aria-*'],
    figcaption: ['style', 'class', 'id', 'title', 'data-*', 'aria-*'],
    button: ['type', 'disabled', 'style', 'class', 'id', 'title', 'aria-label', 'data-*', 'aria-*'],
    label: ['for', 'style', 'class', 'id', 'data-*', 'aria-*'],
    blockquote: ['style', 'class', 'id', 'cite', 'data-*', 'aria-*'],
    pre: ['style', 'class', 'id', 'data-*', 'aria-*'],
    code: ['style', 'class', 'id', 'data-*', 'aria-*'],
    table: ['style', 'class', 'id', 'data-*', 'aria-*'],
    thead: ['style', 'class', 'id', 'data-*', 'aria-*'],
    tbody: ['style', 'class', 'id', 'data-*', 'aria-*'],
    tfoot: ['style', 'class', 'id', 'data-*', 'aria-*'],
    tr: ['style', 'class', 'id', 'data-*', 'aria-*'],
    th: ['style', 'class', 'id', 'colspan', 'rowspan', 'scope', 'data-*', 'aria-*'],
    td: ['style', 'class', 'id', 'colspan', 'rowspan', 'data-*', 'aria-*'],
    video: ['src', 'controls', 'width', 'height', 'poster', 'style', 'class', 'data-*', 'aria-*'],
    audio: ['src', 'controls', 'style', 'class', 'data-*', 'aria-*'],
    source: ['src', 'type', 'data-*', 'aria-*'],
    iframe: ['src', 'width', 'height', 'title', 'frameborder', 'allowfullscreen', 'allow', 'loading', 'referrerpolicy', 'sandbox', 'scrolling', 'border', 'framespacing', 'data-*', 'aria-*'],
    svg: ['width', 'height', 'viewbox', 'viewBox', 'xmlns', 'fill', 'stroke',
      'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'style', 'class', 'id',
      'role', 'aria-label', 'aria-hidden', 'preserveAspectRatio', 'data-*', 'aria-*'],
    g: ['id', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
      'opacity', 'transform', 'style', 'data-*', 'aria-*'],
    path: ['id', 'd', 'fill', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width',
      'stroke-linecap', 'stroke-linejoin', 'opacity', 'style', 'data-*', 'aria-*'],
    polyline: ['points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
      'stroke-linejoin', 'opacity', 'style', 'data-*', 'aria-*'],
    polygon: ['points', 'fill', 'stroke', 'stroke-width', 'stroke-linejoin', 'opacity', 'style', 'data-*', 'aria-*'],
    line: ['x1', 'y1', 'x2', 'y2', 'fill', 'stroke', 'stroke-width',
      'stroke-linecap', 'stroke-linejoin', 'opacity', 'data-*', 'aria-*'],
    circle: ['id', 'cx', 'cy', 'r', 'fill', 'fill-rule', 'stroke', 'stroke-width', 'opacity', 'style', 'data-*', 'aria-*'],
    ellipse: ['id', 'cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'opacity', 'data-*', 'aria-*'],
    rect: ['id', 'x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'fill-rule',
      'stroke', 'stroke-width', 'opacity', 'style', 'clip-path', 'data-*', 'aria-*'],
    defs: ['id', 'data-*', 'aria-*'],
    lineargradient: ['id', 'x1', 'y1', 'x2', 'y2', 'gradientunits', 'gradienttransform', 'spreadmethod', 'data-*', 'aria-*'],
    linearGradient: ['id', 'x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'data-*', 'aria-*'],
    radialgradient: ['id', 'cx', 'cy', 'fx', 'fy', 'r', 'gradientunits', 'gradienttransform', 'spreadmethod', 'data-*', 'aria-*'],
    radialGradient: ['id', 'cx', 'cy', 'fx', 'fy', 'r', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'data-*', 'aria-*'],
    stop: ['offset', 'stop-color', 'stop-opacity', 'style', 'data-*', 'aria-*'],
    clippath: ['id', 'clippathunits', 'data-*', 'aria-*'],
    clipPath: ['id', 'clipPathUnits', 'data-*', 'aria-*'],
    mask: ['id', 'maskunits', 'maskcontentunits', 'data-*', 'aria-*'],
    use: ['id', 'href', 'xlink:href', 'width', 'height', 'x', 'y', 'data-*', 'aria-*'],
    symbol: ['id', 'viewbox', 'viewBox', 'preserveAspectRatio', 'data-*', 'aria-*'],
  },
  allowedIframeHostnames: ['www.youtube.com', 'www.youtube-nocookie.com', 'player.bilibili.com', 'player.vimeo.com'],
  allowedStyles: {
    '*': {
      color: [/^(?:#[0-9a-f]{3,8}|rgba?\([0-9.,%\s]+\)|var\(--[a-zA-Z0-9_-]+\)|[a-zA-Z]+)$/i],
      background: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'background-color': [/^(?:#[0-9a-f]{3,8}|rgba?\([0-9.,%\s]+\)|var\(--[a-zA-Z0-9_-]+\)|[a-zA-Z]+)$/i],
      'background-image': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'font-weight': [/^(?:normal|bold|bolder|lighter|[1-9]00)$/i],
      'font-size': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'font-family': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'line-height': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'text-align': [/^(?:left|right|center|justify|start|end)$/i],
      'text-decoration': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'word-break': [/^(?:normal|break-all|keep-all|break-word)$/i],
      'overflow-wrap': [/^(?:normal|break-word|anywhere)$/i],
      display: [/^(?:inline|inline-block|inline-flex|block|flex|grid|inline-grid|none|table|table-cell)$/i],
      'align-items': [/^(?:center|start|end|flex-start|flex-end|baseline|stretch)$/i],
      'align-self': [/^(?:auto|center|start|end|flex-start|flex-end|baseline|stretch)$/i],
      'justify-content': [/^(?:normal|start|end|center|left|right|space-between|space-around|space-evenly|flex-start|flex-end)$/i],
      'flex-direction': [/^(?:row|row-reverse|column|column-reverse)$/i],
      'flex-wrap': [/^(?:nowrap|wrap|wrap-reverse)$/i],
      flex: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      gap: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      padding: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      margin: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      width: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      height: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'min-width': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'max-width': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'min-height': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'max-height': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      border: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'border-radius': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'border-color': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'border-width': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'border-style': [/^(?:none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset)$/i],
      'box-shadow': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      position: [/^(?:static|relative|absolute|fixed|sticky)$/i],
      top: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      right: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      bottom: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      left: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'z-index': [/^-?\d+$/],
      overflow: [/^(?:visible|hidden|clip|scroll|auto)$/i],
      cursor: [/^(?:auto|default|pointer|wait|text|move|not-allowed|grab|grabbing)$/i],
      opacity: [/^(?:0|1|0?\.[0-9]+|100%)$/i],
      transform: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      transition: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'object-fit': [/^(?:fill|contain|cover|none|scale-down)$/i],
      'vertical-align': [/^(?:middle|baseline|top|bottom|text-top|text-bottom)$/i],
      'white-space': [/^(?:normal|nowrap|pre|pre-wrap|pre-line|break-spaces)$/i],
      'letter-spacing': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'aspect-ratio': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'grid-template-columns': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'grid-template-rows': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'box-sizing': [/^(?:content-box|border-box)$/i],
      'flex-grow': [/^\d+(?:\.\d+)?$/],
      'flex-shrink': [/^\d+(?:\.\d+)?$/],
      'flex-basis': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'align-content': [/^(?:normal|center|start|end|flex-start|flex-end|space-between|space-around|space-evenly|stretch)$/i],
      'justify-items': [/^(?:normal|start|end|center|stretch)$/i],
      'justify-self': [/^(?:auto|start|end|center|stretch)$/i],
      'grid-column': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'grid-row': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'overflow-x': [/^(?:visible|hidden|clip|scroll|auto)$/i],
      'overflow-y': [/^(?:visible|hidden|clip|scroll|auto)$/i],
      'object-position': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'text-transform': [/^(?:none|capitalize|uppercase|lowercase|full-width)$/i],
      'font-style': [/^(?:normal|italic|oblique)$/i],
      'outline': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'list-style': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
    },
  },
};
function decodeInlinePayload(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

function sanitizeInlineSvgReferences(source: string): string {
  return source.replace(/<(?:svg|g|path|use|symbol|mask|clippath|lineargradient|radialgradient)\b[^>]*>/gi, tag => {
    let safe = tag.replace(/\s+(href|xlink:href)\s*=\s*(["'])(.*?)\2/gi, (attribute, _name, _quote, value) =>
      /^#[\w:.-]+$/.test(String(value).trim()) ? attribute : '',
    );
    safe = safe.replace(/\s+(fill|stroke|clip-path|mask)\s*=\s*(["'])(.*?)\2/gi, (attribute, _name, _quote, value) => {
      const cssValue = String(value).trim();
      return /\burl\s*\(/i.test(cssValue) && !/^url\(\s*#[\w:.-]+\s*\)$/i.test(cssValue)
        ? ''
        : attribute;
    });
    return safe;
  });
}

function sanitizeInlineHtmlFragment(source: string): string {
  return sanitizeHtml(sanitizeInlineSvgReferences(source), INLINE_FRAGMENT_SANITIZE_OPTIONS);
}

function restoreInlineHtmlFragments(content: string): string {
  const restoreContainer = (payload: string): string => {
    let source = decodeInlinePayload(payload);

    // Keep style/script blocks as inert text markers through fragment sanitization.
    // The opt-in frontend runtime restores them only when the enhancement is enabled.
    source = source.replace(/<(style|script|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, block =>
      'CYCYINLINEBLOCKX' + encodeInlinePayload(block) + 'XEND',
    );

    // Reattach preserved attributes before sanitizing the restored container.
    // Attribute values are escaped here; the fragment sanitizer remains the
    // final allowlist enforcement layer.
    source = source.replace(
      /(<([a-z][\w:-]*)\b[^>]*>)CYCYINLINEATTRX([a-z][\w:-]*)X([0-9a-f]+)XEND/gi,
      (marker, opening: string, tag: string, _markerTag: string, encoded: string) => {
        try {
          const attributes = JSON.parse(decodeInlinePayload(encoded)) as Record<string, unknown>;
          const safe = Object.entries(attributes).map(([name, value]) => {
            const key = name.toLowerCase();
            if (!(key === 'style' || key === 'class' || key === 'id' || key === 'title'
              || key === 'role' || key === 'width' || key === 'height' || key === 'alt'
              || key === 'loading' || key === 'type' || key === 'name' || key === 'value'
              || key === 'placeholder'
              || (tag.toLowerCase() === 'iframe'
                && ['src', 'frameborder', 'allow', 'allowfullscreen', 'referrerpolicy', 'sandbox', 'scrolling', 'border', 'framespacing'].includes(key))
              || key.startsWith('data-') || key.startsWith('aria-'))) return '';
            const text = String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
              .replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return ' ' + key + '="' + text + '"';
          }).join('');
          return opening.replace(/>$/, safe + '>');
        } catch {
          return opening;
        }
      },
    );

    const safe = sanitizeInlineHtmlFragment(source);
    return safe ? '<div class="cy-inline-html-pending">' + safe + '</div>' : '';
  };

  // The Markdown parser wraps a standalone placeholder in <p>; replace the
  // whole paragraph so a restored block-level container is never nested in <p>.
  let restored = content.replace(
    /<p>\s*CYCYINLINECONTAINERX([0-9a-f]+)XEND\s*<\/p>/gi,
    (_marker, payload: string) => restoreContainer(payload),
  );
  restored = restored.replace(
    /CYCYINLINECONTAINERX([0-9a-f]+)XEND/g,
    (_marker, payload: string) => restoreContainer(payload),
  );

  restored = restored.replace(/CYCYINLINEHTMLX([0-9a-f]+)XEND/g, (_marker, payload: string) => {
    // Preserve nested SVG verbatim through the HTML sanitizer. The browser
    // runtime will rebuild each SVG using its dedicated SVG allowlist.
    const source = decodeInlinePayload(payload).replace(
      /<svg\b[^>]*>[\s\S]*?<\/svg\s*>/gi,
      svg => 'CYCYINLINEBLOCKX' + encodeInlinePayload(svg) + 'XEND',
    );
    const safe = sanitizeInlineHtmlFragment(source);
    return safe ? '<span class="cy-inline-html-pending">' + safe + '</span>' : '';
  });

  // Keep protected blocks inert until the opt-in browser runtime handles them.
  // Do not pass SVG through sanitize-html: it normalizes SVG attribute names
  // (for example viewBox -> viewbox), which breaks rendering. The runtime parses
  // SVG as image/svg+xml and rebuilds it with a strict SVG allowlist.
  restored = restored.replace(/CYCYINLINEBLOCKX([0-9a-f]+)XEND/g, marker => marker);
  return restored;
}

const MARKDOWN_ALERT_ICONS: Record<string, string> = {
  // Reuse the exact five SVG path shapes from the pre-upstream-reset CY Markdown Alerts implementation.
  NOTE: '<svg class="markdown-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
  TIP: '<svg class="markdown-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z"/></svg>',
  IMPORTANT: '<svg class="markdown-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
  WARNING: '<svg class="markdown-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
  CAUTION: '<svg class="markdown-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
};;

function restoreMarkdownAlertIcons(content: string): string {
  return content.replace(
    /<blockquote\b([^>]*\bdata-alert=(["'])(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\2[^>]*)>([\s\S]*?)<\/blockquote>/gi,
    (_full, attributes: string, _quote: string, rawLabel: string, inner: string) => {
      const icon = MARKDOWN_ALERT_ICONS[rawLabel.toUpperCase()];
      if (!icon) return _full;
      const titlePattern = /(<p\b[^>]*class=(["'])markdown-alert-title\2[^>]*>)([\s\S]*?)(<\/p>)/i;
      const updatedInner = inner.replace(
        titlePattern,
        (title, opening: string, _titleQuote: string, text: string, closing: string) => {
          if (opening.includes('cy-markdown-alert-has-icon')) return title;
          const markedOpening = opening.replace(
            /class=(["'])markdown-alert-title\1/i,
            (_match, quote: string) => 'class=' + quote + 'markdown-alert-title cy-markdown-alert-has-icon' + quote,
          );
          return markedOpening + icon + text + closing;
        },
      );
      return '<blockquote' + attributes + '>' + updatedInner + '</blockquote>';
    },
  );
}

function markdownAlertIconStyles(): string {
  return '<style data-cy-markdown-alert-icons>'
    + '.warm-prose .markdown-alert-title.cy-markdown-alert-has-icon::before,'
    + '.warm-note__content .markdown-alert-title.cy-markdown-alert-has-icon::before'
    + '{content:none!important;display:none!important}'
    + '</style>';
}

const INLINE_HTML_RUNTIME = "(() => {\n  const enabled = __CY_ENABLED__;\n  const markerPattern = /CYCYINLINEBLOCKX([0-9a-f]+)XEND|CYCYINLINEATTRX([a-z][\\w:-]*)X([0-9a-f]+)XEND/g;\n  const svgTags = new Set(['svg','g','path','circle','rect','line','polyline','polygon','ellipse','defs','lineargradient','radialgradient','stop','clippath','mask','title','desc','use','symbol']);\n  const svgAttrs = new Set(['id','class','viewbox','width','height','fill','fill-rule','clip-rule','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','opacity','fill-opacity','stroke-opacity','cx','cy','r','rx','ry','x','y','x1','x2','y1','y2','d','points','transform','preserveaspectratio','offset','stop-color','stop-opacity','gradientunits','gradienttransform','clippathunits','maskunits','maskcontentunits','clip-path','mask','filter','href','xlink:href','role','focusable','aria-hidden','aria-label']);\n  const decode = hex => { const bytes = new Uint8Array(hex.length / 2); for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); return new TextDecoder().decode(bytes); };\n  const safeSvgNode = node => {\n    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue || '');\n    if (node.nodeType !== Node.ELEMENT_NODE || !svgTags.has(node.localName.toLowerCase())) return null;\n    const clean = document.createElementNS('http://www.w3.org/2000/svg', node.localName);\n    for (const attr of Array.from(node.attributes)) {\n      const key = attr.name.toLowerCase(), value = attr.value;\n      if (!svgAttrs.has(key) && key !== 'style' && !key.startsWith('aria-')) continue;\n      if (key === 'style') {\n        const allowedStyle = new Set(['fill','stroke','fill-rule','clip-rule','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','opacity','fill-opacity','stroke-opacity','stop-color','stop-opacity']);\n        const safeStyle = value.split(';').map(part => part.trim()).filter(Boolean).map(part => {\n          const split = part.indexOf(':');\n          if (split < 1) return '';\n          const property = part.slice(0, split).trim().toLowerCase();\n          const cssValue = part.slice(split + 1).trim();\n          if (!allowedStyle.has(property) || /expression|javascript:|data:|@import|[\\u0000-\\u001f]/i.test(cssValue)) return '';\n          if (/\\burl\\s*\\(/i.test(cssValue) && !/^url\\(\\s*#[\\w:.-]+\\s*\\)$/i.test(cssValue)) return '';\n          return property + ':' + cssValue;\n        }).filter(Boolean).join(';');\n        if (safeStyle) clean.setAttribute('style', safeStyle);\n        continue;\n      }\n      if ((key === 'href' || key === 'xlink:href') && !/^#[\\w:.-]+$/.test(value)) continue;\n      if (/\\burl\\s*\\(/i.test(value) && !/^\\s*url\\(\\s*#[\\w:.-]+\\s*\\)\\s*$/i.test(value)) continue;\n      if (/javascript:|data:text\\/html|[\\u0000-\\u001f]/i.test(value)) continue;\n      if (key === 'xlink:href') clean.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', value); else clean.setAttribute(attr.name, value);\n    }\n    for (const child of Array.from(node.childNodes)) { const safe = safeSvgNode(child); if (safe) clean.appendChild(safe); }\n    return clean;\n  };\n  const addBlock = raw => {\n    const match = raw.match(/^<(style|script|svg)\\b([^>]*)>([\\s\\S]*)<\\/\\1\\s*>$/i);\n    if (!match) return null;\n    const tag = match[1].toLowerCase(), attrs = match[2] || '', body = match[3] || '';\n    if (tag === 'svg') {\n      try { const parsed = new DOMParser().parseFromString(raw, 'image/svg+xml'); if (parsed.querySelector('parsererror') || parsed.documentElement.localName.toLowerCase() !== 'svg') return null; return safeSvgNode(parsed.documentElement); } catch { return null; }\n    }\n    if (tag === 'style') { const style = document.createElement('style'); const media = attrs.match(/\\bmedia\\s*=\\s*(?:\\\"([^\\\"]*)\\\"|'([^']*)')/i); if (media) style.media = media[1] || media[2] || ''; const safeCss = body.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '').replace(/@import\\b[^;]*(?:;|$)/gi, '').replace(/(?:expression|behavior|-moz-binding)\\s*:[^;}]+;?/gi, '').replace(/url\\(\\s*(?!['\"]?#)[^)]+\\)/gi, 'none'); style.textContent = safeCss; document.head.appendChild(style); return null; }\n    const script = document.createElement('script');\n    const type = attrs.match(/\\btype\\s*=\\s*(?:\\\"([^\\\"]*)\\\"|'([^']*)')/i);\n    const scriptType = (type && (type[1] || type[2]) || '').toLowerCase();\n    if (scriptType && !['module','text/javascript','application/javascript'].includes(scriptType)) return null;\n    if (scriptType) script.type = scriptType;\n    const src = attrs.match(/\\bsrc\\s*=\\s*(?:\\\"([^\\\"]*)\\\"|'([^']*)'|([^\\s>]+))/i);\n    if (src) {\n      try {\n        const url = new URL(src[1] || src[2] || src[3] || '', document.baseURI);\n        if (!['https:', 'http:'].includes(url.protocol)) return null;\n        if (url.protocol === 'http:' && url.origin !== location.origin) return null;\n        script.src = url.href;\n        script.async = false;\n        const integrity = attrs.match(/\\bintegrity\\s*=\\s*(?:\\\"([^\\\"]*)\\\"|'([^']*)')/i);\n        if (integrity) script.integrity = integrity[1] || integrity[2] || '';\n        const crossOrigin = attrs.match(/\\bcrossorigin\\s*=\\s*(?:\\\"([^\\\"]*)\\\"|'([^']*)'|([^\\s>]+))/i);\n        if (crossOrigin) { const value = (crossOrigin[1] || crossOrigin[2] || crossOrigin[3] || 'anonymous').toLowerCase(); if (['anonymous', 'use-credentials'].includes(value)) script.crossOrigin = value; }\n        const referrerPolicy = attrs.match(/\\breferrerpolicy\\s*=\\s*(?:\\\"([^\\\"]*)\\\"|'([^']*)')/i);\n        if (referrerPolicy) { const value = (referrerPolicy[1] || referrerPolicy[2] || '').toLowerCase(); if (['no-referrer', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin', 'unsafe-url'].includes(value)) script.referrerPolicy = value; }\n      } catch { return null; }\n    } else {\n      script.textContent = body;\n    }\n    document.body.appendChild(script); return null;\n  };\n  const hydrate = () => {\n    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode(node) { const p = node.parentElement; if (!p || p.closest('pre,code,textarea,script,style')) return NodeFilter.FILTER_REJECT; markerPattern.lastIndex = 0; return markerPattern.test(node.nodeValue || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; } });\n    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);\n    for (const node of nodes) {\n      const value = node.nodeValue || ''; markerPattern.lastIndex = 0; let last = 0, match, changed = false; const fragment = document.createDocumentFragment();\n      while ((match = markerPattern.exec(value))) {\n        changed = true; if (match.index > last) fragment.appendChild(document.createTextNode(value.slice(last, match.index)));\n        if (enabled && match[1]) { const element = addBlock(decode(match[1])); if (element) fragment.appendChild(element); }\n        else if (enabled && match[2] && match[3]) {\n          const parent = node.parentElement, previous = node.previousElementSibling;\n          const target = parent && parent.tagName.toLowerCase() === match[2] ? parent : previous && previous.tagName.toLowerCase() === match[2] ? previous : parent;\n          if (target) {\n            try {\n              const attrs = JSON.parse(decode(match[3]));\n              for (const [name, value] of Object.entries(attrs)) {\n                if (name === 'style') target.style.cssText = String(value);\n                else if (name === 'class' || name === 'id' || name === 'title' || name === 'role'\n                  || name === 'width' || name === 'height' || name === 'alt' || name === 'loading'\n                  || name === 'type' || name === 'name' || name === 'value' || name === 'placeholder'\n                  || (match[2] === 'iframe' && ['src', 'frameborder', 'allow', 'allowfullscreen', 'referrerpolicy', 'sandbox', 'scrolling', 'border', 'framespacing'].includes(name))\n                  || name.startsWith('data-') || name.startsWith('aria-')) {\n                  target.setAttribute(name, String(value));\n                }\n              }\n            } catch {}\n          }\n        }\n        last = match.index + match[0].length;\n      }\n      if (changed) { if (last < value.length) fragment.appendChild(document.createTextNode(value.slice(last))); node.parentNode && node.parentNode.replaceChild(fragment, node); }\n    }\n  };\n  hydrate(); window.addEventListener('instantclick:newpage', hydrate);\n})();";
function inlineHtmlRuntime(enabled: boolean): string {
  const visibilityStyle = '<style data-cy-inline-html-enhancement-style>'
    + '.cy-inline-html-pending{display:' + (enabled ? 'contents' : 'none') + '!important}'
    + (enabled ? '.warm-prose .cy-inline-html-pending iframe{border-radius:0!important}' : '')
    + '</style>';
  return visibilityStyle + '<script data-cy-inline-html-enhancement>'
    + INLINE_HTML_RUNTIME.replace('__CY_ENABLED__', enabled ? 'true' : 'false')
    + '</script>';
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
}

function parseSettings(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parsePinnedIds(value: unknown): number[] {
  if (typeof value !== 'string' && typeof value !== 'number') return [];
  const result: number[] = [];
  const seen = new Set<number>();
  for (const part of String(value).split(/[，,\s]+/)) {
    if (!/^\d+$/.test(part.trim())) continue;
    const cid = Number(part.trim());
    if (!Number.isSafeInteger(cid) || cid <= 0 || seen.has(cid)) continue;
    seen.add(cid);
    result.push(cid);
  }
  return result;
}

export default function init({ addHook, pluginId }: PluginInitContext): void {
  registerPluginAdminPath(ADMIN_PATH);
  registerPluginAdminPath(ADMIN_SETTINGS_API_PATH);

  // The content filter contract supplies only the source string. Read the
  // plugin's private option through the host options loader; do not depend on
  // an extra RequestContext argument that the core does not pass.
  addHook('content:markdown', pluginId, async (content: string) => {
    return await isHtmlEnhancementEnabled() ? protectInlineHtml(content) : content;
  }, 1);

  // Alert icons remain independent. HTML fragments are restored only when
  // the Markdown stage inserted our opt-in protection markers.
  addHook('content:content', pluginId, (content: string) => {
    const withAlertIcons = restoreMarkdownAlertIcons(content);
    return withAlertIcons.includes('CYCYINLINE')
      ? restoreInlineHtmlFragments(withAlertIcons)
      : withAlertIcons;
  }, 1);

  // Rehydrate only after Markdown sanitization; the feature is opt-in.
  addHook('archive:footer', pluginId, (html: string, extra?: {
    options?: Record<string, unknown>;
  }) => {
    const options = extra?.options;
    if (!options) return html;
    const settings = parsePluginSettings(options[PLUGIN_OPTION_KEY]);
    const htmlRuntime = isEnabled(settings.htmlEnhancementEnabled, false) ? inlineHtmlRuntime(true) : '';
    const alertIconStyle = options.theme === THEME_ID ? markdownAlertIconStyles() : '';
    if (options.theme !== THEME_ID || !isEnabled(settings.showHomeSearchButton)) {
      return html + alertIconStyle + htmlRuntime;
    }
    const searchBase = JSON.stringify(
      String(computeUrls(options as any).siteUrl || '/').replace(/\/?$/, '/'),
    ).replace(/</g, '\\u003c');
    return `${html}${alertIconStyle}${htmlRuntime}<script data-warm-cy-global-search>
      (() => {
        const searchBase = ${searchBase};
        const ensureSearchControls = () => {
          let trigger = document.querySelector('[data-warm-search-open]');
          if (!trigger) {
            trigger = document.createElement('button');
            trigger.type = 'button';
            trigger.className = 'warm-search-trigger';
            trigger.setAttribute('data-warm-search-open', '');
            trigger.setAttribute('aria-label', '打开搜索');
            trigger.title = '全局搜索';
            trigger.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none"><circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" stroke-width="1.8"></circle><path d="m16 16 5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg>';
          }

          let dialog = document.querySelector('[data-warm-search-dialog]');
          if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.className = 'warm-search-dialog';
            dialog.setAttribute('data-warm-search-dialog', '');
            dialog.setAttribute('aria-labelledby', 'warm-search-title');
            dialog.innerHTML = '<div class="warm-search-dialog__panel"><button type="button" class="warm-search-dialog__close" data-warm-search-close aria-label="关闭搜索">×</button><h2 id="warm-search-title">搜索文章</h2><form class="warm-search-form" data-warm-search-form><input type="search" class="warm-search-input" data-warm-search-input placeholder="输入关键词…" autocomplete="off" aria-label="搜索关键词"><button type="submit" class="warm-search-submit" aria-label="搜索"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none"><circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" stroke-width="1.8"></circle><path d="m16 16 5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg><span>搜索</span></button></form><p class="warm-search-error" data-warm-search-error role="status" aria-live="polite"></p></div>';
          }

          dialog.dataset.searchBase = searchBase;
          const nav = document.querySelector('.warm-nav') || document.querySelector('header nav');
          if (nav) {
            nav.append(trigger);
            trigger.classList.remove('warm-search-trigger--floating');
          } else {
            const header = document.querySelector('.warm-header__inner, header');
            if (header) {
              header.append(trigger);
              trigger.classList.remove('warm-search-trigger--floating');
            } else {
              trigger.classList.add('warm-search-trigger--floating');
              document.body.append(trigger);
            }
          }
          if (dialog.parentElement !== document.body) document.body.append(dialog);
        };

        if (!document.documentElement.dataset.warmCyGlobalSearchBound) {
          document.documentElement.dataset.warmCyGlobalSearchBound = '1';
          document.addEventListener('click', event => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target) return;
            if (target.closest('[data-warm-search-open]')) {
              const dialog = document.querySelector('[data-warm-search-dialog]');
              if (!(dialog instanceof HTMLDialogElement)) return;
              const error = dialog.querySelector('[data-warm-search-error]');
              const input = dialog.querySelector('[data-warm-search-input]');
              if (error) error.textContent = '';
              if (!dialog.open) dialog.showModal();
              input?.focus();
              return;
            }
            if (target.closest('[data-warm-search-close]')) {
              const dialog = target.closest('[data-warm-search-dialog]') || document.querySelector('[data-warm-search-dialog]');
              if (dialog instanceof HTMLDialogElement && dialog.open) dialog.close();
              return;
            }
            const dialog = target.closest('[data-warm-search-dialog]');
            if (dialog instanceof HTMLDialogElement && target === dialog) dialog.close();
          });
          document.addEventListener('submit', event => {
            const form = event.target;
            if (!(form instanceof HTMLFormElement) || !form.matches('[data-warm-search-form]')) return;
            event.preventDefault();
            const dialog = form.closest('[data-warm-search-dialog]');
            const input = form.querySelector('[data-warm-search-input]');
            const error = dialog?.querySelector('[data-warm-search-error]');
            const keyword = String(input?.value || '').trim();
            if (!keyword) {
              if (error) error.textContent = '请输入搜索关键词';
              input?.focus();
              return;
            }
            const base = dialog?.dataset.searchBase || searchBase;
            window.location.href = base + 'search/' + encodeURIComponent(keyword) + '/';
          });
          window.addEventListener('instantclick:newpage', ensureSearchControls);
        }

        ensureSearchControls();
      })();
    </script>`;
  }, 20);

  addHook('admin:header', pluginId, (html: string, extra?: {
    title?: string;
    options?: Record<string, unknown>;
  }) => {
    if (extra?.options?.theme !== THEME_ID
      || (extra?.title !== '设置外观' && extra?.title !== 'CY 功能显示')) return html;
    return `${html}<style data-warm-cy-admin>${adminCss}</style>`;
  }, 20);

  // Add the companion settings entry to the existing Settings menu without
  // changing the core Admin layout. Also decorate the theme settings form.
  addHook('admin:footer', pluginId, (html: string, extra?: {
    options?: Record<string, unknown>;
  }) => {
    if (extra?.options?.theme !== THEME_ID) return html;
    return `${html}<script data-warm-cy-admin-navigation>
      (() => {
        const pluginPath = '/admin/plugin/${ADMIN_PAGE_SLUG}';
        const groups = document.querySelectorAll('.typecho-head-nav menu > li');
        for (const group of groups) {
          const heading = group.querySelector(':scope > a');
          if (heading?.textContent?.trim() !== '设置') continue;
          const submenu = group.querySelector(':scope > menu');
          if (!submenu || submenu.querySelector('a[href="' + pluginPath + '"]')) break;
          const item = document.createElement('li');
          const link = document.createElement('a');
          link.href = pluginPath;
          link.textContent = 'CY 功能显示';
          if (window.location.pathname === pluginPath) item.classList.add('focus');
          item.append(link);
          submenu.append(item);
          break;
        }

        if (window.location.pathname === '/admin/options-theme') {
          const form = document.querySelector('form[action="/admin/options-theme"]');
          form?.classList.add('warm-theme-config-form');

          if (form && form.dataset.warmCyLayoutApplied !== '1') {
            form.dataset.warmCyLayoutApplied = '1';
            const getField = name => {
              const input = form.querySelector('[name="' + name + '"]');
              return input ? input.closest('.typecho-option') : null;
            };

            const firstLinkField = getField('linktxt01');
            if (firstLinkField) {
              const section = document.createElement('section');
              section.className = 'warm-theme-links-group';
              const heading = document.createElement('div');
              heading.className = 'warm-theme-links-heading';
              const title = document.createElement('strong');
              title.textContent = '页面连接';
              const description = document.createElement('span');
              description.textContent = '支持 https://、http://、mailto:、站内链接；普通域名可直接填写。';
              heading.append(title, description);
              section.append(heading);
              firstLinkField.before(section);

              for (let index = 1; index <= 10; index += 1) {
                const suffix = String(index).padStart(2, '0');
                const textField = getField('linktxt' + suffix);
                const urlField = getField('links' + suffix);
                const blankField = getField('linkblank' + suffix);
                const textInput = textField?.querySelector('input[name="linktxt' + suffix + '"]');
                const urlInput = urlField?.querySelector('input[name="links' + suffix + '"]');
                const blankInput = blankField?.querySelector('input[name="linkblank' + suffix + '"]');
                if (!textInput || !urlInput || !blankInput) continue;

                const row = document.createElement('div');
                row.className = 'warm-theme-link-row';
                const textLine = document.createElement('div');
                textLine.className = 'warm-theme-link-text-line';
                const textLabel = document.createElement('label');
                textLabel.htmlFor = textInput.id;
                textLabel.textContent = '文字' + index + '：';
                textInput.classList.add('warm-theme-link-input');
                textLine.append(textLabel, textInput);

                const blankLabel = document.createElement('label');
                blankLabel.className = 'warm-theme-link-new-window';
                blankLabel.htmlFor = blankInput.id;
                const blankText = document.createElement('span');
                blankText.textContent = '新窗口打开';
                blankLabel.append(blankInput, blankText);
                textLine.append(blankLabel);

                const urlLine = document.createElement('div');
                urlLine.className = 'warm-theme-link-url-line';
                const urlLabel = document.createElement('label');
                urlLabel.htmlFor = urlInput.id;
                urlLabel.textContent = '网址' + index + '：';
                urlInput.classList.add('warm-theme-link-input');
                urlLine.append(urlLabel, urlInput);

                row.append(textLine, urlLine);
                section.append(row);
                textField.remove();
                urlField.remove();
                blankField.remove();
              }
            }

            const wrapSettingsCard = (className, names) => {
              const fields = names.map(getField).filter(Boolean);
              if (!fields.length) return;
              const card = document.createElement('section');
              card.className = 'warm-theme-settings-card ' + className;
              fields[0].before(card);
              fields.forEach(field => card.append(field));
            };

            wrapSettingsCard('warm-theme-home-card', ['pinnedIds']);
            wrapSettingsCard('warm-theme-image-card', ['imageOptimizeParams']);
            wrapSettingsCard('warm-theme-thumb-card', ['thumbOptimizeParams']);
            wrapSettingsCard('warm-theme-footer-card', ['footerCustomHtml']);
            wrapSettingsCard('warm-theme-loading-card', [
              'continuousLoadMode',
              'commentComponentLoadMode',
              'commentInitialLoadMode'
            ]);

            form.querySelectorAll('.typecho-option:not(.typecho-option-submit)').forEach(option => {
              if (option.style.display === 'none') return;
              const item = option.querySelector(':scope > li');
              if (!item || item.querySelector(':scope > .warm-theme-field-head')) return;
              const label = item.querySelector(':scope > .typecho-label');
              const description = item.querySelector(':scope > .description');
              if (label?.querySelector('input[type="checkbox"], input[type="radio"]')) return;

              const head = document.createElement('div');
              head.className = 'warm-theme-field-head';
              if (label) head.append(label);
              if (description) head.append(description);
              const control = document.createElement('div');
              control.className = 'warm-theme-field-control';
              Array.from(item.children).forEach(child => {
                if (child !== label && child !== description) control.append(child);
              });
              item.append(head, control);
            });
          }

          const titleBar = document.querySelector('.typecho-page-title');
          if (titleBar && !titleBar.querySelector('.warm-cy-settings-switch')) {
            const link = document.createElement('a');
            link.className = 'warm-cy-settings-switch';
            link.href = pluginPath;
            link.textContent = 'CY 功能显示';
            titleBar.append(link);
          }
        }
      })();
    </script>`;
  }, 20);


  addHook('admin:page', pluginId, (html: string, extra?: {
    slug?: string;
    csrfToken?: string;
    options?: Record<string, unknown>;
  }) => {
    if (extra?.slug !== ADMIN_PAGE_SLUG) return html;
    return featureSettingsPageHtml(
      extra.csrfToken || '',
      extra.options?.[PLUGIN_OPTION_KEY],
    );
  }, 20);

  addHook('route:request', pluginId, async (
    result: PluginRouteResult,
    extra?: { request?: Request; path?: string },
  ) => {
    if (result?.handled || !extra?.request) return result;
    const path = extra.path;
    if (path !== ADMIN_PATH && path !== ADMIN_SETTINGS_API_PATH) return result;
    const request = extra.request;
    if (request.method !== 'POST') {
      return { handled: true, response: json({ error: 'Method not allowed' }, 405) };
    }

    const auth = await requireAdminAction(request, 'administrator');
    if (isAdminActionResponse(auth)) {
      return {
        handled: true,
        response: json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status),
      };
    }
    if (auth.options.theme !== THEME_ID) {
      return { handled: true, response: json({ error: 'Theme is not active' }, 404) };
    }

    let body: unknown;
    try { body = await request.json(); } catch {
      return { handled: true, response: json({ error: 'Invalid JSON' }, 400) };
    }
    if (!body || typeof body !== 'object') {
      return { handled: true, response: json({ error: 'Invalid request' }, 400) };
    }

    if (path === ADMIN_SETTINGS_API_PATH) {
      const values = body as {
        showCommentManagementButtons?: unknown;
        showHomeSearchButton?: unknown;
        htmlEnhancementEnabled?: unknown;
      };
      if (typeof values.showCommentManagementButtons !== 'boolean'
        || typeof values.showHomeSearchButton !== 'boolean'
        || typeof values.htmlEnhancementEnabled !== 'boolean') {
        return { handled: true, response: json({ error: 'Invalid settings' }, 400) };
      }
      const current = parsePluginSettings(auth.options[PLUGIN_OPTION_KEY]);
      const next = {
        ...current,
        showCommentManagementButtons: values.showCommentManagementButtons ? '1' : '0',
        showHomeSearchButton: values.showHomeSearchButton ? '1' : '0',
        htmlEnhancementEnabled: values.htmlEnhancementEnabled ? '1' : '0',
      };
      await setOption(auth.db, PLUGIN_OPTION_KEY, JSON.stringify(next));
      return { handled: true, response: json({ success: true }) };
    }

    const { cid, pinned, confirmation } = body as { cid?: unknown; pinned?: unknown; confirmation?: unknown };
    const contentId = Number(cid);
    if (!Number.isSafeInteger(contentId) || contentId <= 0 || typeof pinned !== 'boolean' || confirmation !== '确认') {
      return { handled: true, response: json({ error: 'Invalid parameters' }, 400) };
    }

    const content = await auth.db.query.contents.findFirst({
      columns: { cid: true, type: true, status: true },
      where: eq(schema.contents.cid, contentId),
    });
    if (!content || content.type !== 'post' || content.status !== 'publish') {
      return { handled: true, response: json({ error: 'Published post not found' }, 404) };
    }

    const settings = parseSettings(auth.options[OPTION_KEY]);
    const ids = parsePinnedIds(settings.pinnedIds).filter(id => id !== contentId);
    if (pinned) ids.unshift(contentId);
    settings.pinnedIds = ids.join(',');
    await setOption(auth.db, OPTION_KEY, JSON.stringify(settings));
    return { handled: true, response: json({ success: true, pinned, pinnedIds: ids }) };
  }, 20);

  addHook('comment:list', pluginId, async (
    payload: Record<string, unknown>,
    extra?: { request?: Request; options?: Record<string, unknown>; cid?: number },
  ) => {
    const request = extra?.request;
    const options = extra?.options;
    const cid = Number(extra?.cid);
    if (!request || !options || options.theme !== THEME_ID || !Number.isSafeInteger(cid) || cid <= 0) return payload;

    const auth = await requireAdminAction(request, 'administrator', { csrf: false });
    if (isAdminActionResponse(auth) || !auth.user.authCode) return payload;

    const content = await auth.db.query.contents.findFirst({
      columns: { type: true },
      where: eq(schema.contents.cid, cid),
    });
    if (!content || (content.type !== 'post' && content.type !== 'page')) return payload;

    const settings = parseSettings(auth.options[OPTION_KEY]);
    const featureSettings = parsePluginSettings(auth.options[PLUGIN_OPTION_KEY]);
    const csrfToken = await generateSecurityToken(auth.options.secret, auth.user.authCode, auth.uid);
    return {
      ...payload,
      management: {
        canManage: true,
        showManagementButtons: isEnabled(featureSettings.showCommentManagementButtons),
        adminUrl: computeUrls(auth.options).adminUrl,
        contentType: content.type,
        isPinned: content.type === 'post' && parsePinnedIds(settings.pinnedIds).includes(cid),
        csrfToken,
      },
    };
  }, 20);
}
