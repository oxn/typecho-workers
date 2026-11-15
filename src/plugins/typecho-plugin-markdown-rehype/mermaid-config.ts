/** Rin emits separate light and dark Mermaid source containers. */
export function getRinMermaidConfig(dark: boolean) {
  return {
    startOnLoad: false,
    theme: dark ? 'dark' : 'default',
  };
}
