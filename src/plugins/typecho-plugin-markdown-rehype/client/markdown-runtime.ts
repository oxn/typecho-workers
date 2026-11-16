// Initializes shared Markdown styles and on-demand presentation loaders.
const STYLESHEET_ID = 'rin-markdown-renderer-stylesheet';
const ROOT_SELECTOR = '.toc-content';
function installStyles(): void {
  if (document.getElementById(STYLESHEET_ID)) return;
  const link = document.createElement('link');
  link.id = STYLESHEET_ID;
  link.rel = 'stylesheet';
  link.href = '/plugin-assets/typecho-plugin-markdown-rehype/markdown-styles.css';
  document.head.append(link);
}

function contentRoots(): Element[] {
  return Array.from(document.querySelectorAll(ROOT_SELECTOR));
}

const runtimeLoads = new Map<string, Promise<void>>();
function loadRuntime(filename: string, globalName: string): Promise<void> {
  const roots = contentRoots();
  if (!roots.length) return Promise.resolve();
  const existing = (window as any)[globalName];
  if (existing) {
    roots.forEach(root => existing.initialize(root));
    return Promise.resolve();
  }
  const current = runtimeLoads.get(filename);
  if (current) return current;
  const loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/plugin-assets/typecho-plugin-markdown-rehype/' + filename;
    script.async = true;
    script.onload = () => {
      const runtime = (window as any)[globalName];
      if (!runtime) {
        reject(new Error(filename + ' did not expose its runtime'));
        return;
      }
      contentRoots().forEach(latestRoot => runtime.initialize(latestRoot));
      resolve();
    };
    script.onerror = () => reject(new Error(filename + ' failed to load'));
    document.head.append(script);
  }).catch(error => {
    runtimeLoads.delete(filename);
    console.error('Rin Markdown runtime failed:', error);
  });
  runtimeLoads.set(filename, loading);
  return loading;
}

function initialize(): void {
  const roots = contentRoots();
  if (!roots.length) return;
  installStyles();
  if (roots.some(root => root.querySelector('img'))) {
    void loadRuntime('markdown-image-runtime.js', '__rinMarkdownImageRuntime');
  }
  if (roots.some(root => root.querySelector('.rin-code-pre > code'))) {
    void loadRuntime('markdown-code-runtime.js', '__rinMarkdownCodeRuntime');
  }
}

const api = { initialize };
(window as any).__rinMarkdownRuntime = api;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
else initialize();
window.addEventListener('instantclick:newpage', initialize);
