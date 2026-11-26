/** Shared light/dark Mermaid configuration. */
export function getOxnMermaidConfig(dark: boolean) {
 return {startOnLoad:false,theme:dark?'dark':'default'};
}
