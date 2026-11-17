import { registerPluginAdminPath } from 'typecho/plugin-sdk';
import type { PluginInitContext } from 'typecho/plugin-sdk';

const ADMIN_PAGE_SLUG = 'oxn-service';

function adminPageHtml(): string {
  return `
    <section data-oxn-service>
      <h2>OXN主题服务</h2>
      <p>独立的 OXN 主题服务插件已加载。</p>
      <p>后续功能只在本插件内实现，不修改 OXN 主题原有 CSS，也不依赖旧 CY 插件。</p>
    </section>
  `;
}

export default function init({ addHook, pluginId }: PluginInitContext): void {
  registerPluginAdminPath('/admin/oxn-service');

  addHook('admin:page', pluginId, (html: string, extra?: { slug?: string }) => {
    if (extra?.slug !== ADMIN_PAGE_SLUG) return html;
    return adminPageHtml();
  });
}
