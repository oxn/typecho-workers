// @ts-ignore PrismJS is consumed as a browser bundle; its runtime package has no bundled types.
import Prism from 'prismjs';
// @ts-ignore
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
import 'prismjs/components/prism-markup-templating';
// @ts-ignore
import 'prismjs/components/prism-graphql';
// @ts-ignore
import 'prismjs/components/prism-scss';
// @ts-ignore
import 'prismjs/components/prism-less';
// @ts-ignore
import 'prismjs/components/prism-toml';
// @ts-ignore
import 'prismjs/components/prism-makefile';
// @ts-ignore
import 'prismjs/components/prism-nginx';
// @ts-ignore
import 'prismjs/components/prism-latex';
// @ts-ignore
import 'prismjs/components/prism-r';
// @ts-ignore
import 'prismjs/components/prism-lua';
// @ts-ignore
import 'prismjs/components/prism-kotlin';
// @ts-ignore
import 'prismjs/components/prism-swift';
// @ts-ignore
import 'prismjs/components/prism-dart';
// @ts-ignore
import 'prismjs/components/prism-objectivec';
// @ts-ignore
import 'prismjs/components/prism-matlab';
// @ts-ignore
import 'prismjs/components/prism-perl';
// @ts-ignore
import 'prismjs/components/prism-scala';
// @ts-ignore
import 'prismjs/components/prism-haskell';
// @ts-ignore
import 'prismjs/components/prism-http';
// @ts-ignore
import 'prismjs/components/prism-batch';
// @ts-ignore
import 'prismjs/components/prism-vim';
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

function enhanceCodeBlocks(root: Element): void {
  root.querySelectorAll<HTMLElement>('.rin-code-pre > code').forEach(code => {
    const pre = code.parentElement;
    if (!pre || pre.closest('.mermaid_default,.mermaid_dark') || pre.dataset.rinCodeEnhanced === '1') return;
    pre.dataset.rinCodeEnhanced = '1';
    const copyValue = code.textContent || '';
    const displayValue = copyValue.replace(/\n$/, '');
    if (displayValue !== copyValue) code.textContent = displayValue;
    const wrapper = document.createElement('div');
    wrapper.className = 'rin-code-block relative group';
    pre.before(wrapper);
    wrapper.append(pre);
    const languageMatch = /language-(\w+)/.exec(code.className || '');
    const language = languageMatch?.[1] || '';
    if (language && language !== 'text' && language !== 'plain') {
      code.className = code.className.replace(/language-[\w-]+/, 'language-' + language);
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
