/**
 * Shared Mermaid configuration for the Warm CY public renderer and the
 * Markdown editor preview. Keep the light palette aligned with Mermaid's
 * classic default look used by the public theme.
 */
export function getWarmMermaidConfig(dark: boolean) {
  return {
    startOnLoad: false,
    // Keep Mermaid's intrinsic SVG dimensions so both renderers can center it consistently.
    useMaxWidth: false,
    theme: dark ? 'dark' : 'base',
    look: 'classic',
    themeVariables: {
      fontFamily: '"trebuchet ms",verdana,arial,sans-serif',
      fontSize: '16px',
      // Use transparent surfaces in both the public renderer and editor preview.
      primaryColor: 'transparent',
      primaryBorderColor: '#9370DB',
      primaryTextColor: '#333333',
      nodeBkg: 'transparent',
      mainBkg: 'transparent',
      background: 'transparent',
      secondaryColor: 'transparent',
      secondaryBorderColor: '#aaaa33',
      secondaryTextColor: '#333333',
      tertiaryColor: 'transparent',
      tertiaryBorderColor: '#aaaa33',
      tertiaryTextColor: '#333333',
      clusterBkg: 'transparent',
      edgeLabelBackground: 'transparent',
      lineColor: '#333333',
    },
  };
}
