import type { PluginInitContext } from 'typecho/plugin-sdk';

const PUBLIC_ASSET = '/plugin-assets/typecho-plugin-markdown';

function makeCodeSpan(value: string): string {
  const runs = value.match(/`+/g) || [];
  const maxRun = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const delimiter = '`'.repeat(maxRun + 1);
  return delimiter + value + delimiter;
}

function isEscapedAt(line: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

function skipInlineHtmlTag(line: string, start: number): number {
  if (line[start] !== '<' || !/[A-Za-z/!?]/.test(line[start + 1] || '')) return start;

  let quote = '';
  for (let index = start + 1; index < line.length; index++) {
    const char = line[index];
    if (quote) {
      if (char === quote && !isEscapedAt(line, index)) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>' && !isEscapedAt(line, index)) {
      return index + 1;
    }
  }
  return line.length;
}

function skipInlineLinkDestination(line: string, start: number): number {
  if (line[start] !== ']' || line[start + 1] !== '(') return start;

  let depth = 1;
  let quote = '';
  let angleDestination = false;
  for (let index = start + 2; index < line.length; index++) {
    const char = line[index];
    if (char === '\\') {
      index++;
      continue;
    }
    if (quote) {
      if (char === quote && !isEscapedAt(line, index)) quote = '';
      continue;
    }
    if (angleDestination) {
      if (char === '>' && !isEscapedAt(line, index)) angleDestination = false;
      continue;
    }
    if (char === '<' && depth === 1) {
      angleDestination = true;
      continue;
    }
    if ((char === '"' || char === "'") && depth === 1 && /\s/.test(line[index - 1] || '')) {
      quote = char;
      continue;
    }
    if (char === '(') depth++;
    else if (char === ')') {
      depth--;
      if (depth === 0) return index + 1;
    }
  }
  return start;
}

function transformInlineMath(line: string): string {
  if (/^\s{0,3}\[[^\]]+\]:/.test(line)) return line;

  let output = '';
  let index = 0;

  while (index < line.length) {
    const tagEnd = skipInlineHtmlTag(line, index);
    if (tagEnd > index) {
      output += line.slice(index, tagEnd);
      index = tagEnd;
      continue;
    }

    const linkEnd = skipInlineLinkDestination(line, index);
    if (linkEnd > index) {
      output += line.slice(index, linkEnd);
      index = linkEnd;
      continue;
    }

    if (line[index] === '`' && !isEscapedAt(line, index)) {
      let end = index + 1;
      while (line[end] === '`') end++;
      const marker = line.slice(index, end);
      let close = -1;
      let search = end;
      while ((search = line.indexOf(marker[0], search)) !== -1) {
        let runEnd = search;
        while (line[runEnd] === marker[0]) runEnd++;
        if (runEnd - search === marker.length) {
          close = search;
          break;
        }
        search = runEnd;
      }
      if (close === -1) {
        output += line.slice(index);
        break;
      }
      output += line.slice(index, close + marker.length);
      index = close + marker.length;
      continue;
    }

    let start = -1;
    let close = -1;
    let delimiter = '';

    if (line.startsWith('\\(', index) && !isEscapedAt(line, index)) {
      start = index + 2;
      delimiter = '\\)';
      close = line.indexOf(delimiter, start);
      while (close !== -1 && isEscapedAt(line, close)) close = line.indexOf(delimiter, close + delimiter.length);
    } else if (
      line[index] === '$' &&
      line[index + 1] !== '$' &&
      !isEscapedAt(line, index)
    ) {
      start = index + 1;
      delimiter = '$';
      close = line.indexOf(delimiter, start);
      while (close !== -1 && isEscapedAt(line, close)) {
        close = line.indexOf(delimiter, close + 1);
      }
      if (close !== -1 && line[close + 1] === '$') close = -1;
    }

    if (start >= 0 && close > start) {
      const tex = line.slice(start, close);
      if (tex.trim()) {
        output += makeCodeSpan('\u2063typecho-math-inline:
        index = close + delimiter.length;
        continue;
      }
    }

    output += line[index];
    index++;
  }

  return output;
}

/**
 * Convert math delimiters to ordinary Markdown code spans/fences.
 * The original Markdown parser and sanitizer still own HTML generation and
 * sanitization; this filter never injects HTML or widens the HTML allowlist.
 */
export function transformMathSource(source: string): string {
  if (!source) return source;
  const lines = source.split('\n');
  const output: string[] = [];
  let fenceChar = '';
  let fenceLength = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);

    if (fenceChar) {
      output.push(line);
      if (
        fence &&
        fence[1][0] === fenceChar &&
        fence[1].length >= fenceLength &&
        /^\s*$/.test(line.slice(fence[0].length))
      ) {
        fenceChar = '';
        fenceLength = 0;
      }
      continue;
    }

    if (fence) {
      fenceChar = fence[1][0];
      fenceLength = fence[1].length;
      output.push(line);
      continue;
    }

    const displayIndent = /^(\s{0,3})/.exec(line)?.[1] ?? '';
    const displayBody = line.slice(displayIndent.length).trim();
    const displayLine =
      displayBody.length > 4 && displayBody.startsWith('$$') && displayBody.endsWith('$$')
        ? { indent: displayIndent, body: displayBody.slice(2, -2) }
        : displayBody.length > 4 && displayBody.startsWith('\\[') && displayBody.endsWith('\\]')
          ? { indent: displayIndent, body: displayBody.slice(2, -2) }
          : null;
    if (displayLine) {
      output.push(displayLine.indent + '```math');
      output.push(displayLine.body);
      output.push(displayLine.indent + '```');
      continue;
    }

    const openIndent = /^(\s{0,3})/.exec(line)?.[1] ?? '';
    const openBody = line.slice(openIndent.length).trim();
    const displayOpen = openBody === '$$' || openBody === '\\[';
    if (displayOpen) {
      const closeMarker = openBody === '$$' ? '$$' : '\\]';
      let closeIndex = index + 1;
      while (closeIndex < lines.length && lines[closeIndex].trim() !== closeMarker) closeIndex++;
      if (closeIndex < lines.length) {
        output.push(openIndent + '\`\`\`math');
        output.push(...lines.slice(index + 1, closeIndex));
        output.push(openIndent + '\`\`\`');
        index = closeIndex;
        continue;
      }
    }

    output.push(transformInlineMath(line));
  }

  return output.join('\n');
}

function scriptsHtml(includePurify = true): string {
  return [
    ...(includePurify ? ['<script defer src="/vendor/purify.js"></script>'] : []),
    '<script defer src="' + PUBLIC_ASSET + '/markdown-loader.js"></script>',
  ].join('');
}

export default function init({ addHook, pluginId }: PluginInitContext): void {
  addHook('content:markdown', pluginId, (source: string) => transformMathSource(source));

  addHook('archive:footer', pluginId, (html: string) => html + scriptsHtml());

  addHook('admin:footer', pluginId, (html: string, extra?: { activeMenu?: string; title?: string }) => {
    const isEditorMenu = extra?.activeMenu === 'write-post' || extra?.activeMenu === 'write-page';
    const isEditorTitle = ['撰写新文章', '编辑文章', '创建新页面', '编辑页面'].includes(extra?.title || '');
    if (!isEditorMenu && !isEditorTitle) return html;
    // Editor pages already load DOMPurify as part of the core editor bundle.
    return html + scriptsHtml(false);
  });
}
 + tex + '$\u2063');
        index = close + delimiter.length;
        continue;
      }
    }

    output += line[index];
    index++;
  }

  return output;
}

/**
 * Convert math delimiters to ordinary Markdown code spans/fences.
 * The original Markdown parser and sanitizer still own HTML generation and
 * sanitization; this filter never injects HTML or widens the HTML allowlist.
 */
export function transformMathSource(source: string): string {
  if (!source) return source;
  const lines = source.split('\n');
  const output: string[] = [];
  let fenceChar = '';
  let fenceLength = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);

    if (fenceChar) {
      output.push(line);
      if (
        fence &&
        fence[1][0] === fenceChar &&
        fence[1].length >= fenceLength &&
        /^\s*$/.test(line.slice(fence[0].length))
      ) {
        fenceChar = '';
        fenceLength = 0;
      }
      continue;
    }

    if (fence) {
      fenceChar = fence[1][0];
      fenceLength = fence[1].length;
      output.push(line);
      continue;
    }

    const displayIndent = /^(\s{0,3})/.exec(line)?.[1] ?? '';
    const displayBody = line.slice(displayIndent.length).trim();
    const displayLine =
      displayBody.length > 4 && displayBody.startsWith('$$') && displayBody.endsWith('$$')
        ? { indent: displayIndent, body: displayBody.slice(2, -2) }
        : displayBody.length > 4 && displayBody.startsWith('\\[') && displayBody.endsWith('\\]')
          ? { indent: displayIndent, body: displayBody.slice(2, -2) }
          : null;
    if (displayLine) {
      output.push(displayLine.indent + '```math');
      output.push(displayLine.body);
      output.push(displayLine.indent + '```');
      continue;
    }

    const openIndent = /^(\s{0,3})/.exec(line)?.[1] ?? '';
    const openBody = line.slice(openIndent.length).trim();
    const displayOpen = openBody === '$$' || openBody === '\\[';
    if (displayOpen) {
      const closeMarker = openBody === '$$' ? '$$' : '\\]';
      let closeIndex = index + 1;
      while (closeIndex < lines.length && lines[closeIndex].trim() !== closeMarker) closeIndex++;
      if (closeIndex < lines.length) {
        output.push(openIndent + '\`\`\`math');
        output.push(...lines.slice(index + 1, closeIndex));
        output.push(openIndent + '\`\`\`');
        index = closeIndex;
        continue;
      }
    }

    output.push(transformInlineMath(line));
  }

  return output.join('\n');
}

function scriptsHtml(includePurify = true): string {
  return [
    ...(includePurify ? ['<script defer src="/vendor/purify.js"></script>'] : []),
    '<script defer src="' + PUBLIC_ASSET + '/markdown-loader.js"></script>',
  ].join('');
}

export default function init({ addHook, pluginId }: PluginInitContext): void {
  addHook('content:markdown', pluginId, (source: string) => transformMathSource(source));

  addHook('archive:footer', pluginId, (html: string) => html + scriptsHtml());

  addHook('admin:footer', pluginId, (html: string, extra?: { activeMenu?: string; title?: string }) => {
    const isEditorMenu = extra?.activeMenu === 'write-post' || extra?.activeMenu === 'write-page';
    const isEditorTitle = ['撰写新文章', '编辑文章', '创建新页面', '编辑页面'].includes(extra?.title || '');
    if (!isEditorMenu && !isEditorTitle) return html;
    // Editor pages already load DOMPurify as part of the core editor bundle.
    return html + scriptsHtml(false);
  });
}
