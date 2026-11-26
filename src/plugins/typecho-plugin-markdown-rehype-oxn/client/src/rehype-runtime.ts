import { REFRACTOR_SUPPORTED_LANGUAGES } from '../lib/refractor-languages';
type RuntimeApi = { initialize(root: Element): void };
type BlurhashRuntimeApi = { initialize(root: Element, lazy: boolean): void };
declare global {
 interface Window {
  __oxnMarkdownEnhancer?: { initialize(): void };
  __oxnMarkdownMathRuntime?: RuntimeApi;
  __oxnMarkdownMermaidRuntime?: { mermaid: any };
  __oxnMarkdownHighlightRuntime?: RuntimeApi;
  __oxnMarkdownBlurhashRuntime?: BlurhashRuntimeApi;
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
  blurhash: entry?.dataset.blurhash === '1',
  lazyImages: entry?.dataset.lazyImages === '1',
  loadingMode: entry?.dataset.loading === 'full' ? 'full' : 'ondemand',
 };
 const rootSelector = '[itemprop="articleBody"]';
 const pending = new Map<string, Promise<void>>();
 const stylePending = new Map<string, Promise<void>>();
 const roots = () => Array.from(document.querySelectorAll(rootSelector));
 function loadStyle(file: string, id: string): Promise<void> {
  if (document.getElementById(id)) return Promise.resolve();
  const current = stylePending.get(file);
  if (current) return current;
  const promise = new Promise<void>((resolve, reject) => {
   const link = document.createElement('link');
   link.id = id;
   link.rel = 'stylesheet';
   link.href = '/__plugin-assets/typecho-plugin-markdown-rehype-oxn/' + file;
   link.onload = () => resolve();
   link.onerror = () => {
    link.remove();
    reject(new Error(file + ' failed to load'));
   };
   document.head.append(link);
  }).catch(error => {
   stylePending.delete(file);
   console.error('[Markdown Rehype OXN]', error);
  });
  stylePending.set(file, promise);
  return promise;
 }
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
 type DetectedFeatures = { math: boolean; mermaid: boolean; highlight: boolean; blurhash: boolean };
 function detectFeatures(root: Element, scanContent: boolean, scanBlurhash: boolean): DetectedFeatures {
  const detected: DetectedFeatures = {math:false,mermaid:false,highlight:false,blurhash:false};
  const mermaidSelector = 'pre > code.language-mermaid,pre.rin-mermaid_default,pre.rin-mermaid_dark';
  const highlightSelector = 'pre > code[class*="language-"]';
  const blurhashSelector = 'img[data-oxn-blurhash-src],img[src*="#blurhash="]';
  const inspectElement = (element: Element): void => {
   if (scanContent) {
    if (element.matches(mermaidSelector)) detected.mermaid = true;
    if (element.matches(highlightSelector) && Array.isArray(REFRACTOR_SUPPORTED_LANGUAGES)) {
     const code = element as HTMLElement;
     const match = /(?:^|\s)language-([\w+-]+)/.exec(code.className);
     const language = match?.[1]?.toLowerCase() || '';
     if (language && language !== 'mermaid' && language !== 'text' && language !== 'plain'
      && REFRACTOR_SUPPORTED_LANGUAGES.includes(language as typeof REFRACTOR_SUPPORTED_LANGUAGES[number])) {
      detected.highlight = true;
     }
    }
   }
   if (scanBlurhash && element.matches(blurhashSelector)) detected.blurhash = true;
  };
  inspectElement(root);

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  const excluded = 'pre,code,script,style,textarea,.katex,.tex2jax_ignore,[data-tex2jax-ignore]';
  const blockSelector = 'p,div,li,blockquote,td,th,h1,h2,h3,h4,h5,h6,section,article';
  let text = '';
  let previousBlock: Element | null = null;
  let node: Node | null;
  while ((node = walker.nextNode())) {
   if (node.nodeType === Node.ELEMENT_NODE) {
    inspectElement(node as Element);
    continue;
   }
   if (!scanContent) continue;
   const parent = node.parentElement;
   if (!parent || parent.closest(excluded)) {
    text += '\n';
    previousBlock = null;
    continue;
   }
   const block = parent.closest(blockSelector) || root;
   if (previousBlock && block !== previousBlock) text += '\n';
   text += node.textContent || '';
   previousBlock = block;
  }

  if (scanContent) {
   const isEscaped = (value: string, index: number): boolean => {
    let slashes = 0;
    for (let i = index - 1; i >= 0 && value[i] === '\\'; i--) slashes++;
    return slashes % 2 === 1;
   };
   const hasDollarPair = (value: string, start: number, width: number): boolean => {
    for (let i = start + width; i < value.length; i++) {
     if (value[i] !== '$' || isEscaped(value, i)) continue;
     if (width === 1 && value[i + 1] === '$') continue;
     if (width === 2 && value[i + 1] !== '$') continue;
     return true;
    }
    return false;
   };
   for (let i = 0; i < text.length; i++) {
    if (text[i] === '$' && !isEscaped(text, i)) {
     const width = text[i + 1] === '$' ? 2 : 1;
     if (hasDollarPair(text, i, width)) {
      detected.math = true;
      break;
     }
    }
    if (text[i] === '\\' && !isEscaped(text, i) && (text[i + 1] === '(' || text[i + 1] === '[')) {
     const closing = text[i + 1] === '(' ? '\\)' : '\\]';
     if (text.indexOf(closing, i + 2) !== -1) {
      detected.math = true;
      break;
     }
    }
   }
  }
  return detected;
 }
 let mermaidQueue: Promise<void> = Promise.resolve();
 let mermaidObserver: IntersectionObserver | null = null;
 function renderMermaidNode(node: HTMLElement, mermaid: any): void {
  if (node.dataset.processed === 'true' || node.dataset.oxnMermaidQueued === '1') return;
  node.dataset.oxnMermaidQueued = '1';
  mermaidQueue = mermaidQueue.then(async () => {
   const theme = node.classList.contains('rin-mermaid_dark') ? 'dark' : 'default';
   const code = node.querySelector('code.language-mermaid');
   const source = code?.textContent || '';
   if (!source.trim()) {
    delete node.dataset.oxnMermaidQueued;
    return;
   }
   mermaid.initialize({startOnLoad:false,theme});
   const renderId = 'oxn-mermaid-' + theme + '-' + Math.random().toString(36).slice(2);
   const result = await mermaid.render(renderId, source);
   const renderHost = document.createElement('div');
   renderHost.className = 'oxn-mermaid-render rin-mermaid_' + theme;
   renderHost.innerHTML = result.svg;
   node.insertAdjacentElement('afterend', renderHost);
   if (typeof result.bindFunctions === 'function') result.bindFunctions(renderHost);
   node.dataset.processed = 'true';
   delete node.dataset.oxnMermaidQueued;
  }).catch(error => {
   delete node.dataset.oxnMermaidQueued;
   console.error('[Markdown Rehype OXN] Mermaid render failed:',error);
  });
 }
 function observeMermaid(root: Element, mermaid: any): void {
  if (!('IntersectionObserver' in window)) {
   prepareAndRenderMermaid(root, mermaid);
   return;
  }
  if (!mermaidObserver) {
   mermaidObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
     if (!entry.isIntersecting) continue;
     const node = entry.target as HTMLElement;
     mermaidObserver?.unobserve(node);
     renderMermaidNode(node, mermaid);
    }
   }, {root:null,rootMargin:'300px 0px',threshold:0});
  }
  const selector = 'pre > code.language-mermaid,pre.rin-mermaid_default,pre.rin-mermaid_dark';
  const codes = Array.from(root.querySelectorAll<HTMLElement>(selector));
  if (root.matches(selector)) codes.unshift(root as HTMLElement);
  codes.forEach(code => {
   const original = code.matches('code.language-mermaid') ? code.parentElement as HTMLElement | null : code;
   if (!original) return;
   if (original.matches('pre.rin-mermaid_default,pre.rin-mermaid_dark')) {
    if (original.dataset.processed !== 'true' && original.dataset.oxnMermaidQueued !== '1') mermaidObserver?.observe(original);
    return;
   }
   if (original.dataset.oxnMermaidPrepared === '1') return;
   const source = code.textContent || '';
   const variant = (theme: 'default' | 'dark') => {
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
   const light = variant('default');
   const dark = variant('dark');
   original.replaceWith(light, dark);
   mermaidObserver?.observe(light);
   mermaidObserver?.observe(dark);
  });
 }
 function prepareAndRenderMermaid(root: Element, mermaid: any): void {
  const selector = 'pre > code.language-mermaid';
  const codes = Array.from(root.querySelectorAll<HTMLElement>(selector));
  if (root.matches(selector)) codes.unshift(root as HTMLElement);
  codes.forEach(code => {
   const original = code.parentElement as HTMLElement | null;
   if (!original || original.dataset.oxnMermaidPrepared === '1') return;
   const source = code.textContent || '';
   const variant = (theme: 'default' | 'dark') => {
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
   const light = variant('default');
   const dark = variant('dark');
   original.replaceWith(light, dark);
   renderMermaidNode(light, mermaid);
   renderMermaidNode(dark, mermaid);
  });
 }
 let scheduled = false;
 const pendingScopes = new Set<Element>();
 function rootsWithin(node: Element): Element[] {
  if (node.matches(rootSelector)) return [node];
  const nested = Array.from(node.querySelectorAll(rootSelector));
  if (nested.length) return nested;
  return node.closest(rootSelector) ? [node] : [];
 }
 function initialize(scope?: Element): void {
  const currentRoots = scope ? rootsWithin(scope) : roots();
  if (flags.loadingMode === 'full') {
   const targets = scope ? currentRoots : roots();
   if (flags.blurhash) {
    const blurhashTargets = scope ? [scope] : roots();
    void load('blurhash-runtime.js','__oxnMarkdownBlurhashRuntime').then(() => {
     const runtime = window.__oxnMarkdownBlurhashRuntime;
     if (runtime) blurhashTargets.forEach(root => runtime.initialize(root, flags.lazyImages));
    });
   }
   if (flags.math) {
    void loadStyle('katex-inline.css','oxn-markdown-rehype-katex')
     .then(() => load('math-runtime.js','__oxnMarkdownMathRuntime'))
     .then(() => {
      const runtime = window.__oxnMarkdownMathRuntime;
      if (runtime) targets.forEach(root => runtime.initialize(root));
     });
   }
   if (flags.mermaid) {
    void loadStyle('rehype-styles.css','oxn-markdown-rehype-styles')
     .then(() => load('mermaid-runtime.js','__oxnMarkdownMermaidRuntime'))
     .then(() => {
      const runtime = window.__oxnMarkdownMermaidRuntime;
      if (runtime) targets.forEach(root => observeMermaid(root,runtime.mermaid));
     });
   }
   if (flags.highlight) {
    void loadStyle('rehype-styles.css','oxn-markdown-rehype-styles')
     .then(() => load('highlight-runtime.js','__oxnMarkdownHighlightRuntime'))
     .then(() => {
      const runtime = window.__oxnMarkdownHighlightRuntime;
      if (runtime) targets.forEach(root => runtime.initialize(root));
     });
   }
   return;
  }

  const scanContent = flags.math || flags.mermaid || flags.highlight;
  for (const root of currentRoots) {
   const blurhashTarget = scope || root;
   const detected = detectFeatures(root, scanContent, flags.blurhash);
   if (flags.blurhash && detected.blurhash) {
    void load('blurhash-runtime.js','__oxnMarkdownBlurhashRuntime')
     .then(() => window.__oxnMarkdownBlurhashRuntime?.initialize(blurhashTarget, flags.lazyImages));
   }
   if (flags.math && detected.math) {
    void loadStyle('katex-inline.css','oxn-markdown-rehype-katex')
     .then(() => load('math-runtime.js','__oxnMarkdownMathRuntime'))
     .then(() => window.__oxnMarkdownMathRuntime?.initialize(root));
   }
   if (flags.mermaid && detected.mermaid) {
    void loadStyle('rehype-styles.css','oxn-markdown-rehype-styles')
     .then(() => load('mermaid-runtime.js','__oxnMarkdownMermaidRuntime'))
     .then(() => {
      const runtime = window.__oxnMarkdownMermaidRuntime;
      if (runtime) observeMermaid(root,runtime.mermaid);
     });
   }
   if (flags.highlight && detected.highlight) {
    void loadStyle('rehype-styles.css','oxn-markdown-rehype-styles')
     .then(() => load('highlight-runtime.js','__oxnMarkdownHighlightRuntime'))
     .then(() => window.__oxnMarkdownHighlightRuntime?.initialize(root));
   }
  }
 }
 function schedule(scopes?: Element[]): void {
  scopes?.forEach(scope => pendingScopes.add(scope));
  if (scheduled) return;
  scheduled = true;
  Promise.resolve().then(() => {
   scheduled = false;
   if (!pendingScopes.size) {
    initialize();
    return;
   }
   const scopesToProcess = Array.from(pendingScopes);
   pendingScopes.clear();
   scopesToProcess.forEach(scope => initialize(scope));
  });
 }
 {
  const observer = new MutationObserver(records => {
   const scopes = new Set<Element>();
   for (const record of records) {
    record.addedNodes.forEach(added => {
     const element = added.nodeType === Node.ELEMENT_NODE
      ? added as Element
      : added.parentElement;
     if (!element) return;
     rootsWithin(element).forEach(root => scopes.add(root));
    });
   }
   if (scopes.size) schedule(Array.from(scopes));
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
 }
 if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',() => initialize(),{once:true});
 else initialize();
 window.addEventListener('instantclick:newpage',() => schedule());
 window.__oxnMarkdownEnhancer = {initialize};
})();
