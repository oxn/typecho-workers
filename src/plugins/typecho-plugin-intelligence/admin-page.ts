/**
 * Intelligence admin settings page (/admin/plugin/intelligence).
 */
import { escapeHtml } from 'typecho/plugin-sdk';
import {
  maskSecretFormValues,
  toFormValues,
  SUMMARY_LENGTH_CHARS,
  type IntelligenceSettings,
  type SearchProvider,
  type SummaryLengthPreset,
} from './config';

export const ADMIN_PAGE_SLUG = 'intelligence';
export const CONFIG_API_ROUTE = '/api/admin/plugin-intelligence/config';

export function isIntelligenceAdminSlug(slug: string | undefined): boolean {
  return slug === ADMIN_PAGE_SLUG;
}

function attr(value: string): string {
  return escapeHtml(value);
}

type FieldItem = { label: string; control: string; description?: string };

function fieldCell(item: FieldItem): string {
  return `<div class="intelligence-field">`
    + `<label class="typecho-label">${escapeHtml(item.label)}</label>${item.control}`
    + (item.description ? `<p class="description">${item.description}</p>` : '')
    + `</div>`;
}

/** N labeled controls in one row (desktop); stacks on narrow viewports. */
function fieldRow(...items: FieldItem[]): string {
  const cols = items.length;
  return `<li class="intelligence-row intelligence-row-${cols}">${items.map(fieldCell).join('')}</li>`;
}

function textInput(name: string, value: string, opts: { type?: string; placeholder?: string } = {}): string {
  const type = opts.type || 'text';
  const ph = opts.placeholder ? ` placeholder="${attr(opts.placeholder)}"` : '';
  return `<input type="${type}" name="${name}" id="intelligence-${name}" class="text w-100" value="${attr(value)}"${ph}>`;
}

const SUMMARY_LENGTH_OPTIONS: Array<{ value: SummaryLengthPreset; label: string; hint: string }> = [
  { value: 'short', label: '短', hint: `约 ${SUMMARY_LENGTH_CHARS.short} 字` },
  { value: 'medium', label: '中', hint: `约 ${SUMMARY_LENGTH_CHARS.medium} 字` },
  { value: 'long', label: '长', hint: `约 ${SUMMARY_LENGTH_CHARS.long} 字` },
];

function lengthCards(name: string, value: string): string {
  return `<div class="intelligence-length-grid" role="radiogroup" aria-label="摘要长度">${SUMMARY_LENGTH_OPTIONS.map((opt) => {
    const checked = opt.value === value ? ' checked' : '';
    const active = opt.value === value ? ' is-active' : '';
    return `<label class="intelligence-length-option${active}" aria-label="${attr(`${opt.label}，${opt.hint}`)}">`
      + `<input type="radio" name="${name}" value="${attr(opt.value)}"${checked}>`
      + `<span class="intelligence-length-name">${escapeHtml(opt.label)}</span>`
      + `<span class="intelligence-length-hint">${escapeHtml(opt.hint)}</span>`
      + `</label>`;
  }).join('')}</div>`;
}

function searchCards(
  name: string,
  value: string,
  options: Array<{ value: SearchProvider; label: string; badge: string; hint: string }>,
): string {
  return `<div class="intelligence-scope-grid" role="radiogroup" aria-label="搜索方式">${options.map((opt) => {
    const checked = opt.value === value ? ' checked' : '';
    const active = opt.value === value ? ' is-active' : '';
    return `<label class="intelligence-scope-card${active}">`
      + `<input type="radio" name="${name}" value="${attr(opt.value)}"${checked}>`
      + `<span class="intelligence-scope-top">`
      + `<span class="intelligence-scope-title">${escapeHtml(opt.label)}</span>`
      + `<span class="intelligence-scope-badge">${escapeHtml(opt.badge)}</span>`
      + `</span>`
      + `<span class="intelligence-scope-hint">${escapeHtml(opt.hint)}</span>`
      + `</label>`;
  }).join('')}</div>`;
}

const SEARCH_OPTIONS: Array<{ value: SearchProvider; label: string; badge: string; hint: string }> = [
  { value: 'default', label: '默认', badge: '站内搜索', hint: '搜索标题与正文，保持原有站内搜索行为' },
  { value: 'bing', label: 'Bing', badge: '外部搜索', hint: '直接跳转 Bing 搜索本站，关闭内部搜索路由' },
  { value: 'google', label: 'Google', badge: '外部搜索', hint: '直接跳转 Google 搜索本站，关闭内部搜索路由' },
];

export function adminPageHtml(csrf: string, config: IntelligenceSettings): string {
  const values = maskSecretFormValues(toFormValues(config));
  const v = (key: keyof typeof values) => values[key] || '';

  return `<div class="col-mb-12" id="intelligence-settings-app">
  <div id="intelligence-settings-notice" style="display:none" role="status" aria-live="polite"></div>

  <form id="intelligence-settings-form">
    <input type="hidden" name="_" value="${attr(csrf)}">

    <section class="intelligence-panel">
      <header class="intelligence-panel-head">
        <h3>基础设置</h3>
        <p>连接 OpenAI 兼容接口，供写作辅助与摘要共用</p>
      </header>
      <ul class="typecho-option intelligence-option-list">
        ${fieldRow(
          {
            label: '接口地址',
            control: textInput('endpoint', v('endpoint'), { placeholder: 'https://…/v4/' }),
            description: 'Base URL，请求时自动追加 /chat/completions',
          },
          {
            label: 'API Key',
            control: textInput('apiKey', v('apiKey'), { type: 'password' }),
            description: '仅 AI 功能需要；已保存显示为掩码，保留掩码表示不修改',
          },
        )}
        ${fieldRow(
          { label: '模型名称', control: textInput('model', v('model')) },
          { label: 'Temperature', control: textInput('temperature', v('temperature')) },
          { label: 'Max Token', control: textInput('maxTokens', v('maxTokens')) },
        )}
      </ul>
    </section>

    <section class="intelligence-panel" aria-labelledby="intelligence-summary-title">
      <header class="intelligence-panel-head intelligence-summary-head">
        <div class="intelligence-summary-title">
          <h3 id="intelligence-summary-title">智能摘要</h3>
          <p>使用已保存的 AI 配置生成内容概览</p>
        </div>
        <label class="intelligence-toggle">
          <input type="checkbox" role="switch" name="autoSummary" id="intelligence-autoSummary" value="1"${v('autoSummary') === '1' ? ' checked' : ''} aria-label="自动生成智能摘要">
          <span id="intelligence-auto-summary-state" aria-hidden="true">${v('autoSummary') === '1' ? '开启' : '关闭'}</span>
        </label>
      </header>
      <div class="intelligence-summary-batch">
        <div class="intelligence-summary-batch-head">
          <div class="intelligence-summary-copy">
            ${lengthCards('summaryLength', v('summaryLength'))}
            <p class="description">为已发布的文章和页面生成智能摘要，不受自动生成开关影响。</p>
          </div>
          <div class="intelligence-summary-actions">
            <div class="intelligence-batch-actions">
              <button type="button" class="btn primary" id="intelligence-batch-start">批量生成</button>
              <button type="button" class="btn" id="intelligence-batch-stop" disabled>停止</button>
            </div>
            <label class="intelligence-check"><input type="checkbox" id="intelligence-skip-existing" checked> 跳过已有摘要</label>
          </div>
        </div>
        <div id="intelligence-batch-progress" class="intelligence-batch-progress" hidden>
          <div class="intelligence-batch-bar"><div id="intelligence-batch-bar-fill"></div></div>
          <p id="intelligence-batch-status" class="description" role="status" aria-live="polite"></p>
          <ul id="intelligence-batch-log" class="intelligence-batch-log"></ul>
        </div>
      </div>
    </section>

    <section class="intelligence-panel">
      <header class="intelligence-panel-head">
        <h3>搜索方式</h3>
        <p>选择站内搜索或直接跳转外部搜索引擎</p>
      </header>
      ${searchCards('searchProvider', v('searchProvider'), SEARCH_OPTIONS)}
      <p class="description">外部搜索使用关键词 + site:站点域名，仅能搜索引擎已收录的内容；新文章可能延迟出现。插件停用后恢复默认站内搜索。</p>
    </section>

    <p class="submit intelligence-submit">
      <button type="submit" class="btn primary" id="intelligence-settings-save">保存设置</button>
    </p>
  </form>
</div>

<style>
#intelligence-settings-app p:last-child,
#intelligence-settings-app .intelligence-batch-actions { margin-bottom: 0; }
#intelligence-settings-app .intelligence-panel {
  background: #fff;
  border: 1px solid #e7e7e7;
  border-radius: 6px;
  padding: 1.1em 1.25em 1.25em;
  margin-bottom: 1.25em;
}
#intelligence-settings-app .intelligence-panel-head { margin-bottom: 1em; }
#intelligence-settings-app .intelligence-panel-head h3 {
  margin: 0 0 .25em;
  font-size: 1.05em;
  font-weight: 600;
}
#intelligence-settings-app .intelligence-panel-head p {
  margin: 0;
  color: #888;
  font-size: .92857em;
}
#intelligence-settings-app .intelligence-option-list { list-style: none; margin: 0; padding: 0; }
#intelligence-settings-app .intelligence-option-list > li { margin: 0 0 1em; padding: 0; border: 0; }
#intelligence-settings-app .intelligence-option-list > li:last-child { margin-bottom: 0; }
#intelligence-settings-app .intelligence-row {
  display: grid !important;
  gap: 1em 1.25em;
  align-items: start;
}
#intelligence-settings-app .intelligence-row-2 { grid-template-columns: 1fr 1fr; }
#intelligence-settings-app .intelligence-row-3 { grid-template-columns: 1fr 1fr 1fr; }
#intelligence-settings-app .intelligence-field { min-width: 0; }
#intelligence-settings-app .intelligence-field .text,
#intelligence-settings-app .intelligence-field select {
  width: 100%;
  box-sizing: border-box;
}
#intelligence-settings-app .intelligence-field select { height: 32px; }
#intelligence-settings-app .intelligence-field .description { margin: .35em 0 0; }

#intelligence-settings-app .intelligence-summary-head,
#intelligence-settings-app .intelligence-summary-batch-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 1em 1.5em;
}
#intelligence-settings-app .intelligence-panel-head.intelligence-summary-head { margin-bottom: 0; }
#intelligence-settings-app .intelligence-length-grid {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: .45em;
  margin: 0;
}
#intelligence-settings-app .intelligence-length-option {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: .35em;
  box-sizing: border-box;
  width: 2.35em;
  height: 2.35em;
  margin: 0;
  padding: 0;
  border: 1px solid #e5e5e5;
  border-radius: 4px;
  background: #fafafa;
  cursor: pointer;
  transition: border-color .15s ease, background .15s ease, box-shadow .15s ease;
}
#intelligence-settings-app .intelligence-length-option:hover { border-color: #b7cdd8; }
#intelligence-settings-app .intelligence-length-option.is-active,
#intelligence-settings-app .intelligence-length-option:has(input:checked) {
  width: auto;
  padding: 0 .7em;
  border-color: #467B96;
  background: #f3f8fb;
  box-shadow: inset 0 0 0 1px #467B96;
}
#intelligence-settings-app .intelligence-length-option input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
#intelligence-settings-app .intelligence-length-name { font-weight: 600; color: #333; line-height: 1; }
#intelligence-settings-app .intelligence-length-hint { display: none; color: #467B96; font-size: .86em; line-height: 1; white-space: nowrap; }
#intelligence-settings-app .intelligence-length-option.is-active .intelligence-length-hint,
#intelligence-settings-app .intelligence-length-option:has(input:checked) .intelligence-length-hint { display: inline; }
#intelligence-settings-app .intelligence-summary-title,
#intelligence-settings-app .intelligence-summary-copy { min-width: 0; }
#intelligence-settings-app .intelligence-summary-copy .description { margin: .65em 0 0; line-height: 1.6; }
#intelligence-settings-app .intelligence-summary-batch { margin-top: 1em; padding-top: 1em; border-top: 1px solid #eee; }
#intelligence-settings-app .intelligence-summary-actions { display: flex; flex-direction: column; align-items: flex-end; gap: .65em; }
#intelligence-settings-app .intelligence-summary-actions .btn { white-space: nowrap; }
#intelligence-settings-app .intelligence-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 0;
  white-space: nowrap;
  cursor: pointer;
  color: #666;
  line-height: 1;
}
#intelligence-settings-app .intelligence-toggle span { margin: 0; }
#intelligence-settings-app .intelligence-toggle input {
  appearance: none;
  -webkit-appearance: none;
  box-sizing: border-box;
  position: relative;
  flex: 0 0 auto;
  width: 36px;
  height: 20px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: #b8c0c5;
  cursor: pointer;
  vertical-align: middle;
}
#intelligence-settings-app .intelligence-toggle input::before {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
  top: 2px;
  left: 2px;
  border-radius: 50%;
  background: #fff;
  transition: transform .15s ease;
}
#intelligence-settings-app .intelligence-toggle input:checked { background: #467B96; }
#intelligence-settings-app .intelligence-toggle input:checked::before { transform: translateX(16px); }
#intelligence-settings-app .intelligence-toggle input:focus-visible { outline: 2px solid #467B96; outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) {
  #intelligence-settings-app .intelligence-toggle input::before { transition: none; }
}
#intelligence-settings-app .intelligence-batch-actions {
  display: flex;
  flex-wrap: wrap;
  gap: .5em;
  justify-content: flex-end;
}
#intelligence-settings-app .intelligence-check {
  display: inline-flex;
  gap: .35em;
  align-items: center;
  color: #555;
  margin: 0;
}
#intelligence-settings-app .intelligence-batch-progress { margin-top: .9em; }
#intelligence-settings-app .intelligence-batch-bar {
  height: 8px;
  background: #e8e8e8;
  border-radius: 4px;
  overflow: hidden;
}
#intelligence-settings-app #intelligence-batch-bar-fill {
  height: 100%;
  width: 0;
  background: #467B96;
  transition: width .2s ease;
}
#intelligence-settings-app .intelligence-batch-log {
  max-height: 200px;
  overflow: auto;
  margin: .55em 0 0;
  padding: .6em .8em;
  list-style: none;
  background: #fff;
  border: 1px solid #eee;
  border-radius: 4px;
  font-size: .92857em;
  color: #666;
}
#intelligence-settings-app .intelligence-batch-log li { margin: .15em 0; }
#intelligence-settings-app .intelligence-batch-log .ok { color: #2e7d32; }
#intelligence-settings-app .intelligence-batch-log .err { color: #c62828; }

#intelligence-settings-app .intelligence-scope-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: .85em;
}
#intelligence-settings-app .intelligence-scope-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: .4em;
  margin: 0;
  padding: 1em 1em 1em 2.4em;
  border: 1px solid #e5e5e5;
  border-radius: 6px;
  background: #fafafa;
  cursor: pointer;
  transition: border-color .15s ease, background .15s ease, box-shadow .15s ease;
}
#intelligence-settings-app .intelligence-scope-card:hover { border-color: #b7cdd8; }
#intelligence-settings-app .intelligence-scope-card.is-active,
#intelligence-settings-app .intelligence-scope-card:has(input:checked) {
  border-color: #467B96;
  background: #f3f8fb;
  box-shadow: inset 0 0 0 1px #467B96;
}
#intelligence-settings-app .intelligence-scope-card input {
  position: absolute;
  left: .9em;
  top: 1.2em;
  margin: 0;
}
#intelligence-settings-app .intelligence-scope-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .5em;
  margin-right: 0;
}
#intelligence-settings-app .intelligence-scope-title {
  font-weight: 600;
  color: #333;
  margin-right: 0;
}
#intelligence-settings-app .intelligence-scope-badge {
  flex-shrink: 0;
  margin: 0;
  padding: .12em .5em;
  border-radius: 999px;
  background: #eef3f6;
  color: #467B96;
  font-size: .78em;
  font-weight: 600;
  white-space: nowrap;
}
#intelligence-settings-app .intelligence-scope-card.is-active .intelligence-scope-badge,
#intelligence-settings-app .intelligence-scope-card:has(input:checked) .intelligence-scope-badge {
  background: #467B96;
  color: #fff;
}
#intelligence-settings-app .intelligence-scope-hint {
  color: #888;
  font-size: .92857em;
  line-height: 1.45;
  margin-right: 0;
}
#intelligence-settings-app .intelligence-submit { margin: .25em 0 1.5em; }

#intelligence-settings-notice { margin-bottom: 1em; padding: .75em 1em; border-radius: 4px; }
#intelligence-settings-notice.is-ok { background: #e8f5e9; color: #2e7d32; }
#intelligence-settings-notice.is-err { background: #ffebee; color: #c62828; }

@media (max-width: 820px) {
  #intelligence-settings-app .intelligence-row-2,
  #intelligence-settings-app .intelligence-row-3 {
    grid-template-columns: 1fr !important;
  }
  #intelligence-settings-app .intelligence-scope-grid {
    display: flex;
    flex-direction: column;
  }
}
@media (max-width: 640px) {
  #intelligence-settings-app .intelligence-summary-head { gap: 1em; }
  #intelligence-settings-app .intelligence-summary-batch-head { grid-template-columns: minmax(0, 1fr); gap: .85em; }
  #intelligence-settings-app .intelligence-summary-actions { flex-direction: row; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: .75em 1em; }
}
</style>

<script>
(function () {
  var form = document.getElementById('intelligence-settings-form');
  var notice = document.getElementById('intelligence-settings-notice');
  var saveBtn = document.getElementById('intelligence-settings-save');
  var startBtn = document.getElementById('intelligence-batch-start');
  var stopBtn = document.getElementById('intelligence-batch-stop');
  var skipExisting = document.getElementById('intelligence-skip-existing');
  var progressBox = document.getElementById('intelligence-batch-progress');
  var barFill = document.getElementById('intelligence-batch-bar-fill');
  var statusEl = document.getElementById('intelligence-batch-status');
  var logEl = document.getElementById('intelligence-batch-log');
  var csrf = ${JSON.stringify(csrf)};
  var configUrl = ${JSON.stringify(CONFIG_API_ROUTE)};
  var batchStop = false;
  var autoSummary = document.getElementById('intelligence-autoSummary');
  var autoSummaryState = document.getElementById('intelligence-auto-summary-state');
  if (autoSummary && autoSummaryState) {
    autoSummary.addEventListener('change', function () {
      autoSummaryState.textContent = autoSummary.checked ? '开启' : '关闭';
    });
  }


  function showNotice(ok, message) {
    if (!notice) return;
    notice.style.display = 'block';
    notice.className = ok ? 'is-ok' : 'is-err';
    notice.textContent = message;
  }

  function bindChoiceCards(selector) {
    form.querySelectorAll(selector + ' input').forEach(function (input) {
      input.addEventListener('change', function () {
        form.querySelectorAll(selector).forEach(function (card) {
          var peer = card.querySelector('input');
          card.classList.toggle('is-active', !!(peer && peer.checked));
        });
      });
    });
  }
  bindChoiceCards('.intelligence-scope-card');
  bindChoiceCards('.intelligence-length-option');

  function collectSettings() {
    var data = new FormData(form);
    return {
      endpoint: String(data.get('endpoint') || ''),
      apiKey: String(data.get('apiKey') || ''),
      model: String(data.get('model') || ''),
      temperature: String(data.get('temperature') || ''),
      maxTokens: String(data.get('maxTokens') || ''),
      autoSummary: String(data.get('autoSummary') || '0'),
      summaryLength: String(data.get('summaryLength') || 'medium'),
      searchProvider: String(data.get('searchProvider') || 'default'),
    };
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (saveBtn) saveBtn.disabled = true;
    try {
      var res = await fetch(configUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ settings: collectSettings(), _: csrf }),
      });
      var json = await res.json().catch(function () { return {}; });
      if (!res.ok || !json.success) {
        showNotice(false, json.message || ('保存失败 (' + res.status + ')'));
        return;
      }
      showNotice(true, json.message || '设置已保存');
      if (json.settings && json.settings.apiKey !== undefined) {
        var keyInput = document.getElementById('intelligence-apiKey');
        if (keyInput) keyInput.value = json.settings.apiKey;
      }
    } catch (err) {
      showNotice(false, '保存失败：网络错误');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });

  function pluginAction(action, payload) {
    return fetch('/api/admin/plugin-action', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
      },
      body: JSON.stringify({
        _: csrf,
        plugin: 'typecho-plugin-intelligence',
        action: action,
        payload: payload || {},
      }),
    }).then(function (res) {
      return res.json().then(function (json) {
        return { ok: res.ok, status: res.status, json: json };
      });
    });
  }

  function appendLog(cls, text) {
    if (!logEl) return;
    var li = document.createElement('li');
    li.className = cls;
    li.textContent = text;
    logEl.appendChild(li);
    logEl.scrollTop = logEl.scrollHeight;
  }

  async function summarizeWithRetry(item, attempts) {
    var lastError = '未知错误';
    for (var i = 0; i < attempts; i++) {
      if (batchStop) throw new Error('已停止');
      try {
        var result = await pluginAction('summarizeOne', { cid: item.cid });
        if (result.json && result.json.success) return result.json;
        lastError = (result.json && (result.json.error || result.json.message)) || ('HTTP ' + result.status);
      } catch (err) {
        lastError = err && err.message ? err.message : '网络错误';
      }
    }
    throw new Error(lastError);
  }

  if (startBtn) {
    startBtn.addEventListener('click', async function () {
      batchStop = false;
      startBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = false;
      if (progressBox) progressBox.hidden = false;
      if (logEl) logEl.innerHTML = '';
      if (barFill) barFill.style.width = '0%';
      if (statusEl) statusEl.textContent = '正在加载列表…';

      try {
        var listRes = await pluginAction('listForSummary', {});
        if (!listRes.json || !listRes.json.success || !Array.isArray(listRes.json.items)) {
          throw new Error((listRes.json && (listRes.json.error || listRes.json.message)) || '无法加载文章列表');
        }
        var items = listRes.json.items.slice();
        if (skipExisting && skipExisting.checked) {
          items = items.filter(function (item) { return !item.hasSummary; });
        }
        if (items.length === 0) {
          if (statusEl) statusEl.textContent = '没有需要处理的文章';
          showNotice(true, '没有需要生成摘要的内容');
          return;
        }

        var done = 0;
        var failed = 0;
        for (var i = 0; i < items.length; i++) {
          if (batchStop) break;
          var item = items[i];
          if (statusEl) {
            statusEl.textContent = '正在生成 (' + (i + 1) + '/' + items.length + ')：' + (item.title || ('#' + item.cid));
          }
          try {
            await summarizeWithRetry(item, 3);
            done++;
            appendLog('ok', '✓ #' + item.cid + ' ' + (item.title || ''));
          } catch (err) {
            failed++;
            appendLog('err', '✗ #' + item.cid + ' ' + (item.title || '') + ' — ' + (err && err.message ? err.message : '失败'));
          }
          if (barFill) barFill.style.width = Math.round(((i + 1) / items.length) * 100) + '%';
        }

        var summary = batchStop
          ? ('已停止：成功 ' + done + '，失败 ' + failed)
          : ('完成：成功 ' + done + '，失败 ' + failed);
        if (statusEl) statusEl.textContent = summary;
        showNotice(failed === 0 && !batchStop, summary);
      } catch (err) {
        showNotice(false, err && err.message ? err.message : '批量生成失败');
        if (statusEl) statusEl.textContent = '批量生成失败';
      } finally {
        startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
      }
    });
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', function () {
      batchStop = true;
      stopBtn.disabled = true;
    });
  }

})();
</script>`;
}
