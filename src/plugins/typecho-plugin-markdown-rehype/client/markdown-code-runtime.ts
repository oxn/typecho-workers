import { highlightCode, type RefractorNode } from './lib/refractor-highlight';

function appendHighlightNode(parent: Node, node: RefractorNode): void {
  if (node.type === 'text') {
    parent.appendChild(document.createTextNode(node.value));
    return;
  }
  if (node.type !== 'element' || node.tagName !== 'span') return;

  const span = document.createElement('span');
  const className = node.properties?.className;
  if (Array.isArray(className)) {
    span.className = className.filter(value => typeof value === 'string').join(' ');
  } else if (typeof className === 'string') {
    span.className = className;
  }
  parent.appendChild(span);
  node.children.forEach(child => appendHighlightNode(span, child));
}

function enhanceCodeBlocks(root: Element): void {
  root.querySelectorAll<HTMLElement>('.rin-code-pre > code').forEach(code => {
    const pre = code.parentElement;
    if (!pre || pre.closest('.rin-mermaid_default,.rin-mermaid_dark') || pre.dataset.rinCodeEnhanced === '1') return;
    pre.dataset.rinCodeEnhanced = '1';
    const copyValue = code.textContent || '';
    const displayValue = copyValue.replace(/\n$/, '');
    if (displayValue !== copyValue) code.textContent = displayValue;
    const wrapper = document.createElement('div');
    wrapper.className = 'rin-code-block relative group';
    pre.before(wrapper);
    wrapper.append(pre);
    // Prism language identifiers include hyphens (for example shell-session,
    // markup-templating and web-idl); keep the complete identifier intact.
    const languageMatch = /language-([\w+-]+)/.exec(code.className || '');
    const language = languageMatch?.[1] || '';
    if (language && language !== 'text' && language !== 'plain') {
      code.className = code.className.replace(/language-[\w+-]+/, 'language-' + language);
      const highlighted = highlightCode(displayValue, language);
      const fragment = document.createDocumentFragment();
      highlighted.children.forEach(node => appendHighlightNode(fragment, node));
      code.replaceChildren(fragment);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rin-code-copy';
    button.textContent = 'Copy';
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(copyValue);
      button.textContent = 'Copied!';
      window.setTimeout(() => { button.textContent = 'Copy'; }, 2000);
    });
    wrapper.append(button);
  });
}


function initialize(root: Element): void {
  enhanceCodeBlocks(root);
}

(window as any).__rinMarkdownCodeRuntime = { initialize };
