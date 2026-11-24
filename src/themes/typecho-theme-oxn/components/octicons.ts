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
const icons = (importedIcons.default ?? importedIcons) as Record<string, OcticonDefinition>;

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
