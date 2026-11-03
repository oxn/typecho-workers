import type { PluginInitContext } from 'typecho/plugin-sdk';

const PLUGIN_ID = 'typecho-plugin-markdown';
const PUBLIC_ASSET = '/plugin-assets/typecho-plugin-markdown';

function makeCodeSpan(value: string): string {
  const runs = value.match(/`+/g) || [];
  const maxRun = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const delimiter = '`'.repeat(maxRun + 1);
  return delimiter + value + delimiter;
}

function transformInlineMath(line: string): string {
  let output = '';
  let index = 0;

  while (index < line.length) {
    if (line[index] === '`') {
      let end = index + 1;
      while (line[end] === '`') end++;
      const marker = line.slice(index, end);
      const close = line.indexOf(marker, end);
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

    if (line.startsWith('\\(', index)) {
      start = index + 2;
      delimiter = '\\)';
      close = line.indexOf(delimiter, start);
    } else if (
      line[index] === '$' &&
      line[index + 1] !== '$' &&
      (index === 0 || line[index - 1] !== '\\')
    ) {
      start = index + 1;
      delimiter = '$';
      close = line.indexOf(delimiter, start);
      while (close !== -1 && line[close - 1] === '\\') {
        close = line.indexOf(delimiter, close + 1);
      }
      if (close !== -1 && line[close + 1] === '$') close = -1;
    }

    if (start >= 0 && close > start) {
      const tex = line.slice(start, close);
      if (tex.trim()) {
        output += makeCodeSpan('$' + tex + '$');
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

    const displayLine = /^(\s{0,3})(\$\$|\\\[)(.*?)(\$\$|\\\])\s*$/.exec(line);
    if (displayLine && displayLine[2] === displayLine[4]) {
      output.push(displayLine[1] + '```math');
      output.push(displayLine[3]);
      output.push(displayLine[1] + '```');
      continue;
    }

    const displayOpen = /^(\s{0,3})(\$\$|\\\[)\s*$/.exec(line);
    if (displayOpen) {
      const closeMarker = displayOpen[2] === '$$' ? '$$' : '\\]';
      let closeIndex = index + 1;
      while (closeIndex < lines.length && lines[closeIndex].trim() !== closeMarker) closeIndex++;
      if (closeIndex < lines.length) {
        output.push(displayOpen[1] + '```math');
        output.push(...lines.slice(index + 1, closeIndex));
        output.push(displayOpen[1] + '```');
        index = closeIndex;
        continue;
      }
    }

    output.push(transformInlineMath(line));
  }

  return output.join('\n');
}

function stylesHtml(): string {
  return [
    '<link rel="stylesheet" href="' + PUBLIC_ASSET + '/markdown-highlighter.css">',
    '<link rel="stylesheet" href="' + PUBLIC_ASSET + '/markdown-math.css">',
  ].join('');
}

function scriptsHtml(): string {
  return [
    '<script defer src="/vendor/purify.js"></script>',
    '<script defer src="' + PUBLIC_ASSET + '/markdown-math.js"></script>',
    '<script defer src="' + PUBLIC_ASSET + '/markdown-mermaid.js"></script>',
    '<script defer src="' + PUBLIC_ASSET + '/markdown-highlighter.js"></script>',
  ].join('');
}

export default function init({ addHook, pluginId }: PluginInitContext): void {
  addHook('content:markdown', pluginId, (source: string) => transformMathSource(source));

  addHook('archive:header', pluginId, (html: string) => html + stylesHtml());
  addHook('archive:footer', pluginId, (html: string) => html + scriptsHtml());

  addHook('admin:header', pluginId, (html: string, extra?: { activeMenu?: string }) => {
    if (extra?.activeMenu !== 'write-post' && extra?.activeMenu !== 'write-page') return html;
    return html + stylesHtml();
  });

  addHook('admin:footer', pluginId, (html: string, extra?: { activeMenu?: string }) => {
    if (extra?.activeMenu !== 'write-post' && extra?.activeMenu !== 'write-page') return html;
    return html + scriptsHtml();
  });
}
