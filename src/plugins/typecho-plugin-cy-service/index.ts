import type { PluginInitContext } from 'typecho/plugin-sdk';
import adminCss from './cy-service-settings.css?raw';

const ADMIN_PAGE_SLUG = 'cy-service';
const PLUGIN_VERSION = '0.1.0';

function pageHtml(): string {
  const linkRows = Array.from({ length: 10 }, (_, index) => {
    const number = index + 1;
    const suffix = String(number).padStart(2, '0');
    return `
      <div class="cy-service-link-row">
        <div class="cy-service-link-text-line">
          <label for="cy-link-text-${suffix}">文字${number}：</label>
          <input id="cy-link-text-${suffix}" name="linktxt${suffix}" type="text">
          <label class="cy-service-new-window" for="cy-link-blank-${suffix}">
            <input id="cy-link-blank-${suffix}" name="linkblank${suffix}" type="checkbox">
            <span>新窗口打开</span>
          </label>
        </div>
        <div class="cy-service-link-url-line">
          <label for="cy-link-url-${suffix}">网址${number}：</label>
          <input id="cy-link-url-${suffix}" name="links${suffix}" type="text">
        </div>
      </div>`;
  }).join('');

  return `
    <div class="cy-service-settings">
      <header class="cy-service-header">
        <strong>CY服务插件</strong>
        <span class="cy-service-version">版本：${PLUGIN_VERSION}</span>
        <a href="/admin/options-theme">返回主题设置</a>
      </header>

      <main class="cy-service-form">
        <section class="cy-service-card cy-service-home-card">
          <div class="cy-service-field-head">
            <label for="cy-pinned-ids">首页置顶文章 ID</label>
            <p class="cy-service-description">只控制首页置顶。填写文章 ID，多个 ID 用英文逗号分隔；其他页面不受影响。</p>
          </div>
          <input id="cy-pinned-ids" name="pinnedIds" type="text">
        </section>

        <section class="cy-service-links-group">
          <div class="cy-service-links-heading">
            <strong>页面连接</strong>
            <span>支持 https://、http://、mailto:、站内链接；普通域名可直接填写。</span>
          </div>
          ${linkRows}
        </section>

        <section class="cy-service-card cy-service-article-card">
          <div class="cy-service-field-head">
            <label for="cy-article-declaration">文章内容声明</label>
            <p class="cy-service-description">
              仅在文章详情页显示，位于正文末尾、评论区之前；笔记页不显示。留空则不显示。支持 HTML。<br>
              <strong>变量说明：</strong><code>{site.name}</code>：网站名称；<code>{site.url}</code>：网站首页地址；<code>{site.description}</code>：网站简介。<br>
              <code>{post.title}</code>：当前文章标题；<code>{post.url}</code>：当前文章完整访问地址。<br>
              <strong>样式说明：</strong>声明内 CSS 仅作用于声明区块。需要边框、背景、圆角或内边距时，可自行在 HTML/CSS 中定义。变量替换值会进行 HTML 转义。
            </p>
          </div>
          <textarea id="cy-article-declaration" name="articleDeclarationHtml"></textarea>
        </section>

        <section class="cy-service-card cy-service-footer-card">
          <div class="cy-service-field-head">
            <label for="cy-footer-content">站点底部内容</label>
            <p class="cy-service-description">设置显示于站点底部的内容（HTML）</p>
          </div>
          <textarea id="cy-footer-content" name="footerCustomHtml"></textarea>
        </section>
      </main>
    </div>`;
}

export default function init({ addHook, pluginId }: PluginInitContext): void {
  addHook('admin:header', pluginId, (html: string, extra?: { title?: string }) => {
    if (extra?.title !== 'CY服务插件') return html;
    return `${html}<style data-cy-service-admin>${adminCss}</style>`;
  }, 20);

  addHook('admin:page', pluginId, (html: string, extra?: { slug?: string }) => {
    if (extra?.slug !== ADMIN_PAGE_SLUG) return html;
    return pageHtml();
  }, 20);
}
