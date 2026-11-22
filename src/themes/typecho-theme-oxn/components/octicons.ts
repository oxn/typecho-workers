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

function resolveOcticon(name: string): ResolvedOcticon | null {
  const value = typeof name === 'string' ? name.trim() : '';
  const marker = value.match(/^\{\{(?:octicon|icons):([a-z0-9-]+)\}\}$/i);
  const normalized = (marker?.[1] ?? value).toLowerCase();
  const sizedName = normalized.match(/^(.+)-(16|24)$/);
  const iconName = sizedName?.[1] ?? normalized;
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

export function octiconSvg(name: string, size = 16): string {
  const resolved = resolveOcticon(name);
  if (!resolved) return '';

  const { height, variant } = resolved;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${variant.width} ${height}" fill="currentColor" aria-hidden="true"><path d="${variant.path}"></path></svg>`;
}

/**
 * Accept the same icon input in navigation and footer settings:
 * Octicon marker, raw HTML/SVG, or a legacy bare Octicon name.
 * Append -16 or -24 to a name to select that source variant explicitly.
 */
export function renderIconInput(value: unknown, size = 16): string {
  if (typeof value !== 'string') return '';
  const input = value.trim();
  if (!input) return '';

  const marker = input.match(/^\{\{octicon:([a-z0-9-]+)\}\}$/i);
  if (marker) return octiconSvg(marker[1], size);

  if (/<[a-z][\s\S]*>/i.test(input)) return input;

  // Keep existing bare-name values working for backward compatibility.
  return octiconSvg(input, size);
}
