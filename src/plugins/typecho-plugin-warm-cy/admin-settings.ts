import {
  markdownAlertStyleEditorHtml,
  normalizeMarkdownAlertStyleSettings,
} from './markdown-alerts';

/** Independent admin UI for Warm CY companion feature toggles. */
function escapeAdminHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] || character);
}

function parseAdminSettings(value: unknown): Record<string, unknown> {
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
  return isEnabled(settings.htmlEnhancementEnabled, false) ? 'light' : 'off';
}

export function featureSettingsPageHtml(csrfToken: string, rawSettings: unknown, pluginVersion: string): string {
  const settings = parseAdminSettings(rawSettings);
  const commentsEnabled = isEnabled(settings.showCommentManagementButtons);
  const searchEnabled = isEnabled(settings.showHomeSearchButton);
  const htmlEnhancementMode = getHtmlEnhancementMode(settings);
  const htmlScriptExecutionEnabled = isEnabled(settings.htmlScriptExecutionEnabled, false);
  const markdownAlertStyleSettings = normalizeMarkdownAlertStyleSettings(settings.markdownAlertStyleSettings);
  const videoPlayerEnabled = isEnabled(settings.videoPlayerEnabled ?? settings.mobileNativePlayerEnhancementEnabled, false);
  return `
    <div class="col-mb-12 col-tb-8 col-tb-offset-2 cy-feature-settings"
      data-cy-feature-settings data-csrf-token="${escapeAdminHtml(csrfToken)}">
      <div class="cy-feature-links">
        <a href="/admin/options-theme">返回主题设置</a>
      </div>
      <p class="cy-feature-version">CY 插件版本：${pluginVersion}</p>
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
        <strong>正文 HTML / CSS / SVG 增强</strong>
        <p>关闭：完全按主题原始方式处理。轻量开启：沿用稳定处理规则。全部开启：使用完整 HTML / CSS / SVG 解析与恢复规则。JavaScript 执行由下方独立开关控制。</p>
        <div class="cy-html-mode-options">
          <label><input type="radio" name="htmlEnhancementMode" data-cy-setting="htmlEnhancementMode" value="off" ${htmlEnhancementMode === 'off' ? 'checked' : ''}>不开启</label>
          <label><input type="radio" name="htmlEnhancementMode" data-cy-setting="htmlEnhancementMode" value="light" ${htmlEnhancementMode === 'light' ? 'checked' : ''}>轻量开启（稳定版）</label>
          <label><input type="radio" name="htmlEnhancementMode" data-cy-setting="htmlEnhancementMode" value="full" ${htmlEnhancementMode === 'full' ? 'checked' : ''}>全部开启（完整版）</label>
        </div>
        <label class="cy-feature-toggle"><input type="checkbox" data-cy-setting="htmlScriptExecutionEnabled" ${htmlScriptExecutionEnabled ? 'checked' : ''}><span>允许正文 JavaScript 执行</span></label>
        <p>默认关闭。开启后，轻量版支持的内联脚本，以及全量版允许的内联和 HTTP/HTTPS 外部脚本，才会在访客浏览器执行。仅适用于所有文章作者均可信的站点；关闭此项不影响 HTML / CSS / SVG 解析能力。</p>
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
        var noteStyleEnabled = root.querySelector('[data-cy-alert-style-enabled]');
        var noteStyleReset = root.querySelector('[data-cy-alert-reset]');
        var noteStyleFields = root.querySelectorAll('[data-cy-alert-style-field], [data-cy-alert-icon-visible], [data-cy-alert-icon-size], [data-cy-alert-icon-gap]');
        function syncNoteStyleControls() {
          noteStyleFields.forEach(function (field) { field.disabled = !noteStyleEnabled.checked; });
        }
        noteStyleEnabled.addEventListener('change', syncNoteStyleControls);
        syncNoteStyleControls();
        noteStyleReset.addEventListener('click', function () {
          root.querySelectorAll('[data-cy-alert-style-field]').forEach(function (field) {
            field.value = field.dataset.cyDefaultValue || '';
          });
          var visible = root.querySelector('[data-cy-alert-icon-visible]');
          var size = root.querySelector('[data-cy-alert-icon-size]');
          var gap = root.querySelector('[data-cy-alert-icon-gap]');
          visible.checked = visible.dataset.cyDefaultChecked === 'true';
          size.value = size.dataset.cyDefaultValue || '18';
          gap.value = gap.dataset.cyDefaultValue || '8';
          noteStyleEnabled.checked = true;
          syncNoteStyleControls();
          status.textContent = '已恢复默认样式，请点击保存设置生效';
        });
        save.addEventListener('click', async function () {
          var comments = root.querySelector('[data-cy-setting="showCommentManagementButtons"]');
          var search = root.querySelector('[data-cy-setting="showHomeSearchButton"]');
          var htmlMode = root.querySelector('[data-cy-setting="htmlEnhancementMode"]:checked');
          var noteStyleSettings = { enabled: !!root.querySelector('[data-cy-alert-style-enabled]')?.checked, types: {}, icon: {
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
          var htmlScriptExecution = root.querySelector('[data-cy-setting="htmlScriptExecutionEnabled"]');
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
                htmlScriptExecutionEnabled: !!htmlScriptExecution.checked,
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
