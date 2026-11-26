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
    // Keep the original pre/code subtree intact for theme-owned copy controls.
    // Mermaid SVG is appended beside the hidden source code, never parsed from
    // the whole pre element (which may also contain buttons or other controls).
    const pre = original.cloneNode(true) as HTMLElement;
    pre.removeAttribute('id');
    pre.removeAttribute('data-processed');
    pre.classList.add('rin-mermaid_' + theme);
    pre.dataset.oxnMermaidPrepared = '1';
    const clonedCode = pre.querySelector('code.language-mermaid');
    if (clonedCode) {
     clonedCode.textContent = source;
     // Visually hide the source while keeping its text readable to existing
     // copy handlers that read code.innerText.
     clonedCode.style.position = 'absolute';
     clonedCode.style.width = '1px';
     clonedCode.style.height = '1px';
     clonedCode.style.padding = '0';
     clonedCode.style.margin = '-1px';
     clonedCode.style.overflow = 'hidden';
     clonedCode.style.clipPath = 'inset(50%)';
     clonedCode.style.whiteSpace = 'pre';
     clonedCode.setAttribute('aria-hidden', 'true');
    }
    return pre;
   };
   original.replaceWith(variant('default'), variant('dark'));
  });

  const light = Array.from(root.querySelectorAll<HTMLElement>('pre.rin-mermaid_default:not([data-processed]):not([data-oxn-mermaid-queued])'));
  const dark = Array.from(root.querySelectorAll<HTMLElement>('pre.rin-mermaid_dark:not([data-processed]):not([data-oxn-mermaid-queued])'));
  [...light, ...dark].forEach(node => { node.dataset.oxnMermaidQueued = '1'; });

  mermaidQueue = mermaidQueue.then(async () => {
   const renderVariant = async (nodes: HTMLElement[], theme: 'default' | 'dark') => {
    if (!nodes.length) return;
    mermaid.initialize({startOnLoad:false,theme});
    for (const node of nodes) {
     const code = node.querySelector('code.language-mermaid');
     const source = code?.textContent || '';
     if (!source.trim()) {
      delete node.dataset.oxnMermaidQueued;
      continue;
     }
     const renderId = 'oxn-mermaid-' + theme + '-' + Math.random().toString(36).slice(2);
     try {
      // render() receives only the diagram source. mermaid.run() reads the
      // entire target element and can accidentally include theme controls.
      const result = await mermaid.render(renderId, source);
      node.insertAdjacentHTML('beforeend', result.svg);
      if (typeof result.bindFunctions === 'function') result.bindFunctions(node);
      node.dataset.processed = 'true';
      delete node.dataset.oxnMermaidQueued;
     } catch (error) {
      delete node.dataset.oxnMermaidQueued;
      console.error('[Markdown Rehype OXN] Mermaid diagram failed:', error);
     }
    }
   };
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
