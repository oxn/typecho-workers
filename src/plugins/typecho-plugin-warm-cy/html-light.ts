import sanitizeHtml from 'sanitize-html';

// Exact CY plugin 2026.11.04.20.41 pipeline, shipped with Warm CY theme 2026.11.04.23.12.
// Keep this implementation isolated so the lightweight mode cannot drift with full mode.
function encodeInlinePayload(value: string): string {
  return Array.from(new TextEncoder().encode(value), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function findHtmlTagEnd(source: string, start: number): number {
  let quote = '';
  for (let index = start; index < source.length; index++) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
}

const HTML_RAW_TEXT_TAGS = new Set(['textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);

function findHtmlRawTextEnd(source: string, tag: string, openEnd: number): number {
  if (tag === 'plaintext') return source.length;
  const closePattern = new RegExp('</' + tag + '\\s*>', 'ig');
  closePattern.lastIndex = openEnd + 1;
  const close = closePattern.exec(source);
  return close ? closePattern.lastIndex : source.length;
}

function findHtmlElementEnd(source: string, tag: string, openEnd: number): number {
  if (tag !== 'svg') {
    const closePattern = new RegExp('</' + tag + '\\s*>', 'ig');
    closePattern.lastIndex = openEnd + 1;
    const close = closePattern.exec(source);
    return close ? closePattern.lastIndex : -1;
  }

  let depth = 1;
  let search = openEnd + 1;
  while (search < source.length) {
    const start = source.indexOf('<', search);
    if (start < 0) return -1;
    if (source.startsWith('<!--', start)) {
      const commentEnd = source.indexOf('-->', start + 4);
      search = commentEnd < 0 ? source.length : commentEnd + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', start)) {
      const cdataEnd = source.indexOf(']]>', start + 9);
      search = cdataEnd < 0 ? source.length : cdataEnd + 3;
      continue;
    }
    const token = source.slice(start).match(/^<(\/?)svg\b/i);
    if (!token) {
      const otherTag = source.slice(start).match(/^<([a-z][\w:-]*)\b/i);
      if (!otherTag) {
        search = start + 1;
        continue;
      }
      const otherEnd = findHtmlTagEnd(source, start + otherTag[0].length);
      if (otherEnd < 0) return -1;
      const otherName = otherTag[1].toLowerCase();
      if (otherName === 'script' || otherName === 'style') {
        search = findHtmlElementEnd(source, otherName, otherEnd);
        if (search < 0) return -1;
      } else if (HTML_RAW_TEXT_TAGS.has(otherName) || otherName === 'plaintext') {
        search = findHtmlRawTextEnd(source, otherName, otherEnd);
      } else {
        search = otherEnd + 1;
      }
      continue;
    }

    const tagEnd = findHtmlTagEnd(source, start + token[0].length);
    if (tagEnd < 0) return -1;
    if (token[1] === '/') {
      depth--;
      if (depth === 0) return tagEnd + 1;
    } else if (!/\/\s*>$/.test(source.slice(start, tagEnd + 1))) {
      depth++;
    }
    search = tagEnd + 1;
  }
  return -1;
}

function findHtmlContainerEnd(source: string, tag: string, openEnd: number): number {
  let search = openEnd + 1;
  while (search < source.length) {
    const start = source.indexOf('<', search);
    if (start < 0) return -1;
    if (source.startsWith('<!--', start)) {
      const commentEnd = source.indexOf('-->', start + 4);
      search = commentEnd < 0 ? source.length : commentEnd + 3;
      continue;
    }
    const tagMatch = source.slice(start).match(/^<(\/?)([a-z][\w:-]*)\b/i);
    if (!tagMatch) {
      search = start + 1;
      continue;
    }
    const name = tagMatch[2].toLowerCase();
    const tagEnd = findHtmlTagEnd(source, start + tagMatch[0].length);
    if (tagEnd < 0) return -1;
    if (name === tag && tagMatch[1] === '/') return tagEnd + 1;
    if (name === 'script' || name === 'style' || name === 'svg') {
      search = findHtmlElementEnd(source, name, tagEnd);
      if (search < 0) return -1;
      continue;
    }
    if (HTML_RAW_TEXT_TAGS.has(name) || name === 'plaintext') {
      search = findHtmlRawTextEnd(source, name, tagEnd);
      continue;
    }
    search = tagEnd + 1;
  }
  return -1;
}

function protectCompleteCodeElements(
  source: string,
  protect: (value: string) => string,
): string {
  let output = '';
  let cursor = 0;
  let search = 0;
  while (search < source.length) {
    const start = source.indexOf('<', search);
    if (start < 0) break;
    if (source.startsWith('<!--', start)) {
      const commentEnd = source.indexOf('-->', start + 4);
      search = commentEnd < 0 ? source.length : commentEnd + 3;
      continue;
    }
    const tagMatch = source.slice(start).match(/^<([a-z][\w:-]*)\b/i);
    if (!tagMatch) {
      search = start + 1;
      continue;
    }
    const tag = tagMatch[1].toLowerCase();
    const openEnd = findHtmlTagEnd(source, start + tagMatch[0].length);
    if (openEnd < 0) break;
    if (tag === 'script' || tag === 'style') {
      search = findHtmlElementEnd(source, tag, openEnd);
      if (search < 0) break;
      continue;
    }
    if (tag === 'pre' || tag === 'code') {
      const end = findHtmlContainerEnd(source, tag, openEnd);
      if (end < 0) break;
      output += source.slice(cursor, start) + protect(source.slice(start, end));
      cursor = end;
      search = end;
      continue;
    }
    if (HTML_RAW_TEXT_TAGS.has(tag) || tag === 'plaintext') {
      search = findHtmlRawTextEnd(source, tag, openEnd);
      continue;
    }
    search = openEnd + 1;
  }
  return output + source.slice(cursor);
}

function protectCompleteRawHtmlBlocks(
  content: string,
  protectedSegments: string[],
  markerPrefix: string,
  transform: (tag: string, block: string) => string,
  tags: string[] = ['style', 'script', 'svg'],
): string {
  let output = '';
  let cursor = 0;
  let search = 0;
  while (search < content.length) {
    const start = content.indexOf('<', search);
    if (start < 0) break;
    if (content.startsWith('<!--', start)) {
      const commentEnd = content.indexOf('-->', start + 4);
      search = commentEnd < 0 ? content.length : commentEnd + 3;
      continue;
    }
    const tagMatch = content.slice(start).match(/^<([a-z][\w:-]*)\b/i);
    if (!tagMatch) {
      search = start + 1;
      continue;
    }
    const tag = tagMatch[1].toLowerCase();
    const openEnd = findHtmlTagEnd(content, start + tagMatch[0].length);
    if (openEnd < 0) break;
    if (HTML_RAW_TEXT_TAGS.has(tag) || tag === 'plaintext') {
      search = findHtmlRawTextEnd(content, tag, openEnd);
      continue;
    }
    if ((tag === 'script' || tag === 'style') && !tags.includes(tag)) {
      search = findHtmlElementEnd(content, tag, openEnd);
      if (search < 0) break;
      continue;
    }
    if (!tags.includes(tag)) {
      search = openEnd + 1;
      continue;
    }
    const end = findHtmlElementEnd(content, tag, openEnd);
    if (end < 0) break;
    const markerPattern = new RegExp(markerPrefix + '([0-9]+)TOKEN', 'g');
    const block = content.slice(start, end).replace(
      markerPattern,
      (_token, index: string) => protectedSegments[Number(index)] ?? _token,
    );
    output += content.slice(cursor, start)
      + 'CYCYINLINEBLOCKX' + encodeInlinePayload(transform(tag, block)) + 'XEND';
    cursor = end;
    search = end;
  }
  return output + content.slice(cursor);
}

function protectStyledAnchors(
  content: string,
  protectedSegments: string[],
  markerPrefix: string,
): string {
  let output = '';
  let cursor = 0;
  let search = 0;
  while (search < content.length) {
    const start = content.indexOf('<', search);
    if (start < 0) break;
    if (content.startsWith('<!--', start)) {
      const commentEnd = content.indexOf('-->', start + 4);
      search = commentEnd < 0 ? content.length : commentEnd + 3;
      continue;
    }
    const tagMatch = content.slice(start).match(/^<([a-z][\w:-]*)\b/i);
    if (!tagMatch) {
      search = start + 1;
      continue;
    }
    const tagEnd = findHtmlTagEnd(content, start + tagMatch[0].length);
    if (tagEnd < 0) break;
    const tagName = tagMatch[1].toLowerCase();
    if (HTML_RAW_TEXT_TAGS.has(tagName) || tagName === 'plaintext') {
      search = findHtmlRawTextEnd(content, tagName, tagEnd);
      continue;
    }
    if (tagName === 'script' || tagName === 'style' || tagName === 'svg') {
      const rawEnd = findHtmlElementEnd(content, tagName, tagEnd);
      search = rawEnd >= 0 ? rawEnd : content.length;
      continue;
    }
    if (tagName !== 'a') {
      search = tagEnd + 1;
      continue;
    }
    const end = findHtmlContainerEnd(content, 'a', tagEnd);
    if (end < 0) break;
    const block = content.slice(start, end);
    const openingTag = content.slice(start, tagEnd + 1);
    if (!/\bstyle\s*=/i.test(openingTag) && !/<svg\b/i.test(block)) {
      search = tagEnd + 1;
      continue;
    }
    const markerPattern = new RegExp(markerPrefix + '([0-9]+)TOKEN', 'g');
    const restoredBlock = block.replace(
      markerPattern,
      (_token, index: string) => protectedSegments[Number(index)] ?? _token,
    );
    output += content.slice(cursor, start)
      + 'CYCYINLINEHTMLX' + encodeInlinePayload(restoredBlock) + 'XEND';
    cursor = end;
    search = end;
  }
  return output + content.slice(cursor);
}

function preserveInlineTagAttributes(
  content: string,
  isAllowed: (tag: string, name: string) => boolean,
): string {
  let output = '';
  let cursor = 0;
  let search = 0;
  while (search < content.length) {
    const start = content.indexOf('<', search);
    if (start < 0) break;
    if (content.startsWith('<!--', start)) {
      const commentEnd = content.indexOf('-->', start + 4);
      search = commentEnd < 0 ? content.length : commentEnd + 3;
      continue;
    }
    const tagMatch = content.slice(start).match(/^<([a-z][\w:-]*)\b/i);
    if (!tagMatch) {
      search = start + 1;
      continue;
    }
    const tag = tagMatch[1].toLowerCase();
    const tagEnd = findHtmlTagEnd(content, start + tagMatch[0].length);
    if (tagEnd < 0) break;
    if (HTML_RAW_TEXT_TAGS.has(tag) || tag === 'plaintext') {
      search = findHtmlRawTextEnd(content, tag, tagEnd);
      continue;
    }
    if (tag === 'script' || tag === 'style') {
      search = findHtmlElementEnd(content, tag, tagEnd);
      if (search < 0) break;
      continue;
    }
    const raw = content.slice(start, tagEnd + 1);
    const attributeStart = tagMatch[0].length;
    const attributes: Array<{ name: string; start: number; end: number; value: string }> = [];
    let index = attributeStart;
    while (index < raw.length - 1) {
      while (index < raw.length - 1 && /\s/.test(raw[index])) index++;
      if (raw[index] === '/') {
        index++;
        continue;
      }
      const attrStart = index;
      while (index < raw.length - 1 && !/[\s=/>]/.test(raw[index])) index++;
      if (index === attrStart) {
        index++;
        continue;
      }
      const name = raw.slice(attrStart, index).toLowerCase();
      while (index < raw.length - 1 && /\s/.test(raw[index])) index++;
      let value = '';
      if (raw[index] === '=') {
        index++;
        while (index < raw.length - 1 && /\s/.test(raw[index])) index++;
        const quote = raw[index] === '"' || raw[index] === "'" ? raw[index] : '';
        if (quote) {
          index++;
          const valueStart = index;
          while (index < raw.length - 1 && raw[index] !== quote) index++;
          value = raw.slice(valueStart, index);
          if (raw[index] === quote) index++;
        } else {
          const valueStart = index;
          while (index < raw.length - 1 && !/[\s>]/.test(raw[index])) index++;
          value = raw.slice(valueStart, index);
        }
      }
      attributes.push({ name, start: attrStart, end: index, value });
    }
    const preserved: Record<string, string> = {};
    const removals: Array<{ start: number; end: number }> = [];
    for (const attribute of attributes) {
      if (!isAllowed(tag, attribute.name)) continue;
      if (!Object.prototype.hasOwnProperty.call(preserved, attribute.name)) {
        preserved[attribute.name] = attribute.value;
      }
      removals.push({ start: attribute.start, end: attribute.end });
    }
    if (!Object.keys(preserved).length) {
      search = tagEnd + 1;
      continue;
    }
    let cleanAttrs = raw.slice(attributeStart, raw.length - 1);
    for (const removal of removals.sort((left, right) => right.start - left.start)) {
      const from = removal.start - attributeStart;
      const to = removal.end - attributeStart;
      cleanAttrs = cleanAttrs.slice(0, from) + cleanAttrs.slice(to);
    }
    output += content.slice(cursor, start)
      + '<' + tagMatch[1] + cleanAttrs + '>CYCYINLINEATTRX' + tag
      + 'X' + encodeInlinePayload(JSON.stringify(preserved)) + 'XEND';
    cursor = tagEnd + 1;
    search = cursor;
  }
  return output + content.slice(cursor);
}

function restoreInlineTagAttributeMarkers(
  source: string,
  isAllowed: (tag: string, name: string) => boolean,
): string {
  let output = '';
  let cursor = 0;
  let search = 0;
  while (search < source.length) {
    const start = source.indexOf('<', search);
    if (start < 0) break;
    if (source.startsWith('<!--', start)) {
      const commentEnd = source.indexOf('-->', start + 4);
      search = commentEnd < 0 ? source.length : commentEnd + 3;
      continue;
    }
    const tagMatch = source.slice(start).match(/^<([a-z][\w:-]*)\b/i);
    if (!tagMatch) {
      search = start + 1;
      continue;
    }
    const tagEnd = findHtmlTagEnd(source, start + tagMatch[0].length);
    if (tagEnd < 0) break;
    const tagName = tagMatch[1].toLowerCase();
    if (HTML_RAW_TEXT_TAGS.has(tagName) || tagName === 'plaintext') {
      search = findHtmlRawTextEnd(source, tagName, tagEnd);
      continue;
    }
    if (tagName === 'script' || tagName === 'style') {
      search = findHtmlElementEnd(source, tagName, tagEnd);
      if (search < 0) break;
      continue;
    }
    const markerMatch = source.slice(tagEnd + 1).match(/^CYCYINLINEATTRX([a-z][a-z0-9_:-]*)X([0-9a-f]+)XEND/i);
    if (!markerMatch) {
      search = tagEnd + 1;
      continue;
    }
    const actualTag = tagMatch[1].toLowerCase();
    let safe = '';
    if (actualTag === markerMatch[1].toLowerCase()) {
      try {
        const attributes = JSON.parse(decodeInlinePayload(markerMatch[2])) as Record<string, unknown>;
        safe = Object.entries(attributes).map(([name, value]) => {
          const key = name.toLowerCase();
          if (!isAllowed(actualTag, key)) return '';
          const text = String(value).replace(/"/g, '&quot;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;');
          return ' ' + key + '="' + text + '"';
        }).join('');
      } catch {
        safe = '';
      }
    }
    output += source.slice(cursor, start)
      + source.slice(start, tagEnd) + safe + '>';
    cursor = tagEnd + 1 + markerMatch[0].length;
    search = cursor;
  }
  return output + source.slice(cursor);
}

function findCompleteDivEnd(content: string, openEnd: number): number {
  let depth = 1;
  let search = openEnd + 1;
  while (search < content.length) {
    const start = content.indexOf('<', search);
    if (start < 0) return -1;
    if (content.startsWith('<!--', start)) {
      const commentEnd = content.indexOf('-->', start + 4);
      search = commentEnd < 0 ? content.length : commentEnd + 3;
      continue;
    }
    const tagMatch = content.slice(start).match(/^<(\/?)([a-z][\w:-]*)\b/i);
    if (!tagMatch) {
      search = start + 1;
      continue;
    }
    const tag = tagMatch[2].toLowerCase();
    const tagEnd = findHtmlTagEnd(content, start + tagMatch[0].length);
    if (tagEnd < 0) return -1;
    if (tag === 'script' || tag === 'style' || tag === 'svg') {
      search = findHtmlElementEnd(content, tag, tagEnd);
      if (search < 0) return -1;
      continue;
    }
    if (HTML_RAW_TEXT_TAGS.has(tag) || tag === 'plaintext') {
      search = findHtmlRawTextEnd(content, tag, tagEnd);
      continue;
    }
    if (tag === 'div') {
      if (tagMatch[1] === '/') {
        depth--;
        if (depth === 0) return tagEnd + 1;
      } else if (!/\/\s*>$/.test(content.slice(start, tagEnd + 1))) {
        depth++;
      }
    }
    search = tagEnd + 1;
  }
  return -1;
}

function protectCompleteDivContainers(content: string, protectedSegments: string[], markerPrefix: string): string {
  let output = '';
  let cursor = 0;
  let search = 0;
  while (search < content.length) {
    const start = content.indexOf('<', search);
    if (start < 0) break;
    if (content.startsWith('<!--', start)) {
      const commentEnd = content.indexOf('-->', start + 4);
      search = commentEnd < 0 ? content.length : commentEnd + 3;
      continue;
    }
    const tagMatch = content.slice(start).match(/^<(\/?)([a-z][\w:-]*)\b/i);
    if (!tagMatch) {
      search = start + 1;
      continue;
    }
    const tag = tagMatch[2].toLowerCase();
    const tagEnd = findHtmlTagEnd(content, start + tagMatch[0].length);
    if (tagEnd < 0) break;
    if (tag === 'script' || tag === 'style' || tag === 'svg') {
      search = findHtmlElementEnd(content, tag, tagEnd);
      if (search < 0) break;
      continue;
    }
    if (HTML_RAW_TEXT_TAGS.has(tag) || tag === 'plaintext') {
      search = findHtmlRawTextEnd(content, tag, tagEnd);
      continue;
    }
    if (tag !== 'div' || tagMatch[1] === '/' || /\/\s*>$/.test(content.slice(start, tagEnd + 1))) {
      search = tagEnd + 1;
      continue;
    }
    const end = findCompleteDivEnd(content, tagEnd);
    if (end < 0) break;
    const markerPattern = new RegExp(markerPrefix + '([0-9]+)TOKEN', 'g');
    const block = content.slice(start, end).replace(
      markerPattern,
      (_token, index: string) => protectedSegments[Number(index)] ?? _token,
    );
    output += content.slice(cursor, start)
      + 'CYCYINLINECONTAINERX' + encodeInlinePayload(block) + 'XEND';
    cursor = end;
    search = end;
  }
  return output + content.slice(cursor);
}


function createEntityAwareMarkerPrefixPattern(): RegExp {
  const character = (value: string): string => {
    const code = value.charCodeAt(0);
    return '(?:' + value + '|&#0*' + code + ';?|&#x0*' + code.toString(16) + ';?)';
  };
  const entityAware = (value: string): string => Array.from(value, character).join('');
  const names = ['INLINECONTAINERX', 'INLINEHTMLX', 'INLINEBLOCKX', 'INLINEATTRX', 'CODESEGMENT'];
  return new RegExp('(?:' + entityAware('CYCY') + ')('
    + names.map(entityAware).join('|') + ')', 'gi');
}

function decodeNumericCharacterReferences(value: string): string {
  return value.replace(/&#(?:x([0-9a-f]{1,8})|([0-9]{1,10}));?/gi, (_match, hex: string, decimal: string) => {
    const code = Number.parseInt(hex || decimal, hex ? 16 : 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff
      && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code)
      : '\ufffd';
  });
}

export function protectInlineHtmlLight(source: string): string {
  // Keep the ordinary-Markdown fast path, but inspect literal and entity-encoded
  // reserved marker prefixes before allowing content to reach the browser runtime.
  const markerPrefixPattern = createEntityAwareMarkerPrefixPattern();
  const hasReservedMarker = markerPrefixPattern.test(source);
  markerPrefixPattern.lastIndex = 0;
  if (!source.includes('<') && !hasReservedMarker) return source;

  const protectedSegments: string[] = [];
  // A per-render unpredictable prefix prevents user text from colliding with internal code placeholders.
  const protectedSegmentPrefix = 'CYPROTECTEDSEGMENT' + Math.random().toString(36).slice(2) + '_';
  const protectedSegmentPattern = new RegExp(protectedSegmentPrefix + '([0-9]+)TOKEN', 'g');
  const protect = (value: string): string => {
    const marker = protectedSegmentPrefix + protectedSegments.length + 'TOKEN';
    protectedSegments.push(value);
    return marker;
  };
  const restoreProtectedSegments = (value: string): string => value.replace(
    protectedSegmentPattern,
    (_token, index: string) => protectedSegments[Number(index)] ?? _token,
  );

  let content = protectCompleteCodeElements(source, protect);
  let fenceChar = '';
  let fenceLength = 0;
  const lines = content.split('\n');
  content = lines.map(line => {
    const fence = line.match(/^ {0,3}(\x60{3,}|~{3,})/);
    if (fenceChar) {
      const marker = protect(line);
      if (fence && fence[1][0] === fenceChar && fence[1].length >= fenceLength) {
        fenceChar = '';
        fenceLength = 0;
      }
      return marker;
    }
    if (fence) {
      fenceChar = fence[1][0];
      fenceLength = fence[1].length;
      return protect(line);
    }
    if (/^(?: {4}|\t)/.test(line)) return protect(line);

    return line.replace(/(\x60+)([\s\S]*?)\1/g, protect);
  }).join('\n');
  // Normalize literal and numeric-character-reference spellings outside protected code.
  content = content.replace(markerPrefixPattern, (_marker, name: string) =>
    'CY' + String.fromCharCode(0x200b) + 'CY' + decodeNumericCharacterReferences(name),
  );


  // Preserve styled download-card anchors as a single fragment so nested SVG markup
  // is not fragmented by Markdown tokenization or the core HTML sanitizer.
  content = protectStyledAnchors(
    content,
    protectedSegments,
    protectedSegmentPrefix,
  );

  content = protectCompleteRawHtmlBlocks(
    content,
    protectedSegments,
    protectedSegmentPrefix,
    (_tag, block) => block,
  );

  // Preserve complete div containers as one HTML fragment. CommonMark ends a
  // raw <div> block at blank lines, which otherwise breaks long embedded footers.

  content = protectCompleteDivContainers(content, protectedSegments, protectedSegmentPrefix);
    content = preserveInlineTagAttributes(
    content,
    (tag, name) => name === 'style' || name === 'class' || name === 'id' || name === 'title'
      || name === 'role' || name === 'width' || name === 'height' || name === 'alt'
      || name === 'loading' || name === 'type' || name === 'name' || name === 'value'
      || name === 'placeholder' || name.startsWith('data-') || name.startsWith('aria-'),
  );

  content = content.replace(
    protectedSegmentPattern,
    (_token, index: string) => protectedSegments[Number(index)] ?? _token,
  );
  return content;
}


const INLINE_FRAGMENT_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'a', 'div', 'p', 'span', 'strong', 'b', 'em', 'i', 'small', 'br', 'hr',
    'ul', 'ol', 'li', 'section', 'article', 'header', 'footer', 'nav', 'main',
    'figure', 'figcaption', 'time', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'img', 'button', 'label', 'blockquote', 'pre', 'code',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'details', 'summary', 'dl', 'dt', 'dd', 'picture', 'source',
    'video', 'audio',
    'svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon',
    'ellipse', 'defs', 'lineargradient', 'linearGradient',
    'radialgradient', 'radialGradient', 'stop', 'clippath', 'clipPath',
    'mask', 'title', 'desc', 'use', 'symbol',
  ],
  allowedAttributes: {
    '*': ['class', 'id', 'style', 'title', 'role', 'aria-label', 'aria-hidden'],
    a: ['href', 'target', 'rel', 'title', 'style', 'class', 'id', 'download'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'class', 'style'],
    div: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden'],
    p: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden'],
    span: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden'],
    section: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden'],
    article: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden'],
    header: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden'],
    footer: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden'],
    nav: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden'],
    main: ['style', 'class', 'id', 'title', 'role', 'aria-label', 'aria-hidden'],
    figure: ['style', 'class', 'id', 'title'],
    figcaption: ['style', 'class', 'id', 'title'],
    button: ['type', 'disabled', 'style', 'class', 'id', 'title', 'aria-label'],
    label: ['for', 'style', 'class', 'id'],
    blockquote: ['style', 'class', 'id', 'cite'],
    pre: ['style', 'class', 'id'],
    code: ['style', 'class', 'id'],
    table: ['style', 'class', 'id'],
    thead: ['style', 'class', 'id'],
    tbody: ['style', 'class', 'id'],
    tfoot: ['style', 'class', 'id'],
    tr: ['style', 'class', 'id'],
    th: ['style', 'class', 'id', 'colspan', 'rowspan', 'scope'],
    td: ['style', 'class', 'id', 'colspan', 'rowspan'],
    video: ['src', 'controls', 'width', 'height', 'poster', 'style', 'class'],
    audio: ['src', 'controls', 'style', 'class'],
    source: ['src', 'type'],
    svg: ['width', 'height', 'viewbox', 'viewBox', 'xmlns', 'fill', 'stroke',
      'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'style', 'class', 'id',
      'role', 'aria-label', 'aria-hidden', 'preserveAspectRatio'],
    g: ['id', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
      'opacity', 'transform', 'style'],
    path: ['id', 'd', 'fill', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width',
      'stroke-linecap', 'stroke-linejoin', 'opacity', 'style'],
    polyline: ['points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
      'stroke-linejoin', 'opacity', 'style'],
    polygon: ['points', 'fill', 'stroke', 'stroke-width', 'stroke-linejoin', 'opacity', 'style'],
    line: ['x1', 'y1', 'x2', 'y2', 'fill', 'stroke', 'stroke-width',
      'stroke-linecap', 'stroke-linejoin', 'opacity'],
    circle: ['id', 'cx', 'cy', 'r', 'fill', 'fill-rule', 'stroke', 'stroke-width', 'opacity', 'style'],
    ellipse: ['id', 'cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'opacity'],
    rect: ['id', 'x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'fill-rule',
      'stroke', 'stroke-width', 'opacity', 'style', 'clip-path'],
    defs: ['id'],
    lineargradient: ['id', 'x1', 'y1', 'x2', 'y2', 'gradientunits', 'gradienttransform', 'spreadmethod'],
    linearGradient: ['id', 'x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform', 'spreadMethod'],
    radialgradient: ['id', 'cx', 'cy', 'fx', 'fy', 'r', 'gradientunits', 'gradienttransform', 'spreadmethod'],
    radialGradient: ['id', 'cx', 'cy', 'fx', 'fy', 'r', 'gradientUnits', 'gradientTransform', 'spreadMethod'],
    stop: ['offset', 'stop-color', 'stop-opacity', 'style'],
    clippath: ['id', 'clippathunits'],
    clipPath: ['id', 'clipPathUnits'],
    mask: ['id', 'maskunits', 'maskcontentunits'],
    use: ['id', 'href', 'xlink:href', 'width', 'height', 'x', 'y'],
    symbol: ['id', 'viewbox', 'viewBox', 'preserveAspectRatio'],
  },
  allowedStyles: {
    '*': {
      color: [/^(?:#[0-9a-f]{3,8}|rgba?\([0-9.,%\s]+\)|var\(--[a-zA-Z0-9_-]+\)|[a-zA-Z]+)$/i],
      'color-scheme': [/^(?:normal|light|dark|light dark|only light|only dark)$/i],
      fill: [/^(?:none|currentColor|transparent|#[0-9a-f]{3,8}|rgba?\([0-9.,%\s]+\)|[a-zA-Z]+|url\(\s*#[\w:.-]+\s*\))$/i],
      stroke: [/^(?:none|currentColor|transparent|#[0-9a-f]{3,8}|rgba?\([0-9.,%\s]+\)|[a-zA-Z]+|url\(\s*#[\w:.-]+\s*\))$/i],
      'stroke-width': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'stroke-linecap': [/^(?:butt|round|square)$/i],
      'stroke-linejoin': [/^(?:arcs|bevel|miter|miter-clip|round)$/i],
      'stroke-dasharray': [/^(?:none|[-+]?\d*\.?\d+(?:px|em|rem|%)?(?:\s*,?\s*[-+]?\d*\.?\d+(?:px|em|rem|%)?)*)$/i],
      'stroke-dashoffset': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      font: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      background: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'background-color': [/^(?:#[0-9a-f]{3,8}|rgba?\([0-9.,%\s]+\)|var\(--[a-zA-Z0-9_-]+\)|[a-zA-Z]+)$/i],
      'background-image': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'font-weight': [/^(?:normal|bold|bolder|lighter|[1-9]00)$/i],
      'font-size': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'font-family': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'line-height': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'text-align': [/^(?:left|right|center|justify|start|end)$/i],
      'text-decoration': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'word-break': [/^(?:normal|break-all|keep-all|break-word)$/i],
      'overflow-wrap': [/^(?:normal|break-word|anywhere)$/i],
      display: [/^(?:inline|inline-block|inline-flex|block|flex|grid|inline-grid|none|table|table-cell)$/i],
      'align-items': [/^(?:center|start|end|flex-start|flex-end|baseline|stretch)$/i],
      'align-self': [/^(?:auto|center|start|end|flex-start|flex-end|baseline|stretch)$/i],
      'justify-content': [/^(?:normal|start|end|center|left|right|space-between|space-around|space-evenly|flex-start|flex-end)$/i],
      'flex-direction': [/^(?:row|row-reverse|column|column-reverse)$/i],
      'flex-wrap': [/^(?:nowrap|wrap|wrap-reverse)$/i],
      flex: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      gap: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      padding: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      margin: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      width: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      height: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'min-width': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'max-width': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'min-height': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'max-height': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      border: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'border-left': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'border-right': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'border-top': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'border-bottom': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'border-collapse': [/^(?:collapse|separate)$/i],
      'border-radius': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'border-color': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'border-width': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'border-style': [/^(?:none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset)$/i],
      'box-shadow': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      position: [/^(?:static|relative|absolute|fixed|sticky)$/i],
      top: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      right: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      bottom: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      left: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'z-index': [/^-?\d+$/],
      overflow: [/^(?:visible|hidden|clip|scroll|auto)$/i],
      'overflow-x': [/^(?:visible|hidden|clip|scroll|auto)$/i],
      'overflow-y': [/^(?:visible|hidden|clip|scroll|auto)$/i],
      cursor: [/^(?:auto|default|pointer|wait|text|move|not-allowed|grab|grabbing)$/i],
      opacity: [/^(?:0|1|0?\.[0-9]+|100%)$/i],
      transform: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      transition: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'object-fit': [/^(?:fill|contain|cover|none|scale-down)$/i],
      'vertical-align': [/^(?:middle|baseline|top|bottom|text-top|text-bottom)$/i],
      'white-space': [/^(?:normal|nowrap|pre|pre-wrap|pre-line|break-spaces)$/i],
      'letter-spacing': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'aspect-ratio': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'grid-template-columns': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'grid-template-rows': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'grid-auto-flow': [/^(?:row|column|dense|row dense|column dense)$/i],
      'grid-auto-columns': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'grid-auto-rows': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'grid-column': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'grid-row': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'align-content': [/^(?:normal|center|start|end|flex-start|flex-end|space-between|space-around|space-evenly|stretch)$/i],
      'justify-items': [/^(?:normal|start|end|center|stretch|self-start|self-end|left|right)$/i],
      'place-items': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'box-sizing': [/^(?:content-box|border-box)$/i],
      'font-style': [/^(?:normal|italic|oblique)$/i],
      'text-transform': [/^(?:none|capitalize|uppercase|lowercase)$/i],
      'text-shadow': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'object-position': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'flex-basis': [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'flex-grow': [/^\d+(?:\.\d+)?$/],
      'flex-shrink': [/^\d+(?:\.\d+)?$/],
      animation: [/^(?!.*(?:expression|javascript:|@import|url\s*\())[-#(),.%\w\s"'!/+*]+$/i],
      'animation-name': [/^(?:none|[_a-z][\w-]*|(?:[_a-z][\w-]*\s*,\s*)*[_a-z][\w-]*)$/i],
      'animation-duration': [/^(?:0|\d*\.?\d+(?:ms|s))(?:\s*,\s*(?:0|\d*\.?\d+(?:ms|s)))*$/i],
      'animation-timing-function': [/^(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|steps\([^;{}]+\)|cubic-bezier\([^;{}]+\))(?:\s*,\s*(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|steps\([^;{}]+\)|cubic-bezier\([^;{}]+\)))*$/i],
      'animation-delay': [/^(?:0|[-+]?\d*\.?\d+(?:ms|s))(?:\s*,\s*(?:0|[-+]?\d*\.?\d+(?:ms|s)))*$/i],
      'animation-iteration-count': [/^(?:infinite|\d*\.?\d+)(?:\s*,\s*(?:infinite|\d*\.?\d+))*$/i],
      'animation-direction': [/^(?:normal|reverse|alternate|alternate-reverse)(?:\s*,\s*(?:normal|reverse|alternate|alternate-reverse))*$/i],
      'animation-fill-mode': [/^(?:none|forwards|backwards|both)(?:\s*,\s*(?:none|forwards|backwards|both))*$/i],
      'animation-play-state': [/^(?:running|paused)(?:\s*,\s*(?:running|paused))*$/i],
      'font-stretch': [/^(?:normal|ultra-condensed|extra-condensed|condensed|semi-condensed|semi-expanded|expanded|extra-expanded|ultra-expanded|\d+(?:\.\d+)?%)$/i],
    },
  },
};
function decodeInlinePayload(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

function sanitizeInlineSvgReferences(source: string): string {
  return source.replace(/<(?:svg|g|path|use|symbol|mask|clippath|lineargradient|radialgradient)\b[^>]*>/gi, tag => {
    let safe = tag.replace(/\s+(href|xlink:href)\s*=\s*(["'])(.*?)\2/gi, (attribute, _name, _quote, value) =>
      /^#[\w:.-]+$/.test(String(value).trim()) ? attribute : '',
    );
    safe = safe.replace(/\s+(fill|stroke|clip-path|mask)\s*=\s*(["'])(.*?)\2/gi, (attribute, _name, _quote, value) => {
      const cssValue = String(value).trim();
      return /\burl\s*\(/i.test(cssValue) && !/^url\(\s*#[\w:.-]+\s*\)$/i.test(cssValue)
        ? ''
        : attribute;
    });
    return safe;
  });
}

function sanitizeInlineHtmlFragment(source: string): string {
  // sanitize-html attribute names are exact-match entries; expand only valid
  // data-/aria- names actually present in this fragment, rather than relying
  // on a "data-*" attribute glob that may be treated as a literal name.
  const baseAttributes = INLINE_FRAGMENT_SANITIZE_OPTIONS.allowedAttributes;
  const allowedAttributes: Record<string, string[]> = Array.isArray(baseAttributes)
    ? { '*': [...baseAttributes] }
    : Object.fromEntries(Object.entries(baseAttributes || {}).map(([tag, names]) => [tag, [...(names || [])]]));
  const addAttribute = (tag: string, name: string) => {
    for (const key of ['*', tag]) {
      const list = allowedAttributes[key] || (allowedAttributes[key] = []);
      if (!list.includes(name)) list.push(name);
    }
  };
  const tagPattern = /<([a-z][\w:-]*)\b([^>]*)>/gi;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagPattern.exec(source))) {
    const tag = tagMatch[1].toLowerCase();
    if (!INLINE_FRAGMENT_SANITIZE_OPTIONS.allowedTags?.includes(tag)) continue;
    const attributePattern = /(?:^|\s)(data-[a-z0-9_.:-]+|aria-[a-z0-9_.:-]+)(?=\s|=|$)/gi;
    let attributeMatch: RegExpExecArray | null;
    while ((attributeMatch = attributePattern.exec(tagMatch[2]))) {
      addAttribute(tag, attributeMatch[1].toLowerCase());
    }
  }
  return sanitizeHtml(sanitizeInlineSvgReferences(source), {
    ...INLINE_FRAGMENT_SANITIZE_OPTIONS,
    allowedAttributes,
  });
}

export function restoreInlineHtmlFragmentsLight(content: string): string {
  if (!content.includes('CYCYINLINECONTAINERX')
    && !content.includes('CYCYINLINEHTMLX')
    && !content.includes('CYCYINLINEBLOCKX')
    && !content.includes('CYCYINLINEATTRX')) return content;

  const restoreContainer = (payload: string): string => {
    let source = decodeInlinePayload(payload);

    // Keep style/script blocks as inert text markers through fragment sanitization.
    // The opt-in frontend runtime restores them only when the enhancement is enabled.
    source = protectCompleteRawHtmlBlocks(
      source,
      [],
      '\\u0000CYRESTORE',
      (_tag, block) => block,
    );

    // Reattach preserved attributes before sanitizing the restored container.
    // Attribute values are escaped here; the fragment sanitizer remains the
    // final allowlist enforcement layer.
    source = restoreInlineTagAttributeMarkers(source, (tag, key) => key === 'style' || key === 'class' || key === 'id' || key === 'title'
        || key === 'role' || key === 'width' || key === 'height' || key === 'alt'
        || key === 'loading' || key === 'type' || key === 'name' || key === 'value'
        || key === 'placeholder' || key.startsWith('data-') || key.startsWith('aria-'));

    const safe = sanitizeInlineHtmlFragment(source);
    return safe ? '<div class="cy-inline-html-pending">' + safe + '</div>' : '';
  };

  // The Markdown parser wraps a standalone placeholder in <p>; replace the
  // whole paragraph so a restored block-level container is never nested in <p>.
  let restored = content.replace(
    /<p>\s*CYCYINLINECONTAINERX([0-9a-f]+)XEND\s*<\/p>/gi,
    (_marker, payload: string) => restoreContainer(payload),
  );
  restored = restored.replace(
    /CYCYINLINECONTAINERX([0-9a-f]+)XEND/g,
    (_marker, payload: string) => restoreContainer(payload),
  );

  restored = restored.replace(/CYCYINLINEHTMLX([0-9a-f]+)XEND/g, (_marker, payload: string) => {
    // Preserve nested SVG verbatim through the HTML sanitizer. The browser
    // runtime will rebuild each SVG using its dedicated SVG allowlist.
    const source = protectCompleteRawHtmlBlocks(
      decodeInlinePayload(payload),
      [],
      '\\u0000CYRESTORE',
      (_tag, block) => block,
      ['svg'],
    );
    const safe = sanitizeInlineHtmlFragment(source);
    return safe ? '<span class="cy-inline-html-pending">' + safe + '</span>' : '';
  });

  // Keep protected blocks inert until the opt-in browser runtime handles them.
  // Do not pass SVG through sanitize-html: it normalizes SVG attribute names
  // (for example viewBox -> viewbox), which breaks rendering. The runtime parses
  // SVG as image/svg+xml and rebuilds it with a strict SVG allowlist.
  restored = restored.replace(/CYCYINLINEBLOCKX([0-9a-f]+)XEND/g, marker => marker);
  return restored;
}

const INLINE_HTML_RUNTIME_LIGHT = "(() => {\n  const enabled = __CY_ENABLED__;\n  const allowScripts = __CY_ALLOW_SCRIPTS__;\n  const markerPattern = /CYCYINLINEBLOCKX([0-9a-f]+)XEND|CYCYINLINEATTRX([a-z][a-z0-9_:-]*)X([0-9a-f]+)XEND/g;\n  const svgTags = new Set(['svg','g','path','circle','rect','line','polyline','polygon','ellipse','defs','lineargradient','radialgradient','stop','clippath','mask','title','desc','use','symbol']);\n  const svgAttrs = new Set(['id','class','viewbox','width','height','fill','fill-rule','clip-rule','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','opacity','fill-opacity','stroke-opacity','cx','cy','r','rx','ry','x','y','x1','x2','y1','y2','d','points','transform','preserveaspectratio','offset','stop-color','stop-opacity','gradientunits','gradienttransform','clippathunits','maskunits','maskcontentunits','clip-path','mask','filter','href','xlink:href','role','focusable','aria-hidden','aria-label']);\n  const decode = hex => { const bytes = new Uint8Array(hex.length / 2); for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); return new TextDecoder().decode(bytes); };\n  const decodeAttribute = value => { const decoder = document.createElement('div'); decoder.innerHTML = String(value).replace(/</g, '&lt;'); return decoder.textContent || ''; };\n\n  let inlineSvgSequence = 0;\n  const collectSvgIds = (node, idMap, duplicateIds = new Set()) => {\n    if (!node || node.nodeType !== Node.ELEMENT_NODE || !svgTags.has(node.localName.toLowerCase())) return;\n    for (const attr of Array.from(node.attributes || [])) {\n      if (attr.name.toLowerCase() !== 'id' || !/^[\\w:.-]+$/.test(attr.value)) continue;\n      if (duplicateIds.has(attr.value)) continue;\n      if (idMap.has(attr.value)) {\n        idMap.delete(attr.value);\n        duplicateIds.add(attr.value);\n        continue;\n      }\n      idMap.set(attr.value, 'cy-inline-light-svg-' + inlineSvgSequence + '-' + attr.value);\n    }\n    for (const child of Array.from(node.childNodes || [])) collectSvgIds(child, idMap, duplicateIds);\n  };\n  const rewriteSvgReferences = (value, idMap) => {\n    let valid = true;\n    const rewritten = String(value).replace(/url\\(\\s*(?:([\\\"'])#([\\w:.-]+)\\1|#([\\w:.-]+))\\s*\\)/gi, (_match, _quote, quotedId, bareId) => {\n      const scopedId = idMap.get(quotedId || bareId);\n      if (!scopedId) { valid = false; return ''; }\n      return 'url(#' + scopedId + ')';\n    });\n    return valid ? rewritten : null;\n  };\n  const safeSvgNode = (node, idMap) => {\n    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue || '');\n    if (node.nodeType !== Node.ELEMENT_NODE || !svgTags.has(node.localName.toLowerCase())) return null;\n    const clean = document.createElementNS('http://www.w3.org/2000/svg', node.localName);\n    for (const attr of Array.from(node.attributes)) {\n      const key = attr.name.toLowerCase(), value = attr.value;\n      if (!svgAttrs.has(key) && key !== 'style' && !key.startsWith('aria-')) continue;\n      if (key === 'style') {\n        const allowedStyle = new Set(['fill','stroke','fill-rule','clip-rule','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','opacity','fill-opacity','stroke-opacity','stop-color','stop-opacity']);\n        const safeStyle = value.split(';').map(part => part.trim()).filter(Boolean).map(part => {\n          const split = part.indexOf(':');\n          if (split < 1) return '';\n          const property = part.slice(0, split).trim().toLowerCase();\n          const cssValue = part.slice(split + 1).trim();\n          if (!allowedStyle.has(property) || cssValue.includes('\\\\') || cssValue.includes('/*')\n            || /expression|javascript:|data:|@import|[\\u0000-\\u001f]/i.test(cssValue)) return '';\n          if (/\\burl\\s*\\(/i.test(cssValue) && !/^url\\(\\s*(?:([\\\"'])#[\\w:.-]+\\1|#[\\w:.-]+)\\s*\\)$/i.test(cssValue)) return '';\n          const rewritten = rewriteSvgReferences(cssValue, idMap);\n          return rewritten === null ? '' : property + ':' + rewritten;\n        }).filter(Boolean).join(';');\n        if (safeStyle) clean.setAttribute('style', safeStyle);\n        continue;\n      }\n      if (key === 'id') {\n        const scopedId = idMap.get(value);\n        if (scopedId) clean.setAttribute('id', scopedId);\n        continue;\n      }\n      if (key === 'aria-labelledby' || key === 'aria-describedby') {\n        const ids = value.trim().split(/\\s+/).filter(Boolean);\n        const scopedIds = ids.map(id => idMap.get(id));\n        if (!ids.length || scopedIds.some(id => !id)) continue;\n        clean.setAttribute(attr.name, scopedIds.join(' '));\n        continue;\n      }\n      if (key === 'href' || key === 'xlink:href') {\n        if (!/^#[\\w:.-]+$/.test(value)) continue;\n        const scopedId = idMap.get(value.slice(1));\n        if (!scopedId) continue;\n        const rewritten = '#' + scopedId;\n        if (key === 'xlink:href') clean.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', rewritten);\n        else clean.setAttribute(attr.name, rewritten);\n        continue;\n      }\n      if (['fill','stroke','clip-path','mask','filter'].includes(key)\n        && (value.includes('\\\\') || value.includes('/*'))) continue;\n      if (/\\burl\\s*\\(/i.test(value) && !/^\\s*url\\(\\s*(?:([\\\"'])#[\\w:.-]+\\1|#[\\w:.-]+)\\s*\\)\\s*$/i.test(value)) continue;\n      if (/javascript:|data:text\\/html|[\\u0000-\\u001f]/i.test(value)) continue;\n      const rewritten = rewriteSvgReferences(value, idMap);\n      if (rewritten === null) continue;\n      if (key === 'xlink:href') clean.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', rewritten);\n      else clean.setAttribute(attr.name, rewritten);\n    }\n    for (const child of Array.from(node.childNodes)) {\n      const safe = safeSvgNode(child, idMap);\n      if (safe) clean.appendChild(safe);\n    }\n    return clean;\n  };\n  const allowedProperties = new Set([\n    'color','color-scheme','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','background','background-color','background-image','backdrop-filter','-webkit-backdrop-filter','font','font-weight','font-size','font-family','line-height','text-align','text-decoration','word-break','overflow-wrap','display','align-items','align-self','justify-content','flex-direction','flex-wrap','flex','gap','padding','margin','margin-bottom','width','height','min-width','max-width','min-height','max-height','border','border-left','border-right','border-top','border-bottom','border-collapse','border-radius','border-color','border-width','border-style','box-shadow','position','inset','top','right','bottom','left','z-index','overflow','overflow-x','overflow-y','cursor','pointer-events','opacity','transform','transition','object-fit','vertical-align','white-space','letter-spacing','aspect-ratio','grid-template-columns','grid-template-rows','grid-auto-flow','grid-auto-columns','grid-auto-rows','grid-column','grid-row','align-content','justify-items','place-items','box-sizing','content','font-style','text-transform','text-shadow','object-position','flex-basis','flex-grow','flex-shrink','animation','animation-name','animation-duration','animation-timing-function','animation-delay','animation-iteration-count','animation-direction','animation-fill-mode','animation-play-state','font-stretch'\n  ]);\n  const safeValue = value => {\n    const normalized = String(value || '').trim();\n    const withoutLocalUrls = normalized.replace(/url\\(\\s*(?:([\"'])#[\\w:.-]+\\1|#[\\w:.-]+)\\s*\\)/gi, '');\n    return !!normalized\n      && !/[\\u0000-\\u001f\\u007f]/.test(normalized)\n      && !normalized.includes('\\\\') && !normalized.includes('/*')\n      && !/(?:expression|javascript\\s*:|vbscript\\s*:|@import|behavior\\s*:|-moz-binding)/i.test(normalized)\n      && !/(?:-webkit-)?image-set\\s*\\(/i.test(normalized)\n      && !/url\\s*\\(/i.test(withoutLocalUrls);\n  };\n  const safeInlineStyleText = value => {\n    try {\n      const probe = document.createElement('span');\n      if (!probe.style) return '';\n      probe.style.cssText = String(value || '');\n      const declarations = [];\n      for (let index = 0; index < probe.style.length; index++) {\n        const property = probe.style.item(index).toLowerCase();\n        if (!allowedProperties.has(property) && !/^--[a-z0-9_-]+$/i.test(property)) continue;\n        const cssValue = probe.style.getPropertyValue(property);\n        if (!safeValue(cssValue)) continue;\n        const priority = probe.style.getPropertyPriority(property);\n        declarations.push(property + ':' + cssValue + (priority === 'important' ? ' !important' : ''));\n      }\n      return declarations.join(';');\n    } catch {\n      return '';\n    }\n  };\n\n  let inlineStyleScopeSequence = 0;\n  const safeStylesheetText = (cssText, scopeRoot) => {\n    try {\n      if (!scopeRoot || !scopeRoot.classList) return '';\n      const scopeClass = 'cy-inline-light-scope-' + (++inlineStyleScopeSequence)\n        + '-' + Math.random().toString(36).slice(2);\n      scopeRoot.classList.add(scopeClass);\n      const scope = '.' + scopeClass;\n      let sheet;\n      if (typeof CSSStyleSheet === 'function' && CSSStyleSheet.prototype\n        && typeof CSSStyleSheet.prototype.replaceSync === 'function') {\n        try {\n          sheet = new CSSStyleSheet();\n          sheet.replaceSync(cssText);\n        } catch {\n          sheet = null;\n        }\n      }\n      if ((!sheet || !sheet.cssRules) && document.implementation\n        && typeof document.implementation.createHTMLDocument === 'function') {\n        const parserDocument = document.implementation.createHTMLDocument('');\n        const parserStyle = parserDocument.createElement('style');\n        parserStyle.textContent = cssText;\n        parserDocument.head.appendChild(parserStyle);\n        sheet = parserStyle.sheet;\n      }\n      if (!sheet || !sheet.cssRules) return '';\n      const splitSelectors = selectorText => {\n        const selectors = [];\n        let start = 0, depth = 0, quote = '';\n        for (let index = 0; index < selectorText.length; index++) {\n          const character = selectorText[index];\n          if (quote) {\n            if (character === quote && selectorText[index - 1] !== '\\\\') quote = '';\n          } else if (character === '\"' || character === \"'\") quote = character;\n          else if (character === '(' || character === '[') depth++;\n          else if (character === ')' || character === ']') depth = Math.max(0, depth - 1);\n          else if (character === ',' && depth === 0) {\n            selectors.push(selectorText.slice(start, index).trim());\n            start = index + 1;\n          }\n        }\n        selectors.push(selectorText.slice(start).trim());\n        return selectors.filter(Boolean);\n      };\n      const scopeSelector = selectorText => {\n        const selectors = [];\n        for (const selector of splitSelectors(selectorText)) {\n          if (/:global\\s*\\(|:host(?:-context)?\\b|::slotted\\s*\\(/i.test(selector)) continue;\n          if (/^(?:html|body|:root)\\s*$/i.test(selector)) {\n            scopeRoot.classList.add('cy-inline-html-root-scope');\n            selectors.push(scope);\n            continue;\n          }\n          const rootPrefix = selector.match(/^(?:html|body|:root)(?=$|[\\s>+~.#:[\\]])/i);\n          if (rootPrefix) {\n            scopeRoot.classList.add('cy-inline-html-root-scope');\n            let remainder = selector;\n            while (true) {\n              const rootToken = remainder.match(/^(?:html|body|:root)(?=$|[\\s>+~.#:[\\]])/i);\n              if (!rootToken) break;\n              remainder = remainder.slice(rootToken[0].length);\n              const whitespace = remainder.match(/^\\s+/);\n              if (whitespace) {\n                remainder = remainder.slice(whitespace[0].length);\n                const spacedCombinator = remainder.match(/^[>+~]\\s*/);\n                if (spacedCombinator) {\n                  remainder = remainder.slice(spacedCombinator[0].length);\n                  if (/^(?:html|body|:root)(?=$|[\\s>+~.#:[\\]])/i.test(remainder)) continue;\n                  remainder = ' ' + spacedCombinator[0].trim() + (remainder ? ' ' + remainder : '');\n                  break;\n                }\n                if (/^(?:html|body|:root)(?=$|[\\s>+~.#:[\\]])/i.test(remainder)) continue;\n                remainder = remainder ? ' ' + remainder : '';\n                break;\n              }\n              const combinator = remainder.match(/^[>+~]\\s*/);\n              if (combinator) {\n                remainder = remainder.slice(combinator[0].length);\n                if (/^(?:html|body|:root)(?=$|[\\s>+~.#:[\\]])/i.test(remainder)) continue;\n                remainder = ' ' + combinator[0].trim() + (remainder ? ' ' + remainder : '');\n                break;\n              }\n              break;\n            }\n            selectors.push(scope + remainder);\n            continue;\n          }\n          if (/(^|[\\s>+~,(])(?:html|body)(?=$|[\\s>+~.#:[\\],)])/i.test(selector)\n            || /:root\\b/i.test(selector)) continue;\n          if (selector === '*') selectors.push(scope + ',' + scope + ' *');\n          else selectors.push(scope + ' ' + selector);\n        }\n        return selectors.join(',');\n      };\n      const keyframeNames = new Map();\n      const fontFamilyNames = new Map();\n      const genericFontFamilies = new Set(['serif','sans-serif','monospace','cursive','fantasy','system-ui','ui-serif','ui-sans-serif','ui-monospace','ui-rounded','math','emoji','fangsong']);\n      const collectKeyframes = rules => {\n        for (const rule of Array.from(rules || [])) {\n          const match = String(rule.cssText || '').match(/^@(?:-webkit-)?keyframes\\s+([_a-z][\\w-]*)/i);\n          if (match) keyframeNames.set(match[1], scopeClass + '-' + match[1]);\n          if (rule.style && (rule.type === 5 || /FontFaceRule/i.test(rule.constructor && rule.constructor.name || ''))) {\n            const rawFamily = String(rule.style.getPropertyValue('font-family') || '').trim();\n            const family = rawFamily.replace(/^[\"']|[\"']$/g, '');\n            if (/^[_a-z][\\w -]*$/i.test(family) && !genericFontFamilies.has(family.toLowerCase())) {\n              fontFamilyNames.set(family.toLowerCase(), scopeClass + '-font-' + fontFamilyNames.size);\n            }\n          }\n          if (rule.cssRules) collectKeyframes(rule.cssRules);\n        }\n      };\n      collectKeyframes(sheet.cssRules);\n      const rewriteAnimationNames = (property, value) => {\n        if (property !== 'animation' && property !== 'animation-name') return value;\n        for (const [original, scopedName] of keyframeNames) {\n          const pattern = new RegExp('(^|[\\\\s,])' + original + '(?=$|[\\\\s,])', 'g');\n          value = value.replace(pattern, (_match, prefix) => prefix + scopedName);\n        }\n        return value;\n      };\n      const rewriteFontFamily = (property, value) => {\n        if (property !== 'font-family' && property !== 'font') return value;\n        for (const [original, scopedName] of fontFamilyNames) {\n          value = value.replace(new RegExp('\"' + original + '\"', 'gi'), '\"' + scopedName + '\"');\n          value = value.replace(new RegExp(\"'\" + original + \"'\", 'gi'), \"'\" + scopedName + \"'\");\n          if (!original.includes(' ')) {\n            const pattern = new RegExp('(^|[\\\\s,])' + original + '(?=$|[\\\\s,])', 'gi');\n            value = value.replace(pattern, (_match, prefix) => prefix + scopedName);\n          }\n        }\n        return value;\n      };\n      const serializeDeclarations = (style, extraAllowed) => {\n        const declarations = [];\n        for (let index = 0; index < style.length; index++) {\n          const property = style.item(index).toLowerCase();\n          const value = rewriteFontFamily(property, rewriteAnimationNames(property, style.getPropertyValue(property)));\n          if ((!allowedProperties.has(property) && !extraAllowed.has(property)\n            && !/^--[a-z0-9_-]+$/i.test(property)) || !safeValue(value)) continue;\n          const priority = style.getPropertyPriority(property);\n          declarations.push(property + ':' + value + (priority === 'important' ? ' !important' : ''));\n        }\n        return declarations.join(';');\n      };\n      const serializeRules = (rules, keyframeChildren = false) => {\n        let output = '';\n        for (const rule of Array.from(rules || [])) {\n          if (rule.type === 1 && rule.style && rule.selectorText) {\n            const selector = keyframeChildren ? rule.selectorText : scopeSelector(rule.selectorText);\n            const declarations = serializeDeclarations(rule.style, new Set());\n            if (selector && declarations) output += selector + '{' + declarations + '}';\n          } else if (rule.style && (rule.type === 5 || /FontFaceRule/i.test(rule.constructor && rule.constructor.name || ''))) {\n            const declarations = serializeDeclarations(rule.style, new Set(['src','font-display','font-stretch','unicode-range']));\n            if (declarations) output += '@font-face{' + declarations + '}';\n          } else if (rule.style && rule.keyText) {\n            const declarations = serializeDeclarations(rule.style, new Set());\n            if (declarations) output += rule.keyText + '{' + declarations + '}';\n          } else if (rule.cssRules) {\n            const ruleText = String(rule.cssText || '');\n            const atRule = ruleText.match(/^@([\\w-]+)\\s*([^{]*)/);\n            const name = atRule && atRule[1].toLowerCase();\n            const condition = rule.conditionText || (rule.media && rule.media.mediaText)\n              || (atRule && atRule[2].trim()) || '';\n            const nested = serializeRules(rule.cssRules, name === 'keyframes' || name === '-webkit-keyframes');\n            if (!nested) continue;\n            if ((name === 'keyframes' || name === '-webkit-keyframes') && /^[\\w-]+$/.test(condition)) {\n              output += '@' + name + ' ' + (keyframeNames.get(condition) || condition) + '{' + nested + '}';\n            } else if (['media','supports','container'].includes(name) && condition\n              && !/[{};]/.test(condition)) {\n              output += '@' + name + ' ' + condition + '{' + nested + '}';\n            } else if (name === 'layer' && /^[\\w-]+(?:\\.[\\w-]+)*$/.test(condition)) {\n              output += '@layer ' + scopeClass + '.' + condition + '{' + nested + '}';\n            }\n          }\n        }\n        return output;\n      };\n      return serializeRules(sheet.cssRules);\n    } catch {\n      return '';\n    }\n  };\n  const addBlock = (raw, scopeRoot) => {\n    const blockTemplate = document.createElement('template');
    blockTemplate.innerHTML = raw;
    const blockElement = blockTemplate.content.firstElementChild;
    if (!blockElement || blockTemplate.content.childNodes.length !== 1) return null;
    const tag = blockElement.localName.toLowerCase();
    if (!['style','script','svg'].includes(tag)) return null;
    const body = blockElement.textContent || '';
    if (tag === 'script' && !allowScripts) return null;\n    if (tag === 'svg') {\n      try { const parsed = new DOMParser().parseFromString(raw, 'image/svg+xml'); if (parsed.querySelector('parsererror') || parsed.documentElement.localName.toLowerCase() !== 'svg') return null; const idMap = new Map(); inlineSvgSequence++; collectSvgIds(parsed.documentElement, idMap); return safeSvgNode(parsed.documentElement, idMap); } catch { return null; }\n    }\n    if (tag === 'style') {
      const safeCss = safeStylesheetText(body, scopeRoot);
      if (!safeCss) return null;
      const style = document.createElement('style');
      let parsedStyle;
      try {
        parsedStyle = blockElement;
      } catch { return null; }
      if (!parsedStyle) return null;
      for (const attribute of parsedStyle.attributes) {
        const name = attribute.name.toLowerCase();
        if (['media','nonce','title','id','type'].includes(name) || name.startsWith('data-') || name.startsWith('aria-')) {
          const value = name === 'nonce' ? (parsedStyle.nonce || attribute.value) : attribute.value;
          style.setAttribute(name, value);
        }
      }
      style.textContent = safeCss;
      document.head.appendChild(style);
      return null;
    }
    const script = document.createElement('script');
    // Parse attributes as HTML so entities and boolean attributes follow browser rules.
    let parsedScript;
    try {
      parsedScript = blockElement;
    } catch { return null; }
    if (!parsedScript || parsedScript.hasAttribute('src')) return null;
    const scriptType = (parsedScript.getAttribute('type') || '').trim().toLowerCase();
    if (scriptType && !['module','text/javascript','application/javascript'].includes(scriptType)) return null;
    if (scriptType) script.type = scriptType;
    script.textContent = body; document.body.appendChild(script); return null;\n  };\n  const hydrate = () => {\n    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode(node) { const p = node.parentElement; if (!p || p.closest('pre,code,textarea,script,style')) return NodeFilter.FILTER_REJECT; markerPattern.lastIndex = 0; return markerPattern.test(node.nodeValue || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; } });\n    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);\n    for (const node of nodes) {\n      const value = node.nodeValue || ''; markerPattern.lastIndex = 0; let last = 0, match, changed = false; const fragment = document.createDocumentFragment();\n      while ((match = markerPattern.exec(value))) {\n        changed = true; if (match.index > last) fragment.appendChild(document.createTextNode(value.slice(last, match.index)));\n        if (enabled && match[1]) { const scopeRoot = node.parentElement && (node.parentElement.closest('.cy-inline-html-pending') || node.parentElement.closest('.warm-prose') || node.parentElement.closest('article')); const element = addBlock(decode(match[1]), scopeRoot); if (element) fragment.appendChild(element); }\n        else if (enabled && match[2] && match[3]) {\n          const parent = node.parentElement, previous = node.previousElementSibling;\n          const target = parent && parent.tagName.toLowerCase() === match[2] ? parent : previous && previous.tagName.toLowerCase() === match[2] ? previous : parent;\n          if (target) {\n            try {\n              const attrs = JSON.parse(decode(match[3]));\n              for (const [name, value] of Object.entries(attrs)) {\n                const decodedValue = decodeAttribute(value);\n                if (name === 'style') { const safeStyle = safeInlineStyleText(decodedValue); if (safeStyle) target.setAttribute('style', safeStyle); }\n                else if (name === 'class' || name === 'id' || name === 'title' || name === 'role'\n                  || name === 'width' || name === 'height' || name === 'alt' || name === 'loading'\n                  || name === 'type' || name === 'name' || name === 'value' || name === 'placeholder'\n                  || name.startsWith('data-') || name.startsWith('aria-')) {\n                  target.setAttribute(name, decodedValue);\n                }\n              }\n            } catch {}\n          }\n        }\n        last = match.index + match[0].length;\n      }\n      if (changed) { if (last < value.length) fragment.appendChild(document.createTextNode(value.slice(last))); node.parentNode && node.parentNode.replaceChild(fragment, node); }\n    }\n  };\n  hydrate(); window.addEventListener('instantclick:newpage', hydrate);\n})();";
export function inlineHtmlRuntimeLight(enabled: boolean, allowScripts = false): string {
  const visibilityStyle = '<style data-cy-inline-html-enhancement-style>'
    + '.cy-inline-html-pending{display:' + (enabled ? 'contents' : 'none') + '!important}'
    + '.cy-inline-html-pending.cy-inline-html-root-scope{display:' + (enabled ? 'block' : 'none') + '!important}'
    + '</style>';
  return visibilityStyle + '<script data-cy-inline-html-enhancement>'
    + INLINE_HTML_RUNTIME_LIGHT.replace('__CY_ENABLED__', enabled ? 'true' : 'false').replace('__CY_ALLOW_SCRIPTS__', allowScripts ? 'true' : 'false')
    + '</script>';
}
