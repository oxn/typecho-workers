import katex from 'katex';
import DOMPurify from 'dompurify';
import 'katex/dist/katex.min.css';

function renderMath(root: ParentNode = document): void {
  const nodes = root.querySelectorAll<HTMLElement>('.markdown-math[data-tex]');

  nodes.forEach((node) => {
    if (node.dataset.mathRendered === '1') return;
    const tex = node.dataset.tex ?? '';
    const displayMode = node.classList.contains('markdown-math--block');

    try {
      const html = katex.renderToString(tex, {
        displayMode,
        throwOnError: false,
        trust: false,
        strict: 'ignore',
        output: 'htmlAndMathml',
      });

      node.innerHTML = DOMPurify.sanitize(html, {
        USE_PROFILES: {
          html: true,
          mathMl: true,
          svg: true,
          svgFilters: true,
        },
      });
      node.dataset.mathRendered = '1';
    } catch {
      // Keep the escaped TeX source visible if a formula cannot be rendered.
    }
  });
}

renderMath();
window.addEventListener('instantclick:newpage', () => renderMath());

const observer = new MutationObserver((records) => {
  records.forEach((record) => {
    record.addedNodes.forEach((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const element = node as Element;
      if (element.matches('.markdown-math[data-tex]')) {
        renderMath(element.parentElement ?? element);
      } else if (element.querySelector('.markdown-math[data-tex]')) {
        renderMath(element);
      }
    });
  });
});

if (document.body) observer.observe(document.body, { childList: true, subtree: true });
