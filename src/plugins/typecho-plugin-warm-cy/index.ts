import { eq } from 'drizzle-orm';
import sanitizeHtml from 'sanitize-html';
import { schema } from 'typecho/db';
import { registerPluginAdminPath, setOption } from 'typecho/plugin-sdk';
import type { PluginInitContext, PluginRouteResult } from 'typecho/plugin-sdk';
import { generateSecurityToken } from '@/lib/auth';
import { isAdminActionResponse, requireAdminAction } from '@/lib/admin-auth';
import { computeUrls } from '@/lib/options';
import adminCss from './admin.css?raw';
import { inlineHtmlRuntimeLight, protectInlineHtmlLight, restoreInlineHtmlFragmentsLight } from './html-light';

const THEME_ID = 'typecho-theme-warm-cy';
const OPTION_KEY = `theme:${THEME_ID}`;
const ADMIN_PATH = '/api/admin/theme-pin';
const ADMIN_SETTINGS_API_PATH = '/api/admin/cy-companion-settings';
const ADMIN_PAGE_SLUG = 'cy-companion';
const PLUGIN_OPTION_KEY = 'plugin:typecho-plugin-warm-cy';
const PLUGIN_VERSION = '2026.11.05.10.20';

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

function getHtmlEnhancementMode(settings: Record<string, unknown>): 'off' | 'light' | 'full' {
  const mode = settings.htmlEnhancementMode;
  if (mode === 'off' || mode === 'light' || mode === 'full') return mode;
  // Backward compatibility: the former enabled checkbox maps to the legacy light mode.
  return isEnabled(settings.htmlEnhancementEnabled, false) ? 'light' : 'off';
}

const MARKDOWN_ALERT_TYPES = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const;
const MARKDOWN_ALERT_STYLE_DEFAULTS: Record<string, Record<string, string | number>> = {
  NOTE: { background: '#eef2ff', border: '#c7d2fe', title: '#4338ca', text: '#4338ca', icon: '#4338ca', radius: 8, borderStyle: 'solid' },
  TIP: { background: '#f0fdf4', border: '#bbf7d0', title: '#15803d', text: '#15803d', icon: '#15803d', radius: 8, borderStyle: 'solid' },
  IMPORTANT: { background: '#faf5ff', border: '#e9d5ff', title: '#9333ea', text: '#9333ea', icon: '#9333ea', radius: 8, borderStyle: 'solid' },
  WARNING: { background: '#fefce8', border: '#fde68a', title: '#a16207', text: '#a16207', icon: '#a16207', radius: 8, borderStyle: 'solid' },
  CAUTION: { background: '#fef2f2', border: '#fecaca', title: '#dc2626', text: '#dc2626', icon: '#dc2626', radius: 8, borderStyle: 'solid' },
};

type MarkdownAlertStyleSettings = {
  types: Record<string, Record<string, string | number>>;
  icon: { visible: boolean; size: number; gap: number };
};

function normalizeMarkdownAlertStyleSettings(value: unknown): MarkdownAlertStyleSettings {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const sourceTypes = source.types && typeof source.types === 'object' && !Array.isArray(source.types)
    ? source.types as Record<string, unknown> : {};
  const sourceIcon = source.icon && typeof source.icon === 'object' && !Array.isArray(source.icon)
    ? source.icon as Record<string, unknown> : {};
  const color = (value: unknown, fallback: string) =>
    typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
  const number = (value: unknown, fallback: number, min: number, max: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
  };
  const types: Record<string, Record<string, string | number>> = {};
  for (const type of MARKDOWN_ALERT_TYPES) {
    const item = sourceTypes[type] && typeof sourceTypes[type] === 'object' && !Array.isArray(sourceTypes[type])
      ? sourceTypes[type] as Record<string, unknown> : {};
    const defaults = MARKDOWN_ALERT_STYLE_DEFAULTS[type];
    const borderStyle = ['solid', 'dashed', 'dotted', 'double', 'none'].includes(String(item.borderStyle))
      ? String(item.borderStyle) : String(defaults.borderStyle);
    types[type] = {
      background: color(item.background, String(defaults.background)),
      border: color(item.border, String(defaults.border)),
      title: color(item.title, String(defaults.title)),
      text: color(item.text, String(defaults.text)),
      icon: color(item.icon, String(defaults.icon)),
      radius: number(item.radius, Number(defaults.radius), 0, 32),
      borderStyle,
    };
  }
  return {
    types,
    icon: {
      visible: typeof sourceIcon.visible === 'boolean' ? sourceIcon.visible : true,
      size: number(sourceIcon.size, 18, 12, 32),
      gap: number(sourceIcon.gap, 8, 0, 20),
    },
  };
}

function markdownAlertStyleEditorHtml(value: unknown): string {
  const settings = normalizeMarkdownAlertStyleSettings(value);
  const cards = MARKDOWN_ALERT_TYPES.map(type => {
    const style = settings.types[type];
    const fields = ([
      ['background', '背景颜色', 'color'],
      ['border', '边框颜色', 'color'],
      ['title', '标题颜色', 'color'],
      ['text', '正文颜色', 'color'],
      ['icon', '图标颜色', 'color'],
      ['radius', '圆角（px）', 'number'],
    ] as const).map(([key, label, inputType]) =>
      '<label class="cy-note-style-field"><span>' + label + '</span><input type="' + inputType
      + '" data-cy-alert-style-field="' + type + '.' + key + '" value="' + escapeHtml(style[key]) + '"'
      + (inputType === 'number' ? ' min="0" max="32" step="1"' : '') + '></label>',
    ).join('');
    const borderOptions = ['solid', 'dashed', 'dotted', 'double', 'none'].map(option =>
      '<option value="' + option + '"' + (style.borderStyle === option ? ' selected' : '') + '>' + option + '</option>',
    ).join('');
    return '<fieldset class="cy-note-style-card"><legend>' + type + '</legend><div class="cy-note-style-grid">'
      + fields + '<label class="cy-note-style-field"><span>边框样式</span><select data-cy-alert-style-field="'
      + type + '.borderStyle">' + borderOptions + '</select></label></div></fieldset>';
  }).join('');
  return '<section class="cy-feature-card cy-note-style-settings"><strong>五种 Note 与图标样式</strong>'
    + '<p>每种提示框可独立调整背景、边框、标题、正文、图标颜色、圆角和边框样式。设置只影响 Warm CY 的五种 Markdown Alert，不改变识别规则和 HTML 结构。</p>'
    + '<div class="cy-note-style-grid">' + cards + '</div>'
    + '<div class="cy-note-icon-options"><label><input type="checkbox" data-cy-alert-icon-visible'
    + (settings.icon.visible ? ' checked' : '') + '>显示 SVG 图标</label>'
    + '<label>图标大小（px）<input type="number" min="12" max="32" step="1" data-cy-alert-icon-size value="'
    + settings.icon.size + '"></label>'
    + '<label>图标与标题间距（px）<input type="number" min="0" max="20" step="1" data-cy-alert-icon-gap value="'
    + settings.icon.gap + '"></label></div></section>';
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
  const htmlEnhancementMode = getHtmlEnhancementMode(settings);
  const markdownAlertStyleSettings = normalizeMarkdownAlertStyleSettings(settings.markdownAlertStyleSettings);
  const videoPlayerEnabled = isEnabled(settings.videoPlayerEnabled ?? settings.mobileNativePlayerEnhancementEnabled, false);
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
        <strong>正文 HTML / CSS / JavaScript 增强</strong>
        <p>关闭：完全按主题原始方式处理。轻量开启：沿用昨天的稳定处理规则。全部开启：使用今天扩展后的完整 HTML / CSS / JavaScript / SVG 处理规则。</p>
        <div class="cy-html-mode-options">
          <label><input type="radio" name="htmlEnhancementMode" data-cy-setting="htmlEnhancementMode" value="off" ${htmlEnhancementMode === 'off' ? 'checked' : ''}>不开启</label>
          <label><input type="radio" name="htmlEnhancementMode" data-cy-setting="htmlEnhancementMode" value="light" ${htmlEnhancementMode === 'light' ? 'checked' : ''}>轻量开启（稳定版）</label>
          <label><input type="radio" name="htmlEnhancementMode" data-cy-setting="htmlEnhancementMode" value="full" ${htmlEnhancementMode === 'full' ? 'checked' : ''}>全部开启（完整版）</label>
        </div>
        <p>开启后正文脚本会在访客浏览器中执行，请确保只有可信人员能够发布文章；评论区不受影响。</p>
      </section>
      ${markdownAlertStyleEditorHtml(markdownAlertStyleSettings)}
      <section class="cy-feature-card">
        <label class="cy-feature-toggle">
          <input type="checkbox" data-cy-setting="videoPlayerEnabled" ${videoPlayerEnabled ? 'checked' : ''}>
          <span>独立视频播放器（插件接管）</span>
        </label>
        <p>关闭时完全使用上游主题原生播放器；开启时由 CY 插件独立创建 YouTube、B 站和 Vimeo 播放器 iframe，主题不再处理这些视频。</p>
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
          var htmlMode = root.querySelector('[data-cy-setting="htmlEnhancementMode"]:checked');
          var noteStyleSettings = { types: {}, icon: {
            visible: !!root.querySelector('[data-cy-alert-icon-visible]')?.checked,
            size: Number(root.querySelector('[data-cy-alert-icon-size]')?.value || 18),
            gap: Number(root.querySelector('[data-cy-alert-icon-gap]')?.value ?? 8)
          } };
          root.querySelectorAll('[data-cy-alert-style-field]').forEach(function (field) {
            var parts = (field.dataset.cyAlertStyleField || '').split('.');
            if (parts.length !== 2) return;
            noteStyleSettings.types[parts[0]] = noteStyleSettings.types[parts[0]] || {};
            noteStyleSettings.types[parts[0]][parts[1]] = field.type === 'number' ? Number(field.value) : field.value;
          });
          var videoPlayer = root.querySelector('[data-cy-setting="videoPlayerEnabled"]');
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
                htmlEnhancementMode: htmlMode.value,
                markdownAlertStyleSettings: noteStyleSettings,
                videoPlayerEnabled: !!videoPlayer.checked
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
    block => 'CYCYINLINEBLOCKX' + encodeInlinePayload(/^<svg\b/i.test(block)
      ? sanitizeInlineSvgReferences(restoreProtectedSegments(block))
      : restoreProtectedSegments(block)) + 'XEND',
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
        || (tag.toLowerCase() === 'iframe' && ['src', 'frameborder', 'allowfullscreen', 'referrerpolicy', 'sandbox', 'scrolling', 'border', 'framespacing', 'allow'].includes(name))
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
    'ul', 'ol', 'li', 'menu', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside', 'address',
    'figure', 'figcaption', 'time', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'img', 'button', 'label', 'blockquote', 'pre', 'code', 'mark', 'del', 'ins',
    'sub', 'sup', 'kbd', 'samp', 'var', 'abbr', 'cite', 'q', 'wbr', 'bdi', 'bdo', 'ruby', 'rt', 'rp',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col',
    'details', 'summary', 'dl', 'dt', 'dd', 'picture', 'source',
    'video', 'audio', 'iframe', 'form', 'input', 'select', 'option', 'optgroup', 'textarea',
    'fieldset', 'legend', 'output', 'progress', 'meter', 'canvas',
    'svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon',
    'ellipse', 'defs', 'lineargradient', 'linearGradient',
    'radialgradient', 'radialGradient', 'stop', 'clippath', 'clipPath',
    'mask', 'title', 'desc', 'use', 'symbol',
  ],
  allowedAttributes: {
    '*': ['class', 'id', 'style', 'title', 'role', 'aria-label', 'aria-hidden'],
    a: ['href', 'target', 'rel', 'title', 'style', 'class', 'id', 'download'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'class', 'style'],
    div: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden'],
    p: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden'],
    span: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden'],
    section: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden'],
    article: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden'],
    header: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden'],
    footer: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden'],
    nav: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden'],
    main: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden'],
    figure: ['style', 'class', 'id', 'title'],
    figcaption: ['style', 'class', 'id', 'title'],
    button: ['type', 'disabled', 'style', 'class', 'id', 'title', 'aria-label'],
    label: ['for', 'style', 'class', 'id'],
    blockquote: ['style', 'class', 'id', 'cite'],
    q: ['cite'],
    abbr: ['title'],
    del: ['cite', 'datetime'],
    ins: ['cite', 'datetime'],
    col: ['span', 'width'],
    colgroup: ['span', 'width'],
    pre: ['style', 'class', 'id'],
    code: ['style', 'class', 'id'],
    table: ['style', 'class', 'id'],
    thead: ['style', 'class', 'id'],
    tbody: ['style', 'class', 'id'],
    tfoot: ['style', 'class', 'id'],
    tr: ['style', 'class', 'id'],
    th: ['style', 'class', 'id', 'colspan', 'rowspan', 'scope'],
    td: ['style', 'class', 'id', 'colspan', 'rowspan'],
    video: ['src', 'controls', 'width', 'height', 'poster', 'style', 'class'],
    audio: ['src', 'controls', 'style', 'class'],
    iframe: ['src', 'width', 'height', 'frameborder', 'allowfullscreen', 'title',
      'loading', 'referrerpolicy', 'sandbox', 'scrolling', 'border', 'framespacing', 'allow'],
    source: ['src', 'type'],
    form: ['method', 'enctype', 'target', 'autocomplete', 'name'],
    input: ['type', 'name', 'value', 'placeholder', 'checked', 'disabled', 'required', 'readonly', 'min', 'max', 'step', 'minlength', 'maxlength', 'pattern', 'autocomplete', 'accept', 'multiple', 'width', 'height'],
    select: ['name', 'multiple', 'disabled', 'required', 'size'],
    option: ['value', 'selected', 'disabled', 'label'],
    optgroup: ['label', 'disabled'],
    textarea: ['name', 'rows', 'cols', 'placeholder', 'disabled', 'required', 'readonly', 'minlength', 'maxlength', 'wrap'],
    fieldset: ['disabled', 'name'],
    legend: [],
    output: ['for', 'name'],
    progress: ['value', 'max'],
    meter: ['value', 'min', 'max', 'low', 'high', 'optimum'],
    canvas: ['width', 'height'],
    svg: ['width', 'height', 'viewbox', 'viewBox', 'xmlns', 'fill', 'stroke',
      'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'style', 'class', 'id',
      'role', 'aria-label', 'aria-hidden', 'preserveAspectRatio'],
    g: ['id', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
      'opacity', 'transform', 'style'],
    path: ['id', 'd', 'fill', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width',
      'stroke-linecap', 'stroke-linejoin', 'opacity', 'style'],
    polyline: ['points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
      'stroke-linejoin', 'opacity', 'style'],
    polygon: ['points', 'fill', 'stroke', 'stroke-width', 'stroke-linejoin', 'opacity', 'style'],
    line: ['x1', 'y1', 'x2', 'y2', 'fill', 'stroke', 'stroke-width',
      'stroke-linecap', 'stroke-linejoin', 'opacity'],
    circle: ['id', 'cx', 'cy', 'r', 'fill', 'fill-rule', 'stroke', 'stroke-width', 'opacity', 'style'],
    ellipse: ['id', 'cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'opacity'],
    rect: ['id', 'x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'fill-rule',
      'stroke', 'stroke-width', 'opacity', 'style', 'clip-path'],
    defs: ['id'],
    lineargradient: ['id', 'x1', 'y1', 'x2', 'y2', 'gradientunits', 'gradienttransform', 'spreadmethod'],
    linearGradient: ['id', 'x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform', 'spreadMethod'],
    radialgradient: ['id', 'cx', 'cy', 'fx', 'fy', 'r', 'gradientunits', 'gradienttransform', 'spreadmethod'],
    radialGradient: ['id', 'cx', 'cy', 'fx', 'fy', 'r', 'gradientUnits', 'gradientTransform', 'spreadMethod'],
    stop: ['offset', 'stop-color', 'stop-opacity', 'style'],
    clippath: ['id', 'clippathunits'],
    clipPath: ['id', 'clipPathUnits'],
    mask: ['id', 'maskunits', 'maskcontentunits'],
    use: ['id', 'href', 'xlink:href', 'width', 'height', 'x', 'y'],
    symbol: ['id', 'viewbox', 'viewBox', 'preserveAspectRatio'],
  },
  allowedIframeHostnames: ['www.youtube.com', 'player.bilibili.com', 'player.vimeo.com'],
  allowedSchemesByTag: { iframe: ['https'] },
  allowedStyles: {
    '*': {
      color: [/^(?:#[0-9a-f]{3,8}|rgba?\([0-9.,%\s]+\)|var\(--[a-zA-Z0-9_-]+\)|[a-zA-Z]+)$/i],
      'color-scheme': [/^(?:normal|light|dark|light dark|only light|only dark)$/i],
      fill: [/^(?:none|currentColor|transparent|#[0-9a-f]{3,8}|rgba?\([0-9.,%\s]+\)|[a-zA-Z]+|url\(\s*#[\w:.-]+\s*\))$/i],
      stroke: [/^(?:none|currentColor|transparent|#[0-9a-f]{3,8}|rgba?\([0-9.,%\s]+\)|[a-zA-Z]+|url\(\s*#[\w:.-]+\s*\))$/i],
      'stroke-width': [/^(?!.*(?:expression|javascript:|@import|url\\s*\\())[-#(),.%\\w\\s"'!/+*]+$/i],
      'stroke-linecap': [/^(?:butt|round|square)$/i],
      'stroke-linejoin': [/^(?:arcs|bevel|miter|miter-clip|round)$/i],
      'stroke-dasharray': [/^(?:none|[-+]?\\d*\\.?\\d+(?:px|em|rem|%)?(?:\\s*,?\\s*[-+]?\\d*\\.?\\d+(?:px|em|rem|%)?)*)$/i],
      'stroke-dashoffset': [/^(?!.*(?:expression|javascript:|@import|url\\s*\\())[-#(),.%\\w\\s"'!/+*]+$/i],
      font: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
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
      'border-left': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'border-right': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'border-top': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'border-bottom': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'border-collapse': [/^(?:collapse|separate)$/i],
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
      'overflow-x': [/^(?:visible|hidden|clip|scroll|auto)$/i],
      'overflow-y': [/^(?:visible|hidden|clip|scroll|auto)$/i],
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
      'grid-auto-flow': [/^(?:row|column|dense|row dense|column dense)$/i],
      'grid-auto-columns': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'grid-auto-rows': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'grid-column': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'grid-row': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'align-content': [/^(?:normal|center|start|end|flex-start|flex-end|space-between|space-around|space-evenly|stretch)$/i],
      'justify-items': [/^(?:normal|start|end|center|stretch|self-start|self-end|left|right)$/i],
      'place-items': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'box-sizing': [/^(?:content-box|border-box)$/i],
      'font-style': [/^(?:normal|italic|oblique)$/i],
      'text-transform': [/^(?:none|capitalize|uppercase|lowercase)$/i],
      'text-shadow': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'object-position': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'flex-basis': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'flex-grow': [/^\d+(?:\.\d+)?$/],
      'flex-shrink': [/^\d+(?:\.\d+)?$/],
      animation: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'animation-name': [/^(?:none|[_a-z][\w-]*|(?:[_a-z][\w-]*\s*,\s*)*[_a-z][\w-]*)$/i],
      'animation-duration': [/^(?:0|\d*\.?\d+(?:ms|s))(?:\s*,\s*(?:0|\d*\.?\d+(?:ms|s)))*$/i],
      'animation-timing-function': [/^(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|steps\([^;{}]+\)|cubic-bezier\([^;{}]+\))(?:\s*,\s*(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|steps\([^;{}]+\)|cubic-bezier\([^;{}]+\)))*$/i],
      'animation-delay': [/^(?:0|[-+]?\d*\.?\d+(?:ms|s))(?:\s*,\s*(?:0|[-+]?\d*\.?\d+(?:ms|s)))*$/i],
      'animation-iteration-count': [/^(?:infinite|\d*\.?\d+)(?:\s*,\s*(?:infinite|\d*\.?\d+))*$/i],
      'animation-direction': [/^(?:normal|reverse|alternate|alternate-reverse)(?:\s*,\s*(?:normal|reverse|alternate|alternate-reverse))*$/i],
      'animation-fill-mode': [/^(?:none|forwards|backwards|both)(?:\s*,\s*(?:none|forwards|backwards|both))*$/i],
      'animation-play-state': [/^(?:running|paused)(?:\s*,\s*(?:running|paused))*$/i],
      'font-stretch': [/^(?:normal|ultra-condensed|extra-condensed|condensed|semi-condensed|semi-expanded|expanded|extra-expanded|ultra-expanded|\d+(?:\.\d+)?%)$/i],
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
      return /\burl\s*\(/i.test(cssValue) && !/^url\(\s*(?:(["'])#[\w:.-]+\1|#[\w:.-]+)\s*\)$/i.test(cssValue)
        ? ''
        : attribute;
    });
    return safe;
  });
}

function sanitizeInlineHtmlFragment(source: string): string {
  // sanitize-html attribute names are exact-match entries; expand only valid
  // data-/aria- names actually present in this fragment, rather than relying
  // on a "data-*" attribute glob that may be treated as a literal name.
  const baseAttributes = INLINE_FRAGMENT_SANITIZE_OPTIONS.allowedAttributes;
  const allowedAttributes: Record<string, string[]> = Array.isArray(baseAttributes)
    ? { '*': [...baseAttributes] }
    : Object.fromEntries(Object.entries(baseAttributes || {}).map(([tag, names]) => [tag, [...(names || [])]]));
  const addAttribute = (tag: string, name: string) => {
    for (const key of ['*', tag]) {
      const list = allowedAttributes[key] || (allowedAttributes[key] = []);
      if (!list.includes(name)) list.push(name);
    }
  };
  const tagPattern = /<([a-z][\w:-]*)\b([^>]*)>/gi;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagPattern.exec(source))) {
    const tag = tagMatch[1].toLowerCase();
    if (!INLINE_FRAGMENT_SANITIZE_OPTIONS.allowedTags?.includes(tag)) continue;
    const attributePattern = /(?:^|\s)(data-[a-z0-9_.:-]+|aria-[a-z0-9_.:-]+)(?=\s|=|$)/gi;
    let attributeMatch: RegExpExecArray | null;
    while ((attributeMatch = attributePattern.exec(tagMatch[2]))) {
      addAttribute(tag, attributeMatch[1].toLowerCase());
    }
  }
  return sanitizeHtml(sanitizeInlineSvgReferences(source), {
    ...INLINE_FRAGMENT_SANITIZE_OPTIONS,
    allowedAttributes,
  });
}

function restoreInlineHtmlFragments(content: string): string {
  const restoreContainer = (payload: string): string => {
    let source = sanitizeInlineSvgReferences(decodeInlinePayload(payload));

    // Keep style/script blocks as inert text markers through fragment sanitization.
    // The opt-in frontend runtime restores them only when the enhancement is enabled.
    source = source.replace(/<(style|script|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, block =>
      'CYCYINLINEBLOCKX' + encodeInlinePayload(block) + 'XEND',
    );

    // Reattach preserved attributes before sanitizing the restored container.
    // Attribute values are escaped here; the fragment sanitizer remains the
    // final allowlist enforcement layer.
    source = source.replace(
      /(<[a-z][\w:-]*\b[^>]*>)CYCYINLINEATTRX([a-z][\w:-]*)X([0-9a-f]+)XEND/gi,
      (marker, opening: string, tagName: string, encoded: string) => {
        // The marker is bound to the exact opening tag that produced it.
        // If sanitization or malformed input changes that tag, discard the
        // attributes instead of attaching them to a different element.
        const actualTag = opening.match(/^<([a-z][\w:-]*)\b/i)?.[1]?.toLowerCase();
        if (!actualTag || actualTag !== tagName.toLowerCase()) return opening;
        try {
          const attributes = JSON.parse(decodeInlinePayload(encoded)) as Record<string, unknown>;
          const safe = Object.entries(attributes).map(([name, value]) => {
            const key = name.toLowerCase();
            if (!(key === 'style' || key === 'class' || key === 'id' || key === 'title'
              || key === 'role' || key === 'width' || key === 'height' || key === 'alt'
              || key === 'loading' || key === 'type' || key === 'name' || key === 'value'
              || key === 'placeholder'
              || (tagName.toLowerCase() === 'iframe' && ['src', 'frameborder', 'allowfullscreen', 'referrerpolicy', 'sandbox', 'scrolling', 'border', 'framespacing', 'allow'].includes(key))
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
    const source = sanitizeInlineSvgReferences(decodeInlinePayload(payload)).replace(
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

function markdownAlertIconStyles(value?: unknown): string {
  const settings = normalizeMarkdownAlertStyleSettings(value);
  const rules = MARKDOWN_ALERT_TYPES.map(type => {
    const style = settings.types[type];
    const defaults = MARKDOWN_ALERT_STYLE_DEFAULTS[type];
    const selector = '.warm-prose .markdown-alert[data-alert="' + type + '"],'
      + '.warm-note__content .markdown-alert[data-alert="' + type + '"]';
    const titleSelector = '.warm-prose .markdown-alert[data-alert="' + type + '"] .markdown-alert-title,'
      + '.warm-note__content .markdown-alert[data-alert="' + type + '"] .markdown-alert-title';
    const iconSelector = '.warm-prose .markdown-alert[data-alert="' + type + '"] .markdown-alert-title .markdown-alert-icon,'
      + '.warm-note__content .markdown-alert[data-alert="' + type + '"] .markdown-alert-title .markdown-alert-icon';
    const declarations: string[] = [];
    if (style.background !== defaults.background) declarations.push('background:' + style.background + '!important');
    if (style.border !== defaults.border) declarations.push('border-color:' + style.border + '!important;border-left-color:' + style.border + '!important');
    if (style.borderStyle !== defaults.borderStyle) declarations.push('border-style:' + style.borderStyle + '!important');
    if (style.radius !== defaults.radius) declarations.push('border-radius:' + style.radius + 'px!important');
    const bodySelector = '.warm-prose .markdown-alert[data-alert="' + type + '"] > :not(.markdown-alert-title),'
      + '.warm-note__content .markdown-alert[data-alert="' + type + '"] > :not(.markdown-alert-title)';
    const textRule = style.text !== defaults.text ? bodySelector + '{color:' + style.text + '!important}' : '';
    const titleRule = style.title !== defaults.title
      ? titleSelector + '{color:' + style.title + '!important}' : '';
    const iconDeclarations: string[] = [];
    if (style.icon !== defaults.icon) iconDeclarations.push('color:' + style.icon + '!important');
    if (settings.icon.size !== 18) {
      iconDeclarations.push('width:' + settings.icon.size + 'px!important;height:' + settings.icon.size
        + 'px!important;min-width:' + settings.icon.size + 'px!important;max-width:' + settings.icon.size
        + 'px!important;min-height:' + settings.icon.size + 'px!important;max-height:' + settings.icon.size
        + 'px!important;flex:0 0 ' + settings.icon.size + 'px!important');
    }
    if (settings.icon.gap !== 8) iconDeclarations.push('margin-right:' + settings.icon.gap + 'px!important');
    if (!settings.icon.visible) iconDeclarations.push('display:none!important');
    return (declarations.length ? selector + '{' + declarations.join(';') + '}' : '')
      + titleRule
      + textRule
      + (iconDeclarations.length ? iconSelector + '{' + iconDeclarations.join(';') + '}' : '');
  }).join('');
  return '<style data-cy-markdown-alert-icons>'
    + '.warm-prose .markdown-alert-title.cy-markdown-alert-has-icon::before,'
    + '.warm-note__content .markdown-alert-title.cy-markdown-alert-has-icon::before'
    + '{content:none!important;display:none!important}' + rules + '</style>';
}

const INLINE_HTML_RUNTIME = "(() => {\n  const enabled = __CY_ENABLED__;\n  const markerPattern = /CYCYINLINEBLOCKX([0-9a-f]+)XEND|CYCYINLINEATTRX([a-z][\\w:-]*)X([0-9a-f]+)XEND/g;\n  const allowedInlineIframeHosts = new Set(['www.youtube.com', 'player.bilibili.com', 'player.vimeo.com']);\n  const svgTags = new Set(['svg','g','path','circle','rect','line','polyline','polygon','ellipse','defs','lineargradient','radialgradient','stop','clippath','mask','title','desc','use','symbol','text','tspan','filter','marker','pattern','textpath','mpath','fegaussianblur','feoffset','feblend','fecolormatrix','fecomposite','feflood','femerge','femergenode','fecomponenttransfer','fefunca','fefuncb','fefuncg','fefuncr','feturbulence']);\n  const svgAttrs = new Set(['id','class','viewbox','width','height','fill','fill-rule','clip-rule','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','opacity','fill-opacity','stroke-opacity','cx','cy','r','rx','ry','x','y','x1','x2','y1','y2','d','points','transform','preserveaspectratio','offset','stop-color','stop-opacity','gradientunits','gradienttransform','clippathunits','maskunits','maskcontentunits','clip-path','mask','filter','marker-start','marker-mid','marker-end','markerunits','markerwidth','markerheight','refx','refy','orient','patternunits','patterncontentunits','patterntransform','textlength','lengthadjust','startoffset','method','spacing','side','pathlength','overflow','href','xlink:href','role','focusable','aria-hidden','aria-label','font-family','font-size','font-weight','font-style','text-anchor','dominant-baseline','letter-spacing','dx','dy','filterunits','primitiveunits','color-interpolation-filters','stddeviation','in','in2','result','type','values','operator','k1','k2','k3','k4','slope','intercept','tablevalues','mode','flood-color','flood-opacity','basefrequency','numoctaves','seed','stitchtiles','surfacescale','specularconstant','specularexponent','limitingconeangle','azimuth','elevation','pointsatx','pointsaty','pointsatz','kernelmatrix','kernelunitlength','preservealpha']);\n  const decode = hex => { const bytes = new Uint8Array(hex.length / 2); for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); return new TextDecoder().decode(bytes); };\n  let inlineSvgSequence = 0;\n  const collectSvgIds = (node, idMap) => {\n    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;\n    for (const attr of Array.from(node.attributes || [])) {\n      if (attr.name.toLowerCase() === 'id' && /^[\\w:.-]+$/.test(attr.value) && !idMap.has(attr.value)) {\n        idMap.set(attr.value, 'cy-inline-svg-' + inlineSvgSequence + '-' + attr.value);\n      }\n    }\n    for (const child of Array.from(node.childNodes || [])) collectSvgIds(child, idMap);\n  };\n  const rewriteSvgReferences = (value, idMap) => {\n    let valid = true;\n    const rewritten = String(value).replace(/url\\(\\s*(?:([\"'])#([\\w:.-]+)\\1|#([\\w:.-]+))\\s*\\)/gi, (_match, _quote, quotedId, bareId) => {\n      const scopedId = idMap.get(quotedId || bareId);\n      if (!scopedId) { valid = false; return ''; }\n      return 'url(#' + scopedId + ')';\n    });\n    return valid ? rewritten : null;\n  };\n  const safeSvgNode = (node, idMap) => {\n    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue || '');\n    if (node.nodeType !== Node.ELEMENT_NODE || !svgTags.has(node.localName.toLowerCase())) return null;\n    const clean = document.createElementNS('http://www.w3.org/2000/svg', node.localName);\n    for (const attr of Array.from(node.attributes)) {\n      const key = attr.name.toLowerCase(), value = attr.value;\n      if (!svgAttrs.has(key) && key !== 'style' && !key.startsWith('aria-')) continue;\n      if (key === 'style') {\n        const allowedStyle = new Set(['fill','stroke','fill-rule','clip-rule','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','opacity','fill-opacity','stroke-opacity','stop-color','stop-opacity','font-family','font-size','font-weight','font-style','text-anchor','dominant-baseline','letter-spacing']);\n        const safeStyle = value.split(';').map(part => part.trim()).filter(Boolean).map(part => {\n          const split = part.indexOf(':');\n          if (split < 1) return '';\n          const property = part.slice(0, split).trim().toLowerCase();\n          const cssValue = part.slice(split + 1).trim();\n          if (!allowedStyle.has(property) || cssValue.includes('\\\\') || cssValue.includes('/*') || /expression|javascript:|data:|@import|[\\u0000-\\u001f]/i.test(cssValue)) return '';\n          if (/\\burl\\s*\\(/i.test(cssValue) && !/^url\\(\\s*(?:([\"'])#[\\w:.-]+\\1|#[\\w:.-]+)\\s*\\)$/i.test(cssValue)) return '';\n          const rewritten = rewriteSvgReferences(cssValue, idMap);\n          return rewritten === null ? '' : property + ':' + rewritten;\n        }).filter(Boolean).join(';');\n        if (safeStyle) clean.setAttribute('style', safeStyle);\n        continue;\n      }\n      if ((key === 'href' || key === 'xlink:href') && !/^#[\\w:.-]+$/.test(value)) continue;\n      if (key === 'aria-labelledby' || key === 'aria-describedby') {\n        const ids = value.trim().split(/\\s+/).filter(Boolean);\n        const scopedIds = ids.map(id => idMap.get(id));\n        if (!ids.length || scopedIds.some(id => !id)) continue;\n        clean.setAttribute(attr.name, scopedIds.join(' '));\n        continue;\n      }\n      if (key === 'id') {\n        const scopedId = idMap.get(value);\n        if (scopedId) clean.setAttribute('id', scopedId);\n        continue;\n      }\n      if (key === 'href' || key === 'xlink:href') {\n        if (!/^#[\\w:.-]+$/.test(value)) continue;\n        const scopedId = idMap.get(value.slice(1));\n        if (!scopedId) continue;\n        const rewritten = '#' + scopedId;\n        if (key === 'xlink:href') clean.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', rewritten);\n        else clean.setAttribute(attr.name, rewritten);\n        continue;\n      }\n      if (['fill', 'stroke', 'clip-path', 'mask', 'filter'].includes(key)\n        && (value.includes('\\\\') || value.includes('/*'))) continue;\n      if (/\\burl\\s*\\(/i.test(value) && !/^\\s*url\\(\\s*(?:([\"'])#[\\w:.-]+\\1|#[\\w:.-]+)\\s*\\)\\s*$/i.test(value)) continue;\n      if (/javascript:|data:text\\/html|[\\u0000-\\u001f]/i.test(value)) continue;\n      const rewritten = rewriteSvgReferences(value, idMap);\n      if (rewritten === null) continue;\n      if (key === 'xlink:href') clean.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', rewritten); else clean.setAttribute(attr.name, rewritten);\n    }\n    for (const child of Array.from(node.childNodes)) { const safe = safeSvgNode(child, idMap); if (safe) clean.appendChild(safe); }\n    return clean;\n  };\n  const allowedProperties = new Set([\n    'color','color-scheme','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','background','background-color','background-image','font','font-weight','font-size','font-family','line-height','text-align','text-decoration','word-break','overflow-wrap','display','align-items','align-self','justify-content','flex-direction','flex-wrap','flex','gap','padding','margin','width','height','min-width','max-width','min-height','max-height','border','border-left','border-right','border-top','border-bottom','border-collapse','border-radius','border-color','border-width','border-style','box-shadow','position','top','right','bottom','left','z-index','overflow','overflow-x','overflow-y','cursor','opacity','transform','transition','object-fit','vertical-align','white-space','letter-spacing','aspect-ratio','grid-template-columns','grid-template-rows','grid-auto-flow','grid-auto-columns','grid-auto-rows','grid-column','grid-row','align-content','justify-items','place-items','box-sizing','font-style','text-transform','text-shadow','object-position','flex-basis','flex-grow','flex-shrink','animation','animation-name','animation-duration','animation-timing-function','animation-delay','animation-iteration-count','animation-direction','animation-fill-mode','animation-play-state','font-stretch'\n  ]);\n  const safeValue = value => {\n    const normalized = String(value || '').trim();\n    const withoutLocalUrls = normalized.replace(/url\\(\\s*(?:([\"'])#[\\w:.-]+\\1|#[\\w:.-]+)\\s*\\)/gi, '');\n    return !!normalized\n      && !/[\\u0000-\\u001f\\u007f]/.test(normalized)\n      && !normalized.includes('\\\\') && !normalized.includes('/*')\n      && !/(?:expression|javascript\\s*:|vbscript\\s*:|@import|behavior\\s*:|-moz-binding)/i.test(normalized)\n      && !/(?:-webkit-)?image-set\\s*\\(/i.test(normalized)\n      && !/url\\s*\\(/i.test(withoutLocalUrls);\n  };\n  const safeInlineStyleText = value => {\n    try {\n      const probe = document.createElement('span');\n      if (!probe.style) return '';\n      probe.style.cssText = String(value || '');\n      const declarations = [];\n      for (let index = 0; index < probe.style.length; index++) {\n        const property = probe.style.item(index).toLowerCase();\n        if (!allowedProperties.has(property) && !/^--[a-z0-9_-]+$/i.test(property)) continue;\n        const cssValue = probe.style.getPropertyValue(property);\n        if (!safeValue(cssValue)) continue;\n        const priority = probe.style.getPropertyPriority(property);\n        declarations.push(property + ':' + cssValue + (priority === 'important' ? ' !important' : ''));\n      }\n      return declarations.join(';');\n    } catch {\n      return '';\n    }\n  };\n  let inlineStyleScopeSequence = 0;\n  const addBlock = (raw, scopeRoot) => {\n    const match = raw.match(/^<(style|script|svg)\\b([^>]*)>([\\s\\S]*)<\\/\\1\\s*>$/i);\n    if (!match) return null;\n    const tag = match[1].toLowerCase(), attrs = match[2] || '', body = match[3] || '';\n    if (tag === 'svg') {\n      try { const parsed = new DOMParser().parseFromString(raw, 'image/svg+xml'); if (parsed.querySelector('parsererror') || parsed.documentElement.localName.toLowerCase() !== 'svg') return null; const idMap = new Map(); inlineSvgSequence++; collectSvgIds(parsed.documentElement, idMap); return safeSvgNode(parsed.documentElement, idMap); } catch { return null; }\n    }\n  const safeStylesheetText = (cssText, scopeRoot) => {\n    try {\n      if (!scopeRoot || !scopeRoot.classList) return '';\n      const scopeClass = 'cy-inline-html-scope-' + (++inlineStyleScopeSequence)\n        + '-' + Math.random().toString(36).slice(2);\n      scopeRoot.classList.add(scopeClass);\n      const scope = '.' + scopeClass;\n      let sheet;\n      if (typeof CSSStyleSheet === 'function' && CSSStyleSheet.prototype\n        && typeof CSSStyleSheet.prototype.replaceSync === 'function') {\n        try {\n          sheet = new CSSStyleSheet();\n          sheet.replaceSync(cssText);\n        } catch {\n          sheet = null;\n        }\n      }\n      if ((!sheet || !sheet.cssRules) && document.implementation\n        && typeof document.implementation.createHTMLDocument === 'function') {\n        const parserDocument = document.implementation.createHTMLDocument('');\n        const parserStyle = parserDocument.createElement('style');\n        parserStyle.textContent = cssText;\n        parserDocument.head.appendChild(parserStyle);\n        sheet = parserStyle.sheet;\n      }\n      if (!sheet || !sheet.cssRules) return '';\n      const splitSelectors = selectorText => {\n        const selectors = [];\n        let start = 0, depth = 0, quote = '';\n        for (let index = 0; index < selectorText.length; index++) {\n          const character = selectorText[index];\n          if (quote) {\n            if (character === quote && selectorText[index - 1] !== '\\\\') quote = '';\n          } else if (character === '\"' || character === \"'\") quote = character;\n          else if (character === '(' || character === '[') depth++;\n          else if (character === ')' || character === ']') depth = Math.max(0, depth - 1);\n          else if (character === ',' && depth === 0) {\n            selectors.push(selectorText.slice(start, index).trim());\n            start = index + 1;\n          }\n        }\n        selectors.push(selectorText.slice(start).trim());\n        return selectors.filter(Boolean);\n      };\n      const scopeSelector = selectorText => {\n        const selectors = [];\n        for (const selector of splitSelectors(selectorText)) {\n          if (/:global\\s*\\(|:host(?:-context)?\\b|::slotted\\s*\\(/i.test(selector)) continue;\n          if (/^(?:html|body|:root)\\s*$/i.test(selector)) {\n            selectors.push(scope);\n            continue;\n          }\n          const rootPrefix = selector.match(/^(?:html|body|:root)(?=$|[\\s>+~.#:[\\]])/i);\n          if (rootPrefix) {\n            let remainder = selector;\n            while (true) {\n              const rootToken = remainder.match(/^(?:html|body|:root)(?=$|[\\s>+~.#:[\\]])/i);\n              if (!rootToken) break;\n              remainder = remainder.slice(rootToken[0].length);\n              const whitespace = remainder.match(/^\\s+/);\n              if (whitespace) {\n                remainder = remainder.slice(whitespace[0].length);\n                const spacedCombinator = remainder.match(/^[>+~]\\s*/);\n                if (spacedCombinator) {\n                  remainder = remainder.slice(spacedCombinator[0].length);\n                  if (/^(?:html|body|:root)(?=$|[\\s>+~.#:[\\]])/i.test(remainder)) continue;\n                  remainder = ' ' + spacedCombinator[0].trim() + (remainder ? ' ' + remainder : '');\n                  break;\n                }\n                if (/^(?:html|body|:root)(?=$|[\\s>+~.#:[\\]])/i.test(remainder)) continue;\n                remainder = remainder ? ' ' + remainder : '';\n                break;\n              }\n              const combinator = remainder.match(/^[>+~]\\s*/);\n              if (combinator) {\n                remainder = remainder.slice(combinator[0].length);\n                if (/^(?:html|body|:root)(?=$|[\\s>+~.#:[\\]])/i.test(remainder)) continue;\n                remainder = ' ' + combinator[0].trim() + (remainder ? ' ' + remainder : '');\n                break;\n              }\n              break;\n            }\n            selectors.push(scope + remainder);\n            continue;\n          }\n          if (/(^|[\\s>+~,(])(?:html|body)(?=$|[\\s>+~.#:[\\],)])/i.test(selector)\n            || /:root\\b/i.test(selector)) continue;\n          if (selector === '*') selectors.push(scope + ',' + scope + ' *');\n          else selectors.push(scope + ' ' + selector);\n        }\n        return selectors.join(',');\n      };\n      const keyframeNames = new Map();\n      const fontFamilyNames = new Map();\n      const genericFontFamilies = new Set(['serif','sans-serif','monospace','cursive','fantasy','system-ui','ui-serif','ui-sans-serif','ui-monospace','ui-rounded','math','emoji','fangsong']);\n      const collectKeyframes = rules => {\n        for (const rule of Array.from(rules || [])) {\n          const match = String(rule.cssText || '').match(/^@(?:-webkit-)?keyframes\\s+([_a-z][\\w-]*)/i);\n          if (match) keyframeNames.set(match[1], scopeClass + '-' + match[1]);\n          if (rule.style && (rule.type === 5 || /FontFaceRule/i.test(rule.constructor && rule.constructor.name || ''))) {\n            const rawFamily = String(rule.style.getPropertyValue('font-family') || '').trim();\n            const family = rawFamily.replace(/^[\"']|[\"']$/g, '');\n            if (/^[_a-z][\\w -]*$/i.test(family) && !genericFontFamilies.has(family.toLowerCase())) {\n              fontFamilyNames.set(family.toLowerCase(), scopeClass + '-font-' + fontFamilyNames.size);\n            }\n          }\n          if (rule.cssRules) collectKeyframes(rule.cssRules);\n        }\n      };\n      collectKeyframes(sheet.cssRules);\n      const rewriteAnimationNames = (property, value) => {\n        if (property !== 'animation' && property !== 'animation-name') return value;\n        for (const [original, scopedName] of keyframeNames) {\n          const pattern = new RegExp('(^|[\\\\s,])' + original + '(?=$|[\\\\s,])', 'g');\n          value = value.replace(pattern, (_match, prefix) => prefix + scopedName);\n        }\n        return value;\n      };\n      const rewriteFontFamily = (property, value) => {\n        if (property !== 'font-family' && property !== 'font') return value;\n        for (const [original, scopedName] of fontFamilyNames) {\n          value = value.replace(new RegExp('\"' + original + '\"', 'gi'), '\"' + scopedName + '\"');\n          value = value.replace(new RegExp(\"'\" + original + \"'\", 'gi'), \"'\" + scopedName + \"'\");\n          if (!original.includes(' ')) {\n            const pattern = new RegExp('(^|[\\\\s,])' + original + '(?=$|[\\\\s,])', 'gi');\n            value = value.replace(pattern, (_match, prefix) => prefix + scopedName);\n          }\n        }\n        return value;\n      };\n      const serializeDeclarations = (style, extraAllowed) => {\n        const declarations = [];\n        for (let index = 0; index < style.length; index++) {\n          const property = style.item(index).toLowerCase();\n          const value = rewriteFontFamily(property, rewriteAnimationNames(property, style.getPropertyValue(property)));\n          if ((!allowedProperties.has(property) && !extraAllowed.has(property)\n            && !/^--[a-z0-9_-]+$/i.test(property)) || !safeValue(value)) continue;\n          const priority = style.getPropertyPriority(property);\n          declarations.push(property + ':' + value + (priority === 'important' ? ' !important' : ''));\n        }\n        return declarations.join(';');\n      };\n      const serializeRules = (rules, keyframeChildren = false) => {\n        let output = '';\n        for (const rule of Array.from(rules || [])) {\n          if (rule.type === 1 && rule.style && rule.selectorText) {\n            const selector = keyframeChildren ? rule.selectorText : scopeSelector(rule.selectorText);\n            const declarations = serializeDeclarations(rule.style, new Set());\n            if (selector && declarations) output += selector + '{' + declarations + '}';\n          } else if (rule.style && (rule.type === 5 || /FontFaceRule/i.test(rule.constructor && rule.constructor.name || ''))) {\n            const declarations = serializeDeclarations(rule.style, new Set(['src','font-display','font-stretch','unicode-range']));\n            if (declarations) output += '@font-face{' + declarations + '}';\n          } else if (rule.style && rule.keyText) {\n            const declarations = serializeDeclarations(rule.style, new Set());\n            if (declarations) output += rule.keyText + '{' + declarations + '}';\n          } else if (rule.cssRules) {\n            const ruleText = String(rule.cssText || '');\n            const atRule = ruleText.match(/^@([\\w-]+)\\s*([^{]*)/);\n            const name = atRule && atRule[1].toLowerCase();\n            const condition = rule.conditionText || (rule.media && rule.media.mediaText)\n              || (atRule && atRule[2].trim()) || '';\n            const nested = serializeRules(rule.cssRules, name === 'keyframes' || name === '-webkit-keyframes');\n            if (!nested) continue;\n            if ((name === 'keyframes' || name === '-webkit-keyframes') && /^[\\w-]+$/.test(condition)) {\n              output += '@' + name + ' ' + (keyframeNames.get(condition) || condition) + '{' + nested + '}';\n            } else if (['media','supports','container'].includes(name) && condition\n              && !/[{};]/.test(condition)) {\n              output += '@' + name + ' ' + condition + '{' + nested + '}';\n            } else if (name === 'layer' && /^[\\w-]+(?:\\.[\\w-]+)*$/.test(condition)) {\n              output += '@layer ' + scopeClass + '.' + condition + '{' + nested + '}';\n            }\n          }\n        }\n        return output;\n      };\n      return serializeRules(sheet.cssRules);\n    } catch {\n      return '';\n    }\n  };\n    if (tag === 'style') { const safeCss = safeStylesheetText(body, scopeRoot); if (!safeCss) return null; const style = document.createElement('style'); const styleAttributePattern = /([a-zA-Z_:][\\w:.-]*)\\s*=\\s*(?:\\x22([^\\x22]*)\\x22|'([^']*)'|([^\\s>]+))/g; let styleAttribute; while ((styleAttribute = styleAttributePattern.exec(attrs))) { const name = styleAttribute[1].toLowerCase(); if (['media','nonce','title','id','type'].includes(name) || name.startsWith('data-') || name.startsWith('aria-')) style.setAttribute(name, styleAttribute[2] || styleAttribute[3] || styleAttribute[4] || ''); } style.textContent = safeCss; document.head.appendChild(style); return null; }\n    const script = document.createElement('script');\n    const attributePattern = /([a-zA-Z_:][\\w:.-]*)\\s*=\\s*(?:\\x22([^\\x22]*)\\x22|'([^']*)'|([^\\s>]+))/g;\n    const booleanAttributes = new Set(['async','defer','nomodule']);\n    const copiedAttributes = new Set(['src','type','nonce','integrity','crossorigin','referrerpolicy','charset','fetchpriority','id','class','title']);\n    let attributeMatch;\n    while ((attributeMatch = attributePattern.exec(attrs))) {\n      const name = attributeMatch[1].toLowerCase();\n      if (copiedAttributes.has(name) || name.startsWith('data-') || name.startsWith('aria-')) script.setAttribute(name, attributeMatch[2] || attributeMatch[3] || attributeMatch[4] || '');\n      else if (booleanAttributes.has(name)) script.setAttribute(name, '');\n    }\n    const source = script.getAttribute('src');\n    if (source) {\n      try {\n        const url = new URL(source, document.baseURI);\n        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;\n        if (!script.hasAttribute('async')) script.async = false;\n        script.src = url.href;\n      } catch { return null; }\n    }\n    script.textContent = body;\n    document.body.appendChild(script);\n    return null;\n  };\n  const hydrate = () => {\n    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode(node) { const p = node.parentElement; if (!p || p.closest('pre,code,textarea,script,style')) return NodeFilter.FILTER_REJECT; markerPattern.lastIndex = 0; return markerPattern.test(node.nodeValue || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; } });\n    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);\n    for (const node of nodes) {\n      const value = node.nodeValue || ''; markerPattern.lastIndex = 0; let last = 0, match, changed = false; const fragment = document.createDocumentFragment();\n      while ((match = markerPattern.exec(value))) {\n        changed = true; if (match.index > last) fragment.appendChild(document.createTextNode(value.slice(last, match.index)));\n        if (enabled && match[1]) { const scopeRoot = node.parentElement && (node.parentElement.closest('.cy-inline-html-pending') || node.parentElement.closest('article')); const element = addBlock(decode(match[1]), scopeRoot); if (element) fragment.appendChild(element); }\n        else if (enabled && match[2] && match[3]) {\n          const parent = node.parentElement, previous = node.previousElementSibling;\n          const target = parent && parent.tagName && parent.tagName.toLowerCase() === match[2] ? parent : previous && previous.tagName && previous.tagName.toLowerCase() === match[2] ? previous : null;\n          if (target) {\n            try {\n              const attrs = JSON.parse(decode(match[3]));\n              for (const [name, value] of Object.entries(attrs)) {\n                if (name === 'style') { const safeStyle = safeInlineStyleText(value); if (safeStyle) target.setAttribute('style', safeStyle); }\n                else if (name === 'class' || name === 'id' || name === 'title' || name === 'role'\n                  || name === 'width' || name === 'height' || name === 'alt' || name === 'loading'\n                  || name === 'type' || name === 'name' || name === 'value' || name === 'placeholder'\n                  || (match[2] === 'iframe' && ['src', 'frameborder', 'allowfullscreen', 'referrerpolicy', 'sandbox', 'scrolling', 'border', 'framespacing', 'allow'].includes(name))\n                  || name.startsWith('data-') || name.startsWith('aria-')) {\n                  if (match[2] === 'iframe' && name === 'src') {\n                    try {\n                      const baseUrl = document.baseURI || (window.location && window.location.href) || 'https://invalid.local/';\n                      const iframeUrl = new URL(String(value), baseUrl);\n                      if (iframeUrl.protocol !== 'https:' || iframeUrl.username || iframeUrl.password\n                        || iframeUrl.port || !allowedInlineIframeHosts.has(iframeUrl.hostname.toLowerCase())) continue;\n                      target.setAttribute(name, iframeUrl.href);\n                    } catch {\n                      continue;\n                    }\n                  } else target.setAttribute(name, String(value));\n                }\n              }\n            } catch {}\n          }\n        }\n        last = match.index + match[0].length;\n      }\n      if (changed) { if (last < value.length) fragment.appendChild(document.createTextNode(value.slice(last))); node.parentNode && node.parentNode.replaceChild(fragment, node); }\n    }\n  };\n  hydrate(); window.addEventListener('instantclick:newpage', hydrate);\n})();";
function videoProviderForSource(source: string): 'youtube' | 'bilibili' | 'vimeo' | null {
  try {
    const normalized = source.replace(/&amp;/g, '&').trim();
    if (!normalized) return null;
    // Protocol-relative embeds inherit HTTPS; explicit HTTP, credentials and
    // non-default ports are not trusted even when the hostname looks valid.
    const url = new URL(normalized, 'https://localhost');
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (url.hostname === 'www.youtube.com') return 'youtube';
    if (url.hostname === 'player.bilibili.com') return 'bilibili';
    if (url.hostname === 'player.vimeo.com') return 'vimeo';
  } catch {
    return null;
  }
  return null;
}

function readIframeAttribute(attributes: string, name: string): string {
  const pattern = new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i");
  const match = pattern.exec(attributes);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

function protectVideoIframesForMarkdown(content: string): string {
  return content.replace(/<iframe\b([^>]*)>(?:\s*<\/iframe\s*>)?/gi, (match, attributes: string) => {
    const source = readIframeAttribute(attributes, 'src').replace(/&amp;/g, '&');
    if (!source || !videoProviderForSource(source)) return match;
    return 'CYVIDEOIFRAMEX' + encodeInlinePayload(match) + 'XEND';
  });
}

function restoreVideoIframesAfterMarkdown(content: string): string {
  const restore = (_marker: string, payload: string) => {
    try { return decodeInlinePayload(payload); } catch { return ''; }
  };
  // A protected iframe is plain text to Marked, so a standalone embed may
  // be wrapped in <p>. Remove that wrapper before restoring the block iframe.
  return content
    .replace(/<p>\s*CYVIDEOIFRAMEX([0-9a-f]+)XEND\s*<\/p>/gi, restore)
    .replace(/CYVIDEOIFRAMEX([0-9a-f]+)XEND/g, restore);
}

function replaceVideoIframesWithPlaceholders(content: string): string {
  return content.replace(/<iframe\b([^>]*)>(?:\s*<\/iframe\s*>)?/gi, (match, attributes: string) => {
    const source = readIframeAttribute(attributes, 'src').replace(/&amp;/g, '&');
    const provider = videoProviderForSource(source);
    if (!source || !provider) return match;

    const requestedWidth = readIframeAttribute(attributes, 'width');
    const requestedHeight = readIframeAttribute(attributes, 'height');
    const width = /^\d{2,4}$/.test(requestedWidth) ? Number(requestedWidth) : 0;
    const height = /^\d{2,4}$/.test(requestedHeight) ? Number(requestedHeight) : 0;
    const ratio = width > 0 && height > 0
      ? Math.max(0.5, Math.min(3, width / height))
      : 16 / 9;

    return '<div class="cy-video-player" data-cy-video-player'
      + ' data-cy-video-provider="' + provider + '"'
      + ' data-cy-video-src="' + escapeHtml(source) + '"'
      + ' data-cy-video-ratio="' + ratio.toFixed(5) + '">'
      + '<div class="cy-video-player__status" role="status">正在加载视频…</div>'
      + '</div>';
  });
}

function videoPlayerRuntime(enabled: boolean): string {
  if (!enabled) return '';
  return `<style data-cy-video-player-styles>
    .cy-video-player{position:relative;display:block;width:100%;max-width:100%;height:auto;aspect-ratio:var(--cy-video-ratio,16/9);overflow:hidden;background:transparent;border-radius:0.5rem}
    .cy-video-player iframe{position:absolute;inset:0;display:block;width:100%;height:100%;max-width:100%;border:0;background:transparent}
    .cy-video-player__status{position:absolute;inset:0;display:grid;place-items:center;padding:1rem;color:inherit;background:transparent;text-align:center;font-size:14px;pointer-events:none}
    .cy-video-player__status[hidden]{display:none}
  </style><script data-cy-video-player-runtime>
    (() => {
      const supportedHosts = new Set(['www.youtube.com', 'player.bilibili.com', 'player.vimeo.com']);
      const mount = root => {
        if (!root || root.dataset.cyVideoMounted === '1') return;
        const source = root.dataset.cyVideoSrc || '';
        let url;
        try { url = new URL(source, location.href); } catch { return; }
        const provider = root.dataset.cyVideoProvider || '';
        if (!supportedHosts.has(url.hostname.toLowerCase()) || !['youtube', 'bilibili', 'vimeo'].includes(provider)) return;

        const status = root.querySelector('.cy-video-player__status');
        const ratio = Number.parseFloat(root.dataset.cyVideoRatio || '');
        if (Number.isFinite(ratio) && ratio >= 0.5 && ratio <= 3) {
          root.style.setProperty('--cy-video-ratio', String(ratio));
          root.style.aspectRatio = String(ratio);
        }

        // Keep the platform's native iframe as the playback engine. Do not
        // use lazy loading here: affected Android browsers may leave a
        // script-created lazy iframe unrequested while the embed is visible.
        const frame = document.createElement('iframe');
        if (provider === 'youtube') {
          if (!url.searchParams.has('playsinline')) url.searchParams.set('playsinline', '1');
        }
        frame.src = url.toString();
        frame.title = '视频播放器';
        frame.width = '100%';
        frame.height = '100%';
        frame.loading = 'eager';
        frame.allowFullscreen = true;
        frame.setAttribute('frameborder', provider === 'bilibili' ? 'no' : '0');
        frame.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
        if (provider === 'bilibili') {
          frame.setAttribute('scrolling', 'no');
          frame.setAttribute('border', '0');
          frame.setAttribute('framespacing', '0');
          frame.setAttribute('allowfullscreen', 'true');
        }
        frame.addEventListener('load', () => {
          root.dataset.cyVideoState = 'frame-loaded';
          if (status) status.hidden = true;
        }, { once: true });
        frame.addEventListener('error', () => {
          root.dataset.cyVideoState = 'error';
          if (status) {
            status.hidden = false;
            status.textContent = '播放器框架请求失败，请检查网络或浏览器拦截设置。';
          }
        }, { once: true });

        root.appendChild(frame);
        root.dataset.cyVideoMounted = '1';
        root.dataset.cyVideoState = 'loading';
      };

      const scan = root => {
        if (!root) return;
        if (root.matches && root.matches('[data-cy-video-player]')) mount(root);
        if (root.querySelectorAll) root.querySelectorAll('[data-cy-video-player]').forEach(mount);
      };

      const start = () => scan(document);
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
      } else {
        start();
      }
      window.addEventListener('instantclick:newpage', start);
      const observer = new MutationObserver(records => {
        for (const record of records) record.addedNodes.forEach(scan);
      });
      if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
    })();
  </script>`;
}

function inlineHtmlRuntime(): string {
  // Injected only while the HTML enhancement is enabled; disabled mode adds
  // neither a hiding rule nor a runtime script.
  const visibilityStyle = '<style data-cy-inline-html-enhancement-style>'
    + '.cy-inline-html-pending{display:contents!important}'
    + '</style>';
  return visibilityStyle + '<script data-cy-inline-html-enhancement>'
    + INLINE_HTML_RUNTIME.replace('__CY_ENABLED__', 'true')
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

  // Each content feature reads its own setting from the request context.
  addHook('content:markdown', pluginId, (content: string, requestContext?: {
    options?: Record<string, unknown>;
  }) => {
    const options = requestContext?.options;
    if (options?.theme !== THEME_ID) return content;
    const settings = parsePluginSettings(options[PLUGIN_OPTION_KEY]);
    const videoEnabled = isEnabled(settings.videoPlayerEnabled ?? settings.mobileNativePlayerEnhancementEnabled, false);
    const withVideo = videoEnabled ? protectVideoIframesForMarkdown(content) : content;
    const htmlMode = getHtmlEnhancementMode(settings);
    if (htmlMode === 'light') return protectInlineHtmlLight(withVideo);
    if (htmlMode === 'full') return protectInlineHtml(withVideo);
    return withVideo;
  }, 1);

  // Markdown Alert icons remain a separate legacy CY-theme behavior.
  // HTML fragment restoration runs only when its own enhancement is enabled.
  addHook('content:content', pluginId, (content: string, requestContext?: {
    options?: Record<string, unknown>;
  }) => {
    const options = requestContext?.options;
    if (options?.theme !== THEME_ID) return content;
    const settings = parsePluginSettings(options[PLUGIN_OPTION_KEY]);
    const withAlertIcons = restoreMarkdownAlertIcons(content);
    const htmlMode = getHtmlEnhancementMode(settings);
    const withHtml = htmlMode === 'light'
      ? restoreInlineHtmlFragmentsLight(withAlertIcons)
      : htmlMode === 'full'
        ? restoreInlineHtmlFragments(withAlertIcons)
        : withAlertIcons;
    const videoEnabled = isEnabled(settings.videoPlayerEnabled ?? settings.mobileNativePlayerEnhancementEnabled, false);
    if (!videoEnabled) return withHtml;
    return replaceVideoIframesWithPlaceholders(restoreVideoIframesAfterMarkdown(withHtml));
  }, 1);

  // Frontend output is scoped to Warm CY and each feature's own toggle.
  addHook('archive:footer', pluginId, (html: string, extra?: {
    options?: Record<string, unknown>;
  }) => {
    const options = extra?.options;
    if (!options || options.theme !== THEME_ID) return html;
    const settings = parsePluginSettings(options[PLUGIN_OPTION_KEY]);
    const htmlMode = getHtmlEnhancementMode(settings);
    const htmlRuntime = htmlMode === 'light'
      ? inlineHtmlRuntimeLight(true)
      : htmlMode === 'full'
        ? inlineHtmlRuntime()
        : '';
    const alertIconStyle = markdownAlertIconStyles(settings.markdownAlertStyleSettings);
    const videoPlayer = videoPlayerRuntime(
      isEnabled(settings.videoPlayerEnabled ?? settings.mobileNativePlayerEnhancementEnabled, false),
    );
    if (!isEnabled(settings.showHomeSearchButton)) {
      return html + alertIconStyle + htmlRuntime + videoPlayer;
    }
    const searchBase = JSON.stringify(
      String(computeUrls(options as any).siteUrl || '/').replace(/\/?$/, '/'),
    ).replace(/</g, '\\u003c');
    return `${html}${alertIconStyle}${htmlRuntime}${videoPlayer}<script data-warm-cy-global-search>
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
        htmlEnhancementMode?: unknown;
        markdownAlertStyleSettings?: unknown;
        videoPlayerEnabled?: unknown;
        mobileNativePlayerEnhancementEnabled?: unknown;
      };
      const videoPlayerValue = typeof values.videoPlayerEnabled === 'boolean'
        ? values.videoPlayerEnabled
        : values.mobileNativePlayerEnhancementEnabled;
      const htmlMode = typeof values.htmlEnhancementMode === 'string'
        ? values.htmlEnhancementMode
        : typeof values.htmlEnhancementEnabled === 'boolean'
          ? (values.htmlEnhancementEnabled ? 'light' : 'off')
          : null;
      if (typeof values.showCommentManagementButtons !== 'boolean'
        || typeof values.showHomeSearchButton !== 'boolean'
        || (htmlMode !== 'off' && htmlMode !== 'light' && htmlMode !== 'full')
        || typeof videoPlayerValue !== 'boolean') {
        return { handled: true, response: json({ error: 'Invalid settings' }, 400) };
      }
      const current = parsePluginSettings(auth.options[PLUGIN_OPTION_KEY]);
      const next = {
        ...current,
        showCommentManagementButtons: values.showCommentManagementButtons ? '1' : '0',
        showHomeSearchButton: values.showHomeSearchButton ? '1' : '0',
        htmlEnhancementMode: htmlMode,
        videoPlayerEnabled: videoPlayerValue ? '1' : '0',
      };
      if (values.markdownAlertStyleSettings !== undefined) {
        next.markdownAlertStyleSettings = normalizeMarkdownAlertStyleSettings(values.markdownAlertStyleSettings);
      }
      delete next.htmlEnhancementEnabled;
      delete next.mobileNativePlayerEnhancementEnabled;
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

    // Skip all comment-management work when this feature is switched off.
    const requestSettings = parsePluginSettings(options[PLUGIN_OPTION_KEY]);
    if (!isEnabled(requestSettings.showCommentManagementButtons)) return payload;

    const auth = await requireAdminAction(request, 'administrator', { csrf: false });
    if (isAdminActionResponse(auth) || !auth.user.authCode) return payload;
    const featureSettings = parsePluginSettings(auth.options[PLUGIN_OPTION_KEY]);
    if (!isEnabled(featureSettings.showCommentManagementButtons)) return payload;

    const content = await auth.db.query.contents.findFirst({
      columns: { type: true },
      where: eq(schema.contents.cid, cid),
    });
    if (!content || (content.type !== 'post' && content.type !== 'page')) return payload;

    const settings = parseSettings(auth.options[OPTION_KEY]);
    const csrfToken = await generateSecurityToken(auth.options.secret, auth.user.authCode, auth.uid);
    return {
      ...payload,
      management: {
        canManage: true,
        showManagementButtons: true,
        adminUrl: computeUrls(auth.options).adminUrl,
        contentType: content.type,
        isPinned: content.type === 'post' && parsePinnedIds(settings.pinnedIds).includes(cid),
        csrfToken,
      },
    };
  }, 20);
}
