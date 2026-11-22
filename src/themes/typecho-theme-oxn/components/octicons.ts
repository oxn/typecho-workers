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
  toSVG?: (options?: Record<string, string | number>) => string;
}

const importedIcons = octiconsData as unknown as { default?: Record<string, OcticonDefinition> } & Record<string, OcticonDefinition>;
const icons = (importedIcons.default ?? importedIcons) as Record<string, OcticonDefinition>;

function normalizeOcticonName(name: string): string {
  const value = typeof name === 'string' ? name.trim() : '';
  const marker = value.match(/^\{\{(?:octicon|icons):([a-z0-9-]+)\}\}$/i);
  return (marker?.[1] ?? value).toLowerCase();
}

export function octiconPath(name: string): string {
  const icon = icons[normalizeOcticonName(name)];
  if (!icon) return '';

  const variant =
    icon.heights['16'] ??
    icon.heights[Object.keys(icon.heights).sort((a, b) => Number(a) - Number(b))[0]];

  return variant?.path ?? '';
}

export function octiconSvg(name: string, size = 16): string {
  const icon = icons[normalizeOcticonName(name)];
  if (!icon) return '';

  // Prefer Primer's renderer when available; the package's data export may
  // contain plain icon definitions without the toSVG helper.
  if (icon.toSVG) {
    return icon.toSVG({ width: size, height: size, fill: 'currentColor' });
  }

  const height = icon.heights['16']
    ? 16
    : Number(Object.keys(icon.heights).sort((a, b) => Number(a) - Number(b))[0]);
  const variant = icon.heights[String(height)];
  if (!variant?.path || !variant.width || !height) return '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${variant.width} ${height}" fill="currentColor" aria-hidden="true"><path d="${variant.path}"></path></svg>`;
}

/**
 * Accept the same icon input in navigation and footer settings:
 * Octicon marker, raw HTML/SVG, or a legacy bare Octicon name.
 */
export function renderIconInput(value: unknown, size = 16): string {
  if (typeof value !== 'string') return '';
  const input = value.trim();
  if (!input) return '';

  const marker = input.match(/^\\{\\{octicon:([a-z0-9-]+)\\}\\}$/i);
  if (marker) return octiconSvg(marker[1], size);

  if (/<[a-z][\\s\\S]*>/i.test(input)) return input;

  // Keep existing bare-name values working for backward compatibility.
  return octiconSvg(input, size);
}
