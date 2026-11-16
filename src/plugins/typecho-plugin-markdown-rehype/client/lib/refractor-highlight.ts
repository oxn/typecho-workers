import { refractor } from 'refractor/all';

export interface RefractorTextNode {
  type: 'text';
  value: string;
}

export interface RefractorElementNode {
  type: 'element';
  tagName: string;
  properties?: {
    className?: string[] | string;
  };
  children: RefractorNode[];
}

export type RefractorNode = RefractorTextNode | RefractorElementNode;

export interface RefractorRoot {
  type: 'root';
  children: RefractorNode[];
}

function plainTextRoot(value: string): RefractorRoot {
  return {
    type: 'root',
    children: [{ type: 'text', value }],
  };
}

/** Use Rin's Refractor/Prism AST engine, falling back to unmodified plain text. */
export function highlightCode(value: string, language: string): RefractorRoot {
  if (!language || language === 'text') return plainTextRoot(value);
  try {
    return refractor.highlight(value, language) as RefractorRoot;
  } catch {
    return plainTextRoot(value);
  }
}

export function getSupportedLanguageCount(): number {
  return refractor.listLanguages().length;
}
