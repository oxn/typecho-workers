// @ts-ignore PrismJS is consumed as a browser bundle; its runtime package has no bundled types.
import Prism from 'prismjs';
import './lib/prism-languages';

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
      try { Prism.highlightElement(code); }
      catch (error) { console.error('Rin Prism highlighting failed:', error); }
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
