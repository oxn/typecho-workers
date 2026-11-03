import katex from 'katex';
import './markdown.css';

declare global {
  interface Window {
    DOMPurify?: {
      sanitize: (dirty: string, options?: Record<string, unknown>) => string;
    };
  }
}

const CONTENT_ROOTS = [
  '.warm-prose', '.note-body', '#wmd-preview', '.wmd-preview',
  '.markdown-body', '.post-content', '.entry-content', '.typecho-content',
];
const ROOT_SELECTOR = CONTENT_ROOTS.join(', ');
const scopedSelector = (selector: string) =>
  CONTENT_ROOTS.map((root) => root + ' ' + selector).join(', ');

function safeHtml(html: string): string | null {
  if (!window.DOMPurify) return null;
  return window.DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true },
  });
}

function renderFormula(node: HTMLElement, tex: string, displayMode: boolean): boolean {
  try {
    const html = katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      trust: false,
      strict: 'ignore',
      output: 'mathml',
    });
    const safe = safeHtml(html);
    if (safe === null) return false;
    node.innerHTML = safe;
    node.dataset.markdownMathRendered = '1';
    node.classList.add(displayMode ? 'markdown-math-block' : 'markdown-math-inline');
    return true;
  } catch {
    return false;
  }
}

function renderCodeMath(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(scopedSelector('pre code.language-math')).forEach((code) => {
    if (code.dataset.markdownMathRendered === '1') return;
    const pre = code.closest('pre');
    if (!pre) return;
    const host = document.createElement('div');
    host.className = 'markdown-math-block';
    if (renderFormula(host, code.textContent || '', true)) {
      pre.insertAdjacentElement('beforebegin', host);
      pre.hidden = true;
    }
  });

  root.querySelectorAll<HTMLElement>(scopedSelector('code:not(pre code)')).forEach((code) => {
    if (code.dataset.markdownMathRendered === '1') return;
    const match = /^\$([\s\S]+)\$$/.exec(code.textContent || '');
    if (!match || !match[1].trim()) return;
    const host = document.createElement('span');
    if (renderFormula(host, match[1], false)) code.replaceWith(host);
  });
}

function renderTextMath(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.note-body, #wmd-preview, .wmd-preview').forEach((container) => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (!node.nodeValue?.trim() || node.parentElement?.closest('pre, code, script, style, textarea')) continue;
      nodes.push(node);
    }

    nodes.forEach((node) => {
      const value = node.nodeValue || '';
      const expression = /\\\\(true+?\\\\)|(?<!\\)\$(?!\$)([^$\n]+?)(?<!\\)\$(?!\$)/g;
      let match: RegExpExecArray | null;
      let cursor = 0;
      let changed = false;
      const fragment = document.createDocumentFragment();

      while ((match = expression.exec(value))) {
        const tex = (match[1] ?? match[2] ?? '').trim();
        if (!tex) continue;
        if (match.index > cursor) fragment.appendChild(document.createTextNode(value.slice(cursor, match.index)));
        const span = document.createElement('span');
        if (renderFormula(span, tex, false)) {
          fragment.appendChild(span);
          cursor = match.index + match[0].length;
          changed = true;
        } else {
          fragment.appendChild(document.createTextNode(match[0]));
          cursor = match.index + match[0].length;
        }
      }

      if (changed) {
        if (cursor < value.length) fragment.appendChild(document.createTextNode(value.slice(cursor)));
        node.parentNode?.replaceChild(fragment, node);
      }
    });
  });
}

function renderMath(root: ParentNode = document): void {
  renderCodeMath(root);
  renderTextMath(root);
}

renderMath();
window.addEventListener('instantclick:newpage', () => renderMath());

const observer = new MutationObserver((records) => {
  records.forEach((record) => record.addedNodes.forEach((node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (element.matches('.note-body, #wmd-preview, .wmd-preview, pre code.language-math, code:not(pre code)')) {
      renderMath(document);
    } else if (element.querySelector('pre code.language-math, code:not(pre code)')) {
      renderMath(document);
    }
  }));
});

if (document.body) observer.observe(document.body, { childList: true, subtree: true });
