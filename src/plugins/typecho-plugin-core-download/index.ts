import type { PluginInitContext } from 'typecho/plugin-sdk';
import { coreDownloadAdminHtml } from './admin';

export default function init({ addHook, pluginId }: PluginInitContext): void {
  addHook(
    'admin:writePost:bottom',
    pluginId,
    (html: string) => html + coreDownloadAdminHtml(),
  );
}
