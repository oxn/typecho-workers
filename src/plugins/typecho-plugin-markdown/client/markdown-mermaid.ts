import mermaid from 'mermaid';
import './markdown.css';

declare global {
  interface Window {
    DOMPurify?: {
      sanitize: (dirty: string, options?: Record<string, unknown>) => string;
    };
  }
}

let sequence = 0;

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'default',
  flowchart: { htmlLabels: false, useMaxWidth: true },
  sequence: { useMaxWidth: true },
  gantt: { useMaxWidth: true },
  mindmap: { useMaxWidth: true },
});

const ROOT_SELECTOR = [
  '.warm-prose', '.note-body', '#wmd-preview', '.wmd-preview',
  '.markdown-body', '.post-content', '.entry-content', '.typecho-content',
].join(', ');

async function renderDiagram(code: HTMLElement): Promise<void> {
  if (code.dataset.markdownMermaidRendered === '1' || code.dataset.markdownMermaidPending === '1') return;
  const pre = code.closest('pre');
  if (!pre || !pre.parentElement || !window.DOMPurify) return;

  code.dataset.markdownMermaidPending = '1';
  const host = document.createElement('div');
  host.className = 'markdown-mermaid';
  host.setAttribute('role', 'img');
  host.setAttribute('aria-label', 'Mermaid diagram');
  pre.insertAdjacentElement('beforebegin', host);

  try {
    const id = 'typecho-markdown-mermaid-' + (++sequence);
    const result = await mermaid.render(id, code.textContent ?? '');
    const safeSvg = window.DOMPurify.sanitize(result.svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
    });
    host.innerHTML = safeSvg;
    pre.hidden = true;
    code.dataset.markdownMermaidRendered = '1';
  } catch {
    host.remove();
    delete code.dataset.markdownMermaidPending;
    code.dataset.markdownMermaidError = '1';
  }
}

function renderMermaid(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>(
    ROOT_SELECTOR + ' pre code.language-mermaid, ' + ROOT_SELECTOR + ' pre code.lang-mermaid',
  ).forEach((code) => void renderDiagram(code));
}

renderMermaid();
window.addEventListener('instantclick:newpage', () => renderMermaid());

const observer = new MutationObserver((records) => {
  records.forEach((record) => record.addedNodes.forEach((node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (element.matches('pre code.language-mermaid, pre code.lang-mermaid')) {
      renderMermaid(element.parentElement ?? element);
    } else if (element.querySelector('pre code.language-mermaid, pre code.lang-mermaid')) {
      renderMermaid(element);
    }
  }));
});

if (document.body) observer.observe(document.body, { childList: true, subtree: true });
