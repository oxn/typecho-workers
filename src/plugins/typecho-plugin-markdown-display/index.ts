import { loadPluginConfig } from 'typecho/plugin-sdk';
import type { PluginInitContext } from 'typecho/plugin-sdk';

type DisplayConfig = {
  enableMath: boolean;
  enableMermaid: boolean;
  enableCodeHighlight: boolean;
};

function enabled(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || value === '1' || value === 'true';
}

function getConfig(options?: Record<string, unknown>): DisplayConfig {
  const raw = loadPluginConfig((options || {}) as Record<string, any>, 'typecho-plugin-markdown-display');
  return {
    enableMath: enabled(raw.enableMath, true),
    enableMermaid: enabled(raw.enableMermaid, true),
    enableCodeHighlight: enabled(raw.enableCodeHighlight, true),
  };
}

function buildHead(config: DisplayConfig): string {
  const html: string[] = [];
  if (config.enableMath) {
    html.push('<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css">');
  }
  if (config.enableCodeHighlight) {
    html.push('<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.11.1/styles/github.min.css">');
    html.push('<link rel="stylesheet" media="(prefers-color-scheme: dark)" href="https://cdn.jsdelivr.net/npm/highlight.js@11.11.1/styles/github-dark.min.css">');
  }
  if (config.enableMath || config.enableMermaid || config.enableCodeHighlight) {
    html.push('<style data-typecho-markdown-display>.typecho-md-enhance-diagram{max-width:100%;overflow-x:auto;margin:1.25em 0;text-align:center}.typecho-md-enhance-diagram svg{max-width:100%;height:auto}</style>');
  }
  return html.join('');
}

function buildClientScript(config: DisplayConfig): string {
  const lines = [
    '<script data-typecho-markdown-display data-no-instant>',
    '(function () {',
    '  var flags = ' + JSON.stringify(config).replace(/</g, '\\u003c') + ';',
    '  if (!flags.enableMath && !flags.enableMermaid && !flags.enableCodeHighlight) return;',
    '  var sources = {',
    "    katex: 'https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js',",
    "    autoRender: 'https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/contrib/auto-render.min.js',",
    "    mermaid: 'https://cdn.jsdelivr.net/npm/mermaid@11.12.0/dist/mermaid.min.js',",
    "    highlight: 'https://cdn.jsdelivr.net/npm/highlight.js@11.11.1/lib/common.min.js'",
    '  };',
    '  function load(key, test) {',
    '    if (test()) return Promise.resolve();',
    "    var cacheKey = '__typechoMarkdownLoad_' + key;",
    '    if (window[cacheKey]) return window[cacheKey];',
    '    window[cacheKey] = new Promise(function (resolve, reject) {',
    '      var script = document.createElement("script");',
    '      script.src = sources[key]; script.async = true;',
    '      script.onload = resolve;',
    '      script.onerror = function () { reject(new Error("Failed to load " + key)); };',
    '      document.head.append(script);',
    '    });',
    '    return window[cacheKey];',
    '  }',
    '  function getRoots() {',
    '    var nodes = Array.from(document.querySelectorAll(\'[itemprop="articleBody"], .entry-content, .post-content, .article-content, .markdown-body, .prose, article\'));',
    '    return nodes.filter(function (node, index) {',
    '      return !nodes.some(function (other, otherIndex) { return otherIndex !== index && other.contains(node); });',
    '    });',
    '  }',
    '  var mermaidReady = false;',
    '  async function renderPage() {',
    '    var contentRoots = getRoots();',
    '    if (!contentRoots.length) return;',
    '    var tasks = [];',
    '    if (flags.enableMath) tasks.push((async function () {',
    '      await load("katex", function () { return !!window.katex; });',
    '      await load("autoRender", function () { return typeof window.renderMathInElement === "function"; });',
    '      contentRoots.forEach(function (root) {',
    '        try { window.renderMathInElement(root, {',
    '          delimiters: [',
    '            {left: "$$", right: "$$", display: true},',
    '            {left: "\\\\[", right: "\\\\]", display: true},',
    '            {left: "\\\\(", right: "\\\\)", display: false},',
    '            {left: "$", right: "$", display: false}',
    '          ], throwOnError: false, ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"]',
    '        }); } catch (error) { console.warn("[markdown-display] Math rendering failed", error); }',
    '      });',
    '    })());',
    '    if (flags.enableCodeHighlight) tasks.push((async function () {',
    '      await load("highlight", function () { return !!window.hljs; });',
    '      contentRoots.forEach(function (root) {',
    '        root.querySelectorAll(\'pre code[class*="language-"], pre code[class*="lang-"]\').forEach(function (code) {',
    '          if (code.dataset.typechoHighlightReady === "1") return;',
    '          code.dataset.typechoHighlightReady = "1";',
    '          try { window.hljs.highlightElement(code); } catch (error) { console.warn("[markdown-display] Code highlighting failed", error); }',
    '        });',
    '      });',
    '    })());',
    '    if (flags.enableMermaid) tasks.push((async function () {',
    '      await load("mermaid", function () { return !!window.mermaid; });',
    '      if (!mermaidReady) {',
    '        window.mermaid.initialize({startOnLoad: false, securityLevel: "strict", theme: document.documentElement.classList.contains("dark") ? "dark" : "default"});',
    '        mermaidReady = true;',
    '      }',
    '      var diagrams = [];',
    '      contentRoots.forEach(function (root) {',
    '        root.querySelectorAll("pre code.language-mermaid, pre code.lang-mermaid").forEach(function (code) {',
    '          var pre = code.closest("pre");',
    '          if (!pre || pre.dataset.typechoMermaidReady === "1") return;',
    '          pre.dataset.typechoMermaidReady = "1";',
    '          var diagram = document.createElement("div");',
    '          diagram.className = "mermaid typecho-md-enhance-diagram";',
    '          diagram.textContent = code.textContent || "";',
    '          pre.after(diagram); diagrams.push(diagram);',
    '        });',
    '      });',
    '      if (diagrams.length) {',
    '        try { await window.mermaid.run({nodes: diagrams}); }',
    '        catch (error) { console.warn("[markdown-display] Mermaid rendering failed", error); }',
    '      }',
    '    })());',
    '    await Promise.allSettled(tasks);',
    '  }',
    '  var scheduled = false;',
    '  function schedule() {',
    '    if (scheduled) return;',
    '    scheduled = true;',
    '    requestAnimationFrame(function () { scheduled = false; renderPage(); });',
    '  }',
    '  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", schedule, {once: true});',
    '  else schedule();',
    '  window.addEventListener("instantclick:newpage", schedule);',
    '})();',
    '</script>'
  ];
  return lines.join('\n');
}

export default function init({ addHook, pluginId }: PluginInitContext): void {
  addHook(
    'archive:header',
    pluginId,
    (html: string, extra?: { options?: Record<string, unknown>; pageContext?: { pageType?: string } }) => {
      const pageType = extra?.pageContext?.pageType;
      if (pageType !== 'post' && pageType !== 'page') return html;
      return html + buildHead(getConfig(extra?.options));
    },
  );

  addHook(
    'archive:footer',
    pluginId,
    (html: string, extra?: { options?: Record<string, unknown>; pageContext?: { pageType?: string } }) => {
      const pageType = extra?.pageContext?.pageType;
      if (pageType !== 'post' && pageType !== 'page') return html;
      const config = getConfig(extra?.options);
      if (!config.enableMath && !config.enableMermaid && !config.enableCodeHighlight) return html;
      return html + buildClientScript(config);
    },
  );
}
