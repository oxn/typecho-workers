// @ts-expect-error PrismJS is a browser runtime package without bundled TypeScript declarations.
import Prism from 'prismjs';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-diff';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-markup';

const languages = Prism.languages as typeof Prism.languages & Record<string, unknown>;
languages.js = languages.javascript;
languages.ts = languages.typescript;
languages.py = languages.python;
languages.sh = languages.bash;
languages.shell = languages.bash;
languages.yml = languages.yaml;

function highlight(root: ParentNode = document): void {
  const blocks = root.querySelectorAll<HTMLElement>(
    '.warm-prose pre code[class*="language-"], .warm-note__content pre code[class*="language-"]',
  );

  blocks.forEach((code) => {
    if (code.dataset.warmHighlighted === '1') return;
    code.dataset.warmHighlighted = '1';
    Prism.highlightElement(code);
  });
}

highlight();

window.addEventListener('instantclick:newpage', () => highlight());

const observer = new MutationObserver((records) => {
  for (const record of records) {
    record.addedNodes.forEach((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const element = node as Element;
      if (element.matches('pre code[class*="language-"]')) {
        highlight(element.parentElement ?? element);
      } else if (element.querySelector('pre code[class*="language-"]')) {
        highlight(element);
      }
    });
  }
});

if (document.body) observer.observe(document.body, { childList: true, subtree: true });
