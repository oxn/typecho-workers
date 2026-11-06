/**
 * Warm CY Markdown Alert presentation settings and frontend rendering.
 * This module does not change upstream Markdown parsing or alert recognition.
 */

function escapeAlertHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] || character);
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
  enabled: boolean;
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
    enabled: typeof source.enabled === 'boolean' ? source.enabled : true,
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
      + '" data-cy-alert-style-field="' + type + '.' + key + '" data-cy-default-value="' + escapeAlertHtml(MARKDOWN_ALERT_STYLE_DEFAULTS[type][key]) + '" value="' + escapeAlertHtml(style[key]) + '"'
      + (inputType === 'number' ? ' min="0" max="32" step="1"' : '') + '></label>',
    ).join('');
    const borderOptions = ['solid', 'dashed', 'dotted', 'double', 'none'].map(option =>
      '<option value="' + option + '"' + (style.borderStyle === option ? ' selected' : '') + '>' + option + '</option>',
    ).join('');
    return '<fieldset class="cy-note-style-card"><legend>' + type + '</legend><div class="cy-note-style-grid">'
      + fields + '<label class="cy-note-style-field"><span>边框样式</span><select data-cy-alert-style-field="'
      + type + '.borderStyle" data-cy-default-value="solid">' + borderOptions + '</select></label></div></fieldset>';
  }).join('');
  return '<section class="cy-feature-card cy-note-style-settings"><strong>五种 Note 与图标样式</strong>'
    + '<p>总开关关闭时恢复主题原生 Note 样式；开启后可分别调整五种提示框及 SVG 图标。恢复默认会回到 CY 插件内置的预设样式（与主题无关），包括五种 Note 的全部颜色、边框、圆角，以及 SVG 图标显示、尺寸和间距。</p>'
    + '<label class="cy-feature-toggle"><input type="checkbox" data-cy-alert-style-enabled' + (settings.enabled ? ' checked' : '') + '>启用五种 Note 与图标个性化样式</label>'
    + '<div class="cy-note-style-grid">' + cards + '</div>'
    + '<div class="cy-note-icon-options"><label><input type="checkbox" data-cy-alert-icon-visible data-cy-default-checked="true"'
    + (settings.icon.visible ? ' checked' : '') + '>显示 SVG 图标</label>'
    + '<label>图标大小（px）<input type="number" min="12" max="32" step="1" data-cy-alert-icon-size data-cy-default-value="18" value="'
    + settings.icon.size + '"></label>'
    + '<label>图标与标题间距（px）<input type="number" min="0" max="20" step="1" data-cy-alert-icon-gap data-cy-default-value="8" value="'
    + settings.icon.gap + '"></label>'
    + '<button type="button" class="btn" data-cy-alert-reset>恢复默认样式</button></div></section>';
}

const MARKDOWN_ALERT_ICONS: Record<string, string> = {
  // Reuse the exact five SVG path shapes from the pre-upstream-reset CY Markdown Alerts implementation.
  NOTE: '<svg class="markdown-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
  TIP: '<svg class="markdown-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z"/></svg>',
  IMPORTANT: '<svg class="markdown-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
  WARNING: '<svg class="markdown-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
  CAUTION: '<svg class="markdown-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
};;

export function restoreMarkdownAlertIcons(content: string, value?: unknown): string {
  const settings = normalizeMarkdownAlertStyleSettings(value);
  if (!settings.enabled || !settings.icon.visible) return content;
  // Most articles contain no GitHub-style alert block. Avoid running the
  // full blockquote replacement expression when its required markers are absent.
  if (!content.includes('<blockquote') || !content.includes('data-alert')) return content;
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

export function markdownAlertIconStyles(value?: unknown): string {
  const settings = normalizeMarkdownAlertStyleSettings(value);
  if (!settings.enabled) return '';
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

export { normalizeMarkdownAlertStyleSettings, markdownAlertStyleEditorHtml };
