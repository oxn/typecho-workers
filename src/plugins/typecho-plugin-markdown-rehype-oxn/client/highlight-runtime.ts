import { flattenHighlightTree, highlightCode, isLanguageRegistered } from './lib/refractor-highlight';
declare global { interface Window { __oxnMarkdownHighlightRuntime?: { initialize(root: Element): void } } }
function initialize(root: Element): void {
 root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]').forEach(code => {
  const pre = code.parentElement;
  if (!pre || pre.dataset.oxnHighlightEnhanced === '1') return;
  if (pre.matches('.mermaid,.rin-mermaid_default,.rin-mermaid_dark') || code.classList.contains('language-mermaid')) return;
  const match = /(?:^|\s)language-([\w+-]+)/.exec(code.className);
  const language = match?.[1]?.toLowerCase() || '';
  if (!language || language === 'text' || language === 'plain' || !isLanguageRegistered(language)) return;
  const source = code.textContent || '';
  const tree = highlightCode(source,language);
  const fragment = document.createDocumentFragment();
  for (const segment of flattenHighlightTree(tree)) {
   if (!segment.value) continue;
   if (!segment.classNames.length) fragment.append(document.createTextNode(segment.value));
   else {
    const span = document.createElement('span');
    span.className = segment.classNames.join(' ');
    span.textContent = segment.value;
    fragment.append(span);
   }
  }
  // Keep the original pre/code elements intact; theme copy controls remain untouched.
  code.replaceChildren(fragment);
  pre.classList.add('oxn-code-pre');
  pre.dataset.oxnHighlightEnhanced = '1';
 });
}
window.__oxnMarkdownHighlightRuntime = {initialize};
