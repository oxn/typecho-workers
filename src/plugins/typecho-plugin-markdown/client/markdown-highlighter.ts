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
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-nginx';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-ini';
import 'prismjs/components/prism-powershell';
import 'prismjs/components/prism-graphql';
import './markdown.css';

const languages = Prism.languages as typeof Prism.languages & Record<string, unknown>;
languages.js = languages.javascript;
languages.ts = languages.typescript;
languages.py = languages.python;
languages.sh = languages.bash;
languages.shell = languages.bash;
languages.yml = languages.yaml;
languages.cs = languages.csharp;
languages.rb = languages.ruby;
languages.rs = languages.rust;
languages.kt = languages.kotlin;
languages.ps1 = languages.powershell;
languages.dockerfile = languages.docker;

const CONTENT_ROOTS = [
  '.warm-prose', '.note-body', '#wmd-preview', '.wmd-preview',
  '.markdown-body', '.post-content', '.entry-content', '.typecho-content',
];
const scopedSelector = (selector: string) =>
  CONTENT_ROOTS.map((root) => root + ' ' + selector).join(', ');

function highlight(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>(
    scopedSelector('pre code[class*="language-"]:not(.language-mermaid):not(.language-math)'),
  ).forEach((code) => {
    if (code.dataset.markdownHighlighted === '1') return;
    code.dataset.markdownHighlighted = '1';
    Prism.highlightElement(code);
  });
}

highlight();
window.addEventListener('instantclick:newpage', () => highlight());

const observer = new MutationObserver((records) => {
  records.forEach((record) => record.addedNodes.forEach((node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (element.matches('pre code[class*="language-"]')) {
      highlight(document);
    } else if (element.querySelector('pre code[class*="language-"]')) {
      highlight(document);
    }
  }));
});

if (document.body) observer.observe(document.body, { childList: true, subtree: true });
