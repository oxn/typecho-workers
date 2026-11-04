import { eq } from 'drizzle-orm';
import { schema } from 'typecho/db';
import { registerPluginAdminPath, setOption } from 'typecho/plugin-sdk';
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
const PLUGIN_VERSION = '2026.11.04.18.33';

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

function protectInlineHtml(source: string): string {
  const protectedSegments: string[] = [];
  const protect = (value: string): string => {
    const marker = 'CYCYCODESEGMENT' + protectedSegments.length + 'TOKEN';
    protectedSegments.push(value);
    return marker;
  };

  let content = source.replace(/<(pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, protect);
  let fenceChar = '';
  let fenceLength = 0;
  content = content.split('\n').map(line => {
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

  content = content.replace(
    /<(style|script|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    block => 'CYCYINLINEBLOCKX' + encodeInlinePayload(block) + 'XEND',
  );

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

const INLINE_HTML_RUNTIME = "(() => {\n  const enabled = __CY_ENABLED__;\n  const markerPattern = /CYCYINLINEBLOCKX([0-9a-f]+)XEND|CYCYINLINEATTRX([a-z][\\w:-]*)X([0-9a-f]+)XEND/g;\n  const svgTags = new Set(['svg','g','path','circle','rect','line','polyline','polygon','ellipse','defs','lineargradient','radialgradient','stop','clippath','mask','title','desc','use','symbol']);\n  const svgAttrs = new Set(['id','class','viewbox','width','height','fill','fill-rule','clip-rule','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','opacity','fill-opacity','stroke-opacity','cx','cy','r','rx','ry','x','y','x1','x2','y1','y2','d','points','transform','preserveaspectratio','offset','stop-color','stop-opacity','gradientunits','gradienttransform','clippathunits','maskunits','maskcontentunits','clip-path','mask','filter','href','xlink:href','role','focusable','aria-hidden','aria-label']);\n  const decode = hex => { const bytes = new Uint8Array(hex.length / 2); for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); return new TextDecoder().decode(bytes); };\n  const safeSvgNode = node => {\n    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue || '');\n    if (node.nodeType !== Node.ELEMENT_NODE || !svgTags.has(node.localName.toLowerCase())) return null;\n    const clean = document.createElementNS('http://www.w3.org/2000/svg', node.localName);\n    for (const attr of Array.from(node.attributes)) {\n      const key = attr.name.toLowerCase(), value = attr.value;\n      if (!svgAttrs.has(key) && key !== 'style' && !key.startsWith('aria-')) continue;\n      if (key === 'style') {\n        const allowedStyle = new Set(['fill','stroke','fill-rule','clip-rule','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','opacity','fill-opacity','stroke-opacity','stop-color','stop-opacity']);\n        const safeStyle = value.split(';').map(part => part.trim()).filter(Boolean).map(part => {\n          const split = part.indexOf(':');\n          if (split < 1) return '';\n          const property = part.slice(0, split).trim().toLowerCase();\n          const cssValue = part.slice(split + 1).trim();\n          if (!allowedStyle.has(property) || /expression|javascript:|data:|@import|[\\u0000-\\u001f]/i.test(cssValue)) return '';\n          if (/\\burl\\s*\\(/i.test(cssValue) && !/^url\\(\\s*#[\\w:.-]+\\s*\\)$/i.test(cssValue)) return '';\n          return property + ':' + cssValue;\n        }).filter(Boolean).join(';');\n        if (safeStyle) clean.setAttribute('style', safeStyle);\n        continue;\n      }\n      if ((key === 'href' || key === 'xlink:href') && !/^#[\\w:.-]+$/.test(value)) continue;\n      if (/\\burl\\s*\\(/i.test(value) && !/^\\s*url\\(\\s*#[\\w:.-]+\\s*\\)\\s*$/i.test(value)) continue;\n      if (/javascript:|data:text\\/html|[\\u0000-\\u001f]/i.test(value)) continue;\n      if (key === 'xlink:href') clean.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', value); else clean.setAttribute(attr.name, value);\n    }\n    for (const child of Array.from(node.childNodes)) { const safe = safeSvgNode(child); if (safe) clean.appendChild(safe); }\n    return clean;\n  };\n  const addBlock = raw => {\n    const match = raw.match(/^<(style|script|svg)\\b([^>]*)>([\\s\\S]*)<\\/\\1\\s*>$/i);\n    if (!match) return null;\n    const tag = match[1].toLowerCase(), attrs = match[2] || '', body = match[3] || '';\n    if (tag === 'svg') {\n      try { const parsed = new DOMParser().parseFromString(raw, 'image/svg+xml'); if (parsed.querySelector('parsererror') || parsed.documentElement.localName.toLowerCase() !== 'svg') return null; return safeSvgNode(parsed.documentElement); } catch { return null; }\n    }\n    if (tag === 'style') { const style = document.createElement('style'); const media = attrs.match(/\\bmedia\\s*=\\s*(?:\\\"([^\\\"]*)\\\"|'([^']*)')/i); if (media) style.media = media[1] || media[2] || ''; style.textContent = body; document.head.appendChild(style); return null; }\n    const script = document.createElement('script');\n    const type = attrs.match(/\\btype\\s*=\\s*(?:\\\"([^\\\"]*)\\\"|'([^']*)')/i);\n    const scriptType = (type && (type[1] || type[2]) || '').toLowerCase();\n    if (scriptType && !['module','text/javascript','application/javascript'].includes(scriptType)) return null;\n    if (scriptType) script.type = scriptType;\n    script.textContent = body; document.body.appendChild(script); return null;\n  };\n  const hydrate = () => {\n    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode(node) { const p = node.parentElement; if (!p || p.closest('pre,code,textarea,script,style')) return NodeFilter.FILTER_REJECT; markerPattern.lastIndex = 0; return markerPattern.test(node.nodeValue || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; } });\n    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);\n    for (const node of nodes) {\n      const value = node.nodeValue || ''; markerPattern.lastIndex = 0; let last = 0, match, changed = false; const fragment = document.createDocumentFragment();\n      while ((match = markerPattern.exec(value))) {\n        changed = true; if (match.index > last) fragment.appendChild(document.createTextNode(value.slice(last, match.index)));\n        if (enabled && match[1]) { const element = addBlock(decode(match[1])); if (element) fragment.appendChild(element); }\n        else if (enabled && match[2] && match[3]) {\n          const parent = node.parentElement, previous = node.previousElementSibling;\n          const target = parent && parent.tagName.toLowerCase() === match[2] ? parent : previous && previous.tagName.toLowerCase() === match[2] ? previous : parent;\n          if (target) {\n            try {\n              const attrs = JSON.parse(decode(match[3]));\n              for (const [name, value] of Object.entries(attrs)) {\n                if (name === 'style') target.style.cssText = String(value);\n                else if (name === 'class' || name === 'id' || name === 'title' || name === 'role'\n                  || name === 'width' || name === 'height' || name === 'alt' || name === 'loading'\n                  || name === 'type' || name === 'name' || name === 'value' || name === 'placeholder'\n                  || name.startsWith('data-') || name.startsWith('aria-')) {\n                  target.setAttribute(name, String(value));\n                }\n              }\n            } catch {}\n          }\n        }\n        last = match.index + match[0].length;\n      }\n      if (changed) { if (last < value.length) fragment.appendChild(document.createTextNode(value.slice(last))); node.parentNode && node.parentNode.replaceChild(fragment, node); }\n    }\n  };\n  hydrate(); window.addEventListener('instantclick:newpage', hydrate);\n})();";
function inlineHtmlRuntime(enabled: boolean): string {
  return '<script data-cy-inline-html-enhancement>'
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

  // Protect inline content blocks before the core sanitizer removes them.
  addHook('content:markdown', pluginId, (content: string) => protectInlineHtml(content), 1);

  // Rehydrate only after Markdown sanitization; the feature is opt-in.
  addHook('archive:footer', pluginId, (html: string, extra?: {
    options?: Record<string, unknown>;
  }) => {
    const options = extra?.options;
    if (!options) return html;
    const settings = parsePluginSettings(options[PLUGIN_OPTION_KEY]);
    const htmlRuntime = inlineHtmlRuntime(isEnabled(settings.htmlEnhancementEnabled, false));
    if (options.theme !== THEME_ID || !isEnabled(settings.showHomeSearchButton)) {
      return html + htmlRuntime;
    }
    const searchBase = JSON.stringify(
      String(computeUrls(options as any).siteUrl || '/').replace(/\/?$/, '/'),
    ).replace(/</g, '\\u003c');
    return `${html}${htmlRuntime}<script data-warm-cy-global-search>
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
