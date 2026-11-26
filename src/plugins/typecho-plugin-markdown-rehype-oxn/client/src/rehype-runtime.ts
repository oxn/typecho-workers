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
  // Only source blocks need scheduling. The light/dark variants created by
  // renderMermaid are already owned by the current render pass; observing
  // them as fresh Mermaid work causes repeated scans while SVGs are inserted.
  return !!root.querySelector('pre:not([data-oxn-mermaid-prepared="1"]) > code.language-mermaid');
 }
 function hasHighlight(root: Element): boolean {
  return !!root.querySelector('pre > code[class*="language-"]:not(.language-mermaid)');
 }
 let mermaidQueue: Promise<void> = Promise.resolve();
 async function renderMermaid(root: Element, mermaid: any): Promise<void> {
  // Discover Mermaid source in the already-rendered article DOM. Keep a copy
  // of the original pre/code subtree for existing copy controls, while using
  // source-only measurement nodes for the original Mermaid.run() renderer.
  root.querySelectorAll<HTMLElement>('pre > code.language-mermaid').forEach(code => {
   const original = code.parentElement as HTMLElement | null;
   if (!original || original.dataset.oxnMermaidPrepared === '1') return;
   const source = code.textContent || '';
   if (!source.trim()) return;
   const makeVariant = (theme: 'default' | 'dark') => {
    const pre = original.cloneNode(true) as HTMLElement;
    pre.removeAttribute('id');
    pre.removeAttribute('data-processed');
    pre.classList.add('rin-mermaid_' + theme);
    pre.dataset.oxnMermaidPrepared = '1';
    const clonedCode = pre.querySelector('code.language-mermaid');
    if (clonedCode) {
     clonedCode.textContent = source;
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
   original.replaceWith(makeVariant('default'), makeVariant('dark'));
  });

  const light = Array.from(root.querySelectorAll<HTMLElement>('pre.rin-mermaid_default:not([data-processed])'));
  const dark = Array.from(root.querySelectorAll<HTMLElement>('pre.rin-mermaid_dark:not([data-processed])'));

  const renderVariant = async (targets: HTMLElement[], theme: 'default' | 'dark') => {
   if (!targets.length) return;
   const measurements = targets.map(target => {
    const code = target.querySelector('code.language-mermaid');
    const source = code?.textContent || '';
    const measure = document.createElement('pre');
    measure.className = target.className;
    measure.textContent = source;
    measure.dataset.oxnMermaidMeasure = '1';
    return measure;
   });
   root.append(...measurements);

   const restore: Array<{
    node: HTMLElement;
    display: string;
    displayPriority: string;
    visibility: string;
    visibilityPriority: string;
   }> = [];
   measurements.forEach(node => {
    if (getComputedStyle(node).display !== 'none') return;
    restore.push({
     node,
     display: node.style.getPropertyValue('display'),
     displayPriority: node.style.getPropertyPriority('display'),
     visibility: node.style.getPropertyValue('visibility'),
     visibilityPriority: node.style.getPropertyPriority('visibility'),
    });
    node.style.setProperty('display', 'block', 'important');
    node.style.setProperty('visibility', 'hidden', 'important');
   });
   try {
    // Match the original plugin: initialize one theme, then let Mermaid.run
    // measure and render the source-only nodes itself.
    mermaid.initialize({startOnLoad:false,theme});
    await mermaid.run({nodes:measurements});
    measurements.forEach((measure, index) => {
     const svg = measure.querySelector('svg');
     if (svg) targets[index].append(svg);
     targets[index].dataset.processed = 'true';
    });
   } finally {
    restore.forEach(item => {
     if (item.display) item.node.style.setProperty('display', item.display, item.displayPriority);
     else item.node.style.removeProperty('display');
     if (item.visibility) item.node.style.setProperty('visibility', item.visibility, item.visibilityPriority);
     else item.node.style.removeProperty('visibility');
    });
    measurements.forEach(node => node.remove());
   }
  };

  // Mermaid has global configuration/state; keep the original light-then-dark
  // sequence serialized across roots and InstantClick navigations.
  mermaidQueue = mermaidQueue.then(async () => {
   await renderVariant(light, 'default');
   await renderVariant(dark, 'dark');
  }).catch(error => {
   console.error('[Markdown Rehype OXN] Mermaid render failed:', error);
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
