import { eq } from 'drizzle-orm';
import { schema } from 'typecho/db';
import { registerPluginAdminPath, setOption } from 'typecho/plugin-sdk';
import type { PluginInitContext, PluginRouteResult } from 'typecho/plugin-sdk';
import { generateSecurityToken } from '@/lib/auth';
import { isAdminActionResponse, requireAdminAction } from '@/lib/admin-auth';
import { computeUrls } from '@/lib/options';
import adminCss from './admin.css?raw';
import { inlineHtmlRuntimeLight, protectInlineHtmlLight, restoreInlineHtmlFragmentsLight } from './html-light';
import { inlineHtmlRuntime, protectInlineHtml, restoreInlineHtmlFragments } from './html-full';
import { protectVideoIframesForMarkdown, restoreVideoIframesAfterMarkdown, replaceVideoIframesWithPlaceholders, videoPlayerRuntime } from './video-player';
import { markdownAlertIconStyles, markdownAlertStyleEditorHtml, normalizeMarkdownAlertStyleSettings, restoreMarkdownAlertIcons } from './markdown-alerts';

const THEME_ID = 'typecho-theme-warm-cy';
const OPTION_KEY = `theme:${THEME_ID}`;
const ADMIN_PATH = '/api/admin/theme-pin';
const ADMIN_SETTINGS_API_PATH = '/api/admin/cy-companion-settings';
const ADMIN_PAGE_SLUG = 'cy-companion';
const PLUGIN_OPTION_KEY = 'plugin:typecho-plugin-warm-cy';
const PLUGIN_VERSION = '2026.11.05.10.20';

let activeCyPluginSettings: { theme: unknown; pluginSettings: unknown } | null = null;

function resolveCyPluginSettings(requestContext?: {
  options?: Record<string, unknown>;
}): { theme: unknown; pluginSettings: unknown } | null {
  const options = requestContext?.options;
  if (options) {
    return { theme: options.theme, pluginSettings: options[PLUGIN_OPTION_KEY] };
  }
  return activeCyPluginSettings;
}

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

  // The upstream content filters intentionally receive only their value.
  // Capture site-wide options through the normal request lifecycle hook instead
  // of extending or modifying the core filter signature.
  addHook('system:begin', pluginId, (context?: {
    options?: Record<string, unknown>;
  }) => {
    const options = context?.options;
    activeCyPluginSettings = options
      ? { theme: options.theme, pluginSettings: options[PLUGIN_OPTION_KEY] }
      : null;
  });

  // Optional second arguments keep these handlers easy to unit-test and
  // compatible with third-party callers; upstream core uses the captured
  // system:begin snapshot because it passes only the content value.
  addHook('content:markdown', pluginId, (content: string, requestContext?: {
    options?: Record<string, unknown>;
  }) => {
    const requestOptions = resolveCyPluginSettings(requestContext);
    if (requestOptions?.theme !== THEME_ID) return content;
    const settings = parsePluginSettings(requestOptions.pluginSettings);
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
    const requestOptions = resolveCyPluginSettings(requestContext);
    if (requestOptions?.theme !== THEME_ID) return content;
    const settings = parsePluginSettings(requestOptions.pluginSettings);
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
