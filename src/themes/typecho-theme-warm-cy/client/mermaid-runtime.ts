import mermaid from 'mermaid';

type MermaidThemeConfig = {
  startOnLoad: false;
  theme: 'default' | 'dark';
};

const lightConfig: MermaidThemeConfig = { startOnLoad: false, theme: 'default' };
const darkConfig: MermaidThemeConfig = { startOnLoad: false, theme: 'dark' };

async function renderVariant(nodes: HTMLElement[], config: MermaidThemeConfig): Promise<void> {
  if (!nodes.length) return;

  const sourceByNode = new Map(nodes.map((node) => [node, node.textContent || '']));
  const restore: Array<{
    node: HTMLElement;
    display: string;
    displayPriority: string;
    visibility: string;
    visibilityPriority: string;
  }> = [];

  try {
    nodes.forEach((node) => {
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

    mermaid.initialize(config);
    await mermaid.run({ nodes });
    nodes.forEach((node) => { node.dataset.processed = '1'; });
  } catch (error) {
    nodes.forEach((node) => {
      node.textContent = sourceByNode.get(node) || '';
      node.dataset.processed = '1';
      node.classList.add('rin-mermaid-fallback');
    });
    console.error('[Warm CY] Mermaid render failed', error);
  } finally {
    restore.forEach((item) => {
      if (item.display) item.node.style.setProperty('display', item.display, item.displayPriority);
      else item.node.style.removeProperty('display');
      if (item.visibility) item.node.style.setProperty('visibility', item.visibility, item.visibilityPriority);
      else item.node.style.removeProperty('visibility');
    });
  }
}

let renderQueue: Promise<void> = Promise.resolve();

export function initializeMermaid(root: Element): Promise<void> {
  const render = async (): Promise<void> => {
    const light = Array.from(root.querySelectorAll<HTMLElement>('pre.rin-mermaid_default:not([data-processed])'));
    const dark = Array.from(root.querySelectorAll<HTMLElement>('pre.rin-mermaid_dark:not([data-processed])'));
    if (!light.length && !dark.length) return;
    await renderVariant(light, lightConfig);
    await renderVariant(dark, darkConfig);
  };

  renderQueue = renderQueue.then(render).catch((error) => {
    console.error('[Warm CY] Mermaid rendering queue failed', error);
  });
  return renderQueue;
}
