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
      // Keep mindmap hierarchy colors independent from transparent diagram surfaces.
      git0: dark ? '#334155' : '#64748b',
      gitBranchLabel0: '#ffffff',
      cScale1: dark ? '#1e3a5f' : '#dbeafe',
      cScaleLabel1: dark ? '#dbeafe' : '#1e3a8a',
      cScale2: dark ? '#14532d' : '#dcfce7',
      cScaleLabel2: dark ? '#dcfce7' : '#14532d',
      cScale3: dark ? '#78350f' : '#fef3c7',
      cScaleLabel3: dark ? '#fef3c7' : '#78350f',
      cScale4: dark ? '#831843' : '#fce7f3',
      cScaleLabel4: dark ? '#fce7f3' : '#831843',
      cScale5: dark ? '#4c1d95' : '#ede9fe',
      cScaleLabel5: dark ? '#ede9fe' : '#4c1d95',
      cScale6: dark ? '#164e63' : '#cffafe',
      cScaleLabel6: dark ? '#cffafe' : '#164e63',
      cScale7: dark ? '#7c2d12' : '#ffedd5',
      cScaleLabel7: dark ? '#ffedd5' : '#7c2d12',
      cScale8: dark ? '#334155' : '#e2e8f0',
      cScaleLabel8: dark ? '#e2e8f0' : '#334155',
      cScale9: dark ? '#6b21a8' : '#f3e8ff',
      cScaleLabel9: dark ? '#f3e8ff' : '#6b21a8',
      cScale10: dark ? '#365314' : '#ecfccb',
      cScaleLabel10: dark ? '#ecfccb' : '#365314',
      cScale11: dark ? '#881337' : '#ffe4e6',
      cScaleLabel11: dark ? '#ffe4e6' : '#881337',
    },
  };
}
