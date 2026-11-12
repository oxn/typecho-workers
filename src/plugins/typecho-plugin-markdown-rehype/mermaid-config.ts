/**
 * Shared Mermaid configuration for the Warm CY public renderer and the
 * Markdown editor preview. Keep both renderers on the same Redux Color Neo
 * visual style.
 */
export function getWarmMermaidConfig(dark: boolean) {
  return {
    startOnLoad: false,
    theme: dark ? 'redux-dark-color' : 'redux-color',
    look: 'neo',
    themeVariables: {
      fontFamily: '"trebuchet ms",verdana,arial,sans-serif',
      fontSize: '16px',
    },
  };
}
