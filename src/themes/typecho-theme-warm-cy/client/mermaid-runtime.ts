import mermaid from 'mermaid';

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
  configured = true;
}

export async function initializeMermaid(root: Element): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('pre > code.language-mermaid, pre > code.lang-mermaid'));
  if (!blocks.length) return;
  ensureConfigured();
  for (const code of blocks) {
    const pre = code.parentElement;
    if (!pre || pre.dataset.warmMermaid === '1') continue;
    pre.dataset.warmMermaid = '1';
    const source = code.textContent || '';
    const container = document.createElement('div');
    container.className = 'warm-mermaid';
    container.setAttribute('role', 'img');
    container.setAttribute('aria-label', 'Mermaid diagram');
    pre.replaceWith(container);
    try {
      const id = 'warm-mermaid-' + Math.random().toString(36).slice(2);
      const result = await mermaid.render(id, source);
      container.innerHTML = result.svg;
    } catch (error) {
      console.error('[Warm CY] Mermaid render failed', error);
      container.textContent = source;
      container.classList.add('warm-mermaid--fallback');
    }
  }
}
