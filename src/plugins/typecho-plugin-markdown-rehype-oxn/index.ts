import type { PluginInitContext } from 'typecho/plugin-sdk';
import { loadPluginConfig } from '@/lib/plugin';
import katexCss from 'katex/dist/katex.min.css?inline';
import enhancerCss from './client/rehype-styles.css?inline';

const STYLE_ID = 'oxn-markdown-rehype-styles';
const KATEX_STYLE_ID = 'oxn-markdown-rehype-katex';

function enabled(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}
function featureConfig(options: Record<string, unknown> | undefined, pluginId: string) {
  const saved = loadPluginConfig(options || {}, pluginId);
  return {
    math: enabled(saved.enableMath),
    mermaid: enabled(saved.enableMermaid),
    highlight: enabled(saved.enableHighlight),
  };
}
function styleTag(id: string, css: string): string {
  return `<style id="${id}">${css.replace(/<\\/style/gi, '<\\\\/style')}</style>`;
}

export default function init({ addHook, pluginId }: PluginInitContext): void {
  addHook('archive:header', pluginId, (html: string, extra?: { options?: Record<string, unknown> }) => {
    const config = featureConfig(extra?.options, pluginId);
    if (!config.math && !config.mermaid && !config.highlight) return html;
    let output = html;
    if (config.math && !output.includes(KATEX_STYLE_ID)) output += styleTag(KATEX_STYLE_ID, katexCss);
    if ((config.mermaid || config.highlight) && !output.includes(STYLE_ID)) output += styleTag(STYLE_ID, enhancerCss);
    return output;
  }, 1000);

  // Runs after the theme has produced the final article HTML. No Markdown
  // parsing/filtering hooks are registered by this plugin.
  addHook('archive:footer', pluginId, (html: string, extra?: { options?: Record<string, unknown> }) => {
    const config = featureConfig(extra?.options, pluginId);
    if (!config.math && !config.mermaid && !config.highlight) return html;
    const attrs = [
      config.math ? 'data-math="1"' : '',
      config.mermaid ? 'data-mermaid="1"' : '',
      config.highlight ? 'data-highlight="1"' : '',
    ].filter(Boolean).join(' ');
    return html + `<script src="/plugin-assets/${pluginId}/rehype-runtime.js" ${attrs} defer></script>`;
  }, 1000);
}
