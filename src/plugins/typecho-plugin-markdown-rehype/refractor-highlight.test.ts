import { describe, expect, it } from 'vitest';
import { getSupportedLanguageCount, getUnregisteredLanguages, highlightCode } from './client/lib/refractor-highlight';

function collectElements(nodes: any[]): any[] {
  return nodes.flatMap(node => node.type === 'element'
    ? [node, ...collectElements(node.children || [])]
    : []);
}

function className(node: any): string {
  const value = node.properties?.className;
  return Array.isArray(value) ? value.join(' ') : String(value || '');
}

describe('Rin Refractor code highlighting', () => {
  it('registers the complete 297-language Prism grammar set', () => {
    expect(getSupportedLanguageCount()).toBe(297);
    expect(getUnregisteredLanguages()).toEqual([]);
  });

  it('returns Prism token classes for JavaScript', () => {
    const tree = highlightCode('const answer = 42;', 'javascript');
    const classes = collectElements(tree.children).map(className);

    expect(classes.some(value => value.includes('keyword'))).toBe(true);
    expect(classes.some(value => value.includes('number'))).toBe(true);
  });

  it('keeps plain and unknown languages as text', () => {
    expect(highlightCode('plain text', 'text').children).toEqual([
      { type: 'text', value: 'plain text' },
    ]);
    expect(highlightCode('source', 'not-a-real-language').children).toEqual([
      { type: 'text', value: 'source' },
    ]);
  });

  it('returns only inert span nodes for HTML code samples', () => {
    const tree = highlightCode('<script>alert(1)</script>', 'html');
    const elements = collectElements(tree.children);
    expect(elements.length).toBeGreaterThan(0);
    expect(elements.every(node => node.tagName === 'span')).toBe(true);
  });
});
