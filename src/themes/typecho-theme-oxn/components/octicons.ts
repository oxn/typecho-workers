/**
 * Complete GitHub Primer Octicons catalogue.
 * Source: https://github.com/primer/octicons
 * MIT License; see OCTICONS-LICENSE.txt.
 *
 * The catalogue is available to server-side theme code, but only icons
 * explicitly requested by a component are emitted into page HTML.
 */
// @ts-ignore -- @primer/octicons currently ships CommonJS without TypeScript declarations.
import octiconsData from '@primer/octicons';

interface OcticonVariant {
  path: string;
  width: number;
}

interface OcticonDefinition {
  heights: Record<string, OcticonVariant>;
}

const importedIcons = octiconsData as unknown as { default?: Record<string, OcticonDefinition> } & Record<string, OcticonDefinition>;
const upstreamIcons = (importedIcons.default ?? importedIcons) as Record<string, OcticonDefinition>;

// Custom OXN icons are kept separate from the upstream Octicons catalogue.
// This Cloudflare mark was supplied for OXN and is not an upstream Octicon.
// Its 40:19 viewBox is preserved inside the square output box without distortion.
const cloudflareIcon: OcticonDefinition = {
  heights: {
    '19': {
      width: 40,
      path: '<path fill="#F6821F" d="m27.16 18.507.204-.735c.242-.873.152-1.68-.255-2.274-.374-.547-.998-.868-1.755-.906l-14.346-.19a.3.3 0 0 1-.127-.034.3.3 0 0 1-.099-.09.31.31 0 0 1-.03-.27.4.4 0 0 1 .128-.185.37.37 0 0 1 .205-.081l14.479-.192c1.717-.082 3.576-1.536 4.227-3.31l.826-2.25a.55.55 0 0 0 .022-.298C29.702 3.29 25.94 0 21.44 0c-4.146 0-7.667 2.792-8.928 6.673a4.1 4.1 0 0 0-2.978-.86c-1.99.206-3.589 1.877-3.786 3.953a4.6 4.6 0 0 0 .11 1.547C2.605 11.41 0 14.189 0 17.603q0 .459.065.911c.009.07.042.134.093.18.05.047.116.072.183.073l26.485.003h.007a.34.34 0 0 0 .205-.076.36.36 0 0 0 .122-.187"></path><path fill="#FBAD41" d="M31.94 8.153q-.2 0-.397.01a.2.2 0 0 0-.062.014.2.2 0 0 0-.091.061.24.24 0 0 0-.054.098l-.564 2.033c-.243.874-.152 1.68.254 2.274.375.547.998.868 1.756.906l3.058.191a.3.3 0 0 1 .123.035.28.28 0 0 1 .142.22.3.3 0 0 1-.015.14.4.4 0 0 1-.128.185.37.37 0 0 1-.205.08l-3.177.192c-1.725.083-3.585 1.536-4.235 3.31l-.23.626a.18.18 0 0 0 .017.16.166.166 0 0 0 .134.08h10.941c.064 0 .126-.021.176-.06a.3.3 0 0 0 .106-.16 8.5 8.5 0 0 0 .291-2.216c0-4.517-3.51-8.18-7.84-8.18"></path>',
    },
  },
};

const customIcons: Record<string, OcticonDefinition> = {
  cf: cloudflareIcon,
  cloudflare: cloudflareIcon,
  bilibili: {
    heights: {
      '18': {
        width: 18,
        path: '<path fill-rule="evenodd" clip-rule="evenodd" d="M3.73252 2.67094C3.33229 2.28484 3.33229 1.64373 3.73252 1.25764C4.11291 0.890684 4.71552 0.890684 5.09591 1.25764L7.21723 3.30403C7.27749 3.36218 7.32869 3.4261 7.37081 3.49407H10.5789C10.6211 3.4261 10.6723 3.36218 10.7325 3.30403L12.8538 1.25764C13.2342 0.890684 13.8368 0.890684 14.2172 1.25764C14.6175 1.64373 14.6175 2.28484 14.2172 2.67094L13.364 3.49407H14C16.2091 3.49407 18 5.28493 18 7.49407V12.9996C18 15.2087 16.2091 16.9996 14 16.9996H4C1.79086 16.9996 0 15.2087 0 12.9996V7.49406C0 5.28492 1.79086 3.49407 4 3.49407H4.58579L3.73252 2.67094ZM4 5.42343C2.89543 5.42343 2 6.31886 2 7.42343V13.0702C2 14.1748 2.89543 15.0702 4 15.0702H14C15.1046 15.0702 16 14.1748 16 13.0702V7.42343C16 6.31886 15.1046 5.42343 14 5.42343H4ZM5 9.31747C5 8.76519 5.44772 8.31747 6 8.31747C6.55228 8.31747 7 8.76519 7 9.31747V10.2115C7 10.7638 6.55228 11.2115 6 11.2115C5.44772 11.2115 5 10.7638 5 10.2115V9.31747ZM12 8.31747C11.4477 8.31747 11 8.76519 11 9.31747V10.2115C11 10.7638 11.4477 11.2115 12 11.2115C12.5523 11.2115 13 10.7638 13 10.2115V9.31747Z" fill="currentColor"/>',
      },
    },
  },
};

const icons: Record<string, OcticonDefinition> = {
  ...upstreamIcons,
  ...customIcons,
};

interface ResolvedOcticon {
  height: number;
  variant: OcticonVariant;
}

interface ParsedOcticonMarker {
  marker: string;
  name: string;
  size?: number;
  title?: string;
}

interface RenderIconInputOptions {
  /** Render non-icon plain text instead of treating it as an icon-only field. */
  plainText?: boolean;
}

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => HTML_ENTITIES[char] ?? char);
}

function parseOcticonMarker(value: string): ParsedOcticonMarker | null {
  const match = value.match(/^\{\{(?:octicon|icons):([a-z0-9-]+)((?:\|[^|}]*)*)\}\}/i);
  if (!match) return null;

  const parsed: ParsedOcticonMarker = {
    marker: match[0],
    name: match[1].toLowerCase(),
  };

  for (const parameter of match[2].split('|').filter(Boolean)) {
    const separator = parameter.indexOf('=');
    if (separator < 1) continue;

    const key = parameter.slice(0, separator).trim().toLowerCase();
    const parameterValue = parameter.slice(separator + 1);
    if (key === 'size') {
      const requestedSize = Number(parameterValue.trim());
      if (Number.isInteger(requestedSize) && requestedSize > 0 && requestedSize <= 256) {
        parsed.size = requestedSize;
      }
    } else if (key === 'title' && parameterValue.trim()) {
      parsed.title = parameterValue;
    }
  }

  return parsed;
}

function resolveOcticon(name: string): ResolvedOcticon | null {
  const value = typeof name === 'string' ? name.trim() : '';
  const sizedName = value.toLowerCase().match(/^(.+)-(16|24)$/);
  const iconName = sizedName?.[1] ?? value.toLowerCase();
  const icon = icons[iconName];
  if (!icon) return null;

  const requestedHeight = sizedName?.[2];
  const height = requestedHeight
    ? Number(requestedHeight)
    : icon.heights['16']
      ? 16
      : Number(Object.keys(icon.heights).sort((a, b) => Number(a) - Number(b))[0]);
  const variant = icon.heights[String(height)];
  if (!variant?.path || !variant.width) return null;

  return { height, variant };
}

export function octiconPath(name: string): string {
  return resolveOcticon(name)?.variant.path ?? '';
}

export function octiconSvg(name: string, size = 16, title?: string): string {
  const resolved = resolveOcticon(name);
  if (!resolved) return '';

  const { height, variant } = resolved;
  const outputSize = Number.isFinite(size) && size > 0 ? size : 16;
  const safeTitle = typeof title === 'string' ? title.trim() : '';
  const titleMarkup = safeTitle ? `<title>${escapeHtml(safeTitle)}</title>` : '';
  const accessibility = safeTitle
    ? `role="img" aria-label="${escapeHtml(safeTitle)}"`
    : 'aria-hidden="true"';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${outputSize}" height="${outputSize}" viewBox="0 0 ${variant.width} ${height}" fill="currentColor" ${accessibility}>${titleMarkup}${variant.path}</svg>`;
}

/**
 * Shared content renderer for footer links, independent-page icon fields,
 * and navigation labels.
 *
 * Supported Octicon syntax:
 *   {{octicon:home}}
 *   {{octicon:home|size=16|title=Back home}}
 *
 * The legacy {{icons:name}} marker and bare icon names remain compatible.
 * Raw HTML/SVG is passed through unchanged; use native markup such as
 * <span title="提示文本">...</span> when an HTML/SVG tooltip is needed.
 */
export function renderIconInput(
  value: unknown,
  size = 16,
  options: RenderIconInputOptions = {},
): string {
  if (typeof value !== 'string') return '';
  const input = value.trim();
  if (!input) return '';

  const marker = parseOcticonMarker(input);
  if (marker) {
    const icon = octiconSvg(marker.name, marker.size ?? size, marker.title);
    if (!icon) return options.plainText ? escapeHtml(input) : '';
    const trailingText = input.slice(marker.marker.length);
    const trailingHtml = /<[a-z][\s\S]*>/i.test(trailingText);
    return icon + (trailingText ? trailingHtml ? trailingText : escapeHtml(trailingText) : '');
  }

  if (/<[a-z][\s\S]*>/i.test(input)) return input;
  if (options.plainText) return escapeHtml(input);

  // Keep existing bare-name values working for backward compatibility.
  return octiconSvg(input, size);
}
