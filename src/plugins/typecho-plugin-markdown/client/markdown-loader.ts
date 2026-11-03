const ASSET = '/plugin-assets/typecho-plugin-markdown';
const CONTENT_ROOTS = [
  '.warm-prose', '.note-body', '#wmd-preview', '.wmd-preview',
  '.markdown-body', '.post-content', '.entry-content', '.typecho-content',
];

function scopedSelector(selector: string): string {
  return CONTENT_ROOTS.map((root) => root + ' ' + selector).join(', ');
}

const loadedScripts = new Set<string>();
const failedScripts = new Set<string>();

function ensureStyle(filename: string): void {
  const existing = document.querySelector('link[data-markdown-style="' + filename + '"]');
  if (existing) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = ASSET + '/' + filename;
  link.dataset.markdownStyle = filename;
  document.head.appendChild(link);
}

function ensureScript(filename: string): void {
  if (loadedScripts.has(filename) || failedScripts.has(filename)) return;
  const existing = document.querySelector('script[data-markdown-script="' + filename + '"]');
  if (existing) {
    loadedScripts.add(filename);
    return;
  }

  loadedScripts.add(filename);
  const script = document.createElement('script');
  script.src = ASSET + '/' + filename;
  script.async = true;
  script.dataset.markdownScript = filename;
  script.addEventListener('error', () => {
    loadedScripts.delete(filename);
    failedScripts.add(filename);
    script.remove();
  }, { once: true });
  document.body.appendChild(script);
}

function hasMath(): boolean {
  if (document.querySelector(scopedSelector('pre code.language-math'))) return true;

  const inlineCode = Array.from(
    document.querySelectorAll<HTMLElement>(scopedSelector('code:not(pre code)')),
  ).some((code) => /^\$([\s\S]+)\$$/.test(code.textContent || ''));

  if (inlineCode) return true;

  const textRoots = document.querySelectorAll<HTMLElement>('.note-body, #wmd-preview, .wmd-preview');
  return Array.from(textRoots).some((root) =>
    /\\\\(false+?\\\\)|(?<!\\)\$(?!\$)[^$\n]+(?<!\\)\$(?!\$)/.test(root.textContent || ''),
  );
}

function hasMermaid(): boolean {
  return Boolean(document.querySelector(
    scopedSelector('pre code.language-mermaid, pre code.lang-mermaid'),
  ));
}

function hasHighlightableCode(): boolean {
  return Boolean(document.querySelector(
    scopedSelector('pre code[class*="language-"]:not(.language-mermaid):not(.language-math)'),
  ));
}

function scan(): void {
  if (hasMath()) {
    ensureStyle('markdown-math.css');
    ensureScript('markdown-math.js');
  }

  if (hasMermaid()) {
    ensureStyle('markdown-mermaid-core.css');
    ensureScript('markdown-mermaid-core.js');
  }

  if (hasHighlightableCode()) {
    ensureStyle('markdown-highlighter.css');
    ensureScript('markdown-highlighter.js');
  }
}

let scanQueued = false;
function scheduleScan(): void {
  if (scanQueued) return;
  scanQueued = true;
  window.requestAnimationFrame(() => {
    scanQueued = false;
    scan();
  });
}

scan();
window.addEventListener('instantclick:newpage', scheduleScan);

const observer = new MutationObserver(scheduleScan);
if (document.body) observer.observe(document.body, { childList: true, subtree: true });
