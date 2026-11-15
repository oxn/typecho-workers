/** Rin emits separate light and dark Mermaid source containers. */
export function getRinMermaidConfig(dark: boolean) {
  return {
    startOnLoad: false,
    theme: dark ? 'dark' : 'default',
  };
}

/**
 * Backward-compatible public export used by the Warm CY theme.
 * Keep both theme integrations on the same Mermaid configuration contract.
 */
export const getWarmMermaidConfig = getRinMermaidConfig;
