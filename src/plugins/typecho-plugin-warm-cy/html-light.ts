import sanitizeHtml from 'sanitize-html';

// Exact CY plugin 2026.11.04.20.41 pipeline, shipped with Warm CY theme 2026.11.04.23.12.
// Keep this implementation isolated so the lightweight mode cannot drift with full mode.
function encodeInlinePayload(value: string): string {
  return Array.from(new TextEncoder().encode(value), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function protectCompleteDivContainers(content: string, protectedSegments: string[]): string {
  const tagPattern = /<\/?div\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  let output = '';
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(content))) {
    if (/^<\//.test(match[0]) || /\/\s*>$/.test(match[0])) continue;

    let depth = 1;
    let closeEnd = -1;
    let nested: RegExpExecArray | null;
    while ((nested = tagPattern.exec(content))) {
      if (/^<\//.test(nested[0])) depth -= 1;
      else if (!/\/\s*>$/.test(nested[0])) depth += 1;
      if (depth === 0) {
        closeEnd = tagPattern.lastIndex;
        break;
      }
    }
    if (closeEnd < 0) break;

    const block = content.slice(match.index, closeEnd).replace(
      /CYCYCODESEGMENT(\d+)TOKEN/g,
      (_token, index: string) => protectedSegments[Number(index)] ?? _token,
    );

    // Protect every complete div container, not only multiline footers.
    // Even a single-line div is stripped by the core sanitizer, which breaks
    // its class/style attributes and makes the remaining content look plain.

    output += content.slice(cursor, match.index)
      + 'CYCYINLINECONTAINERX' + encodeInlinePayload(block) + 'XEND';
    cursor = closeEnd;
    tagPattern.lastIndex = closeEnd;
  }

  return output + content.slice(cursor);
}
export function protectInlineHtmlLight(source: string): string {
  const protectedSegments: string[] = [];
  const protect = (value: string): string => {
    const marker = 'CYCYCODESEGMENT' + protectedSegments.length + 'TOKEN';
    protectedSegments.push(value);
    return marker;
  };
  const restoreProtectedSegments = (value: string): string => value.replace(
    /CYCYCODESEGMENT(\d+)TOKEN/g,
    (_token, index: string) => protectedSegments[Number(index)] ?? _token,
  );

  let content = source.replace(/<(pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, protect);
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

  // Preserve styled download-card anchors as a single fragment so nested SVG markup
  // is not fragmented by Markdown tokenization or the core HTML sanitizer.
  content = content.replace(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi, block => {
    if (!/\bstyle\s*=|<svg\b/i.test(block)) return block;
    return 'CYCYINLINEHTMLX' + encodeInlinePayload(restoreProtectedSegments(block)) + 'XEND';
  });

  content = content.replace(
    /<(style|script|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    block => 'CYCYINLINEBLOCKX' + encodeInlinePayload(restoreProtectedSegments(block)) + 'XEND',
  );

  // Preserve complete div containers as one HTML fragment. CommonMark ends a
  // raw <div> block at blank lines, which otherwise breaks long embedded footers.

  content = protectCompleteDivContainers(content, protectedSegments);
  content = content.replace(/<([a-z][\w:-]*)(\s[^<>]*?)>/gi, (full, tag: string, attrs: string) => {
    const preserved: Record<string, string> = {};
    const attributePattern = /([^\s=\/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let match: RegExpExecArray | null;
    while ((match = attributePattern.exec(attrs))) {
      const name = match[1].toLowerCase();
      if (name === 'style' || name === 'class' || name === 'id' || name === 'title'
        || name === 'role' || name === 'width' || name === 'height' || name === 'alt'
        || name === 'loading' || name === 'type' || name === 'name' || name === 'value'
        || name === 'placeholder'
        || name.startsWith('data-') || name.startsWith('aria-')) {
        preserved[name] = match[2] ?? match[3] ?? match[4] ?? '';
      }
    }
    if (!Object.keys(preserved).length) return full;
    const cleanAttrs = attrs.replace(attributePattern, (attribute, name: string) =>
      Object.prototype.hasOwnProperty.call(preserved, name.toLowerCase()) ? '' : attribute,
    );
    return '<' + tag + cleanAttrs + '>CYCYINLINEATTRX' + tag.toLowerCase()
      + 'X' + encodeInlinePayload(JSON.stringify(preserved)) + 'XEND';
  });

  for (let index = protectedSegments.length - 1; index >= 0; index--) {
    content = content.replace('CYCYCODESEGMENT' + index + 'TOKEN', protectedSegments[index]);
  }
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
  return sanitizeHtml(sanitizeInlineSvgReferences(source), INLINE_FRAGMENT_SANITIZE_OPTIONS);
}

export function restoreInlineHtmlFragmentsLight(content: string): string {
  const restoreContainer = (payload: string): string => {
    let source = decodeInlinePayload(payload);

    // Keep style/script blocks as inert text markers through fragment sanitization.
    // The opt-in frontend runtime restores them only when the enhancement is enabled.
    source = source.replace(/<(style|script|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, block =>
      'CYCYINLINEBLOCKX' + encodeInlinePayload(block) + 'XEND',
    );

    // Reattach preserved attributes before sanitizing the restored container.
    // Attribute values are escaped here; the fragment sanitizer remains the
    // final allowlist enforcement layer.
    source = source.replace(
      /(<[a-z][\w:-]*\b[^>]*>)CYCYINLINEATTRX([a-z][\w:-]*)X([0-9a-f]+)XEND/gi,
      (marker, opening: string, _tag: string, encoded: string) => {
        try {
          const attributes = JSON.parse(decodeInlinePayload(encoded)) as Record<string, unknown>;
          const safe = Object.entries(attributes).map(([name, value]) => {
            const key = name.toLowerCase();
            if (!(key === 'style' || key === 'class' || key === 'id' || key === 'title'
              || key === 'role' || key === 'width' || key === 'height' || key === 'alt'
              || key === 'loading' || key === 'type' || key === 'name' || key === 'value'
              || key === 'placeholder' || key.startsWith('data-') || key.startsWith('aria-'))) return '';
            const text = String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
              .replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return ' ' + key + '="' + text + '"';
          }).join('');
          return opening.replace(/>$/, safe + '>');
        } catch {
          return opening;
        }
      },
    );

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
    const source = decodeInlinePayload(payload).replace(
      /<svg\b[^>]*>[\s\S]*?<\/svg\s*>/gi,
      svg => 'CYCYINLINEBLOCKX' + encodeInlinePayload(svg) + 'XEND',
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

const INLINE_HTML_RUNTIME_LIGHT = "(() => {\n  const enabled = __CY_ENABLED__;\n  const markerPattern = /CYCYINLINEBLOCKX([0-9a-f]+)XEND|CYCYINLINEATTRX([a-z][\\w:-]*)X([0-9a-f]+)XEND/g;\n  const svgTags = new Set(['svg','g','path','circle','rect','line','polyline','polygon','ellipse','defs','lineargradient','radialgradient','stop','clippath','mask','title','desc','use','symbol']);\n  const svgAttrs = new Set(['id','class','viewbox','width','height','fill','fill-rule','clip-rule','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','opacity','fill-opacity','stroke-opacity','cx','cy','r','rx','ry','x','y','x1','x2','y1','y2','d','points','transform','preserveaspectratio','offset','stop-color','stop-opacity','gradientunits','gradienttransform','clippathunits','maskunits','maskcontentunits','clip-path','mask','filter','href','xlink:href','role','focusable','aria-hidden','aria-label']);\n  const decode = hex => { const bytes = new Uint8Array(hex.length / 2); for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); return new TextDecoder().decode(bytes); };\n  const safeSvgNode = node => {\n    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue || '');\n    if (node.nodeType !== Node.ELEMENT_NODE || !svgTags.has(node.localName.toLowerCase())) return null;\n    const clean = document.createElementNS('http://www.w3.org/2000/svg', node.localName);\n    for (const attr of Array.from(node.attributes)) {\n      const key = attr.name.toLowerCase(), value = attr.value;\n      if (!svgAttrs.has(key) && key !== 'style' && !key.startsWith('aria-')) continue;\n      if (key === 'style') {\n        const allowedStyle = new Set(['fill','stroke','fill-rule','clip-rule','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','opacity','fill-opacity','stroke-opacity','stop-color','stop-opacity']);\n        const safeStyle = value.split(';').map(part => part.trim()).filter(Boolean).map(part => {\n          const split = part.indexOf(':');\n          if (split < 1) return '';\n          const property = part.slice(0, split).trim().toLowerCase();\n          const cssValue = part.slice(split + 1).trim();\n          if (!allowedStyle.has(property) || /expression|javascript:|data:|@import|[\\u0000-\\u001f]/i.test(cssValue)) return '';\n          if (/\\burl\\s*\\(/i.test(cssValue) && !/^url\\(\\s*#[\\w:.-]+\\s*\\)$/i.test(cssValue)) return '';\n          return property + ':' + cssValue;\n        }).filter(Boolean).join(';');\n        if (safeStyle) clean.setAttribute('style', safeStyle);\n        continue;\n      }\n      if ((key === 'href' || key === 'xlink:href') && !/^#[\\w:.-]+$/.test(value)) continue;\n      if (/\\burl\\s*\\(/i.test(value) && !/^\\s*url\\(\\s*#[\\w:.-]+\\s*\\)\\s*$/i.test(value)) continue;\n      if (/javascript:|data:text\\/html|[\\u0000-\\u001f]/i.test(value)) continue;\n      if (key === 'xlink:href') clean.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', value); else clean.setAttribute(attr.name, value);\n    }\n    for (const child of Array.from(node.childNodes)) { const safe = safeSvgNode(child); if (safe) clean.appendChild(safe); }\n    return clean;\n  };\n  const addBlock = raw => {\n    const match = raw.match(/^<(style|script|svg)\\b([^>]*)>([\\s\\S]*)<\\/\\1\\s*>$/i);\n    if (!match) return null;\n    const tag = match[1].toLowerCase(), attrs = match[2] || '', body = match[3] || '';\n    if (tag === 'svg') {\n      try { const parsed = new DOMParser().parseFromString(raw, 'image/svg+xml'); if (parsed.querySelector('parsererror') || parsed.documentElement.localName.toLowerCase() !== 'svg') return null; return safeSvgNode(parsed.documentElement); } catch { return null; }\n    }\n    if (tag === 'style') { const style = document.createElement('style'); const media = attrs.match(/\\bmedia\\s*=\\s*(?:\\\"([^\\\"]*)\\\"|'([^']*)')/i); if (media) style.media = media[1] || media[2] || ''; style.textContent = body; document.head.appendChild(style); return null; }\n    const script = document.createElement('script');\n    const type = attrs.match(/\\btype\\s*=\\s*(?:\\\"([^\\\"]*)\\\"|'([^']*)')/i);\n    const scriptType = (type && (type[1] || type[2]) || '').toLowerCase();\n    if (scriptType && !['module','text/javascript','application/javascript'].includes(scriptType)) return null;\n    if (scriptType) script.type = scriptType;\n    script.textContent = body; document.body.appendChild(script); return null;\n  };\n  const hydrate = () => {\n    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode(node) { const p = node.parentElement; if (!p || p.closest('pre,code,textarea,script,style')) return NodeFilter.FILTER_REJECT; markerPattern.lastIndex = 0; return markerPattern.test(node.nodeValue || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; } });\n    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);\n    for (const node of nodes) {\n      const value = node.nodeValue || ''; markerPattern.lastIndex = 0; let last = 0, match, changed = false; const fragment = document.createDocumentFragment();\n      while ((match = markerPattern.exec(value))) {\n        changed = true; if (match.index > last) fragment.appendChild(document.createTextNode(value.slice(last, match.index)));\n        if (enabled && match[1]) { const element = addBlock(decode(match[1])); if (element) fragment.appendChild(element); }\n        else if (enabled && match[2] && match[3]) {\n          const parent = node.parentElement, previous = node.previousElementSibling;\n          const target = parent && parent.tagName.toLowerCase() === match[2] ? parent : previous && previous.tagName.toLowerCase() === match[2] ? previous : parent;\n          if (target) {\n            try {\n              const attrs = JSON.parse(decode(match[3]));\n              for (const [name, value] of Object.entries(attrs)) {\n                if (name === 'style') target.style.cssText = String(value);\n                else if (name === 'class' || name === 'id' || name === 'title' || name === 'role'\n                  || name === 'width' || name === 'height' || name === 'alt' || name === 'loading'\n                  || name === 'type' || name === 'name' || name === 'value' || name === 'placeholder'\n                  || name.startsWith('data-') || name.startsWith('aria-')) {\n                  target.setAttribute(name, String(value));\n                }\n              }\n            } catch {}\n          }\n        }\n        last = match.index + match[0].length;\n      }\n      if (changed) { if (last < value.length) fragment.appendChild(document.createTextNode(value.slice(last))); node.parentNode && node.parentNode.replaceChild(fragment, node); }\n    }\n  };\n  hydrate(); window.addEventListener('instantclick:newpage', hydrate);\n})();";
export function inlineHtmlRuntimeLight(enabled: boolean): string {
  const visibilityStyle = '<style data-cy-inline-html-enhancement-style>'
    + '.cy-inline-html-pending{display:' + (enabled ? 'contents' : 'none') + '!important}'
    + '</style>';
  return visibilityStyle + '<script data-cy-inline-html-enhancement>'
    + INLINE_HTML_RUNTIME_LIGHT.replace('__CY_ENABLED__', enabled ? 'true' : 'false')
    + '</script>';
}
