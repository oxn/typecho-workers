type RuntimeApi = { initialize(root: Element): void };
declare global {
 interface Window {
  __oxnMarkdownEnhancer?: { initialize(): void };
  __oxnMarkdownMathRuntime?: RuntimeApi;
  __oxnMarkdownMermaidRuntime?: { mermaid: any };
  __oxnMarkdownHighlightRuntime?: RuntimeApi;
 }
}
(() => {
 if (window.__oxnMarkdownEnhancer) {
  window.__oxnMarkdownEnhancer.initialize();
  return;
 }
 const entry = document.currentScript as HTMLScriptElement | null;
 const flags = {
  math: entry?.dataset.math === '1',
  mermaid: entry?.dataset.mermaid === '1',
  highlight: entry?.dataset.highlight === '1',
 };
 const rootSelector = '.warm-prose, .toc-content, [itemprop="articleBody"]';
 const pending = new Map<string, Promise<void>>();
 const roots = () => Array.from(document.querySelectorAll(rootSelector));
 function load(file: string, globalName: keyof Window): Promise<void> {
  if (window[globalName]) return Promise.resolve();
  const current = pending.get(file);
  if (current) return current;
  const promise = new Promise<void>((resolve, reject) => {
   const script = document.createElement('script');
   script.src = '/__plugin-assets/typecho-plugin-markdown-rehype-oxn/' + file;
   script.async = true;
   script.onload = () => window[globalName] ? resolve() : reject(new Error(file + ' did not expose runtime'));
   script.onerror = () => reject(new Error(file + ' failed to load'));
   document.head.append(script);
  }).catch(error => {
   pending.delete(file);
   console.error('[Markdown Rehype OXN]', error);
  });
  pending.set(file, promise);
  return promise;
 }
 function hasMath(root: Element): boolean {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const pattern = /(?:\$\$|\$[^\n$]+\$|\\\(|\\\[)/;
  let node: Node | null;
  while ((node = walker.nextNode())) {
   const parent = node.parentElement;
   if (!parent || parent.closest('pre,code,script,style,textarea,.katex,.tex2jax_ignore,[data-tex2jax-ignore]')) continue;
   if (pattern.test(node.textContent || '')) return true;
  }
  return false;
 }
 function hasMermaid(root: Element): boolean {
  return !!root.querySelector('pre > code.language-mermaid,pre.rin-mermaid_default,pre.rin-mermaid_dark');
 }
 function hasHighlight(root: Element): boolean {
  return !!root.querySelector('pre > code[class*="language-"]:not(.language-mermaid)');
 }
 let mermaidQueue: Promise<void> = Promise.resolve();
 async function renderMermaid(root: Element, mermaid: any): Promise<void> {
  root.querySelectorAll<HTMLElement>('pre > code.language-mermaid').forEach(code => {
   const original = code.parentElement as HTMLElement | null;
   if (!original || original.dataset.oxnMermaidPrepared === '1') return;
   const source = code.textContent || '';
   const variant = (theme: 'default' | 'dark') => {
    const pre = original.cloneNode(false) as HTMLElement;
    pre.removeAttribute('id');
    pre.removeAttribute('data-processed');
    pre.classList.add('mermaid', 'rin-mermaid_' + theme);
    pre.dataset.oxnMermaidPrepared = '1';
    pre.textContent = source;
    return pre;
   };
   original.replaceWith(variant('default'), variant('dark'));
  });
  const light = Array.from(root.querySelectorAll<HTMLElement>('pre.rin-mermaid_default:not([data-processed]):not([data-oxn-mermaid-queued])'));
  const dark = Array.from(root.querySelectorAll<HTMLElement>('pre.rin-mermaid_dark:not([data-processed]):not([data-oxn-mermaid-queued])'));
  [...light, ...dark].forEach(node => { node.dataset.oxnMermaidQueued = '1'; });
  const renderVariant = async (nodes: HTMLElement[], theme: 'default' | 'dark') => {
   if (!nodes.length) return;
   const restore: Array<{node:HTMLElement;display:string;displayPriority:string;visibility:string;visibilityPriority:string}> = [];
   nodes.forEach(node => {
    if (getComputedStyle(node).display !== 'none') return;
    restore.push({node,display:node.style.getPropertyValue('display'),displayPriority:node.style.getPropertyPriority('display'),visibility:node.style.getPropertyValue('visibility'),visibilityPriority:node.style.getPropertyPriority('visibility')});
    node.style.setProperty('display','block','important');
    node.style.setProperty('visibility','hidden','important');
   });
   try {
    mermaid.initialize({startOnLoad:false,theme});
    await mermaid.run({nodes});
   } finally {
    restore.forEach(item => {
     if (item.display) item.node.style.setProperty('display',item.display,item.displayPriority); else item.node.style.removeProperty('display');
     if (item.visibility) item.node.style.setProperty('visibility',item.visibility,item.visibilityPriority); else item.node.style.removeProperty('visibility');
    });
   }
  };
  mermaidQueue = mermaidQueue.then(async () => {
   await renderVariant(light,'default');
   await renderVariant(dark,'dark');
  }).catch(error => {
   [...light, ...dark].forEach(node => { delete node.dataset.oxnMermaidQueued; });
   console.error('[Markdown Rehype OXN] Mermaid render failed:',error);
  });
  await mermaidQueue;
 }
 let scheduled = false;
 function initialize(): void {
  for (const root of roots()) {
   if (flags.math && hasMath(root)) void load('math-runtime.js','__oxnMarkdownMathRuntime').then(() => window.__oxnMarkdownMathRuntime?.initialize(root));
   if (flags.mermaid && hasMermaid(root)) void load('mermaid-runtime.js','__oxnMarkdownMermaidRuntime').then(() => {
    const runtime = window.__oxnMarkdownMermaidRuntime;
    if (runtime) void renderMermaid(root,runtime.mermaid);
   });
   if (flags.highlight && hasHighlight(root)) void load('highlight-runtime.js','__oxnMarkdownHighlightRuntime').then(() => window.__oxnMarkdownHighlightRuntime?.initialize(root));
  }
 }
 function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  Promise.resolve().then(() => { scheduled = false; initialize(); });
 }
 const observer = new MutationObserver(records => {
  if (records.some(record => record.addedNodes.length)) schedule();
 });
 observer.observe(document.documentElement,{childList:true,subtree:true});
 if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',initialize,{once:true});
 else initialize();
 window.addEventListener('instantclick:newpage',schedule);
 window.__oxnMarkdownEnhancer = {initialize};
})();
