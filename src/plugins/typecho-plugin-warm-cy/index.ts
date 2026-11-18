import { eq } from 'drizzle-orm';
import { getDb, schema } from 'typecho/db';
import { registerPluginAdminPath, setOption } from 'typecho/plugin-sdk';
import type { PluginInitContext, PluginRouteResult } from 'typecho/plugin-sdk';
import { generateSecurityToken } from '@/lib/auth';
import { isAdminActionResponse, requireAdminAction } from '@/lib/admin-auth';
import { computeUrls } from '@/lib/options';

const THEME_ID = 'typecho-theme-warm-cy';
const ADMIN_PATH = '/api/admin/theme-pin';
const ADMIN_SETTINGS_API_PATH = '/api/admin/cy-companion-settings';
const ADMIN_PAGE_SLUG = 'cy-companion';
const PLUGIN_OPTION_KEY = 'plugin:typecho-plugin-warm-cy';
const OPTION_KEY = `theme:${THEME_ID}`;
const PLUGIN_VERSION = '2026.11.10.21.03';
const THEME_VERSION = '2026.11.10.21.03';

/** Plugin-owned admin styles, embedded to follow the plugin activation lifecycle. */
const adminCss = String.raw`/* Warm CY Companion settings page only. Loaded through admin:header for this plugin's settings page. */
.typecho-option {
  margin: 0 0 14px !important;
  padding: 16px 18px !important;
  border: 1px solid #e5e7eb !important;
  border-radius: 10px !important;
  background: #fff !important;
  box-shadow: 0 2px 8px rgba(15, 23, 42, .035) !important;
}
.typecho-option > li { padding: 0 !important; }
.typecho-label {
  display: block;
  margin: 0 0 8px !important;
  color: #263238;
  font-weight: 600;
}
.typecho-option input[type="checkbox"] { accent-color: #269b63; }
.typecho-option input:focus,
.typecho-option textarea:focus,
.typecho-option select:focus {
  border-color: #269b63 !important;
  outline: 1px solid rgba(38, 155, 99, .16);
  box-shadow: 0 0 0 2px rgba(38, 155, 99, .08) !important;
}
.typecho-option p.description,
.typecho-option .description {
  margin: 7px 0 0;
  color: #7b858b;
  line-height: 1.65;
  font-size: 13px;
}

.cy-feature-settings {
  padding-top: 4px;
}
.cy-feature-link-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) auto;
  align-items: end;
  gap: 12px;
  margin: 12px 0;
  padding: 12px 0;
  border-bottom: 1px solid #e8ece9;
}
.cy-feature-link-row > label:not(.cy-feature-toggle) {
  display: grid;
  gap: 6px;
  color: #46534b;
  font-size: 13px;
}
.cy-feature-link-row input[type="text"] {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 34px;
  padding: 6px 9px;
  border: 1px solid #dce4df;
  border-radius: 6px;
}
.cy-feature-link-row .cy-feature-toggle { padding-bottom: 8px; white-space: nowrap; }
@media (max-width: 767px) {
  .cy-feature-link-row { grid-template-columns: 1fr; gap: 8px; }
  .cy-feature-link-row .cy-feature-toggle { padding-bottom: 0; }
}

.cy-feature-card .cy-feature-warning {
  color: #c62828;
  font-weight: 700;
}
.cy-feature-card {
  margin: 0 0 16px;
  padding: 20px 22px;
  border: 1px solid #e5e9e7;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 2px 9px rgba(20, 40, 30, .035);
}
.cy-feature-card h2 {
  margin: 0 0 8px;
  color: #26352d;
  font-size: 16px;
  font-weight: 650;
}
.cy-feature-card p {
  margin: 0 0 14px;
  color: #77817b;
  font-size: 13px;
  line-height: 1.7;
}
.cy-feature-toggle {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: #34433a;
  font-size: 14px;
  cursor: pointer;
}
.cy-feature-toggle input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: #269b63;
}
.cy-feature-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 2px 2px 12px;
}
.cy-feature-actions .btn {
  border-color: #269b63;
  background: #269b63;
  color: #fff;
}
.cy-feature-actions .btn:hover:not(:disabled) {
  border-color: #1e8654;
  background: #1e8654;
}
.cy-feature-actions .btn:disabled {
  opacity: .65;
  cursor: wait;
}
.cy-feature-actions [data-cy-save-status] {
  color: #269b63;
  font-size: 13px;
}
@media (max-width: 767px) {
  .cy-feature-card { padding: 16px; }
  .cy-feature-actions { align-items: flex-start; flex-direction: column; gap: 8px; }
}


/* Theme settings form: reuse the companion plugin's card design. */
.warm-theme-config-form .typecho-option {
  margin: 0 0 14px !important;
  padding: 16px 18px !important;
  border: 1px solid #e5e9e7 !important;
  border-radius: 10px !important;
  background: #fff !important;
  box-shadow: 0 2px 9px rgba(20, 40, 30, .035) !important;
}
.warm-theme-config-form .typecho-option > li { padding: 0 !important; }
.warm-theme-config-form .typecho-option .typecho-label {
  display: block;
  margin: 0 0 8px !important;
  color: #26352d;
  font-weight: 600;
}
.warm-theme-config-form .typecho-option input.text,
.warm-theme-config-form .typecho-option textarea,
.warm-theme-config-form .typecho-option select {
  max-width: 100%;
  border: 1px solid #dce4df;
  border-radius: 6px;
}
.warm-theme-config-form .typecho-option input.text,
.warm-theme-config-form .typecho-option select {
  min-height: 34px;
  padding: 6px 9px;
}
.warm-theme-config-form .typecho-option textarea {
  min-height: 84px;
  padding: 8px 10px;
}
.warm-theme-config-form .typecho-option input:focus,
.warm-theme-config-form .typecho-option textarea:focus,
.warm-theme-config-form .typecho-option select:focus {
  border-color: #269b63 !important;
  outline: 1px solid rgba(38, 155, 99, .16);
  box-shadow: 0 0 0 2px rgba(38, 155, 99, .08) !important;
}
.warm-theme-config-form .typecho-option .description {
  margin: 7px 0 0;
  color: #77817b;
  font-size: 13px;
  line-height: 1.65;
}
.warm-theme-config-form .typecho-option span { margin-right: 12px; }
.warm-theme-config-form .typecho-option-submit {
  margin-top: 8px !important;
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}
.warm-theme-config-form .typecho-option-submit > li { padding: 0 !important; }
.warm-theme-config-form .typecho-option-submit .btn {
  border-color: #269b63;
  border-radius: 6px;
  background: #269b63;
  color: #fff;
}
.warm-theme-config-form .typecho-option-submit .btn:hover {
  border-color: #1e8654;
  background: #1e8654;
}
.cy-feature-links {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin: 0 0 14px;
}
.cy-feature-links a,
.warm-cy-settings-switch {
  display: inline-flex;
  align-items: center;
  padding: 7px 12px;
  border: 1px solid #dce4df;
  border-radius: 7px;
  background: #fff;
  color: #269b63 !important;
  text-decoration: none;
  font-size: 13px;
}
.cy-feature-links a:hover,
.warm-cy-settings-switch:hover {
  border-color: #269b63;
  background: #f5fbf7;
}
.warm-cy-settings-switch { margin-left: 12px; }
@media (max-width: 767px) {
  .warm-theme-config-form .typecho-option { padding: 14px !important; }
  .warm-cy-settings-switch { margin: 8px 0 0; }
}


/* Compact, original-style Warm CY theme settings layout. */
.warm-theme-config-form .typecho-option {
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}
.warm-theme-settings-card {
  margin: 0 0 16px;
  padding: 16px 18px;
  border: 1px solid #e5e9e7;
  border-radius: 9px;
  background: #fff;
  box-shadow: 0 2px 9px rgba(20, 40, 30, .035);
}
.warm-theme-settings-card .typecho-option + .typecho-option {
  margin-top: 16px !important;
}
.warm-theme-settings-card .warm-theme-field-head {
  margin-bottom: 9px;
}
.warm-theme-config-form .typecho-option > li { padding: 0 !important; }
.warm-theme-config-form .warm-theme-field-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 12px;
  row-gap: 3px;
  margin: 0 0 9px;
}
.warm-theme-config-form .warm-theme-field-head > .typecho-label {
  display: inline;
  margin: 0 !important;
  color: #26352d;
  font-size: 14px;
  font-weight: 650;
  line-height: 1.6;
}
.warm-theme-config-form .warm-theme-field-head > .description {
  display: inline;
  margin: 0 !important;
  color: #77817b;
  font-size: 12px;
  line-height: 1.6;
}
.warm-theme-config-form .warm-theme-field-control {
  width: 100%;
}
.warm-theme-config-form .warm-theme-field-control > input.text,
.warm-theme-config-form .warm-theme-field-control > select,
.warm-theme-config-form .warm-theme-field-control > textarea {
  display: block;
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
}
.warm-theme-config-form .warm-theme-field-control > textarea {
  min-height: 110px;
}
.warm-theme-links-group {
  margin: 0 0 22px;
  padding: 16px 18px 8px;
  border: 1px solid #e5e9e7;
  border-radius: 9px;
  background: #fff;
}
.warm-theme-links-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 14px;
  margin: 0 0 12px;
  padding: 0 0 11px;
  border-bottom: 1px solid #dfe6e1;
  text-align: left;
}
.warm-theme-links-heading strong {
  color: #26352d;
  font-size: 15px;
  font-weight: 650;
}
.warm-theme-links-heading span {
  color: #77817b;
  font-size: 12px;
  line-height: 1.6;
}
.warm-theme-link-row {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 12px 0 14px;
  border-bottom: 1px solid #e8ece9;
}
.warm-theme-link-row:last-child {
  border-bottom: 0;
}
.warm-theme-link-text-line,
.warm-theme-link-url-line {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.warm-theme-link-text-line > label:first-child,
.warm-theme-link-url-line > label {
  flex: 0 0 62px;
  color: #46534b;
  font-size: 13px;
  text-align: left;
}
.warm-theme-config-form .warm-theme-link-input {
  box-sizing: border-box;
  flex: 1 1 auto;
  width: 1%;
  min-width: 0;
  min-height: 34px;
  padding: 6px 9px;
  border: 1px solid #dce4df;
  border-radius: 6px;
  background: #fff;
}
.warm-theme-link-new-window {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  color: #56635b;
  font-size: 12px;
  white-space: nowrap;
}
.warm-theme-link-new-window input { accent-color: #269b63; }
.warm-theme-config-form .typecho-option-submit {
  margin-top: 8px !important;
  padding: 0 !important;
  border: 0 !important;
}
@media (max-width: 640px) {
  .warm-theme-settings-card { padding: 14px; }
  .warm-theme-links-heading { align-items: flex-start; flex-direction: column; gap: 3px; }
  .warm-theme-link-text-line { flex-wrap: wrap; }
  .warm-theme-link-text-line > label:first-child,
  .warm-theme-link-url-line > label { flex-basis: 54px; }
  .warm-theme-link-new-window { margin-left: 63px; }
}

.warm-search-trigger--floating {
  position: fixed;
  z-index: 30;
  right: 18px;
  bottom: 18px;
  border: 1px solid rgba(220, 228, 223, .9);
  background: rgba(255, 255, 255, .94);
  box-shadow: 0 4px 18px rgba(20, 40, 30, .12);
}



.cy-feature-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin: 0 0 18px;
}
.cy-feature-header > strong {
  color: #26352d;
  font-size: 16px;
  font-weight: 700;
}
.cy-feature-header .cy-feature-version {
  color: #77817b;
  font-size: 13px;
  font-weight: 400;
}
.cy-feature-header > a {
  display: inline-flex;
  align-items: center;
  padding: 7px 12px;
  border: 1px solid #dce4df;
  border-radius: 7px;
  background: #fff;
  color: #269b63 !important;
  text-decoration: none;
  font-size: 13px;
}
.cy-feature-header > a:hover { border-color: #269b63; background: #f5fbf7; }
.warm-cy-theme-version {
  display: inline-block;
  margin-left: 12px;
  color: #77817b;
  font-size: 12px;
  font-weight: 400;
  vertical-align: middle;
}


/* Four migrated Warm CY settings use the original compact card treatment. */

.cy-feature-intro {
  margin: 0 0 14px;
  color: #77817b;
  font-size: 13px;
  line-height: 1.7;
}
.cy-feature-card h2 {
  display: block;
  margin: 0 0 8px;
  color: #26352d;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.6;
}
.cy-feature-card .cy-feature-field {
  display: block;
  margin: 0;
}
.cy-feature-card .cy-feature-field input[type="text"],
.cy-feature-card .cy-feature-field textarea {
  box-sizing: border-box;
  display: block;
  width: 100%;
  max-width: 100%;
  min-height: 36px;
  padding: 8px 10px;
  border: 1px solid #dce4df;
  border-radius: 6px;
  background: #fff;
  color: #34433a;
  font: inherit;
  line-height: 1.6;
}
.cy-feature-card .cy-feature-field textarea {
  min-height: 150px;
  resize: vertical;
}
.cy-feature-card .cy-feature-field input:focus,
.cy-feature-card .cy-feature-field textarea:focus {
  border-color: #269b63;
  outline: 1px solid rgba(38, 155, 99, .16);
  box-shadow: 0 0 0 2px rgba(38, 155, 99, .08);
}
.cy-feature-card .cy-feature-link-row:first-of-type {
  margin-top: 4px;
}


/* The four migrated fields retain Typecho's native, un-carded option layout. */
.cy-feature-migrated-settings .typecho-option {
  margin: 0 0 16px !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}
.cy-feature-migrated-settings .typecho-option > li { padding: 0 !important; }
.cy-feature-migrated-settings .typecho-option .typecho-label { display: block; }
.cy-feature-migrated-settings .typecho-option input.text,
.cy-feature-migrated-settings .typecho-option textarea { max-width: 100%; }
`;

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

function haveSamePluginSettings(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key) && left[key] === right[key]);
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

function featureSettingsPageHtml(csrfToken: string, rawSettings: unknown, rawThemeSettings: unknown): string {
  const settings = parsePluginSettings(rawSettings);
  let legacy: Record<string, unknown> = {};
  try {
    const parsed = typeof rawThemeSettings === 'string' ? JSON.parse(rawThemeSettings) : rawThemeSettings;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) legacy = parsed as Record<string, unknown>;
  } catch { /* Keep empty migration defaults when legacy settings are malformed. */ }
  const movedValue = (key: string) => settings[key] !== undefined ? settings[key] : legacy[key];
  const nativeField = (key: string, type: 'text' | 'textarea' | 'checkbox') => {
    const fieldIndex = key === 'pinnedIds' ? 0
      : key === 'articleDeclarationHtml' ? 33
        : key === 'footerCustomHtml' ? 34
          : (() => {
            const suffix = Number(key.slice(-2));
            const groupIndex = (suffix - 1) * 3;
            return groupIndex + (key.startsWith('linktxt') ? 1 : key.startsWith('links') ? 2 : 3);
          })();
    const id = key + '-0-' + (fieldIndex + 1);
    const optionId = 'typecho-option-item-' + key + '-' + fieldIndex;
    const value = movedValue(key);
    const safe = escapeHtml(value ?? '');
    const schema: Record<string, { label: string; description: string }> = {"pinnedIds":{"label":"首页置顶文章 ID","description":"只控制首页置顶。填写文章 ID，多个 ID 用英文逗号分隔；其他页面不受影响。"},"linktxt01":{"label":"页脚链接 1：显示文字","description":"留空则不显示这组链接。"},"links01":{"label":"页脚链接 1：链接地址","description":"支持 https://、http://、mailto:；普通域名可直接填写。"},"linkblank01":{"label":"页脚链接 1：在新窗口打开","description":""},"linktxt02":{"label":"页脚链接 2：显示文字","description":"留空则不显示这组链接。"},"links02":{"label":"页脚链接 2：链接地址","description":"支持 https://、http://、mailto:；普通域名可直接填写。"},"linkblank02":{"label":"页脚链接 2：在新窗口打开","description":""},"linktxt03":{"label":"页脚链接 3：显示文字","description":"留空则不显示这组链接。"},"links03":{"label":"页脚链接 3：链接地址","description":"支持 https://、http://、mailto:；普通域名可直接填写。"},"linkblank03":{"label":"页脚链接 3：在新窗口打开","description":""},"linktxt04":{"label":"页脚链接 4：显示文字","description":"留空则不显示这组链接。"},"links04":{"label":"页脚链接 4：链接地址","description":"支持 https://、http://、mailto:；普通域名可直接填写。"},"linkblank04":{"label":"页脚链接 4：在新窗口打开","description":""},"linktxt05":{"label":"页脚链接 5：显示文字","description":"留空则不显示这组链接。"},"links05":{"label":"页脚链接 5：链接地址","description":"支持 https://、http://、mailto:；普通域名可直接填写。"},"linkblank05":{"label":"页脚链接 5：在新窗口打开","description":""},"linktxt06":{"label":"页脚链接 6：显示文字","description":"留空则不显示这组链接。"},"links06":{"label":"页脚链接 6：链接地址","description":"支持 https://、http://、mailto:；普通域名可直接填写。"},"linkblank06":{"label":"页脚链接 6：在新窗口打开","description":""},"linktxt07":{"label":"页脚链接 7：显示文字","description":"留空则不显示这组链接。"},"links07":{"label":"页脚链接 7：链接地址","description":"支持 https://、http://、mailto:；普通域名可直接填写。"},"linkblank07":{"label":"页脚链接 7：在新窗口打开","description":""},"linktxt08":{"label":"页脚链接 8：显示文字","description":"留空则不显示这组链接。"},"links08":{"label":"页脚链接 8：链接地址","description":"支持 https://、http://、mailto:；普通域名可直接填写。"},"linkblank08":{"label":"页脚链接 8：在新窗口打开","description":""},"linktxt09":{"label":"页脚链接 9：显示文字","description":"留空则不显示这组链接。"},"links09":{"label":"页脚链接 9：链接地址","description":"支持 https://、http://、mailto:；普通域名可直接填写。"},"linkblank09":{"label":"页脚链接 9：在新窗口打开","description":""},"linktxt10":{"label":"页脚链接 10：显示文字","description":"留空则不显示这组链接。"},"links10":{"label":"页脚链接 10：链接地址","description":"支持 https://、http://、mailto:；普通域名可直接填写。"},"linkblank10":{"label":"页脚链接 10：在新窗口打开","description":""},"articleDeclarationHtml":{"label":"文章内容声明","description":"<style>ul.typecho-option:has(textarea[name=\"articleDeclarationHtml\"]){box-sizing:border-box!important;width:100%!important;background:#fff!important;border:1px solid #e5e7eb!important;border-radius:14px!important;padding:22px 26px!important;margin:18px 0!important;box-shadow:0 4px 16px rgba(31,41,55,.04)!important}ul.typecho-option:has(textarea[name=\"articleDeclarationHtml\"])>li{padding:0!important;margin:0!important}ul.typecho-option:has(textarea[name=\"articleDeclarationHtml\"]) .typecho-label{display:block!important;margin:0 0 8px!important;font-size:18px!important;font-weight:700!important;color:#27332e!important}ul.typecho-option:has(textarea[name=\"articleDeclarationHtml\"]) .description{margin:14px 0 0!important;line-height:1.7!important;color:#7b8580!important}ul.typecho-option:has(textarea[name=\"articleDeclarationHtml\"]) textarea{box-sizing:border-box!important;width:100%!important;max-width:100%!important;min-height:180px!important;display:block!important}</style>仅在文章详情页显示，位于正文末尾、评论区之前；笔记页不显示。留空则不显示。支持 HTML。<br><strong>变量说明：</strong><br><code>{site.name}</code>：网站名称；<code>{site.url}</code>：网站首页地址；<code>{site.description}</code>：网站简介。<br><code>{post.title}</code>：当前文章标题；<code>{post.url}</code>：当前文章完整访问地址。<br><strong>样式说明：</strong>声明内 CSS 仅作用于声明区块。需要边框、背景、圆角或内边距时，可自行在 HTML/CSS 中定义。变量替换值会进行 HTML 转义。"},"footerCustomHtml":{"label":"站点底部内容","description":"设置显示于站点底部的内容（HTML）"}};
    const field = schema[key];
    const description = field?.description ? '<p class="description">' + field.description + '</p>' : '';
    if (type === 'checkbox') return '<ul class="typecho-option" id="' + optionId + '"><li><label class="typecho-label" for="' + id + '"><input type="checkbox" id="' + id + '" name="' + key + '" data-cy-setting="' + key + '" value="1" ' + (value === true || value === 1 || value === '1' ? 'checked' : '') + '> ' + field.label + '</label>' + description + '</li></ul>';
    if (type === 'textarea') return '<ul class="typecho-option" id="' + optionId + '"><li><label class="typecho-label" for="' + id + '">' + field.label + '</label><textarea id="' + id + '" name="' + key + '" data-cy-setting="' + key + '">' + safe + '</textarea>' + description + '</li></ul>';
    return '<ul class="typecho-option" id="' + optionId + '"><li><label class="typecho-label" for="' + id + '">' + field.label + '</label><input id="' + id + '" name="' + key + '" type="text" class="text" data-cy-setting="' + key + '" value="' + safe + '">' + description + '</li></ul>';
  };
  const movedFields = [
    nativeField('pinnedIds', 'text'),
    nativeField('linktxt01', 'text'), nativeField('links01', 'text'), nativeField('linkblank01', 'checkbox'),
    nativeField('linktxt02', 'text'), nativeField('links02', 'text'), nativeField('linkblank02', 'checkbox'),
    nativeField('linktxt03', 'text'), nativeField('links03', 'text'), nativeField('linkblank03', 'checkbox'),
    nativeField('linktxt04', 'text'), nativeField('links04', 'text'), nativeField('linkblank04', 'checkbox'),
    nativeField('linktxt05', 'text'), nativeField('links05', 'text'), nativeField('linkblank05', 'checkbox'),
    nativeField('linktxt06', 'text'), nativeField('links06', 'text'), nativeField('linkblank06', 'checkbox'),
    nativeField('linktxt07', 'text'), nativeField('links07', 'text'), nativeField('linkblank07', 'checkbox'),
    nativeField('linktxt08', 'text'), nativeField('links08', 'text'), nativeField('linkblank08', 'checkbox'),
    nativeField('linktxt09', 'text'), nativeField('links09', 'text'), nativeField('linkblank09', 'checkbox'),
    nativeField('linktxt10', 'text'), nativeField('links10', 'text'), nativeField('linkblank10', 'checkbox'),
    nativeField('articleDeclarationHtml', 'textarea'),
    nativeField('footerCustomHtml', 'textarea'),
  ].join('');
  const commentsEnabled = isEnabled(settings.showCommentManagementButtons);
  const searchEnabled = isEnabled(settings.showHomeSearchButton);
  return `
    <div class="col-mb-12 col-tb-8 col-tb-offset-2 cy-feature-settings"
      data-cy-feature-settings data-csrf-token="${escapeHtml(csrfToken)}">
      <div class="cy-feature-header">
        <strong>CY服务插件</strong>
        <span class="cy-feature-version">版本：${PLUGIN_VERSION}</span>
        <a href="/admin/options-theme">返回主题设置</a>
      </div>
      <div class="cy-feature-migrated-settings warm-theme-config-form">${movedFields}</div>
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
          <span>首页搜索按键</span>
        </label>
        <p>控制 Warm CY 所有页面的主导航是否显示搜索图标。关闭后全站不显示搜索入口。</p>
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
        var form = root.querySelector('.warm-theme-config-form');
        if (form && form.dataset.warmCyLayoutApplied !== '1') {
          form.dataset.warmCyLayoutApplied = '1';
          var getField = function (name) {
            var input = form.querySelector('[name="' + name + '"]');
            return input ? input.closest('.typecho-option') : null;
          };

          var firstLinkField = getField('linktxt01');
          if (firstLinkField) {
            var section = document.createElement('section');
            section.className = 'warm-theme-links-group';
            var heading = document.createElement('div');
            heading.className = 'warm-theme-links-heading';
            var title = document.createElement('strong');
            title.textContent = '页面连接';
            var description = document.createElement('span');
            description.textContent = '支持 https://、http://、mailto:、站内链接；普通域名可直接填写。';
            heading.append(title, description);
            section.append(heading);
            firstLinkField.before(section);

            for (var index = 1; index <= 10; index += 1) {
              var suffix = String(index).padStart(2, '0');
              var textField = getField('linktxt' + suffix);
              var urlField = getField('links' + suffix);
              var blankField = getField('linkblank' + suffix);
              var textInput = textField && textField.querySelector('input[name="linktxt' + suffix + '"]');
              var urlInput = urlField && urlField.querySelector('input[name="links' + suffix + '"]');
              var blankInput = blankField && blankField.querySelector('input[name="linkblank' + suffix + '"]');
              if (!textInput || !urlInput || !blankInput) continue;

              var row = document.createElement('div');
              row.className = 'warm-theme-link-row';
              var textLine = document.createElement('div');
              textLine.className = 'warm-theme-link-text-line';
              var textLabel = document.createElement('label');
              textLabel.htmlFor = textInput.id;
              textLabel.textContent = '文字' + index + '：';
              textInput.classList.add('warm-theme-link-input');
              textLine.append(textLabel, textInput);

              var blankLabel = document.createElement('label');
              blankLabel.className = 'warm-theme-link-new-window';
              blankLabel.htmlFor = blankInput.id;
              var blankText = document.createElement('span');
              blankText.textContent = '新窗口打开';
              blankLabel.append(blankInput, blankText);
              textLine.append(blankLabel);

              var urlLine = document.createElement('div');
              urlLine.className = 'warm-theme-link-url-line';
              var urlLabel = document.createElement('label');
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

          var wrapSettingsCard = function (className, names) {
            var fields = names.map(getField).filter(Boolean);
            if (!fields.length) return;
            var card = document.createElement('section');
            card.className = 'warm-theme-settings-card ' + className;
            fields[0].before(card);
            fields.forEach(function (field) { card.append(field); });
          };

          wrapSettingsCard('warm-theme-home-card', ['pinnedIds']);
          wrapSettingsCard('warm-theme-footer-card', ['footerCustomHtml']);

          form.querySelectorAll('.typecho-option:not(.typecho-option-submit)').forEach(function (option) {
            if (option.style.display === 'none') return;
            var item = option.querySelector(':scope > li');
            if (!item || item.querySelector(':scope > .warm-theme-field-head')) return;
            var label = item.querySelector(':scope > .typecho-label');
            var description = item.querySelector(':scope > .description');
            if (label && label.querySelector('input[type="checkbox"], input[type="radio"]')) return;

            var head = document.createElement('div');
            head.className = 'warm-theme-field-head';
            if (label) head.append(label);
            if (description) head.append(description);
            var control = document.createElement('div');
            control.className = 'warm-theme-field-control';
            Array.from(item.children).forEach(function (child) {
              if (child !== label && child !== description) control.append(child);
            });
            item.append(head, control);
          });
        }
        save.addEventListener('click', async function () {
          var movedSettings = {};
          root.querySelectorAll('[data-cy-setting]').forEach(function (field) {
            var key = field.getAttribute('data-cy-setting');
            movedSettings[key] = field.type === 'checkbox' ? !!field.checked : field.value;
          });
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
                ...movedSettings,
                showCommentManagementButtons: !!root.querySelector('[data-cy-setting="showCommentManagementButtons"]')?.checked,
                showHomeSearchButton: !!root.querySelector('[data-cy-setting="showHomeSearchButton"]')?.checked,
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

  addHook('archive:footer', pluginId, (html: string, extra?: {
    options?: Record<string, unknown>;
  }) => {
    const options = extra?.options;
    if (!options) return html;
    const settings = parsePluginSettings(options[PLUGIN_OPTION_KEY]);
    if (options.theme !== THEME_ID || !isEnabled(settings.showHomeSearchButton)) {
      return html;
    }
    const searchBase = JSON.stringify(
      String(computeUrls(options as any).siteUrl || '/').replace(/\/?$/, '/'),
    ).replace(/</g, '\\u003c');
    return `${html}<script data-warm-cy-global-search>
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
    if (extra?.title !== 'CY服务插件'
      && !(extra?.options?.theme === THEME_ID && extra?.title === '设置外观')) return html;
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
        const groups = document.querySelectorAll('.typecho-head-nav > nav > menu > li');
        let settingsLinkAdded = false;
        for (const group of groups) {
          const heading = group.querySelector(':scope > a');
          if (heading?.textContent?.trim() !== '设置') continue;
          const submenu = group.querySelector(':scope > menu');
          if (!submenu) break;
          let item = submenu.querySelector('a[href="' + pluginPath + '"]')?.closest('li');
          if (!item) {
            item = document.createElement('li');
            const link = document.createElement('a');
            link.href = pluginPath;
            link.textContent = 'CY服务插件';
            item.append(link);
            submenu.append(item);
          }
          if (window.location.pathname === pluginPath) item.classList.add('focus');
          settingsLinkAdded = true;
          break;
        }

        // Keep the settings entry reachable even if another admin layout
        // changes or omits the nested Settings submenu.
        if (!settingsLinkAdded) {
          const mainMenu = document.querySelector('.typecho-head-nav > nav > menu');
          if (mainMenu && !mainMenu.querySelector('a[href="' + pluginPath + '"]')) {
            const item = document.createElement('li');
            const link = document.createElement('a');
            link.href = pluginPath;
            link.textContent = 'CY服务插件';
            item.append(link);
            const operate = mainMenu.querySelector(':scope > li.operate');
            if (operate) mainMenu.insertBefore(item, operate);
            else mainMenu.append(item);
          }
        }

        if (window.location.pathname === '/admin/options-theme') {
          const form = document.querySelector('form[action="/admin/options-theme"]');
          form?.classList.add('warm-theme-config-form');
          if (form && !form.previousElementSibling?.classList.contains('warm-theme-plugin-links')) {
            const toolbar = document.createElement('div');
            toolbar.className = 'cy-feature-links warm-theme-plugin-links';
            const cyLink = document.createElement('a');
            cyLink.href = pluginPath;
            cyLink.textContent = 'CY服务插件';
            const rehypeLink = document.createElement('a');
            rehypeLink.href = '/admin/plugin-config?id=typecho-plugin-markdown-rehype';
            rehypeLink.textContent = 'Markdown Rehype';
            toolbar.append(cyLink, rehypeLink);
            form.before(toolbar);
          }

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
          if (titleBar && !titleBar.querySelector('.warm-cy-theme-version')) {
            const version = document.createElement('span');
            version.className = 'warm-cy-theme-version';
            version.textContent = '主题版本：' + ${JSON.stringify(THEME_VERSION)};
            titleBar.append(version);
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
      extra.options?.[OPTION_KEY],
    );
  }, 20);

  addHook('route:request', pluginId, async (
    result: PluginRouteResult,
    extra?: { request?: Request; path?: string; options?: Record<string, unknown> },
  ) => {
    if (result?.handled || !extra?.request) return result;
    const request = extra.request;
    const path = extra.path || new URL(request.url).pathname;

    if (path !== ADMIN_PATH && path !== ADMIN_SETTINGS_API_PATH) return result;
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
        pinnedIds?: unknown;
        articleDeclarationHtml?: unknown;
        footerCustomHtml?: unknown;
        [key: string]: unknown;
      };
      const movedStringKeys = ['pinnedIds', 'articleDeclarationHtml', 'footerCustomHtml', ...Array.from({ length: 10 }, (_, i) => { const n = String(i + 1).padStart(2, '0'); return [`linktxt${n}`, `links${n}`]; }).flat()];
      if (movedStringKeys.some(key => values[key] !== undefined && typeof values[key] !== 'string')
        || Array.from({ length: 10 }, (_, i) => `linkblank${String(i + 1).padStart(2, '0')}`).some(key => values[key] !== undefined && typeof values[key] !== 'boolean')) {
        return { handled: true, response: json({ error: 'Invalid content settings' }, 400) };
      }
      if (typeof values.showCommentManagementButtons !== 'boolean'
        || typeof values.showHomeSearchButton !== 'boolean'
) {
        return { handled: true, response: json({ error: 'Invalid settings' }, 400) };
      }
      const current = parsePluginSettings(auth.options[PLUGIN_OPTION_KEY]);
      const next = {
        ...current,
        showCommentManagementButtons: values.showCommentManagementButtons ? '1' : '0',
        showHomeSearchButton: values.showHomeSearchButton ? '1' : '0',
      };
      delete next.htmlEnhancementEnabled;
      delete next.canonicalDomainRedirectEnabled;
      for (const key of movedStringKeys) {
        if (typeof values[key] === 'string') next[key] = values[key];
      }
      for (let i = 1; i <= 10; i++) {
        const key = `linkblank${String(i).padStart(2, '0')}`;
        if (typeof values[key] === 'boolean') next[key] = values[key] ? '1' : '0';
      }
      if (haveSamePluginSettings(current, next)) {
        return { handled: true, response: json({ success: true, unchanged: true }) };
      }
      await setOption(auth.db, PLUGIN_OPTION_KEY, JSON.stringify(next));
      return { handled: true, response: json({ success: true, unchanged: false }) };
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

    const settings = {
      ...parsePluginSettings(auth.options[OPTION_KEY]),
      ...parsePluginSettings(auth.options[PLUGIN_OPTION_KEY]),
    };
    const ids = parsePinnedIds(settings.pinnedIds).filter(id => id !== contentId);
    if (pinned) ids.unshift(contentId);
    settings.pinnedIds = ids.join(',');
    await setOption(auth.db, PLUGIN_OPTION_KEY, JSON.stringify(settings));
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

    const settings = {
      ...parsePluginSettings(auth.options[OPTION_KEY]),
      ...parsePluginSettings(auth.options[PLUGIN_OPTION_KEY]),
    };
    const featureSettings = settings;
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
