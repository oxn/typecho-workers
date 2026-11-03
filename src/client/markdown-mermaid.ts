import mermaid from 'mermaid';
import DOMPurify from 'dompurify';

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

async function renderDiagram(code: HTMLElement): Promise<void> {
  if (code.dataset.mermaidRendered === '1' || code.dataset.mermaidPending === '1') return;
  const pre = code.closest('pre');
  if (!pre || !pre.parentElement) return;

  code.dataset.mermaidPending = '1';
  const host = document.createElement('div');
  host.className = 'warm-mermaid';
  host.setAttribute('role', 'img');
  host.setAttribute('aria-label', 'Mermaid diagram');
  pre.insertAdjacentElement('beforebegin', host);

  try {
    const id = 'warm-mermaid-' + (++sequence);
    const result = await mermaid.render(id, code.textContent ?? '');
    const safeSvg = DOMPurify.sanitize(result.svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
    });
    host.innerHTML = safeSvg;
    pre.hidden = true;
    code.dataset.mermaidRendered = '1';
  } catch {
    host.remove();
    delete code.dataset.mermaidPending;
    code.dataset.mermaidError = '1';
  }
}

function renderMermaid(root: ParentNode = document): void {
  const blocks = root.querySelectorAll<HTMLElement>(
    '.warm-prose pre code.language-mermaid, .warm-prose pre code.lang-mermaid',
  );
  blocks.forEach((code) => void renderDiagram(code));
}

renderMermaid();
window.addEventListener('instantclick:newpage', () => renderMermaid());

const observer = new MutationObserver((records) => {
  records.forEach((record) => {
    record.addedNodes.forEach((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const element = node as Element;
      if (element.matches('pre code.language-mermaid, pre code.lang-mermaid')) {
        renderMermaid(element.parentElement ?? element);
      } else if (element.querySelector('pre code.language-mermaid, pre code.lang-mermaid')) {
        renderMermaid(element);
      }
    });
  });
});

if (document.body) observer.observe(document.body, { childList: true, subtree: true });
