import mermaid from 'mermaid';

// Expose the fully bundled browser runtime for the editor's on-demand loader.
// Keeping this as a client entry lets esbuild include Mermaid's relative chunks
// instead of publishing only its ESM entry file as an isolated static asset.
(window as any).__warmCyMermaid = mermaid;
