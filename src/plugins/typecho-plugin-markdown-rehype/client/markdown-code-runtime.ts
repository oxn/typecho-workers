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


function initialize(root: Element): void {
  enhanceCodeBlocks(root);
}

(window as any).__rinMarkdownCodeRuntime = { initialize };
