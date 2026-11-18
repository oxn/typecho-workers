import mermaid from 'mermaid';

type MermaidThemeConfig = {
  startOnLoad: false;
  theme: 'default' | 'dark';
  themeVariables: {
    background: 'transparent';
  };
};

function getMermaidConfig(): MermaidThemeConfig {
  const isDark = document.documentElement.classList.contains('dark');
  return {
    startOnLoad: false,
    theme: isDark ? 'dark' : 'default',
    themeVariables: { background: 'transparent' },
  };
}

async function renderDiagrams(nodes: HTMLElement[]): Promise<void> {
  if (!nodes.length) return;

  const sourceByNode = new Map(nodes.map((node) => [node, node.textContent || '']));
  try {
    mermaid.initialize(getMermaidConfig());
    await mermaid.run({ nodes });
    nodes.forEach((node) => {
      node.dataset.processed = '1';
      node.querySelectorAll<SVGElement>('svg').forEach((svg) => {
        svg.style.backgroundColor = 'transparent';
        svg.querySelectorAll<SVGElement>('.background').forEach((background) => {
          background.style.fill = 'transparent';
        });
      });
    });
  } catch (error) {
    nodes.forEach((node) => {
      node.textContent = sourceByNode.get(node) || '';
      node.dataset.processed = '1';
      node.classList.add('rin-mermaid-fallback');
    });
    console.error('[Warm CY] Mermaid render failed', error);
  }
}

let renderQueue: Promise<void> = Promise.resolve();

export function initializeMermaid(root: Element): Promise<void> {
  const render = async (): Promise<void> => {
    const diagrams = Array.from(root.querySelectorAll<HTMLElement>('pre.rin-mermaid:not([data-processed])'));
    await renderDiagrams(diagrams);
  };

  renderQueue = renderQueue.then(render).catch((error) => {
    console.error('[Warm CY] Mermaid rendering queue failed', error);
  });
  return renderQueue;
}
