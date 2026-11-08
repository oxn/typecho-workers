import { escapeHtml } from 'typecho/plugin-sdk';
import type { PluginInitContext } from 'typecho/plugin-sdk';
import { markedHighlight } from 'marked-highlight';
import markedFootnote from 'marked-footnote';
import hljs from 'highlight.js/lib/common';

/**
 * This plugin intentionally runs after the core Markdown parser and sanitizer.
 * It only adds attributes and navigation markup generated from already-sanitized
 * heading content; it never restores author-supplied raw HTML.
 */
const TOC_MARKER_RE = /<p>\s*\[\[toc\]\]\s*<\/p>/gi;
const HEADING_RE = /<(h[1-6])>([\s\S]*?)<\/\1>/gi;
const TAG_RE = /<[^>]*>/g;
const ENTITY_RE = /&(?:amp|lt|gt|quot|#39|nbsp|#x[0-9a-f]+|#\d+);/gi;

function decodeEntity(entity: string): string {
  const named: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
  };
  const key = entity.toLowerCase();
  if (named[key] !== undefined) return named[key];
  const hex = key.match(/^&#x([0-9a-f]+);$/);
  const decimal = key.match(/^&#(\d+);$/);
  const codePoint = hex ? Number.parseInt(hex[1], 16) : decimal ? Number.parseInt(decimal[1], 10) : NaN;
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : entity;
}

function headingText(html: string): string {
  return html.replace(TAG_RE, '').replace(ENTITY_RE, decodeEntity).replace(/\s+/g, ' ').trim();
}

function slugifyHeading(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

export interface HeadingEntry {
  level: number;
  id: string;
  text: string;
}

export function addHeadingAnchorsAndToc(html: string): string {
  // Reserve IDs emitted by other safe render extensions (for example footnotes)
  // before assigning heading slugs, so the final document has no cross-feature collisions.
  const used = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]));
  const headings: HeadingEntry[] = [];

  const withAnchors = html.replace(HEADING_RE, (full, tag: string, inner: string) => {
    const text = headingText(inner);
    if (!text) return full;

    const base = slugifyHeading(text);
    let id = base;
    let suffix = 2;
    while (used.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(id);
    headings.push({ level: Number(tag.slice(1)), id, text });

    // The id and fragment link are generated exclusively from heading text.
    return `<${tag} id="${escapeHtml(id)}">${inner}<a class="markdown-heading-anchor" href="#${escapeHtml(id)}" aria-label="Link to ${escapeHtml(text)}">#</a></${tag}>`;
  });

  if (!TOC_MARKER_RE.test(withAnchors)) return withAnchors;
  TOC_MARKER_RE.lastIndex = 0;
  if (headings.length === 0) return withAnchors.replace(TOC_MARKER_RE, '');

  const items = headings
    .filter((heading) => heading.level >= 2)
    .map((heading) =>
      `<li class="markdown-toc-level-${heading.level}"><a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a></li>`,
    )
    .join('');

  const toc = items
    ? `<nav class="markdown-toc" aria-label="文章目录"><strong>目录</strong><ol>${items}</ol></nav>`
    : '';

  return withAnchors.replace(TOC_MARKER_RE, toc);
}

const PRESENTATION_STYLES = `<style id="markdown-gfm-presentation">
.markdown-heading-anchor{opacity:0;margin-inline-start:.45em;text-decoration:none;font-size:.85em}
h1:hover .markdown-heading-anchor,h2:hover .markdown-heading-anchor,h3:hover .markdown-heading-anchor,h4:hover .markdown-heading-anchor,h5:hover .markdown-heading-anchor,h6:hover .markdown-heading-anchor,.markdown-heading-anchor:focus{opacity:.65}
.markdown-toc{margin:1.25em 0;padding:1em 1.25em;border:1px solid var(--border-color,rgba(127,127,127,.25));border-radius:.5em}
.markdown-toc>strong{display:block;margin-bottom:.5em}
.markdown-toc ol{margin:.25em 0 0;padding-left:1.5em}
.markdown-toc li{margin:.2em 0}
.markdown-toc-level-3{margin-left:1em!important}
.markdown-toc-level-4,.markdown-toc-level-5,.markdown-toc-level-6{margin-left:2em!important}
@media(hover:none){.markdown-heading-anchor{opacity:.55}}
/* Syntax token colors are authored by this plugin for Highlight.js token classes. */
.hljs{color:var(--markdown-code-color,#24292f);background:var(--markdown-code-bg,#f6f8fa)}
.hljs-comment,.hljs-quote{color:#6a737d;font-style:italic}
.hljs-keyword,.hljs-selector-tag,.hljs-subst{color:#d73a49}
.hljs-number,.hljs-literal,.hljs-variable,.hljs-template-variable,.hljs-tag .hljs-attr{color:#005cc5}
.hljs-string,.hljs-doctag,.hljs-regexp{color:#032f62}
.hljs-title,.hljs-section,.hljs-selector-id{color:#6f42c1}
.hljs-type,.hljs-class .hljs-title{color:#e36209}
.hljs-attr,.hljs-attribute,.hljs-name{color:#22863a}
.hljs-built_in,.hljs-builtin-name{color:#005cc5}
.footnotes{margin-top:2rem;font-size:.9em}
.footnotes .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
</style>`;

export default function init({ addHook, addMarkdownExtension, pluginId }: PluginInitContext): void {
  // Use the maintained Marked adapter with a bounded common-language grammar set.
  // Unknown or malformed language labels fall back to escaped, unhighlighted code.
  addMarkdownExtension?.(() => markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, language) {
      const normalizedLanguage = String(language || '').trim().split(/\s+/, 1)[0].toLowerCase();
      if (!normalizedLanguage || !hljs.getLanguage(normalizedLanguage)) return escapeHtml(code);
      try {
        return hljs.highlight(code, { language: normalizedLanguage }).value;
      } catch {
        return escapeHtml(code);
      }
    },
  }));
  // marked-footnote keeps mutable lexer state in its extension closure, so
  // register a factory to isolate references between concurrent renders.
  addMarkdownExtension?.(() => markedFootnote({
    prefixId: 'markdown-footnote-',
    prefixData: 'markdown-',
    backRefLabel: 'Back to footnote',
  }));

  // The marker is optional and does not alter ordinary Markdown text.
  // Priority 30 intentionally follows CY's priority-1 HTML-fragment restoration.
  addHook('content:content', pluginId, (content: string) => {
    if (!/<h[1-6]>|<p>\s*\[\[toc\]\]\s*<\/p>/i.test(content)) return content;
    return addHeadingAnchorsAndToc(content);
  }, 30);

  addHook('archive:header', pluginId, (html: string) => {
    if (html.includes('id="markdown-gfm-presentation"')) return html;
    return html + PRESENTATION_STYLES;
  }, 30);
}
