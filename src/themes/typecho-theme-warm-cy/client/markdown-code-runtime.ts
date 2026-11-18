import { flattenHighlightTree, highlightCode } from './lib/refractor-highlight';

function appendHighlightSegments(code: HTMLElement, source: string, language: string): void {
  const tree = highlightCode(source, language);
  const fragment = document.createDocumentFragment();
  for (const segment of flattenHighlightTree(tree)) {
    const span = document.createElement('span');
    if (segment.classNames.length) span.className = segment.classNames.join(' ');
    span.textContent = segment.value;
    fragment.append(span);
  }
  code.replaceChildren(fragment);
}

function enhanceCodeBlocks(root: Element): void {
  root.querySelectorAll<HTMLElement>('pre > code').forEach(code => {
    const pre = code.parentElement;
    if (!pre || code.classList.contains('language-mermaid') || code.classList.contains('lang-mermaid') || pre.closest('.rin-mermaid_default,.rin-mermaid_dark') || pre.dataset.rinCodeEnhanced === '1') return;
    pre.dataset.rinCodeEnhanced = '1';
    pre.classList.add('rin-code-pre');
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
      appendHighlightSegments(code, displayValue, language);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rin-code-copy';
    button.textContent = '复制';
    button.title = '复制代码';
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      let copied = false;

      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(copyValue);
          copied = true;
        }
      } catch {
        // HTTP 本地地址等非安全上下文可能无法使用 Clipboard API，继续尝试兼容方案。
      }

      if (!copied) {
        const textarea = document.createElement('textarea');
        textarea.value = copyValue;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';
        document.body.append(textarea);
        try {
          textarea.focus();
          textarea.select();
          textarea.setSelectionRange(0, textarea.value.length);
          copied = document.execCommand('copy');
        } catch {
          copied = false;
        } finally {
          textarea.remove();
        }
      }

      button.textContent = copied ? '已复制' : '复制失败';
      button.title = copied ? '已复制代码' : '复制失败，请手动选择代码';
      button.disabled = false;
      window.setTimeout(() => {
        button.textContent = '复制';
        button.title = '复制代码';
      }, 2000);
    });
    wrapper.append(button);
  });
}


export function initializeCodeBlocks(root: Element): void {
  enhanceCodeBlocks(root);
}


