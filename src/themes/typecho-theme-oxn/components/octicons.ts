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

const icons = octiconsData as unknown as Record<string, OcticonDefinition>;

export function octiconPath(name: string): string {
  const icon = icons[name];
  if (!icon) return '';

  const variant =
    icon.heights['16'] ??
    icon.heights[Object.keys(icon.heights).sort((a, b) => Number(a) - Number(b))[0]];

  return variant?.path ?? '';
}

export function octiconSvg(name: string, size = 16): string {
  const icon = icons[name];
  if (!icon) return '';

  // Primer selects the closest native artwork size and preserves its viewBox.
  return icon.toSVG
    ? icon.toSVG({ width: size, height: size, fill: 'currentColor' })
    : '';
}
