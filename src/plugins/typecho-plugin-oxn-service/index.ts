import { loadPluginConfig, registerPluginAdminPath, setOption } from 'typecho/plugin-sdk';
import type { PluginInitContext, PluginRouteResult } from 'typecho/plugin-sdk';
import { isAdminActionResponse, requireAdminAction } from '@/lib/admin-auth';

const ADMIN_PAGE = 'oxn-service';
const API_PATH = '/api/admin/oxn-service-settings';
const CONFIG_ID = 'typecho-plugin-oxn-service';
const MAX_HTML = 20000;
const MAX_LINKS = 10;

type FooterLink = { text: string; url: string; newWindow: boolean };
type Settings = {
  pinnedIds: string;
  articleDeclarationHtml: string;
  footerCustomHtml: string;
  footerLinks: FooterLink[];
};

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c] || c);
}

function js(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function parseIds(value: unknown): number[] {
  if (typeof value !== 'string' && typeof value !== 'number') return [];
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const part of String(value).split(/[，,\s]+/)) {
    if (!/^\d+$/.test(part.trim())) continue;
    const id = Number(part.trim());
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length === 100) break;
  }
  return ids;
}

function normalizeLinks(value: unknown): FooterLink[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_LINKS).map(item => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      text: typeof row.text === 'string' ? row.text.trim().slice(0, 60) : '',
      url: typeof row.url === 'string' ? row.url.trim().slice(0, 2048) : '',
      newWindow: row.newWindow === true,
    };
  }).filter(row => row.text && row.url);
}

function safeLink(url: string): boolean {
  if (!url || /^\s*(javascript|data|vbscript):/i.test(url)) return false;
  if (/^(https?:|mailto:|tel:|\/|#|\?)/i.test(url)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(url);
}

function getSettings(options?: Record<string, unknown>): Settings {
  const saved = loadPluginConfig(options || {}, CONFIG_ID);
  return {
    pinnedIds: parseIds(saved.pinnedIds).join(','),
    articleDeclarationHtml: typeof saved.articleDeclarationHtml === 'string' ? saved.articleDeclarationHtml.slice(0, MAX_HTML) : '',
    footerCustomHtml: typeof saved.footerCustomHtml === 'string' ? saved.footerCustomHtml.slice(0, MAX_HTML) : '',
    footerLinks: normalizeLinks(saved.footerLinks),
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
}

function pageHtml(csrf: string, settings: Settings): string {
  const rows = Array.from({ length: MAX_LINKS }, (_, i) => {
    const link = settings.footerLinks[i] || { text: '', url: '', newWindow: false };
    return '<div class="oxn-link-row" data-link-row="' + i + '"' + (i > 0 && !link.text && !link.url ? ' hidden' : '') + '>' +
      '<label>文字 ' + (i + 1) + '<input type="text" maxlength="60" data-link-text value="' + escapeHtml(link.text) + '"></label>' +
      '<label>链接地址<input type="text" maxlength="2048" data-link-url value="' + escapeHtml(link.url) + '" placeholder="https:// 或站内路径"></label>' +
      '<label class="oxn-check"><input type="checkbox" data-link-blank ' + (link.newWindow ? 'checked' : '') + '> 新窗口打开</label></div>';
  }).join('');
  return '<div class="col-mb-12" id="oxn-service-settings" data-csrf="' + escapeHtml(csrf) + '">' +
    '<style>#oxn-service-settings{max-width:920px;margin:auto;color:#34433a;font-size:14px;line-height:1.65}#oxn-service-settings *{box-sizing:border-box}#oxn-service-settings .oxn-section{margin:0 0 16px;padding:16px 18px;border:1px solid #e5e9e7;border-radius:8px;background:#fff}#oxn-service-settings h3{margin:0 0 6px;font-size:15px}#oxn-service-settings p{margin:0 0 12px;color:#77817b;font-size:12px}#oxn-service-settings input[type=text],#oxn-service-settings textarea{display:block;width:100%;padding:8px 10px;border:1px solid #dce4df;border-radius:5px;background:#fff;color:#34433a;font:inherit}#oxn-service-settings textarea{min-height:150px;resize:vertical}#oxn-service-settings .oxn-link-row{display:grid;grid-template-columns:minmax(120px,.8fr) minmax(220px,1.6fr) auto;gap:12px;align-items:end;padding:12px 0;border-top:1px solid #edf0ee}#oxn-service-settings .oxn-link-row[hidden]{display:none}#oxn-service-settings .oxn-link-row label{font-size:12px}#oxn-service-settings .oxn-link-row input[type=text]{margin-top:5px}#oxn-service-settings .oxn-check{display:flex;align-items:center;gap:6px;white-space:nowrap;padding-bottom:9px}#oxn-service-settings button{cursor:pointer}#oxn-service-settings [data-save-status]{margin-left:12px;color:#269b63;font-size:13px}@media(max-width:700px){#oxn-service-settings .oxn-link-row{grid-template-columns:1fr}#oxn-service-settings .oxn-check{padding:0}}</style>' +
    '<section class="oxn-section"><h3>首页置顶文章</h3><p>填写文章 CID，多个 ID 用逗号或空格分隔。按填写顺序置顶；只影响首页文章列表。</p><input type="text" maxlength="500" data-pinned value="' + escapeHtml(settings.pinnedIds) + '" placeholder="例如：12, 35, 48"></section>' +
    '<section class="oxn-section"><h3>文章内容声明</h3><p>只显示在文章详情正文之后、评论区之前；笔记和独立页面不显示。支持 HTML。变量：{site.name}、{site.url}、{site.description}、{post.title}、{post.url}。变量值会进行 HTML 转义。</p><textarea data-declaration spellcheck="false">' + escapeHtml(settings.articleDeclarationHtml) + '</textarea></section>' +
    '<section class="oxn-section"><h3>页脚自定义 HTML</h3><p>追加到站点页脚区域。留空则不显示。</p><textarea data-footer-html spellcheck="false">' + escapeHtml(settings.footerCustomHtml) + '</textarea></section>' +
    '<section class="oxn-section"><h3>页脚链接</h3><p>最多 10 组。填写文字和地址后显示，可选择在新窗口打开。</p><div data-links>' + rows + '</div><button type="button" class="btn btn-s" data-add>＋ 添加一组链接</button></section>' +
    '<p><button type="button" class="btn primary" data-save>保存设置</button><span data-save-status role="status" aria-live="polite"></span></p></div>' +
    '<script>(function(){var r=document.getElementById("oxn-service-settings");if(!r||r.dataset.ready)return;r.dataset.ready="1";var rows=[].slice.call(r.querySelectorAll("[data-link-row]"));var add=r.querySelector("[data-add]");var save=r.querySelector("[data-save]");var status=r.querySelector("[data-save-status]");add.addEventListener("click",function(){var row=rows.find(function(x){return x.hidden});if(row){row.hidden=false;row.querySelector("input[type=text]").focus()}if(!rows.some(function(x){return x.hidden}))add.hidden=true});save.addEventListener("click",async function(){save.disabled=true;status.textContent="正在保存…";var links=rows.map(function(row){return{text:row.querySelector("[data-link-text]").value,url:row.querySelector("[data-link-url]").value,newWindow:row.querySelector("[data-link-blank]").checked}});try{var response=await fetch("' + API_PATH + '",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":r.dataset.csrf||""},body:JSON.stringify({pinnedIds:r.querySelector("[data-pinned]").value,articleDeclarationHtml:r.querySelector("[data-declaration]").value,footerCustomHtml:r.querySelector("[data-footer-html]").value,footerLinks:links})});var result=await response.json();if(!response.ok||!result.success)throw new Error(result.error||"保存失败");r.querySelector("[data-pinned]").value=result.settings.pinnedIds;status.textContent="保存成功"}catch(e){status.textContent=e instanceof Error?e.message:"保存失败"}finally{save.disabled=false}})})();</script>';
}

function frontendHtml(settings: Settings, options: Record<string, unknown>): string {
  const site = {
    name: typeof options.title === 'string' ? options.title : '',
    url: typeof options.siteUrl === 'string' ? options.siteUrl.replace(/\/$/, '') : '',
    description: typeof options.description === 'string' ? options.description : '',
  };
  return '<style>.warm-nav .oxn-service-search{display:inline-flex;align-items:center;gap:5px;margin-left:8px}.warm-nav .oxn-service-search input{width:112px;min-width:0;padding:5px 7px;border:1px solid #e5e9e7;border-radius:5px;background:#fff;font:inherit;font-size:12px}.warm-nav .oxn-service-search button{padding:5px 8px;border:1px solid #e5e9e7;border-radius:5px;background:#fff;color:inherit;font:inherit;font-size:12px;cursor:pointer}.oxn-service-article-declaration{margin:22px 0 0;padding:14px 16px;border:1px solid #e8ece9;border-radius:6px;font-size:.92em;line-height:1.75}.oxn-service-footer-html{margin-top:14px}@media(max-width:760px){.warm-nav .oxn-service-search{margin-left:0}.warm-nav .oxn-service-search input{width:92px}}</style>' +
    '<script>(function(){var declaration=' + js(settings.articleDeclarationHtml) + ';var footer=' + js(settings.footerCustomHtml) + ';var links=' + js(settings.footerLinks) + ';var site=' + js(site) + ';function esc(v){return String(v||"").replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}function search(){var nav=document.querySelector(".warm-nav");if(!nav||nav.querySelector(".oxn-service-search"))return;var f=document.createElement("form");f.className="oxn-service-search";f.method="get";f.action="/";f.setAttribute("role","search");var i=document.createElement("input");i.type="search";i.name="s";i.placeholder="搜索";i.setAttribute("aria-label","搜索文章");var b=document.createElement("button");b.type="submit";b.textContent="搜索";f.append(i,b);nav.appendChild(f)}function footerUi(){var root=document.querySelector(".warm-footer");if(!root)return;var nav=root.querySelector(".warm-footer__meta nav[aria-label=\\"页脚链接\\"]");if(!nav&&links.length){nav=document.createElement("nav");nav.setAttribute("aria-label","页脚链接");root.querySelector(".warm-footer__meta")?.appendChild(nav)}if(nav&&!nav.dataset.oxnLinks){links.forEach(function(x){if(!x.text||!x.url)return;var a=document.createElement("a");a.textContent=x.text;a.href=x.url;if(x.newWindow){a.target="_blank";a.rel="noopener noreferrer"}nav.appendChild(a)});nav.dataset.oxnLinks="1"}if(footer&&!root.querySelector(".oxn-service-footer-html")){var box=document.createElement("div");box.className="oxn-service-footer-html";box.innerHTML=footer;root.appendChild(box)}}function articleUi(){if(!declaration)return;var article=document.querySelector(".warm-article:not(.is-note)");var body=article&&article.querySelector(".warm-article__body");if(!body||article.querySelector(".oxn-service-article-declaration"))return;var title=article.querySelector(".warm-article__header h1")?.textContent||document.title;var values={"{site.name}":esc(site.name),"{site.url}":esc(site.url),"{site.description}":esc(site.description),"{post.title}":esc(title),"{post.url}":esc(location.href)};var html=declaration.replace(/\\{site\\.name\\}|\\{site\\.url\\}|\\{site\\.description\\}|\\{post\\.title\\}|\\{post\\.url\\}/g,function(k){return values[k]||""});var box=document.createElement("aside");box.className="oxn-service-article-declaration";box.innerHTML=html;body.insertAdjacentElement("afterend",box)}function init(){search();footerUi();articleUi()}init();window.addEventListener("instantclick:newpage",init)})();</script>';
}

export default function init({ addHook, pluginId }: PluginInitContext): void {
  registerPluginAdminPath(API_PATH);

  addHook('archive:select', pluginId, (
    selection: { pinnedIds?: number[] },
    extra?: { archiveType?: string; options?: Record<string, unknown> },
  ) => {
    if (extra?.archiveType !== 'index') return selection;
    return { ...selection, pinnedIds: parseIds(getSettings(extra.options).pinnedIds) };
  });

  addHook('archive:footer', pluginId, (html: string, extra?: { options?: Record<string, unknown> }) => {
    if (!extra?.options) return html;
    return html + frontendHtml(getSettings(extra.options), extra.options);
  });

  addHook('admin:page', pluginId, (html: string, extra?: {
    slug?: string; csrfToken?: string; options?: Record<string, unknown>;
  }) => extra?.slug === ADMIN_PAGE ? pageHtml(extra.csrfToken || '', getSettings(extra.options)) : html);

  addHook('admin:footer', pluginId, (html: string, extra?: {
    activeMenu?: string; user?: { group?: string };
  }) => {
    if (extra?.user?.group !== 'administrator') return html;
    const active = extra.activeMenu === 'manage-comments';
    return html + '<script>(function(){var root=document.querySelector(".typecho-head-nav nav > menu > li:nth-child(3)");if(!root||root.querySelector("a[href=\\"/admin/manage-comments\\"]"))return;var menu=root.querySelector(":scope > menu");if(!menu)return;var anchor=menu.querySelector("a[href=\\"/admin/manage-posts\\"]");var item=document.createElement("li");item.className="' + (active ? 'focus' : '') + '";var link=document.createElement("a");link.href="/admin/manage-comments";link.textContent="评论管理";item.appendChild(link);if(anchor&&anchor.parentElement)anchor.parentElement.insertAdjacentElement("afterend",item);else menu.appendChild(item);' + (active ? 'root.classList.add("focus");' : '') + '})();</script>';
  });

  addHook('route:request', pluginId, async (
    result: PluginRouteResult,
    extra?: { request?: Request; path?: string },
  ) => {
    if (result?.handled || !extra?.request) return result;
    const request = extra.request;
    if ((extra.path || new URL(request.url).pathname) !== API_PATH) return result;
    if (request.method !== 'POST') {
      return { handled: true, response: json({ success: false, error: 'Method not allowed' }, 405) };
    }
    const auth = await requireAdminAction(request, 'administrator');
    if (isAdminActionResponse(auth)) {
      return { handled: true, response: json({ success: false, error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status) };
    }
    let body: unknown;
    try { body = await request.json(); } catch {
      return { handled: true, response: json({ success: false, error: '请求 JSON 格式无效' }, 400) };
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { handled: true, response: json({ success: false, error: '设置格式无效' }, 400) };
    }
    const value = body as Record<string, unknown>;
    if (typeof value.pinnedIds !== 'string' || value.pinnedIds.length > 500 ||
        typeof value.articleDeclarationHtml !== 'string' || value.articleDeclarationHtml.length > MAX_HTML ||
        typeof value.footerCustomHtml !== 'string' || value.footerCustomHtml.length > MAX_HTML ||
        !Array.isArray(value.footerLinks) || value.footerLinks.length > MAX_LINKS) {
      return { handled: true, response: json({ success: false, error: '设置内容无效或超出长度限制' }, 400) };
    }
    const links = normalizeLinks(value.footerLinks);
    if (links.some(link => !safeLink(link.url))) {
      return { handled: true, response: json({ success: false, error: '页脚链接协议不受支持' }, 400) };
    }
    const settings: Settings = {
      pinnedIds: parseIds(value.pinnedIds).join(','),
      articleDeclarationHtml: value.articleDeclarationHtml,
      footerCustomHtml: value.footerCustomHtml,
      footerLinks: links,
    };
    await setOption(auth.db, 'plugin:' + CONFIG_ID, JSON.stringify(settings));
    return { handled: true, response: json({ success: true, settings }) };
  }, 20);
}
