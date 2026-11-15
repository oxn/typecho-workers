// Rin-compatible article presentation runtime. This is intentionally a small,
// plugin-owned browser layer: parsing remains server-side and no theme renderer
// or long-lived DOM observer is required.
// @ts-ignore PrismJS is consumed as a browser bundle; its runtime package has no bundled types.
import Prism from 'prismjs';
// Prism grammars used by common Rin articles.
// @ts-ignore Prism language modules are JavaScript side-effect modules.
import 'prismjs/components/prism-markup';
// @ts-ignore
import 'prismjs/components/prism-css';
// @ts-ignore
import 'prismjs/components/prism-clike';
// @ts-ignore
import 'prismjs/components/prism-javascript';
// @ts-ignore
import 'prismjs/components/prism-jsx';
// @ts-ignore
import 'prismjs/components/prism-typescript';
// @ts-ignore
import 'prismjs/components/prism-tsx';
// @ts-ignore
import 'prismjs/components/prism-json';
// @ts-ignore
import 'prismjs/components/prism-bash';
// @ts-ignore
import 'prismjs/components/prism-shell-session';
// @ts-ignore
import 'prismjs/components/prism-python';
// @ts-ignore
import 'prismjs/components/prism-sql';
// @ts-ignore
import 'prismjs/components/prism-yaml';
// @ts-ignore
import 'prismjs/components/prism-markdown';
// @ts-ignore
import 'prismjs/components/prism-diff';
// @ts-ignore
import 'prismjs/components/prism-java';
// @ts-ignore
import 'prismjs/components/prism-go';
// @ts-ignore
import 'prismjs/components/prism-rust';
// @ts-ignore
import 'prismjs/components/prism-php';
// @ts-ignore
import 'prismjs/components/prism-c';
// @ts-ignore
import 'prismjs/components/prism-cpp';
// @ts-ignore
import 'prismjs/components/prism-csharp';
// @ts-ignore
import 'prismjs/components/prism-ruby';
// @ts-ignore
import 'prismjs/components/prism-powershell';
// @ts-ignore
import 'prismjs/components/prism-docker';
// @ts-ignore
import 'prismjs/components/prism-ini';
import { drawBlurhashToCanvas } from './lib/blurhash';

const STYLE_ID = 'rin-markdown-renderer-styles';
const ROOT_SELECTOR = '.toc-content';

const RIN_CSS = `
.toc-content{min-width:0;overflow-wrap:anywhere}
:is(.dark,[data-color-mode="dark"]) .toc-content{color:#d4d4d4}
.toc-content p{margin-top:.5rem;padding-top:.25rem;padding-bottom:.25rem;overflow-wrap:anywhere}
.toc-content h1,.toc-content h2,.toc-content h3,.toc-content h4,.toc-content h5,.toc-content h6{margin-top:1rem;font-weight:700;overflow-wrap:anywhere;scroll-margin-top:var(--header-scroll-offset,7rem)}
.toc-content h1{font-size:1.875rem;line-height:2.25rem}
.toc-content h2{font-size:1.5rem;line-height:2rem}
.toc-content h3{font-size:1.25rem;line-height:1.75rem}
.toc-content h4{font-size:1.125rem;line-height:1.75rem}
.toc-content h5{font-size:1rem;line-height:1.5rem}
.toc-content h6{font-size:.875rem;line-height:1.25rem}
.toc-content a{overflow-wrap:anywhere;color:#0686c8}
.dark .toc-content a,[data-color-mode="dark"] .toc-content a{color:#2590f1}
.toc-content a:hover{text-decoration:underline}
.toc-content blockquote:not(.markdown-alert){padding-left:1rem;border-left:4px solid #d1d5db;font-style:italic;color:#6b7280}
:is(.dark,[data-color-mode="dark"]) .toc-content blockquote:not(.markdown-alert){border-color:#6b7280;color:#9ca3af}
.markdown-alert{box-sizing:border-box;border-left:2px solid;border-width:2px;border-radius:.5rem;padding:1rem;margin:1rem 0;line-height:1.375}
.markdown-alert-title{display:flex;align-items:center;gap:.25rem;margin:0!important;font-weight:700;color:inherit;fill:currentColor}
.markdown-alert .octicon{width:.75rem;margin-right:.25rem;flex:none}
.markdown-alert-note{border-color:#a5b4fc;background:#e0e7ff;color:#818cf8}
.markdown-alert-warning{border-color:#fde047;background:#fef9c3;color:#facc15}
.markdown-alert-tip{border-color:#86efac;background:#dcfce7;color:#4ade80}
.markdown-alert-important{border-color:#d8b4fe;background:#f3e8ff;color:#c084fc}
.markdown-alert-caution{border-color:#fca5a5;background:#fee2e2;color:#f87171}
:is(.dark,[data-color-mode="dark"]) .markdown-alert-note{border-color:#312e81;background:#312e81;color:#a5b4fc}
:is(.dark,[data-color-mode="dark"]) .markdown-alert-warning{border-color:#713f12;background:#713f12;color:#fde047}
:is(.dark,[data-color-mode="dark"]) .markdown-alert-tip{border-color:#14532d;background:#14532d;color:#86efac}
:is(.dark,[data-color-mode="dark"]) .markdown-alert-important{border-color:#581c87;background:#581c87;color:#d8b4fe}
:is(.dark,[data-color-mode="dark"]) .markdown-alert-caution{border-color:#7f1d1d;background:#7f1d1d;color:#fca5a5}
.markdown-alert-title{margin-top:0!important;padding:0!important}
.toc-content em{margin-left:1px;margin-right:4px}
.toc-content strong{margin-left:1px;margin-right:1px}
.toc-content ul{list-style:disc;padding-left:1.25rem;margin-top:.5rem}
.toc-content ul.contains-task-list{list-style:none;padding-left:1.25rem}
.toc-content ol{list-style:decimal;padding-left:1.25rem}
.toc-content li{padding-left:.5rem;padding-top:.25rem;padding-bottom:.25rem}
.toc-content hr{margin:1rem 0}
.toc-content table{display:block;max-width:100%;overflow-x:auto}
.toc-content th{padding:.5rem 1rem;border:1px solid #6b7280;background:#4b5563}
.toc-content td{padding:.5rem 1rem;border:1px solid currentColor}
.toc-content sup,.toc-content sub{font-size:.75rem;margin-right:4px}
.toc-content section[data-footnotes]{margin-top:2rem}
.toc-content section[data-footnotes] ol{list-style:decimal;padding-left:2.5rem;font-size:.875rem;color:#6b7280}
.rin-iframe-wrapper{width:100%;margin:1rem 0}.rin-iframe{display:block;width:100%;min-height:400px;border-radius:.75rem;border:1px solid rgba(0,0,0,.1)}
:is(.dark,[data-color-mode="dark"]) .rin-iframe{border-color:rgba(255,255,255,.1)}
.toc-content :not(.rin-code-pre)>code{background:#eff1f3;height:24px;padding:2px 4px;border-radius:6px;margin:0 2px;color:#262626;font:13px ui-monospace,"SFMono-Regular","SF Mono",Consolas,"Liberation Mono",Menlo,monospace}
.dark .toc-content :not(.rin-code-pre)>code,[data-color-mode="dark"] .toc-content :not(.rin-code-pre)>code{background:#4a5061;color:#d4d4d4}
.rin-code-block{position:relative;min-width:0;max-width:100%;overflow:hidden}
.rin-code-block .rin-code-pre{box-sizing:border-box;margin:.5em 0;padding:1em;max-width:100%;overflow:auto;border-radius:.25rem;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;background:#f5f7ff;color:#5e6687;font:14px/1.375 Consolas,Menlo,Monaco,"Andale Mono WT","Andale Mono","Lucida Console","Lucida Sans Typewriter","DejaVu Sans Mono","Bitstream Vera Sans Mono","Liberation Mono","Nimbus Mono L","Courier New",Courier,monospace;tab-size:4}
.rin-code-block .rin-code-pre>code{font:14px/1.375 ui-monospace,"SFMono-Regular","SF Mono",Consolas,"Liberation Mono",Menlo,monospace;font-variant-ligatures:normal;font-feature-settings:"liga" 1}
:is(.dark,[data-color-mode="dark"]) .rin-code-block .rin-code-pre,:is(.dark,[data-color-mode="dark"]) .rin-code-block .rin-code-pre>code{background:#1e1e1e;color:#d4d4d4;font-size:14px;line-height:1.5}
.rin-code-block .token.comment,.rin-code-block .token.prolog,.rin-code-block .token.doctype,.rin-code-block .token.cdata{color:#898ea4}
.rin-code-block .token.punctuation{color:#5e6687}
.rin-code-block .token.operator,.rin-code-block .token.boolean,.rin-code-block .token.number{color:#c76b29}
.rin-code-block .token.property{color:#c08b30}
.rin-code-block .token.tag{color:#3d8fd1}
.rin-code-block .token.string,.rin-code-block .token.entity,.rin-code-block .token.url{color:#22a2c9}
.rin-code-block .token.selector{color:#6679cc}
.rin-code-block .token.attr-name{color:#c76b29}
.rin-code-block .token.attr-value,.rin-code-block .token.keyword,.rin-code-block .token.control,.rin-code-block .token.directive,.rin-code-block .token.unit{color:#ac9739}
.rin-code-block .token.statement,.rin-code-block .token.regex,.rin-code-block .token.atrule{color:#22a2c9}
.rin-code-block .token.placeholder,.rin-code-block .token.variable{color:#3d8fd1}
.rin-code-block .token.deleted{ text-decoration:line-through}
.rin-code-block .token.inserted{border-bottom:1px dotted #202746}
.rin-code-block .token.italic{font-style:italic}
.rin-code-block .token.important{font-weight:bold;color:#c94922}
.rin-code-block .token.bold{font-weight:bold}
:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.comment,:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.prolog{color:#6a9955}
:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.punctuation,:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.operator{color:#d4d4d4}
:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.doctype .token.doctype-tag{color:#569cd6}
:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.doctype .token.name,:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.property,:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.constant,:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.parameter,:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.variable{color:#9cdcfe}
:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.tag,:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.boolean,:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.entity,:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.keyword,:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.important{color:#569cd6}
:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.number,:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.symbol,:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.inserted,:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.unit{color:#b5cea8}
:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.selector{color:#d7ba7d}
:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.attr-name{color:#9cdcfe}
:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.string,:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.char,:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.builtin,:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.deleted,:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.atrule{color:#ce9178}
:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.operator.arrow,:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.entity{color:#569cd6}
:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.atrule.rule,:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.keyword.module,:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.keyword.control-flow{color:#c586c0}
:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.function{color:#dcdcaa}
:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.regex{color:#d16969}
:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.class-name{color:#4ec9b0}
:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.escape{color:#d7ba7d}
:is(.dark,[data-color-mode="dark"]) .rin-code-block .token.attr-value{color:#ce9178}
.rin-code-copy{position:absolute;top:4px;right:4px;padding:4px 8px;border:0;border-radius:6px;background:rgba(127,127,127,.16);color:inherit;font-size:14px;user-select:none;cursor:pointer;visibility:hidden}
.rin-code-block:hover .rin-code-copy,.rin-code-copy:focus{visibility:visible}
.rin-image-block{display:block;width:100%;text-align:center;margin:1rem 0}
.rin-image-inline{display:inline-block;vertical-align:middle;margin:0 .25rem}
.rin-image-inner{position:relative;display:inline-block;max-width:100%;overflow:hidden}
.rin-image-inner.is-rounded{border-radius:.75rem}
.rin-image-blurhash{position:absolute;inset:0;width:100%;height:100%;transform:scale(1.1);filter:blur(4px);pointer-events:none}
.rin-image-element{display:block;margin-left:auto;margin-right:auto;max-width:100%;height:auto;cursor:zoom-in;transition:opacity .2s}
.rin-image-element.is-rounded{border-radius:.75rem}
.rin-image-element.is-loading{opacity:0}
.rin-image-element.is-hidden{display:none}
.rin-image-placeholder{display:inline-flex;align-items:center;justify-content:center;background:#f5f5f5;color:#a3a3a3}
.dark .rin-image-placeholder,[data-color-mode="dark"] .rin-image-placeholder{background:#262626;color:#737373}
.rin-image-placeholder.is-block{min-width:12rem;min-height:8rem}
.rin-image-placeholder.is-inline{width:2rem;height:2rem}
.rin-lightbox{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.94);color:#fff}
.rin-lightbox.is-open{display:flex}
.rin-lightbox-image{max-width:calc(100vw - 64px);max-height:calc(100vh - 100px);object-fit:contain;transform-origin:center;transition:transform .12s}
.rin-lightbox-toolbar{position:absolute;top:12px;right:12px;left:12px;display:flex;align-items:center;justify-content:flex-end;gap:8px}
.rin-lightbox-toolbar button,.rin-lightbox-toolbar a,.rin-lightbox-nav{display:inline-flex;align-items:center;justify-content:center;min-width:36px;height:36px;padding:0 10px;border:1px solid rgba(255,255,255,.35);border-radius:6px;background:rgba(30,30,30,.65);color:#fff;text-decoration:none;cursor:pointer}
.rin-lightbox-counter{margin-right:auto;font-size:13px}
.rin-lightbox-nav{position:absolute;top:50%;transform:translateY(-50%);font-size:24px}
.rin-lightbox-prev{left:12px}.rin-lightbox-next{right:12px}
.rin-lightbox-caption{position:absolute;bottom:16px;left:16px;right:16px;text-align:center;font-size:14px;color:#ddd}
.toc-content .mermaid_dark{display:none}
.dark .toc-content .mermaid_default,[data-color-mode="dark"] .toc-content .mermaid_default{display:none}
.dark .toc-content .mermaid_dark,[data-color-mode="dark"] .toc-content .mermaid_dark{display:block}
`;

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = RIN_CSS;
  document.head.append(style);
}

function contentRoot(): Element | null {
  return document.querySelector(ROOT_SELECTOR);
}

function currentImages(): HTMLImageElement[] {
  const root = contentRoot();
  return root ? Array.from(root.querySelectorAll('img')) : [];
}

function showImagePlaceholder(inner: HTMLElement, alt: string, block: boolean): void {
  if (inner.querySelector('.rin-image-placeholder')) return;
  const placeholder = document.createElement('span');
  placeholder.className = 'rin-image-placeholder ' + (block ? 'is-block' : 'is-inline');
  if (alt) {
    placeholder.setAttribute('role', 'img');
    placeholder.setAttribute('aria-label', alt);
  }
  placeholder.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.6"/><circle cx="8.5" cy="9" r="1.5" fill="currentColor"/><path d="m4 17 5-5 3 3 3-4 5 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  inner.append(placeholder);
}

function enhanceImage(image: HTMLImageElement): void {
  if (image.dataset.rinImageEnhanced === '1') return;
  image.dataset.rinImageEnhanced = '1';
  const block = image.dataset.rinImageLayout === 'block';
  const rounded = block;
  const scale = block ? '0.75' : '0.5';
  const outer = document.createElement('span');
  outer.className = block ? 'rin-image-block' : 'rin-image-inline';
  const inner = document.createElement('span');
  inner.className = 'rin-image-inner' + (rounded ? ' is-rounded' : '');
  inner.style.zoom = scale;
  const width = Number.parseInt(image.getAttribute('width') || '', 10);
  const height = Number.parseInt(image.getAttribute('height') || '', 10);
  if (width > 0 && height > 0) inner.style.aspectRatio = width + ' / ' + height;

  const blurhash = image.dataset.blurhash || '';
  let canvas: HTMLCanvasElement | null = null;
  if (blurhash) {
    canvas = document.createElement('canvas');
    canvas.className = 'rin-image-blurhash' + (rounded ? ' is-rounded' : '');
    canvas.setAttribute('aria-hidden', 'true');
    try { drawBlurhashToCanvas(canvas, blurhash); }
    catch (error) { console.error('Failed to render blurhash', error); canvas = null; }
    if (canvas) inner.append(canvas);
  }

  image.classList.add('rin-image-element');
  if (rounded) image.classList.add('is-rounded');
  inner.append(image);
  outer.append(inner);
  image.before(outer);

  const loaded = () => {
    image.classList.remove('is-loading', 'is-hidden');
    inner.querySelector('.rin-image-placeholder')?.remove();
    canvas?.remove();
  };
  const failed = () => {
    image.classList.remove('is-loading');
    image.classList.add('is-hidden');
    if (!blurhash || !canvas) showImagePlaceholder(inner, image.alt || '', block);
  };
  image.addEventListener('load', loaded);
  image.addEventListener('error', failed);
  if (image.complete) {
    if (image.naturalWidth > 0) loaded();
    else failed();
  } else if (canvas) {
    image.classList.add('is-loading');
  }
}

function createLightbox(): {
  open: (image: HTMLImageElement) => void;
  close: () => void;
} {
  let root = document.querySelector<HTMLElement>('.rin-lightbox');
  if (!root) {
    root = document.createElement('div');
    root.className = 'rin-lightbox';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Image viewer');
    root.innerHTML = '<div class="rin-lightbox-toolbar"><span class="rin-lightbox-counter"></span><button type="button" data-action="zoom-out" aria-label="Zoom out">−</button><button type="button" data-action="zoom-in" aria-label="Zoom in">+</button><a data-action="download" href="#" download>Download</a><button type="button" data-action="close" aria-label="Close">×</button></div><button type="button" class="rin-lightbox-nav rin-lightbox-prev" data-action="prev" aria-label="Previous image">‹</button><img class="rin-lightbox-image" alt=""><button type="button" class="rin-lightbox-nav rin-lightbox-next" data-action="next" aria-label="Next image">›</button><div class="rin-lightbox-caption"></div>';
    document.body.append(root);
  }
  const image = root.querySelector<HTMLImageElement>('.rin-lightbox-image')!;
  const counter = root.querySelector<HTMLElement>('.rin-lightbox-counter')!;
  const caption = root.querySelector<HTMLElement>('.rin-lightbox-caption')!;
  const download = root.querySelector<HTMLAnchorElement>('[data-action="download"]')!;
  let activeIndex = -1;
  let zoom = 1;
  const slides = () => currentImages().filter(item => item.getAttribute('src'));
  const render = () => {
    const list = slides();
    if (activeIndex < 0 || activeIndex >= list.length) return;
    const active = list[activeIndex];
    image.src = active.currentSrc || active.src;
    image.alt = active.alt || '';
    image.style.transform = 'scale(' + zoom + ')';
    counter.textContent = (activeIndex + 1) + ' / ' + list.length;
    caption.textContent = active.alt || '';
    const src = active.currentSrc || active.src;
    download.href = src;
    download.download = src.split('/').pop()?.split('?')[0] || 'image';
    root!.querySelector<HTMLElement>('.rin-lightbox-prev')!.style.visibility = list.length > 1 ? 'visible' : 'hidden';
    root!.querySelector<HTMLElement>('.rin-lightbox-next')!.style.visibility = list.length > 1 ? 'visible' : 'hidden';
  };
  const close = () => {
    activeIndex = -1;
    root!.classList.remove('is-open');
    image.removeAttribute('src');
    document.body.style.removeProperty('overflow');
  };
  root.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (target === root) { close(); return; }
    if (action === 'close') close();
    else if (action === 'zoom-in') { zoom = Math.min(zoom + .25, 4); render(); }
    else if (action === 'zoom-out') { zoom = Math.max(zoom - .25, 1); render(); }
    else if (action === 'next') { activeIndex = (activeIndex + 1) % slides().length; zoom = 1; render(); }
    else if (action === 'prev') { activeIndex = (activeIndex - 1 + slides().length) % slides().length; zoom = 1; render(); }
  });
  root.addEventListener('wheel', event => {
    if (!root!.classList.contains('is-open')) return;
    if (event.deltaY < 0) zoom = Math.min(zoom + .1, 4);
    else zoom = Math.max(zoom - .1, 1);
    render();
  }, { passive: true });
  document.addEventListener('keydown', event => {
    if (!root!.classList.contains('is-open')) return;
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowRight' && slides().length > 1) { activeIndex = (activeIndex + 1) % slides().length; zoom = 1; render(); }
    else if (event.key === 'ArrowLeft' && slides().length > 1) { activeIndex = (activeIndex - 1 + slides().length) % slides().length; zoom = 1; render(); }
  });
  return {
    open: selected => {
      const list = slides();
      activeIndex = list.indexOf(selected);
      if (activeIndex < 0) return;
      zoom = 1;
      render();
      root!.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    },
    close,
  };
}

function enhanceCodeBlocks(root: Element): void {
  root.querySelectorAll<HTMLElement>('.rin-code-pre > code').forEach(code => {
    const pre = code.parentElement;
    if (!pre || pre.closest('.mermaid_default,.mermaid_dark') || pre.dataset.rinCodeEnhanced === '1') return;
    pre.dataset.rinCodeEnhanced = '1';
    const wrapper = document.createElement('div');
    wrapper.className = 'rin-code-block relative group';
    pre.before(wrapper);
    wrapper.append(pre);
    const languageClass = Array.from(code.classList).find(name => name.startsWith('language-'));
    if (languageClass && languageClass !== 'language-text' && languageClass !== 'language-plain') {
      try { Prism.highlightElement(code); }
      catch (error) { console.error('Rin Prism highlighting failed:', error); }
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rin-code-copy';
    button.textContent = 'Copy';
    button.addEventListener('click', async () => {
      const value = code.textContent || '';
      let copied = false;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(value);
          copied = true;
        } else {
          const textarea = document.createElement('textarea');
          textarea.value = value;
          textarea.setAttribute('readonly', '');
          textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
          document.body.append(textarea);
          textarea.select();
          copied = document.execCommand('copy');
          textarea.remove();
        }
      } catch (error) { console.error('Markdown code copy failed:', error); }
      button.textContent = copied ? 'Copied!' : 'Copy failed';
      window.setTimeout(() => { button.textContent = 'Copy'; }, 2000);
    });
    wrapper.append(button);
  });
}

let lightbox: ReturnType<typeof createLightbox> | null = null;
function initialize(): void {
  const root = contentRoot();
  if (!root) return;
  installStyles();
  lightbox = lightbox || createLightbox();
  root.querySelectorAll<HTMLImageElement>('img').forEach(enhanceImage);
  enhanceCodeBlocks(root);
  if (root.dataset.rinImageClickBound !== '1') {
    root.dataset.rinImageClickBound = '1';
    root.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      const image = target.closest('img.rin-image-element') as HTMLImageElement | null;
      if (image) lightbox?.open(image);
    });
  }
}

const api = { initialize };
(window as any).__rinMarkdownRuntime = api;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
else initialize();
window.addEventListener('instantclick:newpage', initialize);
