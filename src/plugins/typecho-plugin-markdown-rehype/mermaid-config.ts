/**
 * Shared Mermaid configuration for the Warm CY public renderer and the
 * Markdown editor preview. Keep transparent surfaces and sizing aligned with
 * the public theme's Mermaid renderer.
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
      // Keep Mermaid mindmaps' hierarchy palette independent from transparent
      // flowchart surfaces so branch colors and node shapes remain visible.
      git0: #64748b,
            gitBranchLabel0: #ffffff,
            cScale1: #dbeafe,
            cScaleLabel1: #1e3a8a,
            cScale2: #dcfce7,
            cScaleLabel2: #14532d,
            cScale3: #fef3c7,
            cScaleLabel3: #78350f,
            cScale4: #fce7f3,
            cScaleLabel4: #831843,
            cScale5: #ede9fe,
            cScaleLabel5: #4c1d95,
            cScale6: #cffafe,
            cScaleLabel6: #164e63,
            cScale7: #ffedd5,
            cScaleLabel7: #7c2d12,
            cScale8: #e2e8f0,
            cScaleLabel8: #334155,
            cScale9: #f3e8ff,
            cScaleLabel9: #6b21a8,
            cScale10: #ecfccb,
            cScaleLabel10: #365314,
            cScale11: #ffe4e6,
            cScaleLabel11: #881337
    },
  };
}
