/**
 * Shared Mermaid configuration for the Warm CY public renderer and the
 * Markdown editor preview. Keep the light palette aligned with Mermaid's
 * classic default look used by the public theme.
 */
export function getWarmMermaidConfig(dark: boolean) {
  return {
    startOnLoad: false,
    theme: dark ? 'dark' : 'default',
    look: 'classic',
    themeVariables: {
      fontFamily: '"trebuchet ms",verdana,arial,sans-serif',
      fontSize: '16px',
    },
  };
}
