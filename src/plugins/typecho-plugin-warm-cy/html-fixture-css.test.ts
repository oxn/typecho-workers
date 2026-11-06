import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inlineHtmlRuntime } from './html-full';
import { inlineHtmlRuntimeLight } from './html-light';

const fixturePaths = [
  '../../../cy-html-comprehensive-test-1文章.html',
  '../../../cy-html-comprehensive-test文章.html',
  '../../../cy-video-iframe-diagnostic文章.html',
];

function fixtureCssProperties(): Set<string> {
  const properties = new Set<string>();
  for (const path of fixturePaths) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const styleBlocks = source.matchAll(/<style\\b[^>]*>([\\s\\S]*?)<\\/style\\s*>/gi);
    for (const block of styleBlocks) {
      for (const match of block[1].matchAll(/(?:^|[;{])\\s*([-\\w]+)\\s*:/g)) {
        const property = match[1].toLowerCase();
        if (!property.startsWith('--')) properties.add(property);
      }
    }
  }
  return properties;
}

function runtimeCssProperties(runtime: string): Set<string> {
  const match = runtime.match(/const allowedProperties = new Set\\(\\[([\\s\\S]*?)\\]\\);/);
  if (!match) throw new Error('CSS allowlist not found in HTML runtime');
  return new Set(Array.from(match[1].matchAll(/'([^']+)'/g), item => item[1]));
}

describe('Warm CY HTML fixture CSS compatibility', () => {
  it('keeps every CSS property used by all uploaded article fixtures in both modes', () => {
    const fixtureProperties = fixtureCssProperties();
    const fullProperties = runtimeCssProperties(inlineHtmlRuntime());
    const lightProperties = runtimeCssProperties(inlineHtmlRuntimeLight(true));

    expect(fixtureProperties.size).toBeGreaterThan(0);
    for (const property of fixtureProperties) {
      expect(fullProperties.has(property), 'full mode should allow ' + property).toBe(true);
      expect(lightProperties.has(property), 'light mode should allow ' + property).toBe(true);
    }
  });

  it('keeps the full and lightweight CSS allowlists aligned', () => {
    const fullProperties = runtimeCssProperties(inlineHtmlRuntime());
    const lightProperties = runtimeCssProperties(inlineHtmlRuntimeLight(true));
    expect([...fullProperties].sort()).toEqual([...lightProperties].sort());
  });
});
