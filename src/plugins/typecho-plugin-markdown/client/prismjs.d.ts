declare module 'prismjs' {
  const Prism: {
    languages: Record<string, unknown>;
    highlightElement(element: Element): void;
  };
  export default Prism;
}

declare module 'prismjs/components/*';
